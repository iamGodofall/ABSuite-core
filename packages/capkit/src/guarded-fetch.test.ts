/**
 * The redirect bypass, tested against real sockets.
 *
 * These deliberately do not stub `globalThis.fetch`. The defect being tested
 * for lived *inside* fetch's redirect handling — a stub that returns whatever
 * the test says would have passed against the broken code, because the broken
 * code's mistake was trusting fetch to do something it does not do. So two real
 * HTTP servers are started, a real redirect is issued, and the assertion is
 * whether the second server was reached.
 *
 * Everything runs on loopback with no external network, so these are as fast
 * and as deterministic as the stubbed suites.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { guardedFetch, BlockedTargetError } from './guarded-fetch';

/** Start a server on loopback and return its port. */
async function serve(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => server.close() };
}

describe('a redirect cannot smuggle a request past the guard', () => {
  let target: Awaited<ReturnType<typeof serve>>;
  let redirector: Awaited<ReturnType<typeof serve>>;
  let targetHits = 0;

  beforeEach(async () => {
    targetHits = 0;
    target = await serve((_req, res) => {
      targetHits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ iam: 'STOLEN-CREDENTIALS' }));
    });
    redirector = await serve((req, res) => {
      if (req.url === '/ok') { res.writeHead(200); res.end('legitimate'); return; }
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/latest/meta-data/iam/` });
      res.end();
    });
  });

  afterEach(() => { target.close(); redirector.close(); });

  /*
   * `localhost` is named in the allowlist so hop zero passes on its own merits,
   * exactly as a permitted public host would. Hop one is the same machine by a
   * different name, so nothing about the network is doing the work here — only
   * whether the second hop is inspected at all.
   */
  const policy = { refuse: ['loopback' as const], allow: ['localhost'], verb: 'call' };

  test('the redirect target is refused, and never contacted', async () => {
    await expect(
      guardedFetch(`http://localhost:${redirector.port}/hook`, {}, policy)
    ).rejects.toThrow(/loopback address \(redirected from hop 1\)/);

    // The assertion that matters. Before this fix the body came back.
    expect(targetHits).toBe(0);
  });

  test('the error says which hop failed, because "it was refused" is not actionable', async () => {
    const error = await guardedFetch(`http://localhost:${redirector.port}/hook`, {}, policy)
      .catch((e: unknown) => e as BlockedTargetError);

    expect(error).toBeInstanceOf(BlockedTargetError);
    expect((error as BlockedTargetError).hop).toBe(1);
    expect((error as BlockedTargetError).target.address).toBe('127.0.0.1');
  });

  test('a request that does not redirect still works', async () => {
    // A guard that broke ordinary requests would be removed, so this is not a
    // formality: it is half of what the fix has to be true of.
    const response = await guardedFetch(`http://localhost:${redirector.port}/ok`, {}, policy);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('legitimate');
  });

  test('a redirect to a permitted host is followed normally', async () => {
    const relay = await serve((_req, res) => {
      res.writeHead(302, { location: `http://localhost:${redirector.port}/ok` });
      res.end();
    });
    try {
      const response = await guardedFetch(`http://localhost:${relay.port}/`, {}, policy);
      expect(await response.text()).toBe('legitimate');
    } finally { relay.close(); }
  });

  test('a redirect loop ends, rather than being followed forever', async () => {
    const loop = await serve((_req, res) => {
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    try {
      await expect(
        guardedFetch(`http://localhost:${loop.port}/`, {}, { ...policy, maxRedirects: 3 })
      ).rejects.toThrow(/more than 3 redirects/);
    } finally { loop.close(); }
  });
});

describe('an allowlist that only binds the first hop is not an allowlist', () => {
  /*
   * This was a hole in the first version of this file, found by probing the fix
   * rather than by reading it.
   *
   * edge-run enforced `EDGERUN_ALLOWED_HOSTS` before calling in, and passed the
   * same list as `allow` — which exempts a host from the *range* check, and says
   * nothing about hosts arrived at later. So hop zero was restricted to the
   * named hosts and every later hop was not: an allowlisted service answering a
   * `302` reached anywhere, with the body returned in `output`.
   *
   * `allow` and `only` answer different questions, and conflating them cost
   * exactly this.
   */
  test('a redirect to a host that is not on the list is refused', async () => {
    let elsewhereHits = 0;
    const elsewhere = await serve((_req, res) => {
      elsewhereHits++;
      res.writeHead(200); res.end('not on the list');
    });
    const listed = await serve((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${elsewhere.port}/` });
      res.end();
    });

    try {
      await expect(
        guardedFetch(`http://localhost:${listed.port}/`, {}, { refuse: [], only: ['localhost'], verb: 'call' })
      ).rejects.toThrow(/not on the allowed host list \(redirected from hop 1\)/);

      expect(elsewhereHits).toBe(0);
    } finally { elsewhere.close(); listed.close(); }
  });

  test('a host on the list is called normally', async () => {
    const server = await serve((_req, res) => { res.writeHead(200); res.end('fine'); });
    try {
      const response = await guardedFetch(`http://localhost:${server.port}/`, {},
        { refuse: [], only: ['localhost'], verb: 'call' });
      expect(await response.text()).toBe('fine');
    } finally { server.close(); }
  });

  test('a name that will not resolve is still held to the list', async () => {
    /*
     * Ordering, and it matters. `resolveRanges` returns undefined for a name it
     * cannot resolve, and that is deliberately not a refusal — so if `only` were
     * checked after resolution, an unresolvable host would skip the one rule
     * that does not depend on resolution at all.
     */
    await expect(
      guardedFetch('http://no-such-host.invalid/', {}, { refuse: [], only: ['localhost'], verb: 'call' })
    ).rejects.toThrow(/not on the allowed host list/);
  });
});

describe('credentials do not follow a redirect across origins', () => {
  /*
   * Following redirects by hand means owning the rules fetch was applying for
   * us. This is the one whose absence is silent: nothing fails, the request
   * succeeds, and the caller's bearer token has been handed to whichever host
   * the redirect named.
   */
  test('Authorization is dropped when the origin changes', async () => {
    let seen: string | undefined = 'never-ran';
    const other = await serve((req, res) => {
      seen = req.headers.authorization;
      res.writeHead(200); res.end('ok');
    });
    const start = await serve((_req, res) => {
      // A different port is a different origin.
      res.writeHead(302, { location: `http://127.0.0.1:${other.port}/` });
      res.end();
    });

    try {
      await guardedFetch(`http://127.0.0.1:${start.port}/`,
        { headers: { authorization: 'Bearer SUPER-SECRET' } },
        { refuse: [], verb: 'call' });

      expect(seen).toBeUndefined();
    } finally { other.close(); start.close(); }
  });

  test('Authorization survives a redirect within the same origin', async () => {
    // Dropping it here would break every API that redirects /v1/x to /v1/x/.
    let seen: string | undefined;
    const server = await serve((req, res) => {
      if (req.url === '/start') { res.writeHead(302, { location: '/finish' }); res.end(); return; }
      seen = req.headers.authorization;
      res.writeHead(200); res.end('ok');
    });

    try {
      await guardedFetch(`http://127.0.0.1:${server.port}/start`,
        { headers: { authorization: 'Bearer SAME-ORIGIN' } },
        { refuse: [], verb: 'call' });

      expect(seen).toBe('Bearer SAME-ORIGIN');
    } finally { server.close(); }
  });
});

describe('the method and body a redirect produces', () => {
  /*
   * Replicated from the fetch spec because following redirects by hand means
   * owning it. Getting this wrong does not throw — it silently re-POSTs a body
   * to a URL it was never sent to.
   */
  test.each([
    [301, 'POST', 'GET'],
    [302, 'POST', 'GET'],
    [303, 'POST', 'GET'],
    [303, 'PUT', 'GET'],
    [307, 'POST', 'POST'],
    [308, 'POST', 'POST'],
  ])('%i turns %s into %s', async (status, sent, expected) => {
    let method: string | undefined;
    let body = '';
    const server = await serve((req, res) => {
      if (req.url === '/start') { res.writeHead(status, { location: '/finish' }); res.end(); return; }
      method = req.method;
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { res.writeHead(200); res.end('ok'); });
    });

    try {
      await guardedFetch(`http://127.0.0.1:${server.port}/start`,
        { method: sent, body: 'payload', headers: { 'content-type': 'text/plain' } },
        { refuse: [], verb: 'call' });

      expect(method).toBe(expected);
      expect(body).toBe(expected === 'POST' ? 'payload' : '');
    } finally { server.close(); }
  });
});

describe('metadata endpoints are refused whatever the policy says', () => {
  /*
   * The reason this is not left to each caller's range list: AWS serves IMDS
   * over IPv6 at fd00:ec2::254, which is unique-local. edge-run and quickbench
   * refuse link-local and allow unique-local — correctly, since an fd00::/8
   * service is the kind of internal thing they exist to call — so the IPv6
   * endpoint was reachable in both while the IPv4 one was refused.
   */
  test.each([
    ['the IPv4 metadata service', 'http://169.254.169.254/latest/meta-data/'],
    ['the ECS task credentials endpoint', 'http://169.254.170.2/v2/credentials/'],
    ['AWS IMDS over IPv6', 'http://[fd00:ec2::254]/latest/meta-data/'],
    ['metadata.google.internal', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['metadata.google.internal with a trailing dot', 'http://metadata.google.internal./'],
  ])('refuses %s with an empty refuse list', async (_label, url) => {
    await expect(guardedFetch(url, {}, { refuse: [], verb: 'call' }))
      .rejects.toThrow(/metadata/i);
  });

  test('naming a metadata endpoint in the allowlist does not permit it', async () => {
    // Every other rule here can be overridden by the operator. This one cannot,
    // because an allowlist entry naming the credential service is far more
    // likely to be an injected value than an intention.
    await expect(
      guardedFetch('http://169.254.169.254/', {}, { refuse: [], allow: ['169.254.169.254'], verb: 'call' })
    ).rejects.toThrow(/metadata/i);
  });
});

describe('what the guard refuses before any socket opens', () => {
  test.each([
    ['a URL that cannot be parsed', 'not a url', /could not be parsed/],
    ['file:', 'file:///etc/passwd', /unsupported protocol/],
    ['data:', 'data:text/plain,hello', /unsupported protocol/],
  ])('%s', async (_label, url, expected) => {
    await expect(guardedFetch(url, {}, { refuse: [], verb: 'call' })).rejects.toThrow(expected);
  });

  test('an unresolvable host is not reported as a security refusal', async () => {
    // It fails at fetch anyway. Reporting a DNS outage as a security event
    // teaches operators to ignore security events.
    await expect(guardedFetch('http://no-such-host.invalid/', {}, { refuse: ['loopback'], verb: 'call' }))
      .rejects.not.toThrow(/Refusing/);
  });
});

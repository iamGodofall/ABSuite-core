/**
 * An `http` task must not be a way to read the machine's cloud credentials.
 *
 * `EDGERUN_ALLOWED_HOSTS` empty means *any host*, and empty is the documented
 * default. So out of the box, probing found every one of these reachable, with
 * the response body returned in `output`:
 *
 *     http://169.254.169.254/latest/meta-data/iam/security-credentials/
 *     http://metadata.google.internal/computeMetadata/v1/
 *
 * Plain `http:` is accepted, and that detail is the whole difference from the
 * sibling defect in connector-starter: **AWS IMDSv1 is HTTP-only.** Requiring
 * https there incidentally blocked the classic credential-theft path. Here
 * nothing did.
 *
 * A `queue:write` scope means *queue a task*. It does not mean *read this
 * machine's IAM credentials*.
 *
 * ## Why private ranges are deliberately still allowed
 *
 * edge-run is a task runner inside your own infrastructure. *Call
 * `http://10.0.0.5/reindex` every fifteen minutes* is the product's primary
 * job, not an attack. Blocking `10.x` by default would break real deployments
 * to prevent nothing — and a control that breaks the main use case gets
 * switched off, which protects nobody. Link-local is different: never a
 * legitimate scheduled-task target, and the highest-value one there is.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TaskRuntime } from './runtime';

describe('http tasks refuse the cloud metadata service', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Stub the network so a regression cannot actually reach anything, and so
    // "reached" is unambiguous rather than a connection error.
    globalThis.fetch = (async () => new Response('{"creds":"stolen"}', { status: 200 })) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const run = (url: string, allowedHosts?: string[]) =>
    new TaskRuntime(allowedHosts ? { allowedHosts } : {}).execute({ type: 'http', url });

  test.each([
    ['the AWS/GCP/Azure metadata address', 'http://169.254.169.254/latest/meta-data/', /metadata service/],
    ['the ECS task credentials endpoint', 'http://169.254.170.2/v2/credentials/', /metadata service/],
    ['AWS IMDS over IPv6, which is unique-local not link-local', 'http://[fd00:ec2::254]/latest/', /metadata service/],
    ['anything else in link-local', 'http://169.254.1.1/', /metadata range/],
    ['IPv6 link-local', 'http://[fe80::1]/admin', /IPv6 link-local/],
  ])('refuses %s', async (_label, url, expected) => {
    const result = await run(url);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(expected);
  });

  /*
   * By name, not only by address.
   *
   * `metadata.google.internal` resolves to 169.254.169.254 on GCP and returns
   * ENOTFOUND everywhere else — verified, not assumed. So a DNS-based check
   * catches it only in the one environment where it is hardest to test, which
   * is why the name is refused outright.
   */
  test.each([
    ['metadata.google.internal', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['metadata.goog', 'http://metadata.goog/computeMetadata/v1/'],
  ])('refuses %s by name, without depending on the resolver', async (_label, url) => {
    const result = await run(url);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GCP metadata service/);
  });

  test('still refuses a protocol that is not http or https', async () => {
    const result = await run('file:///etc/passwd');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unsupported protocol/);
  });
});

describe('the task runner keeps doing its job', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const run = (url: string, allowedHosts?: string[]) =>
    new TaskRuntime(allowedHosts ? { allowedHosts } : {}).execute({ type: 'http', url });

  test.each([
    ['a private address, which is the primary use case', 'http://10.0.0.5/reindex'],
    ['another private range', 'http://192.168.1.10/webhook'],
    ['loopback, for a sidecar', 'http://127.0.0.1:8081/health'],
    ['an ordinary public host', 'https://example.com/hook'],
  ])('still calls %s', async (_label, url) => {
    const result = await run(url);

    expect(result.ok).toBe(true);
  });

  test('an explicit allowlist entry wins for an ordinary internal host', async () => {
    const refused = await run('http://169.254.1.1/x');
    expect(refused.ok).toBe(false);

    const allowed = await run('http://169.254.1.1/x', ['169.254.1.1']);
    expect(allowed.ok).toBe(true);
  });

  /*
   * This is a deliberate change from what this package used to promise, which
   * was that naming a host in `EDGERUN_ALLOWED_HOSTS` always won.
   *
   * That conflated two different statements. *Restrict which hosts this may
   * call* is a scoping decision an operator makes routinely; *yes, read this
   * machine's cloud credentials* is not, and the knob named for the first
   * should not quietly be the one that does the second. The override still
   * exists — a control an operator cannot turn off gets patched out, and a
   * patched-out control protects nobody — it just has to be asked for by name.
   */
  test('the allowlist alone no longer opens the metadata service', async () => {
    const allowlisted = await run('http://169.254.169.254/x', ['169.254.169.254']);

    expect(allowlisted.ok).toBe(false);
    expect(allowlisted.error).toMatch(/EDGERUN_ALLOW_METADATA/);
  });

  test('EDGERUN_ALLOW_METADATA=true does open it, for the operator who means it', async () => {
    const runtime = new TaskRuntime({ allowedHosts: ['169.254.169.254'], allowMetadata: true });
    const result = await runtime.execute({ type: 'http', url: 'http://169.254.169.254/x' });

    expect(result.ok).toBe(true);
  });

  /*
   * The allowlist has to survive a redirect, or it is a check on the URL that
   * was queued rather than a restriction on what the runtime may reach. It did
   * not, at first: an allowlisted host answering a 302 returned the body from a
   * host the operator had excluded.
   *
   * Real servers here rather than the stubbed fetch the rest of this file uses,
   * because the defect is in how redirects are followed and a stub follows none.
   */
  test('the allowlist survives a redirect, which is what makes it a restriction', async () => {
    globalThis.fetch = realFetch;

    let offListHits = 0;
    const offList = http.createServer((_q, r) => { offListHits++; r.writeHead(200); r.end('{"reached":true}'); });
    await new Promise<void>(resolve => { offList.listen(0, '127.0.0.1', resolve); });
    const offPort = (offList.address() as AddressInfo).port;

    const listed = http.createServer((_q, r) => {
      r.writeHead(302, { location: `http://127.0.0.1:${offPort}/` });
      r.end();
    });
    await new Promise<void>(resolve => { listed.listen(0, '127.0.0.1', resolve); });
    const listedPort = (listed.address() as AddressInfo).port;

    try {
      const result = await new TaskRuntime({ allowedHosts: ['localhost'] })
        .execute({ type: 'http', url: `http://localhost:${listedPort}/` });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not on the allowed host list/);
      expect(offListHits).toBe(0);
    } finally { offList.close(); listed.close(); }
  });

  test('an allowlist still excludes everything not on it', async () => {
    const result = await run('https://example.com/hook', ['internal.example.net']);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Host not allowed/);
  });
});

/**
 * The dashboard's own routes, over a real socket.
 *
 * This file exists because `find packages/dashboard-ui -name '*.test.ts'`
 * returned nothing. The dashboard is the most privileged process in a default
 * deployment — it holds `CAPKIT_ADMIN_KEY` and mounts the Docker socket — and
 * it had no test of any kind.
 *
 * That is how `/endpoint-check` shipped as the fourth instance of the SSRF this
 * repository had already fixed three times, with two defects at once:
 *
 *   - **no `requireAdminAccess`**, alone among the routes that reach anything,
 *     making it an unauthenticated localhost port scanner; and
 *   - **a hostname allowlist covering one hop**, so an allowlisted service
 *     answering `302 Location: http://elsewhere/` reached that host and the
 *     route reported `ok: true`.
 *
 * Both were found by probing a running server and fixed by hand. Neither was
 * protected by anything afterwards, which made the fix exactly as durable as
 * one person's memory of a terminal session.
 *
 * `127.0.0.2` is the off-allowlist target throughout. The whole of `127/8` is
 * local on Linux, so it needs no external network and no environment-specific
 * interface — and it is genuinely not on the health-host list, which is what
 * makes it a real test rather than a staged one.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const ADMIN = 'test-admin-key-not-a-secret';
const PACKAGE = join(__dirname);
// The real CLI entry, not the `.bin` shim. On Windows the shim is an
// extension-less shell script that `spawn` cannot execute directly (ENOENT),
// so we invoke Node with the actual `tsx` CLI script instead — identical on
// every platform.
const TSX = join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** A free port from the OS, so parallel suites cannot collide. */
async function freePort(): Promise<number> {
  const { createServer: net } = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = net();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface Instance { child: ChildProcess; base: string }

/**
 * Start the real server and wait until it answers.
 *
 * `/health` is the readiness probe because it is the one route deliberately
 * left open — a gated health endpoint makes a platform declare the container
 * dead.
 */
async function start(env: Record<string, string>): Promise<Instance> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [TSX, 'server.ts'], {
    cwd: PACKAGE,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 40_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`dashboard never became healthy on ${base}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return { child, base };
}

async function stop(instance: Instance | undefined) {
  if (!instance?.child || instance.child.exitCode !== null) return;
  await new Promise<void>(resolve => {
    const done = () => resolve();
    instance.child.once('exit', done);
    instance.child.kill('SIGTERM');
    setTimeout(done, 5_000).unref?.();
  });
}

const listen = (server: Server, host: string) =>
  new Promise<number>(resolve => server.listen(0, host, () => resolve((server.address() as AddressInfo).port)));

describe('the dashboard with an admin key configured', () => {
  let dashboard: Instance | undefined;

  /** The off-allowlist target. Counts its own hits, which is the assertion. */
  let offList: Server;
  let offListPort = 0;
  let offListHits = 0;

  /** On the allowlist, and answers a redirect to the one that is not. */
  let redirector: Server;
  let redirectorPort = 0;

  beforeAll(async () => {
    offList = createServer((_req, res) => {
      offListHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ reached: 'a host the allowlist excludes' }));
    });
    offListPort = await listen(offList, '127.0.0.2');

    redirector = createServer((req, res) => {
      if (req.url === '/health') { res.writeHead(200); res.end('{}'); return; }
      res.writeHead(302, { location: `http://127.0.0.2:${offListPort}/health` });
      res.end();
    });
    redirectorPort = await listen(redirector, '127.0.0.1');

    dashboard = await start({ ABSUITE_ADMIN_API_KEY: ADMIN });
  }, 60_000);

  afterAll(async () => {
    await stop(dashboard);
    offList.close();
    redirector.close();
  }, 20_000);

  beforeEach(() => { offListHits = 0; });

  const check = (url: string, headers: Record<string, string> = {}) =>
    fetch(`${dashboard!.base}/endpoint-check?url=${encodeURIComponent(url)}`, { headers });

  const asAdmin = (url: string) => check(url, { 'x-absuite-admin-key': ADMIN });

  test('/health answers without credentials, because a gated one reads as dead', async () => {
    expect((await fetch(`${dashboard!.base}/health`)).ok).toBe(true);
  });

  test('the route refuses an unauthenticated caller', async () => {
    // It distinguishes an open port from a closed one, so unauthenticated it is
    // a localhost port scanner for anyone who can reach the dashboard.
    const response = await check(`http://127.0.0.1:${redirectorPort}/health`);

    expect(response.status).toBe(403);
  });

  test('a wrong admin key is refused too', async () => {
    const response = await check(`http://127.0.0.1:${redirectorPort}/health`, {
      'x-absuite-admin-key': 'not-the-key',
    });

    expect(response.status).toBe(403);
  });

  test('an allowlisted host is still checked, which is the whole feature', async () => {
    // Half of what the fix has to be true of. A guard that broke this would be
    // removed, and would protect nobody.
    const response = await asAdmin(`http://127.0.0.1:${redirectorPort}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: 200 });
  });

  test('a host that is not on the allowlist is refused before any request', async () => {
    const response = await asAdmin(`http://127.0.0.2:${offListPort}/health`);

    expect(response.status).toBe(400);
    expect(offListHits).toBe(0);
  });

  /*
   * The defect. Hop zero passes on its own merits, exactly as it should, and
   * everything after it used to be unchecked.
   */
  test('a redirect to an off-allowlist host is refused, and never contacted', async () => {
    const response = await asAdmin(`http://127.0.0.1:${redirectorPort}/redirect-me`);
    const body = await response.json() as { message?: string };

    expect(body.message).toMatch(/not on the allowed host list/);

    // The assertion that matters. Before the fix this server logged the request
    // and the route answered `ok: true`.
    expect(offListHits).toBe(0);
  });

  test.each([
    ['file:', 'file:///etc/passwd'],
    ['a URL that will not parse', 'not a url at all'],
    ['an empty url', ''],
  ])('refuses %s', async (_label, url) => {
    expect((await asAdmin(url)).status).toBe(400);
  });
});

/**
 * What an unauthenticated caller can actually read.
 *
 * Twelve of the dashboard's fifty routes carry no `requireAdminAccess`, and
 * several of them are right to — `/health` cannot carry credentials, and
 * `POST /executions/verify` being open to a stranger is the product's argument
 * rather than a concession. `check:routeauth` now makes each of the twelve
 * state its reason.
 *
 * A stated reason is a claim, so these assert the claims. The one that was
 * wrong: `/service-health/absuite-db` returned `ABSUITE_DB_PATH` to anonymous
 * callers, in a field the interface never read.
 */
describe('what the public routes disclose', () => {
  let dashboard: Instance | undefined;

  beforeAll(async () => {
    dashboard = await start({
      ABSUITE_ADMIN_API_KEY: ADMIN,
      ABSUITE_DB_PATH: '/very/specific/path/absuite.db',
    });
  }, 60_000);

  afterAll(async () => { await stop(dashboard); }, 20_000);

  const get = (path: string) => fetch(`${dashboard!.base}${path}`);

  test('service health does not disclose the database path', async () => {
    const response = await get('/service-health/absuite-db');
    const text = await response.text();

    expect(text).not.toContain('/very/specific/path');
    expect(text).not.toContain('ABSUITE_DB_PATH');
    // Still answers the question it exists to answer.
    expect(JSON.parse(text)).toMatchObject({ service: 'absuite-db' });
  });

  test('an invalid service name is refused rather than proxied', async () => {
    /*
     * The allowlist is what stops this becoming a way to aim the dashboard.
     *
     * Encoded, because an unencoded `../..` is normalised by the client before
     * the request is sent and never reaches this handler at all — it lands on
     * the single-page-app fallback and returns the bundle with a 200. The first
     * version of this test asserted `not 200` against the unencoded form and
     * failed, and the failure was the assertion being wrong rather than the
     * route being open.
     */
    expect((await get('/service-health/nonesuch')).status).toBe(400);
    expect((await get('/service-health/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status).toBe(400);
    expect((await get('/service-health/..%2f..%2fetc')).status).toBe(400);
  });

  test('status reports service state and nothing else', async () => {
    const body = await (await get('/status')).json() as Record<string, unknown>;

    // Six services plus the database, each a state string. Anything else here
    // would be disclosure that no route annotation claims.
    for (const value of Object.values(body)) expect(typeof value).toBe('string');
    expect(Object.keys(body)).toContain('dashboard');
  });

  test('no public route leaks environment values', async () => {
    /*
     * A blunt sweep, on the principle that the specific leak found here was one
     * nobody had looked for. It cannot prove absence — it pins the ones that
     * exist today against a value that would be unmistakable if it appeared.
     */
    const paths = ['/health', '/status', '/service-health/absuite-db', '/system/layers'];

    for (const path of paths) {
      const text = await (await get(path)).text();
      expect(text).not.toContain('/very/specific/path');
      expect(text).not.toMatch(/test-admin-key-not-a-secret/);
    }
  });
});

/**
 * Layer 4 — model identity, reachable from the interface for the first time.
 *
 * Four routes existed in capkit and none were proxied here, so the only way to
 * approve a model was curl. These assert the proxy, not the registry: capkit's
 * own suite covers fingerprint comparison, and duplicating it here would test
 * the same logic twice and the wiring not at all.
 *
 * capkit is not running in this suite, so the proxy answers 502. That is the
 * assertion worth having — the route exists, is guarded, and reports the
 * dependency honestly rather than inventing an empty list, which is exactly the
 * failure `Empty` and `unverifiable` exist to prevent in the interface.
 */
describe('the model-identity proxy', () => {
  let dashboard: Instance | undefined;

  beforeAll(async () => { dashboard = await start({ ABSUITE_ADMIN_API_KEY: ADMIN }); }, 60_000);
  afterAll(async () => { await stop(dashboard); }, 20_000);

  const admin = { 'x-absuite-admin-key': ADMIN };

  test.each([
    ['GET', '/models'],
    ['POST', '/models'],
    ['POST', '/models/refunds-classifier/supersede'],
    ['POST', '/models/refunds-classifier/attest'],
  ])('%s %s refuses an unauthenticated caller', async (method, path) => {
    const response = await fetch(`${dashboard!.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });

    expect(response.status).toBe(403);
  });

  test.each([
    ['GET', '/models'],
    ['POST', '/models'],
    ['POST', '/models/refunds-classifier/attest'],
  ])('%s %s reaches capkit when authenticated, and says so when it cannot', async (method, path) => {
    const response = await fetch(`${dashboard!.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...admin },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });

    // 502 when capkit is not running here, 401 when a real capkit is running
    // and rejects the test key. What must never happen is 200 with an empty
    // list, which would read as "no models approved".
    expect([502, 401]).toContain(response.status);
    if (response.status === 502) {
      expect(await response.json()).toMatchObject({ error: 'CapKit is unreachable' });
    }
  });

  test('the model name is encoded rather than interpolated raw', async () => {
    // A name with a slash must not become a different upstream path.
    const response = await fetch(`${dashboard!.base}/models/${encodeURIComponent('a/../b')}/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...admin },
      body: '{}',
    });

    // 502 when capkit is not running, 401 when a real capkit rejects the test
    // key. Either way the encoded name was forwarded, not interpolated.
    expect([502, 401]).toContain(response.status);
  });
});

/**
 * Tenancy and billing — the last §2 row, and the one about money.
 *
 * These assert the proxy and its one piece of real logic: the action segment is
 * checked against a list rather than interpolated. Without that, a route reading
 * `/admin/tenants/:id/:action` would let a caller aim the dashboard's admin key
 * at any capkit path beneath `/admin/tenants/:id/`.
 */
describe('the tenancy proxy', () => {
  let dashboard: Instance | undefined;

  beforeAll(async () => { dashboard = await start({ ABSUITE_ADMIN_API_KEY: ADMIN }); }, 60_000);
  afterAll(async () => { await stop(dashboard); }, 20_000);

  const admin = { 'content-type': 'application/json', 'x-absuite-admin-key': ADMIN };

  test.each([
    ['GET', '/admin/tenants'],
    ['POST', '/admin/tenants'],
    ['POST', '/admin/tenants/ten_1/plan'],
    ['POST', '/admin/tenants/ten_1/rotate-key'],
  ])('%s %s refuses an unauthenticated caller', async (method, path) => {
    const response = await fetch(`${dashboard!.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });

    expect(response.status).toBe(403);
  });

  test.each(['plan', 'status', 'rotate-key'])('%s is a permitted action', async (action) => {
    const response = await fetch(`${dashboard!.base}/admin/tenants/ten_1/${action}`, {
      method: 'POST', headers: admin, body: '{}',
    });

    // 502 when capkit is not running, 401 when a real capkit rejects the test
    // key — the point is that it was allowed through rather than refused as an
    // unknown action.
    expect([502, 401]).toContain(response.status);
  });

  test.each([
    ['an invented action', 'delete'],
    ['a path traversal in the action', '..%2f..%2fexecutions'],
    ['an upstream admin path', 'rotate-key%2f..%2f..%2ftenants'],
  ])('refuses %s', async (_label, action) => {
    const response = await fetch(`${dashboard!.base}/admin/tenants/ten_1/${action}`, {
      method: 'POST', headers: admin, body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Unknown tenant action') });
  });

  test('an unreachable capkit is reported, not answered with an empty list', async () => {
    // An empty tenants array would read as "nobody is metered", which is the
    // same false zero this whole panel exists to avoid. 502 when capkit is not
    // running, 401 when a real capkit rejects the test key — either way the
    // proxy reported the dependency honestly instead of inventing an empty list.
    const response = await fetch(`${dashboard!.base}/admin/tenants`, { headers: admin });

    expect([502, 401]).toContain(response.status);
    if (response.status === 502) {
      expect(await response.json()).toMatchObject({ error: 'CapKit is unreachable' });
    }
  });
});

/**
 * The gate a public instance rests on, which had no test at all.
 *
 * `ABSUITE_PUBLIC_PASSWORD` puts basic auth in front of every route including
 * the static bundle. It is the only thing standing between a demo instance and
 * anybody who finds the address — and that process holds `CAPKIT_ADMIN_KEY` and
 * can start and stop services.
 *
 * It was written, documented under a heading reading *"The password is not
 * optional"*, and asserted by nothing. These run before any link to a public
 * instance is posted anywhere.
 */
describe('a public instance, gated by password', () => {
  const PASSWORD = 'demo-pass-not-a-secret';
  const credentials = `Basic ${Buffer.from(`absuite:${PASSWORD}`).toString('base64')}`;

  let dashboard: Instance | undefined;

  beforeAll(async () => {
    dashboard = await start({ ABSUITE_PUBLIC_PASSWORD: PASSWORD, ABSUITE_ADMIN_API_KEY: ADMIN });
  }, 60_000);

  afterAll(async () => { await stop(dashboard); }, 20_000);

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${dashboard!.base}${path}`, { headers });

  /*
   * Every route, including the ones added most recently. A gate registered
   * before the routes covers them by construction — but "by construction" is
   * the reasoning that produced four SSRF instances, so it is asserted instead.
   */
  test.each([
    '/', '/status', '/models', '/admin/tenants', '/executions/public-key',
    '/ai/providers', '/system/layers', '/bench/core',
  ])('%s is 401 without credentials', async (path) => {
    expect((await get(path)).status).toBe(401);
  });

  test('the challenge names basic auth, or a browser will not prompt', async () => {
    expect((await get('/status')).headers.get('www-authenticate')).toMatch(/^Basic/);
  });

  test('a wrong password is refused', async () => {
    const wrong = `Basic ${Buffer.from('absuite:not-the-password').toString('base64')}`;
    expect((await get('/status', { authorization: wrong })).status).toBe(401);
  });

  test('the right password gets through', async () => {
    expect((await get('/status', { authorization: credentials })).status).toBe(200);
  });

  /*
   * Two gates, not one. The password admits you to the instance; the admin key
   * is still required for anything that reads the record. A visitor to a public
   * demo gets the interface, not the executions.
   */
  test('the password alone does not open the admin routes', async () => {
    expect((await get('/models', { authorization: credentials })).status).toBe(403);
  });

  test('/health stays open, because a gated one reads as a dead container', async () => {
    expect((await get('/health')).status).toBe(200);
  });
});

describe('the dashboard with no admin key configured', () => {
  let dashboard: Instance | undefined;

  beforeAll(async () => {
    dashboard = await start({ ABSUITE_ADMIN_API_KEY: '' });
  }, 60_000);

  afterAll(async () => { await stop(dashboard); }, 20_000);

  /*
   * The default deployment sets no admin key, so this is the configuration most
   * instances actually run. If the route were open here, the fix would be void
   * exactly where it matters most.
   */
  test('the route is closed rather than open when unconfigured', async () => {
    const response = await fetch(`${dashboard!.base}/endpoint-check?url=${encodeURIComponent('http://127.0.0.1/health')}`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'Service management is disabled' });
  });
});

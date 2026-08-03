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
const TSX = join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

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

  const child = spawn(TSX, ['server.ts'], {
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

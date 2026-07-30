import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run the real HTTP server and talk to it over the network.
 *
 * Every unit in this package was tested and none of the routes were, which is
 * how `POST /auth/token/validate` shipped accepting a `requiredScope` field and
 * silently ignoring it: asking "is this token good for payment:refund?" about a
 * token holding only `payment:approve` answered `{"valid": true}`. A false
 * allow, from the endpoint whose entire job is to answer that question.
 *
 * No amount of reading the handler would have caught it. Something had to send
 * the request.
 */
const BUILT = join(__dirname, '..', 'dist', 'server.js');

const SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef';
const ADMIN = 'test-admin-key-not-a-secret';

let child: ChildProcess | undefined;
let base = '';
let dataDir = '';

/** A free port from the OS, so parallel suites cannot collide. */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  if (!existsSync(BUILT)) throw new Error(`${BUILT} is missing — run pnpm build first`);

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  dataDir = mkdtempSync(join(tmpdir(), 'capkit-smoke-'));

  child = spawn(process.execPath, [BUILT], {
    env: {
      ...process.env,
      PORT: String(port),
      CAPKIT_HMAC_SECRET: SECRET,
      CAPKIT_ADMIN_KEY: ADMIN,
      ABSUITE_DB_PATH: join(dataDir, 'absuite.db'),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('server never became healthy');
    await new Promise(r => setTimeout(r, 200));
  }
}, 30_000);

afterAll(() => {
  child?.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const issue = async (scope: string[]) => {
  const { body } = await post(
    '/auth/token',
    { sub: 'agent:test', scope, expiresIn: '5m' },
    { 'x-absuite-admin-key': ADMIN }
  );
  return String(body.token);
};

describe('the running CapKit server', () => {
  test('reports the version from its manifest, not a hardcoded string', async () => {
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { status: string; version: string };

    expect(body.status).toBe('healthy');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require('../package.json') as { version: string };
    expect(body.version).toBe(manifest.version);
  });

  test('refuses to issue a token without a credential', async () => {
    const { status, body } = await post('/auth/token', { sub: 'a', scope: ['x:y'] });
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe('TOKEN_MISSING');
  });

  test('validates a token against the scope it holds', async () => {
    const token = await issue(['payment:approve']);
    const { status, body } = await post(
      '/auth/token/validate',
      { token, requiredScope: 'payment:approve' },
      { 'x-absuite-admin-key': ADMIN }
    );

    expect(status).toBe(200);
    expect(body.valid).toBe(true);
    // Echoed back so a caller can see the check ran rather than assume it.
    expect(body.requiredScope).toBe('payment:approve');
    expect(body.scopeSatisfied).toBe(true);
  });

  test('refuses a token for a scope it does not hold', async () => {
    const token = await issue(['payment:approve']);
    const { status, body } = await post(
      '/auth/token/validate',
      { token, requiredScope: 'payment:refund' },
      { 'x-absuite-admin-key': ADMIN }
    );

    // This returned 200 {"valid": true} before 1.1.0.
    expect(status).toBe(400);
    expect(body.valid).toBe(false);
    expect(body.error).toBe('CAPABILITY_INSUFFICIENT');
  });

  test('still validates when no scope is named', async () => {
    const token = await issue(['payment:approve']);
    const { status, body } = await post('/auth/token/validate', { token }, { 'x-absuite-admin-key': ADMIN });

    expect(status).toBe(200);
    expect(body.valid).toBe(true);
    // Nothing was asked, so nothing is claimed.
    expect(body.requiredScope).toBeUndefined();
    expect(body.scopeSatisfied).toBeUndefined();
  });

  test('rejects a token signed with a different secret', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciIsInNjb3BlIjpbIioiXSwiZXhwIjo5OTk5OTk5OTk5fQ.notavalidsignature';
    const { status, body } = await post('/auth/token/validate', { token: forged }, { 'x-absuite-admin-key': ADMIN });

    expect(status).toBe(400);
    expect(body.valid).toBe(false);
  });

  test('records an execution and signs it', async () => {
    const token = await issue(['execution:record', 'execution:read']);
    const { status, body } = await post(
      '/executions',
      {
        subject: 'agent:test',
        scope: ['execution:record'],
        module: 'payments',
        action: 'approve_batch',
        input: { batch: 'BATCH-1', total: 1 },
        outcome: 'success',
      },
      { authorization: `Bearer ${token}` }
    );

    expect(status).toBe(201);
    expect(String(body.id)).toMatch(/^exec_/);
    expect(String(body.hash)).toHaveLength(64);
    expect(body.signature).toBeTruthy();
    // Payloads are hashed, never stored.
    expect(JSON.stringify(body)).not.toContain('BATCH-1');
  });

  /**
   * Every route the API reference documents for CapKit must actually answer.
   *
   * A misplaced closing brace once nested every route after `/executions/stats`
   * *inside* that handler. TypeScript accepted it — the code is syntactically
   * fine — the build passed, the unit tests passed, and eleven endpoints simply
   * stopped existing until someone happened to call the one route that
   * registered them. Nothing that reads source could see it. Only asking the
   * server could.
   *
   * A 4xx counts as answering: an auth or validation failure is a real handler
   * declining. Only "no route" means the endpoint is gone.
   */
  test('every documented GET route is actually registered', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join: joinPath } = require('node:path') as typeof import('node:path');

    const doc = readFileSync(joinPath(__dirname, '..', '..', '..', 'docs', 'API.md'), 'utf8');
    const section = doc.slice(doc.indexOf('## CapKit'), doc.indexOf('## ', doc.indexOf('## CapKit') + 5));

    const paths = [...section.matchAll(/^\| GET \| `([^`]+)`/gm)]
      .map(match => match[1]!)
      // Parameterised routes need a real id; they are covered by their own tests.
      .filter(path => !path.includes(':'));

    expect(paths.length).toBeGreaterThan(5);

    const missing: string[] = [];
    for (const path of paths) {
      const res = await fetch(`${base}${path}`, { headers: { 'x-absuite-admin-key': ADMIN } });
      if (res.status >= 500) { missing.push(`${path} → ${res.status}`); continue; }
      if (res.status === 404) {
        const body = await res.text();
        if (body.includes('No route for')) missing.push(`${path} → not registered`);
      }
    }

    expect(missing).toEqual([]);
  }, 30_000);
});

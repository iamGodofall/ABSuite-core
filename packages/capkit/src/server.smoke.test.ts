import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANONICAL_VERSION } from './trace';

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
      // The suite makes far more calls than a person does, and the burst limiter
      // is real: it started returning 429 the moment identity added enrolments,
      // challenges and proofs to the run. Raised for the harness only — the
      // limiter itself is exercised by rate-limit.test.ts, which is where a
      // limit belongs under test rather than as a background hazard here.
      ABSUITE_RATE_LIMIT_PER_MINUTE: '10000',
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

  test('attributes spend to the agent that caused it, with its coverage', async () => {
    const token = await issue(['execution:record', 'execution:read']);
    const auth = { authorization: `Bearer ${token}` };

    await post('/executions', {
      subject: 'agent:spender', scope: ['llm:call'], module: 'llm', action: 'completion',
      input: { prompt: 'x' }, outcome: 'success',
      cost: { amount: 1420, currency: 'USD', source: 'provider-usage-api', unit: 'tokens', quantity: 8_200_000 },
    }, auth);
    // Same agent, no figure recorded. This is the one the coverage must expose.
    await post('/executions', {
      subject: 'agent:spender', scope: ['llm:call'], module: 'llm', action: 'completion',
      input: { prompt: 'y' }, outcome: 'success',
    }, auth);

    const body = (await (await fetch(`${base}/executions/cost`, { headers: { 'x-absuite-admin-key': ADMIN } })).json()) as {
      coverage: { records: number; priced: number; unpriced: number; meaning: string };
      totals: { currency: string; amount: number }[];
      subjects: { subject: string; priced: number; unpriced: number; currencies: { currency: string; amount: number }[] }[];
    };

    const spender = body.subjects.find(entry => entry.subject === 'agent:spender')!;
    expect(spender.currencies).toContainEqual({ currency: 'USD', amount: 1420, executions: 1 });
    expect(spender.priced).toBe(1);
    expect(spender.unpriced).toBe(1);

    expect(body.totals.find(total => total.currency === 'USD')!.amount).toBeGreaterThanOrEqual(1420);
    // Never a bare total: the share of the log it covers travels with it.
    expect(body.coverage.unpriced).toBeGreaterThan(0);
    expect(body.coverage.meaning).toMatch(/nothing here knows/);
  });

  test('refuses a cost it would have to guess at, and says which part', async () => {
    const token = await issue(['execution:record']);
    const auth = { authorization: `Bearer ${token}` };
    const execution = {
      subject: 'agent:sloppy', scope: ['llm:call'], module: 'llm', action: 'completion',
      input: { prompt: 'x' }, outcome: 'success',
    };

    // A float would have to be rounded, and rounding money is the caller's call.
    const fractional = await post('/executions', { ...execution, cost: { amount: 14.2, currency: 'USD', source: 'm' } }, auth);
    expect(fractional.status).toBe(400);
    expect(JSON.stringify(fractional.body)).toMatch(/integer number of minor units/);

    // A figure with nobody behind it is a rumour carrying a signature.
    const anonymous = await post('/executions', { ...execution, cost: { amount: 1420, currency: 'USD' } }, auth);
    expect(anonymous.status).toBe(400);
    expect(JSON.stringify(anonymous.body)).toMatch(/cost.source is required/);
  });

  /**
   * Every report can be read by someone who has only the report.
   *
   * A file opened in 2046 saying "3 records require attention" has told its
   * reader almost nothing: which build, over what scope, verified under which
   * rules? Context is part of the evidence, and a report that outlives the
   * software has to carry its own.
   */
  test('every report carries the build, the moment and the scope that produced it', async () => {
    const token = await issue(['execution:record', 'execution:read']);
    const { body: recorded } = await post('/executions',
      { subject: 'agent:provenance', scope: ['x:y'], jti: 'tok_p', module: 'm', action: 'act', input: { a: 1 }, output: { b: 2 }, outcome: 'success' },
      { authorization: `Bearer ${token}` });

    const headers = { 'x-absuite-admin-key': ADMIN };
    const reports = [
      '/executions/stats',
      '/executions/attention',
      '/executions/unknowns',
      '/executions/authority',
      '/executions/cost',
      `/executions/${String(recorded.id)}/conditions`,
      `/executions/${String(recorded.id)}/explain`,
    ];

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest = require('../package.json') as { version: string };

    for (const path of reports) {
      const body = (await (await fetch(`${base}${path}`, { headers })).json()) as {
        generated?: { service: string; version: string; at: string; canonicalVersion: number; canonicalVersionsVerified: number[]; scope: string };
      };

      expect(body.generated).toBeDefined();
      expect(body.generated!.service).toBe('capkit');
      // Read from the manifest, never typed in — a report asserting the wrong
      // version with confidence is the failure this project argues against.
      expect(body.generated!.version).toBe(manifest.version);
      expect(Date.parse(body.generated!.at)).not.toBeNaN();
      // The newest form this build writes, and every form it can still verify.
      // Reporting only the newest would imply the log is uniform; it is not, and
      // a reader holding just this file has no other way to find out.
      expect(body.generated!.canonicalVersion).toBe(CANONICAL_VERSION);
      expect(body.generated!.canonicalVersionsVerified).toContain(1);
      // Scope is prose because a future reader is a person, not a parser.
      expect(body.generated!.scope.length).toBeGreaterThan(10);
    }
  }, 20_000);

  /**
   * Every count states what it is a count *of*.
   *
   * "3 records need attention" reads identically whether it is 3 of 10 or 3 of
   * ten million, and a truncated list reads exactly like a complete one. The
   * recurring pattern in this codebase — verified against what, unknown resolved
   * by what, absent because of what — applies to quantities too.
   */
  test('every listing states its denominator, and says when it is truncated', async () => {
    const token = await issue(['execution:record', 'execution:read']);
    for (const action of ['a', 'b', 'c']) {
      await post('/executions',
        { subject: 'agent:counts', scope: [], module: 'm', action, input: { action }, outcome: 'failure', error: 'x' },
        { authorization: `Bearer ${token}` });
    }

    const headers = { 'x-absuite-admin-key': ADMIN };

    const attention = (await (await fetch(`${base}/executions/attention?limit=2`, { headers })).json()) as
      { count: number; held: number; limit: number; truncated: boolean; note: string };
    expect(attention.count).toBe(2);
    expect(attention.held).toBeGreaterThanOrEqual(3);
    // A capped list must never read as a complete one.
    expect(attention.truncated).toBe(true);
    expect(attention.note).toMatch(/most recent of an unknown larger number/i);

    const full = (await (await fetch(`${base}/executions/attention?limit=500`, { headers })).json()) as
      { truncated: boolean; note: string };
    expect(full.truncated).toBe(false);
    expect(full.note).toMatch(/record\(s\) held/i);

    const authority = (await (await fetch(`${base}/executions/authority`, { headers })).json()) as
      { held: number; complete: boolean };
    expect(authority.complete).toBe(true);
    expect(authority.held).toBeGreaterThanOrEqual(3);

    const unknowns = (await (await fetch(`${base}/executions/unknowns`, { headers })).json()) as
      { examined: number; held: number };
    expect(unknowns.held).toBeGreaterThanOrEqual(unknowns.examined);
  }, 20_000);

  test('the audit log keeps refusals, and its chain verifies over them', async () => {
    // A request with no token. This must be recorded, not dropped: a log that
    // only holds what was permitted is a log of half the decisions, and the
    // Verify screen states plainly that refusals are kept.
    const refused = await fetch(`${base}/executions`);
    expect(refused.status).toBe(401);

    const headers = { 'x-absuite-admin-key': ADMIN };
    const log = (await (await fetch(`${base}/audit?limit=200`, { headers })).json()) as {
      entries: { action: string; result: 'allow' | 'deny'; reason?: string; hash?: string; prevHash?: string }[];
      total: number;
    };

    const denial = log.entries.find(entry => entry.result === 'deny');
    expect(denial).toBeDefined();
    expect(denial!.reason).toBeTruthy();

    // Every entry carries its own hash and the predecessor it was sealed
    // against, so a reader can recompute the chain rather than take it on faith.
    expect(denial!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(denial!.prevHash).toMatch(/^[0-9a-f]{64}$/);

    const integrity = (await (await fetch(`${base}/audit/verify`, { headers })).json()) as
      { valid: boolean; checked: number; brokenAt?: number; headHash: string };

    expect(integrity.valid).toBe(true);
    expect(integrity.checked).toBeGreaterThanOrEqual(log.entries.length);
    expect(integrity.headHash).toMatch(/^[0-9a-f]{64}$/);

    // The verdict says how many links were checked. "Valid" with no count is a
    // claim about nothing, and the panel that renders this refuses to draw a
    // green state without one.
    expect(integrity.checked).toBeGreaterThan(0);
  }, 20_000);

  test('the unknown queue groups gaps by the work that would close them', async () => {
    const token = await issue(['execution:record', 'execution:read']);

    // Two records with different gaps: one missing an output hash, one with no
    // policy reference and no output hash.
    await post('/executions',
      { subject: 'agent:a', scope: ['x:y'], jti: 'tok_1', module: 'm', action: 'no-output', input: { a: 1 }, outcome: 'success' },
      { authorization: `Bearer ${token}` });
    await post('/executions',
      { subject: 'agent:b', scope: ['x:y'], jti: 'tok_2', module: 'm', action: 'also-no-output', input: { b: 2 }, outcome: 'success' },
      { authorization: `Bearer ${token}` });

    const res = await fetch(`${base}/executions/unknowns`, { headers: { 'x-absuite-admin-key': ADMIN } });
    const body = (await res.json()) as {
      examined: number;
      queue: { resolution: string; conditions: string[]; examples: string[] }[];
      note: string;
    };

    expect(res.status).toBe(200);
    expect(body.examined).toBeGreaterThanOrEqual(2);

    // An unknown is a queue of work, and identical gaps collapse into one entry
    // rather than being reported once per record.
    const outputHashWork = body.queue.find(item => /output hash/i.test(item.resolution));
    expect(outputHashWork).toBeDefined();
    expect(outputHashWork!.conditions).toContain('Evidence');
    expect(outputHashWork!.examples.length).toBeGreaterThan(1);

    // Listed, never ranked: which gap matters is not ABSuite's call.
    expect(body.note).toMatch(/not ranked/i);
    expect(JSON.stringify(body)).not.toMatch(/priority|severity|score/i);
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

/**
 * Layer 1, over the wire.
 *
 * The unit tests prove the registry. These prove the *gate* — that an enrolled
 * subject cannot obtain authority in its own name without its own key. That is
 * the only part an attacker interacts with, and it is the part that was missing.
 */
describe('identity, enforced at the gate', () => {
  const { generateKeyPairSync, sign: cryptoSign, createPrivateKey } = require('node:crypto') as typeof import('node:crypto');

  const keypair = () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  };
  const signNonce = (nonce: string, privateKeyPem: string) =>
    cryptoSign(null, Buffer.from(nonce, 'utf8'), createPrivateKey(privateKeyPem)).toString('base64');

  const admin = { 'x-absuite-admin-key': ADMIN };

  test('an unenrolled subject still gets a token, and the record says Identity is UNKNOWN', async () => {
    const { status, body } = await post('/auth/token', { sub: 'agent:unenrolled', scope: ['execution:record'] }, admin);
    expect(status).toBe(200);

    const recorded = await post('/executions', {
      subject: 'agent:unenrolled', jti: String(body.jti), scope: ['execution:record'],
      module: 'm', action: 'act', input: { a: 1 }, outcome: 'success',
    }, { authorization: `Bearer ${String(body.token)}` });

    const conditions = (await (await fetch(`${base}/executions/${String(recorded.body.id)}/conditions`, { headers: admin })).json()) as
      { conditions: { condition: string; state: string; finding: string }[] };
    const identity = conditions.conditions.find(c => c.condition === 'Identity')!;

    // Not DEMONSTRATED. The name may well be true; nothing here shows it.
    expect(identity.state).toBe('UNKNOWN');
    expect(identity.finding).toMatch(/not an enrolled identity/);
  });

  test('once enrolled, a token in that name requires the key — and the record earns DEMONSTRATED', async () => {
    const { publicKeyPem, privateKeyPem } = keypair();
    const subject = 'agent:enrolled';

    const enrolled = await post('/identities', { subject, publicKeyPem, kind: 'agent' }, admin);
    expect(enrolled.status).toBe(201);

    // The impersonation this layer exists to stop: an admin key is no longer
    // enough to act as an enrolled subject.
    const bare = await post('/auth/token', { sub: subject, scope: ['execution:record'] }, admin);
    expect(bare.status).toBe(401);
    expect(JSON.stringify(bare.body)).toMatch(/PROOF_REQUIRED/);

    const challenge = (await (await fetch(`${base}/identities/${subject}/challenge`, { method: 'POST' })).json()) as { nonce: string };
    expect(challenge.nonce).toBeTruthy();

    const wrongKey = await post('/auth/token', {
      sub: subject, scope: ['execution:record'],
      proof: { nonce: challenge.nonce, signature: signNonce(challenge.nonce, keypair().privateKeyPem) },
    }, admin);
    expect(wrongKey.status).toBe(401);

    const second = (await (await fetch(`${base}/identities/${subject}/challenge`, { method: 'POST' })).json()) as { nonce: string };
    const proven = await post('/auth/token', {
      sub: subject, scope: ['execution:record'],
      proof: { nonce: second.nonce, signature: signNonce(second.nonce, privateKeyPem) },
    }, admin);
    expect(proven.status).toBe(200);

    const recorded = await post('/executions', {
      subject, jti: String(proven.body.jti), scope: ['execution:record'],
      module: 'm', action: 'act', input: { a: 1 }, outcome: 'success',
    }, { authorization: `Bearer ${String(proven.body.token)}` });

    const conditions = (await (await fetch(`${base}/executions/${String(recorded.body.id)}/conditions`, { headers: admin })).json()) as
      { conditions: { condition: string; state: string; finding: string }[] };
    const identity = conditions.conditions.find(c => c.condition === 'Identity')!;

    expect(identity.state).toBe('DEMONSTRATED');
    expect(identity.finding).toMatch(/signed a challenge with the key on file/);
  });

  test('a suspended identity obtains nothing further, and keeps everything it already had', async () => {
    const { publicKeyPem } = keypair();
    const subject = 'agent:suspended';
    await post('/identities', { subject, publicKeyPem }, admin);

    const suspended = await post(`/identities/${subject}/suspend`, { reason: 'key suspected compromised' }, admin);
    expect(suspended.status).toBe(200);

    const refused = await post('/auth/token', { sub: subject, scope: ['execution:record'] }, admin);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/IDENTITY_SUSPENDED/);

    // No challenge either — the door is shut before proof is even attempted.
    const challenge = await fetch(`${base}/identities/${subject}/challenge`, { method: 'POST' });
    expect(challenge.status).toBe(403);
  });

  test('the registry never holds private material', async () => {
    const listed = await (await fetch(`${base}/identities`, { headers: admin })).json() as { identities: unknown[] };
    expect(JSON.stringify(listed)).not.toContain('PRIVATE KEY');
    expect(listed.identities.length).toBeGreaterThan(0);
  });
});

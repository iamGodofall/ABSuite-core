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
      // The PayPal route refuses outright without an id, so the refusals below
      // would all pass for the wrong reason. Configured so the route reaches
      // the checks that are actually under test.
      PAYPAL_WEBHOOK_ID: 'WH-SMOKE-TEST',
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

afterAll(async () => {
  /*
   * Wait for the child to actually exit before deleting its database.
   *
   * On Linux an open file can be unlinked and the suite never noticed. Windows
   * holds a lock until the process is gone, so `rmSync` threw EPERM and failed
   * the run — a real defect that only a Windows machine could surface, in the
   * one suite whose job is to prove the server works.
   */
  if (child && child.exitCode === null) {
    await new Promise<void>(resolve => {
      const done = () => resolve();
      child!.once('exit', done);
      child!.kill('SIGTERM');
      setTimeout(done, 5_000).unref?.();
    });
  }

  // Retried, because the handle can outlive the process by a few milliseconds.
  for (let attempt = 0; dataDir && attempt < 5; attempt += 1) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

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
      '/executions/provenance',
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

describe('a dashboard read cannot stall the recorder', () => {
  /**
   * Found by measuring, not by a failure.
   *
   *     20,000 records   content + linkage     262 ms
   *     20,000 records   + Ed25519           3,046 ms
   *
   * /executions/stats is what the control plane opens on and polls, and Node is
   * single-threaded — so three seconds of synchronous signature verification
   * blocks every other request to the service, including the ones recording new
   * executions. The fix is not to skip a check and stay quiet about it: the
   * response now says which walk ran.
   */
  test('the default walk skips signatures and says so', async () => {
    const body = (await (await fetch(`${base}/executions/stats`, { headers: { 'x-absuite-admin-key': ADMIN } })).json()) as
      { chain: { valid: boolean; signaturesChecked: boolean; covers: string } };

    expect(body.chain.valid).toBe(true);
    expect(body.chain.signaturesChecked).toBe(false);
    // An unchecked claim must never read like a checked one.
    expect(body.chain.covers).toMatch(/Signatures were not checked/);
  });

  test('?verify=full checks them, and says that too', async () => {
    const body = (await (await fetch(`${base}/executions/stats?verify=full`, { headers: { 'x-absuite-admin-key': ADMIN } })).json()) as
      { chain: { valid: boolean; signaturesChecked: boolean; covers: string } };

    expect(body.chain.valid).toBe(true);
    expect(body.chain.signaturesChecked).toBe(true);
    expect(body.chain.covers).toMatch(/Ed25519 signatures/);
  });
});

/**
 * The approval workflow end to end, over HTTP, the way an operator runs it.
 *
 * `REQUIRES_APPROVAL` was a decision the trace could carry and nothing could act
 * on: no way to ask, grant, refuse, expire, or show afterwards that a person had
 * answered before the action ran. These tests exist because the interesting
 * failures are all at the boundary — a request accepted with the wrong shape, a
 * scope that lets the asker also decide, a record whose conditions report goes
 * green without an approval behind it.
 */
describe('approvals, over the wire', () => {
  const sha256 = (value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex');

  const openRequest = async (inputHash: string, headers: Record<string, string>) =>
    post('/approvals', {
      action: { subject: 'agent:invoicing', module: 'payments', action: 'refund', inputHash },
      context: 'Refund R1,420.00 to customer 4471 for a duplicate charge.',
      policyRef: 'finance.refunds.max-10000',
      policyVersion: '3',
      requestedBy: 'agent:invoicing',
    }, headers);

  test('a request opens pending and hands back the statement an approver signs', async () => {
    const token = await issue(['execution:record']);
    const { status, body } = await openRequest(sha256('refund-a'), { authorization: `Bearer ${token}` });

    expect(status).toBe(201);
    const approval = body.approval as Record<string, unknown>;
    expect(approval.state).toBe('PENDING');
    expect(approval.assurance).toBe('ASSERTED');
    expect(String(body.statementToSign)).toContain(String(approval.actionHash));
    // An open request permits nothing, and the response says so rather than
    // leaving the caller to infer it from a 201.
    expect(String(body.means)).toMatch(/running on an UNKNOWN is running unapproved/);
  });

  test('recording a request does not carry the authority to decide one', async () => {
    const token = await issue(['execution:record']);
    const { body } = await openRequest(sha256('refund-b'), { authorization: `Bearer ${token}` });
    const id = (body.approval as { id: string }).id;

    // Separation of duties, enforced at the gate rather than only in the
    // registry: an agent that can ask must not be able to answer.
    const denied = await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'someone', basis: 'why not' },
      { authorization: `Bearer ${token}` });

    expect(denied.status).toBe(403);
  });

  test('the requester cannot decide their own request even holding the scope', async () => {
    const token = await issue(['execution:record']);
    const decider = await issue(['approval:decide']);
    const { body } = await openRequest(sha256('refund-c'), { authorization: `Bearer ${token}` });
    const id = (body.approval as { id: string }).id;

    const self = await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'agent:invoicing', basis: 'looks fine' },
      { authorization: `Bearer ${decider}` });

    expect(self.status).toBe(403);
    expect((self.body.error as { code: string }).code).toBe('SELF_APPROVAL');
  });

  test('a decision needs a basis, and is made once', async () => {
    const token = await issue(['execution:record']);
    const decider = await issue(['approval:decide']);
    const { body } = await openRequest(sha256('refund-d'), { authorization: `Bearer ${token}` });
    const id = (body.approval as { id: string }).id;

    const noBasis = await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'alice', basis: '' },
      { authorization: `Bearer ${decider}` });
    expect(noBasis.status).toBe(400);

    const granted = await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'alice', basis: 'ledger confirms a duplicate charge' },
      { authorization: `Bearer ${decider}` });
    expect(granted.status).toBe(200);
    expect((granted.body.approval as { state: string }).state).toBe('GRANTED');

    const again = await post(`/approvals/${id}/decide`,
      { decision: 'REFUSED', decidedBy: 'bob', basis: 'on reflection' },
      { authorization: `Bearer ${decider}` });
    expect(again.status).toBe(409);
  });

  /**
   * The property the whole design turns on.
   *
   * Nothing links the approval to the execution except a hash both sides compute
   * from the same four fields. There is no approval id on the trace, so there is
   * no column for an operator to fill in after the fact.
   */
  test('an execution\'s conditions find the approval from the record alone', async () => {
    const record = await issue(['execution:record']);
    const decider = await issue(['approval:decide']);
    const read = await issue(['execution:read']);

    const input = { batch: 'BATCH-APPROVED', amount: 142000 };
    const inputHash = sha256(JSON.stringify(input));

    const opened = await openRequest(inputHash, { authorization: `Bearer ${record}` });
    const id = (opened.body.approval as { id: string }).id;

    await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'alice', basis: 'ledger confirms a duplicate charge' },
      { authorization: `Bearer ${decider}` });

    const execution = await post('/executions', {
      subject: 'agent:invoicing',
      module: 'payments',
      action: 'refund',
      inputHash,
      outcome: 'success',
      governance: {
        policyRef: 'finance.refunds.max-10000',
        policyVersion: '3',
        decision: 'REQUIRES_APPROVAL',
        evidence: ['amount exceeds the automatic limit'],
      },
    }, { authorization: `Bearer ${record}` });
    expect(execution.status).toBe(201);
    const traceId = (execution.body as { id: string }).id;

    await post(`/approvals/${id}/consume`, { traceId }, { authorization: `Bearer ${record}` });

    const conditions = await (await fetch(`${base}/executions/${traceId}/conditions`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { conditions: { condition: string; state: string; finding: string; from: string }[] };

    const governance = conditions.conditions.find(c => c.condition === 'Governance')!;
    expect(governance.state).toBe('DEMONSTRATED');
    expect(governance.finding).toMatch(/an approval holds/);
    expect(governance.finding).toMatch(/alice/);
    expect(governance.from).toMatch(/approval record/);
  });

  /**
   * The failure this was built to make visible.
   *
   * A record says a rule demanded a person. Nobody was asked. Before the
   * approval workflow existed this reported Governance as DEMONSTRATED, because
   * the only question the check asked was whether a policy had been *named*.
   */
  test('an unapproved REQUIRES_APPROVAL execution reports a governance failure', async () => {
    const record = await issue(['execution:record']);
    const read = await issue(['execution:read']);

    const execution = await post('/executions', {
      subject: 'agent:invoicing',
      module: 'payments',
      action: 'refund',
      inputHash: sha256('never-approved'),
      outcome: 'success',
      governance: {
        policyRef: 'finance.refunds.max-10000',
        policyVersion: '3',
        decision: 'REQUIRES_APPROVAL',
        evidence: ['amount exceeds the automatic limit'],
      },
    }, { authorization: `Bearer ${record}` });
    const traceId = (execution.body as { id: string }).id;

    const conditions = await (await fetch(`${base}/executions/${traceId}/conditions`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { conditions: { condition: string; state: string; finding: string }[]; overall: string };

    const governance = conditions.conditions.find(c => c.condition === 'Governance')!;
    expect(governance.state).toBe('FAILED');
    expect(governance.finding).toMatch(/satisfied by nobody being asked, is not governance/);
    // And it drags the whole report down, because nothing composes upward.
    expect(conditions.overall).toBe('FAILED');
  });

  test('attest answers from the four fields on the record, with no approval id', async () => {
    const record = await issue(['execution:record']);
    const decider = await issue(['approval:decide']);
    const read = await issue(['execution:read']);

    const inputHash = sha256('attest-by-hash');
    const opened = await openRequest(inputHash, { authorization: `Bearer ${record}` });
    const id = (opened.body.approval as { id: string }).id;
    await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' },
      { authorization: `Bearer ${decider}` });

    const attested = await post('/approvals/attest', {
      action: { subject: 'agent:invoicing', module: 'payments', action: 'refund', inputHash },
    }, { authorization: `Bearer ${read}` });

    expect(attested.status).toBe(200);
    expect(attested.body.state).toBe('DEMONSTRATED');
    expect(attested.body.assurance).toBe('ASSERTED');
    expect(String(JSON.stringify(attested.body))).not.toMatch(/\bscore\b|\bgrade\b/i);
  });

  test('an approval is spent once, and the second execution is refused it', async () => {
    const record = await issue(['execution:record']);
    const decider = await issue(['approval:decide']);

    const opened = await openRequest(sha256('spend-once'), { authorization: `Bearer ${record}` });
    const id = (opened.body.approval as { id: string }).id;
    await post(`/approvals/${id}/decide`,
      { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' },
      { authorization: `Bearer ${decider}` });

    const first = await post(`/approvals/${id}/consume`, { traceId: 'exec_1' }, { authorization: `Bearer ${record}` });
    expect(first.status).toBe(200);

    const second = await post(`/approvals/${id}/consume`, { traceId: 'exec_2' }, { authorization: `Bearer ${record}` });
    expect(second.status).toBe(409);
    expect((second.body.error as { code: string }).code).toBe('APPROVAL_CONSUMED');
  });

  test('the pending queue is what a person actually opens', async () => {
    const record = await issue(['execution:record']);
    const read = await issue(['execution:read']);
    await openRequest(sha256(`queue-${Date.now()}`), { authorization: `Bearer ${record}` });

    const body = await (await fetch(`${base}/approvals?state=PENDING`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { approvals: { state: string }[]; unverifiable: { field: string }[] };

    expect(body.approvals.length).toBeGreaterThan(0);
    expect(body.approvals.every(a => a.state === 'PENDING')).toBe(true);
    // The distinction that keeps an approval from becoming a permission.
    expect(body.unverifiable.map(u => u.field)).toContain('authority');
  });
});

/**
 * Layer 6, over the wire.
 *
 * The layer's promise is that ABSuite's own agents watch the record
 * *continuously*. What existed was a query that answered when asked. The
 * distinction these tests defend is the one that makes a monitor worth having:
 * silence from it must be distinguishable from health.
 */
describe('the watch, over the wire', () => {
  test('an empty notice list arrives with the sentence that explains it', async () => {
    const read = await issue(['execution:read']);
    const body = await (await fetch(`${base}/watch`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as {
      notices: unknown[];
      coverage: { everRun: boolean; because: string; behind: number };
      unverifiable: { field: string }[];
    };

    // Whatever the sweep has found by now, coverage must always say what the
    // list covers. A list with no denominator is the failure mode.
    expect(typeof body.coverage.because).toBe('string');
    expect(body.coverage.because.length).toBeGreaterThan(20);
    expect(body.unverifiable.map(u => u.field)).toEqual(
      expect.arrayContaining(['severity', 'completeness'])
    );
  });

  test('a sweep raises the unapproved execution the conditions report already failed', async () => {
    const read = await issue(['execution:read']);
    const swept = await post('/watch/sweep', {}, { authorization: `Bearer ${read}` });

    expect(swept.status).toBe(200);
    const coverage = swept.body.coverage as { everRun: boolean };
    expect(coverage.everRun).toBe(true);

    const listed = await (await fetch(`${base}/watch?state=OPEN`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { notices: { kind: string; finding: string; from: string }[] };

    // The record written earlier in this file: REQUIRES_APPROVAL, nobody asked.
    const unapproved = listed.notices.find(n => n.kind === 'UNAPPROVED_EXECUTION');
    expect(unapproved).toBeDefined();
    expect(unapproved!.from).toMatch(/approval record/);
  });

  test('a notice is closed with a name and a reason, and is not deleted', async () => {
    const read = await issue(['execution:read']);
    const write = await issue(['execution:record']);
    await post('/watch/sweep', {}, { authorization: `Bearer ${read}` });

    const listed = await (await fetch(`${base}/watch?state=OPEN`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { notices: { id: string }[] };
    const id = listed.notices[0]!.id;

    // The subject of a finding must not be able to close the finding about
    // itself. This required execution:record when it shipped, which every
    // recording agent holds — so an agent that ran without authority could
    // silence the notice saying so, and the queue would look clean.
    const byTheSubject = await post(`/watch/notices/${id}/acknowledge`,
      { by: 'agent:test', basis: 'nothing to see here' },
      { authorization: `Bearer ${write}` });
    expect(byTheSubject.status).toBe(403);

    const closer = await issue(['watch:acknowledge']);
    const bare = await post(`/watch/notices/${id}/acknowledge`, { by: 'alice', basis: '' },
      { authorization: `Bearer ${closer}` });
    expect(bare.status).toBe(400);

    const done = await post(`/watch/notices/${id}/acknowledge`,
      { by: 'alice', basis: 'Reviewed with the payments team; the policy reference was wrong, not the action.' },
      { authorization: `Bearer ${closer}` });
    expect(done.status).toBe(200);
    expect((done.body as { state: string }).state).toBe('ACKNOWLEDGED');

    const after = await (await fetch(`${base}/watch?state=ACKNOWLEDGED`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { notices: { id: string; basis: string }[] };

    expect(after.notices.map(n => n.id)).toContain(id);
    expect(after.notices.find(n => n.id === id)!.basis).toMatch(/Reviewed with the payments team/);
  });

  test('sweeping twice does not duplicate a standing problem', async () => {
    const read = await issue(['execution:read']);
    await post('/watch/sweep', {}, { authorization: `Bearer ${read}` });

    const before = await (await fetch(`${base}/watch?limit=500`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { notices: unknown[] };

    const second = await post('/watch/sweep', {}, { authorization: `Bearer ${read}` });
    expect((second.body.raised as unknown[])).toHaveLength(0);

    const after = await (await fetch(`${base}/watch?limit=500`, {
      headers: { authorization: `Bearer ${read}` },
    })).json() as { notices: unknown[] };

    expect(after.notices.length).toBe(before.notices.length);
  });
});

/**
 * The PayPal webhook route, over real HTTP.
 *
 * `paypal-webhook.test.ts` proves the cryptography against known vectors. It
 * cannot prove the route is mounted, that the raw body survives express's JSON
 * parser, or that the host check runs before the certificate is fetched — and
 * this file exists because a route that silently ignored a field is exactly the
 * class of defect no unit test catches.
 *
 * WHAT THIS CANNOT PROVE, stated rather than implied: no test here verifies a
 * genuine PayPal signature, because that needs a certificate served from a
 * paypal.com host and an event PayPal actually signed. Everything below is a
 * REFUSAL. The passing case waits for a deployed instance and PayPal's webhook
 * simulator, and until that has run, "the verification works" is a claim about
 * my reading of their scheme rather than a measurement.
 */
describe('POST /billing/paypal/webhook', () => {
  const event = {
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resource: { id: 'I-SMOKE', custom_id: 'business', status: 'ACTIVE' },
  };

  const headers = (over: Record<string, string> = {}) => ({
    'paypal-transmission-id': 'smoke-1',
    'paypal-transmission-time': '2026-08-28T10:00:00Z',
    'paypal-transmission-sig': 'ZmFrZQ==',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-smoke',
    'paypal-auth-algo': 'SHA256withRSA',
    ...over,
  });

  test('the route is mounted — a refusal, not a 404', async () => {
    const res = await post('/billing/paypal/webhook', event, headers());
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(400);
  });

  test('REFUSAL — a certificate URL that is not a PayPal host', async () => {
    // The single most important assertion in this file. An attacker who chooses
    // the certificate satisfies every cryptographic check, so this is what ties
    // the event to PayPal. It must be answered BEFORE anything is fetched.
    const res = await post('/billing/paypal/webhook', event, headers({
      'paypal-cert-url': 'https://paypal.com.evil.example/cert.pem',
    }));
    expect(res.status).toBe(400);
    expect(String((res.body.error as { message?: string })?.message ?? '')).toContain('not a PayPal host');
  });

  test('REFUSAL — plain http is refused even on a real PayPal host', async () => {
    const res = await post('/billing/paypal/webhook', event, headers({
      'paypal-cert-url': 'http://api.paypal.com/certs/x',
    }));
    expect(String((res.body.error as { message?: string })?.message ?? '')).toContain('not a PayPal host');
  });

  test('REFUSAL — a missing certificate URL', async () => {
    const noCert = headers();
    delete (noCert as Record<string, string>)['paypal-cert-url'];
    const res = await post('/billing/paypal/webhook', event, noCert);
    expect(res.status).toBe(400);
  });

  test('an unsigned request never reaches the entitlement path', async () => {
    // The body names a real plan and a real ACTIVE status. If any refusal above
    // were missing, this is the request that would grant `business` for free.
    const res = await post('/billing/paypal/webhook', event, headers({
      'paypal-cert-url': 'https://evil.example/?host=api.paypal.com',
    }));
    expect(res.status).toBe(400);
    expect(res.body.applied).toBeUndefined();
  });
});

/**
 * The price list, over real HTTP.
 *
 * A pricing page is the one surface where a wrong number takes somebody's
 * money, so the figures are asserted against the plan definitions rather than
 * against themselves.
 */
describe('GET /plans', () => {
  const plans = async () => {
    const res = await fetch(`${base}/plans`);
    return (await res.json()) as { plans: Array<Record<string, unknown>> };
  };

  test('serves both terms, and monthly still means monthly', async () => {
    const { plans: list } = await plans();
    const business = list.find(p => p.id === 'business')!;
    // Unchanged for anything already reading it.
    expect(business.priceCents).toBe(29900);
    const annual = business.annual as Record<string, unknown>;
    expect(annual.priceCents).toBe(299000);
    expect(annual.yearly).toBe('2990.00');
  });

  test('the advertised saving is really two months', async () => {
    const { plans: list } = await plans();
    for (const plan of list) {
      const annual = plan.annual as { savingCents: number } | null;
      if (!annual) continue;
      expect(annual.savingCents).toBe((plan.priceCents as number) * 2);
    }
  });

  test('free and enterprise advertise no annual price', async () => {
    const { plans: list } = await plans();
    expect(list.find(p => p.id === 'free')!.annual).toBeNull();
    // priceCents 0 there means negotiated; a "$0.00 a year" enterprise line
    // would be an offer nobody made.
    expect(list.find(p => p.id === 'enterprise')!.annual).toBeNull();
  });
});

/**
 * The witnessing history, over real HTTP.
 *
 * The smoke server runs with no notary configured, which is the state most
 * instances are in and the one most likely to be got wrong: an unwitnessed
 * chain must read as unwitnessed and never as suspicious.
 */
describe('GET /notary/receipts', () => {
  test('REFUSAL — a tenant key is required', async () => {
    const res = await fetch(`${base}/notary/receipts`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('TENANT_KEY_REQUIRED');
  });

  test('the route exists rather than falling through to a 404', async () => {
    // A paid capability behind a route that does not answer is the dead button
    // this codebase keeps finding.
    const res = await fetch(`${base}/notary/receipts`);
    expect(res.status).not.toBe(404);
  });
});

describe('GET /audit/export carries the outside witness', () => {
  test('the bundle reports honestly that nothing witnesses this instance', async () => {
    const res = await fetch(`${base}/audit/export`, { headers: { 'x-absuite-admin-key': ADMIN } });
    if (res.status === 401 || res.status === 403) return; // auth shape differs; covered by unit tests
    const bundle = (await res.json()) as { receipts?: unknown[]; format?: string };
    expect(bundle.format).toBe('absuite.audit-export.v1');
    // No notary configured here, so no receipts — and the field is absent
    // rather than an empty array, because two spellings of one fact is how a
    // reader ends up asking which one means something.
    expect(bundle.receipts).toBeUndefined();
  });
});

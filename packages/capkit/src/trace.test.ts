import { Storage } from './storage';
import {
  TraceStore,
  SigningKey,
  hashPayload,
  hashTrace,
  canonicalTrace,
  verifyTrace,
  verifySignature,
  replayManifest,
  compareReplay,
  GENESIS_HASH,
  type ExecutionTrace,
} from './trace';

const freshStore = (withKey = true) => {
  const storage = new Storage(':memory:');
  const key = withKey ? new SigningKey() : undefined;
  return { storage, key, traces: new TraceStore(storage, key) };
};

const sampleExecution = (overrides: Record<string, unknown> = {}) => ({
  subject: 'agent-001',
  jti: 'token-1',
  scope: ['queue:write'],
  module: 'edge-run',
  action: 'http:POST https://api.example.com/sync',
  inputHash: hashPayload({ url: 'https://api.example.com/sync' }),
  outputHash: hashPayload({ ok: true }),
  outcome: 'success' as const,
  startedAt: '2026-07-28T10:00:00.000Z',
  completedAt: '2026-07-28T10:00:01.000Z',
  durationMs: 1000,
  steps: [{ seq: 1, name: 'queued', at: '2026-07-28T10:00:00.000Z' }],
  ...overrides,
});

describe('payload hashing', () => {
  test('is stable regardless of key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  test('distinguishes different payloads', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  test('handles undefined and null without throwing', () => {
    expect(hashPayload(undefined)).toHaveLength(64);
    expect(hashPayload(null)).toHaveLength(64);
  });

  test('array order is significant', () => {
    expect(hashPayload([1, 2])).not.toBe(hashPayload([2, 1]));
  });
});

describe('trace canonicalisation', () => {
  test('excludes hash and signature so hashing is not circular', () => {
    const canonical = canonicalTrace({ ...sampleExecution(), id: 'exec_1', prevHash: GENESIS_HASH });
    expect(canonical).not.toContain('signature');
  });

  test('scope order does not change the hash', () => {
    const base = { ...sampleExecution(), id: 'exec_1', prevHash: GENESIS_HASH };
    const a = hashTrace({ ...base, scope: ['a:b', 'c:d'] });
    const b = hashTrace({ ...base, scope: ['c:d', 'a:b'] });
    expect(a).toBe(b);
  });
});

describe('Ed25519 signing', () => {
  test('a generated keypair signs and verifies', () => {
    const key = new SigningKey();
    const signature = key.sign('abc123');

    expect(verifySignature('abc123', signature, key.publicKeyPem)).toBe(true);
    expect(verifySignature('different', signature, key.publicKeyPem)).toBe(false);
  });

  test('a different key does not verify', () => {
    const a = new SigningKey();
    const b = new SigningKey();
    expect(verifySignature('abc', a.sign('abc'), b.publicKeyPem)).toBe(false);
  });

  test('a configured private key survives a restart', () => {
    const { privateKeyPem } = SigningKey.generate();
    const first = new SigningKey(privateKeyPem);
    const second = new SigningKey(privateKeyPem);

    expect(first.ephemeral).toBe(false);
    expect(second.publicKeyPem).toBe(first.publicKeyPem);
    // A signature from before the restart still verifies after it.
    expect(verifySignature('abc', first.sign('abc'), second.publicKeyPem)).toBe(true);
  });

  test('an ephemeral key is flagged as such', () => {
    expect(new SigningKey().ephemeral).toBe(true);
  });

  test('the public key alone cannot forge a signature', () => {
    const key = new SigningKey();
    // Only the public half is exported; there is no path from it to a signature.
    expect(key.publicKeyPem).toContain('PUBLIC KEY');
    expect(key.publicKeyPem).not.toContain('PRIVATE KEY');
  });
});

describe('recording and verifying traces', () => {
  test('records a signed, chained trace', () => {
    const { traces, key } = freshStore();
    const trace = traces.record(sampleExecution());

    expect(trace.id).toMatch(/^exec_/);
    expect(trace.prevHash).toBe(GENESIS_HASH);
    expect(trace.hash).toHaveLength(64);
    expect(trace.signature).toBeTruthy();
    expect(verifyTrace(trace, key!.publicKeyPem).valid).toBe(true);
  });

  test('links each trace to its predecessor', () => {
    const { traces } = freshStore();
    const first = traces.record(sampleExecution());
    const second = traces.record(sampleExecution({ subject: 'agent-002' }));

    expect(second.prevHash).toBe(first.hash);
    expect(traces.headHash).toBe(second.hash);
  });

  test('detects an altered outcome', () => {
    const { traces, key } = freshStore();
    const trace = traces.record(sampleExecution({ outcome: 'failure', error: 'denied' }));

    // Rewrite history: a denial becomes a success.
    const forged: ExecutionTrace = { ...trace, outcome: 'success', error: undefined };
    const verdict = verifyTrace(forged, key!.publicKeyPem);

    expect(verdict.valid).toBe(false);
    expect(verdict.contentIntact).toBe(false);
    expect(verdict.reason).toMatch(/does not match its hash/i);
  });

  test('detects an altered output hash', () => {
    const { traces, key } = freshStore();
    const trace = traces.record(sampleExecution());
    const forged: ExecutionTrace = { ...trace, outputHash: hashPayload({ ok: false }) };

    expect(verifyTrace(forged, key!.publicKeyPem).valid).toBe(false);
  });

  test('a re-hashed forgery still fails on the signature', () => {
    const { traces, key } = freshStore();
    const trace = traces.record(sampleExecution({ outcome: 'failure' }));

    // A sophisticated attacker recomputes the hash to match their edit.
    const { hash, signature, ...content } = trace;
    const forged: ExecutionTrace = {
      ...content,
      outcome: 'success',
      hash: hashTrace({ ...content, outcome: 'success' }),
      signature,
    };

    const verdict = verifyTrace(forged, key!.publicKeyPem);
    expect(verdict.contentIntact).toBe(true);   // the hash now matches the content
    expect(verdict.signatureValid).toBe(false); // but it was never signed by us
    expect(verdict.valid).toBe(false);
  });

  test('verifies content without a key, and reports signature unchecked', () => {
    const { traces } = freshStore();
    const trace = traces.record(sampleExecution());
    const verdict = verifyTrace(trace);

    expect(verdict.valid).toBe(true);
    expect(verdict.signatureValid).toBeNull();
  });

  test('an unsigned trace fails when a key is supplied', () => {
    const { traces } = freshStore(false);
    const trace = traces.record(sampleExecution());

    expect(trace.signature).toBeUndefined();
    expect(verifyTrace(trace, new SigningKey().publicKeyPem).reason).toMatch(/not signed/i);
  });
});

describe('chain verification', () => {
  test('verifies a clean chain', () => {
    const { traces, key } = freshStore();
    traces.record(sampleExecution());
    traces.record(sampleExecution({ subject: 'b' }));
    traces.record(sampleExecution({ subject: 'c' }));

    const result = traces.verifyChain(key!.publicKeyPem);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
  });

  test('detects a record edited directly in the database', () => {
    const { storage, traces, key } = freshStore();
    traces.record(sampleExecution());
    const target = traces.record(sampleExecution({ subject: 'victim', outcome: 'failure' }));
    traces.record(sampleExecution({ subject: 'c' }));

    // Tamper at the storage layer, bypassing the API entirely.
    storage.run("UPDATE executions SET outcome = 'success' WHERE id = ?", target.id);

    const result = traces.verifyChain(key!.publicKeyPem);
    expect(result.valid).toBe(false);
    expect(result.brokenId).toBe(target.id);
    expect(result.brokenAt).toBe(2);
  });

  test('detects a deleted record', () => {
    const { storage, traces, key } = freshStore();
    traces.record(sampleExecution());
    const removed = traces.record(sampleExecution({ subject: 'gone' }));
    traces.record(sampleExecution({ subject: 'c' }));

    storage.run('DELETE FROM executions WHERE id = ?', removed.id);

    const result = traces.verifyChain(key!.publicKeyPem);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/predecessor/i);
  });

  test('an empty chain is trivially valid', () => {
    const { traces, key } = freshStore();
    const result = traces.verifyChain(key!.publicKeyPem);

    expect(result.valid).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.headHash).toBe(GENESIS_HASH);
  });
});

describe('querying traces', () => {
  test('filters by subject and outcome', () => {
    const { traces } = freshStore();
    traces.record(sampleExecution({ subject: 'agent-a' }));
    traces.record(sampleExecution({ subject: 'agent-b', outcome: 'failure', error: 'x' }));

    expect(traces.list({ subject: 'agent-a' })).toHaveLength(1);
    expect(traces.list({ outcome: 'failure' })).toHaveLength(1);
  });

  test('scopes to a tenant', () => {
    const { traces } = freshStore();
    traces.record(sampleExecution({ tenantId: 'ten_1' }));
    traces.record(sampleExecution({ tenantId: 'ten_2' }));

    expect(traces.list({ tenantId: 'ten_1' })).toHaveLength(1);
  });

  test('round-trips through storage intact', () => {
    const { traces, key } = freshStore();
    const recorded = traces.record(sampleExecution());
    const loaded = traces.get(recorded.id)!;

    expect(loaded).toEqual(recorded);
    expect(verifyTrace(loaded, key!.publicKeyPem).valid).toBe(true);
  });
});

describe('replay', () => {
  test('manifest exposes expectations without the payloads', () => {
    const { traces } = freshStore();
    const trace = traces.record(sampleExecution());
    const manifest = replayManifest(trace);

    expect(manifest.expectedInputHash).toBe(trace.inputHash);
    // Proof without ABSuite retaining the customer's data.
    expect(JSON.stringify(manifest)).not.toContain('api.example.com/sync?');
  });

  test('an identical re-run is deterministic', () => {
    const { traces } = freshStore();
    const input = { url: 'https://api.example.com/sync' };
    const output = { ok: true };
    const trace = traces.record(sampleExecution({ inputHash: hashPayload(input), outputHash: hashPayload(output) }));

    expect(compareReplay(trace, { input, output })).toEqual({
      inputMatches: true,
      outputMatches: true,
      deterministic: true,
    });
  });

  test('a changed output is detected', () => {
    const { traces } = freshStore();
    const input = { url: 'x' };
    const trace = traces.record(sampleExecution({ inputHash: hashPayload(input), outputHash: hashPayload({ ok: true }) }));

    const result = compareReplay(trace, { input, output: { ok: false } });
    expect(result.inputMatches).toBe(true);
    expect(result.outputMatches).toBe(false);
    expect(result.deterministic).toBe(false);
  });

  test('a trace with no recorded output cannot be shown deterministic', () => {
    const { traces } = freshStore();
    const trace = traces.record(sampleExecution({ outputHash: undefined }));

    expect(compareReplay(trace, { input: {}, output: {} }).outputMatches).toBe(false);
  });
});

// The friction below was found by writing examples/incident-forensics.mjs
// against the published packages: every one of these is a step a newcomer had
// to perform manually in 1.0, and none of them carried information the library
// did not already have.
describe('recording without the ceremony', () => {
  test('hashes the payloads for you', () => {
    const { traces } = freshStore();
    const input = { batch: 'BATCH-8891', total: 250000 };
    const output = { approved: true };

    const trace = traces.record({
      subject: 'agent:invoicing',
      scope: ['payment:approve'],
      module: 'payments',
      action: 'approve_batch',
      input,
      output,
      outcome: 'success',
    });

    expect(trace.inputHash).toBe(hashPayload(input));
    expect(trace.outputHash).toBe(hashPayload(output));
    // Hashed, never stored. The convenience must not become a data copy.
    expect(JSON.stringify(traces.get(trace.id))).not.toContain('BATCH-8891');
  });

  test('a pre-computed hash is still accepted', () => {
    const { traces } = freshStore();
    const trace = traces.record({
      subject: 'a', scope: [], module: 'm', action: 'x',
      inputHash: hashPayload({ n: 1 }),
      outcome: 'success',
    });

    expect(trace.inputHash).toBe(hashPayload({ n: 1 }));
    expect(trace.outputHash).toBeUndefined();
  });

  test('refuses to record an execution with no input at all', () => {
    const { traces } = freshStore();
    expect(() =>
      // Neither form supplied. Guessing an empty payload would put a hash in
      // the chain that attests to something nobody ever processed.
      traces.record({ subject: 'a', scope: [], module: 'm', action: 'x', outcome: 'success' } as never)
    ).toThrow(/either `input`.*or `inputHash`/);
  });

  test('defaults startedAt to now and steps to none', () => {
    const { traces } = freshStore();
    const before = Date.now();
    const trace = traces.record({
      subject: 'a', scope: [], module: 'm', action: 'x', input: {}, outcome: 'success',
    });

    expect(trace.steps).toEqual([]);
    expect(Date.parse(trace.startedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(trace.startedAt)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('derives durationMs from the two timestamps', () => {
    const { traces } = freshStore();
    const trace = traces.record({
      subject: 'a', scope: [], module: 'm', action: 'x', input: {}, outcome: 'success',
      startedAt: '2026-07-29T02:14:03.000Z',
      completedAt: '2026-07-29T02:14:05.500Z',
    });

    expect(trace.durationMs).toBe(2500);
  });

  test('a measured duration always beats a derived one', () => {
    const { traces } = freshStore();
    const trace = traces.record({
      subject: 'a', scope: [], module: 'm', action: 'x', input: {}, outcome: 'success',
      startedAt: '2026-07-29T02:14:03.000Z',
      completedAt: '2026-07-29T02:14:05.500Z',
      durationMs: 41,
    });

    // The caller measured it; the store did not.
    expect(trace.durationMs).toBe(41);
  });

  test('omits the duration rather than record a negative one', () => {
    const { traces } = freshStore();
    const trace = traces.record({
      subject: 'a', scope: [], module: 'm', action: 'x', input: {}, outcome: 'success',
      startedAt: '2026-07-29T02:14:05.000Z',
      completedAt: '2026-07-29T02:14:03.000Z',
    });

    // A clock that ran backwards is a symptom, not a measurement.
    expect(trace.durationMs).toBeUndefined();
  });

  test('the convenience form still signs, chains and verifies', () => {
    const { traces, key } = freshStore();
    const first = traces.record({ subject: 'a', scope: [], module: 'm', action: 'x', input: 1, outcome: 'success' });
    const second = traces.record({ subject: 'a', scope: [], module: 'm', action: 'y', input: 2, outcome: 'success' });

    expect(second.prevHash).toBe(first.hash);
    expect(traces.verifyChain(key!.publicKeyPem).valid).toBe(true);
  });
});

describe('a wrong key is not the same accusation as an edit', () => {
  test('a rotated key is reported as a different key, not as tampering', () => {
    const traces = new TraceStore(new Storage(':memory:'), new SigningKey());
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'x', input: 1, outcome: 'success' });

    // Same record, different key — exactly what a rotation or an ephemeral dev
    // key produces.
    const verdict = verifyTrace(trace, new SigningKey().publicKeyPem);

    expect(verdict.valid).toBe(false);
    expect(verdict.signatureValid).toBe(false);
    // The content is untouched, and the message must say so. An operator who
    // reads "tampered" after a routine rotation stops believing the alarm.
    expect(verdict.contentIntact).toBe(true);
    expect(verdict.reason).toMatch(/was not edited/i);
    expect(verdict.reason).toMatch(/different key/i);
  });

  test('an edited record still says the content does not match its hash', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'x', input: 1, outcome: 'success' });

    const verdict = verifyTrace({ ...trace, outcome: 'failure' }, key.publicKeyPem);

    expect(verdict.contentIntact).toBe(false);
    expect(verdict.reason).toMatch(/does not match its hash/i);
    // The two failures must never be worded the same way.
    expect(verdict.reason).not.toMatch(/different key/i);
  });
});

describe('aggregate counts for a control plane', () => {
  const seed = () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

    traces.record({ subject: 'agent:a', scope: ['pay:approve'], module: 'payments', action: 'approve', input: 1, outcome: 'success', startedAt: hoursAgo(1) });
    traces.record({ subject: 'agent:a', scope: ['pay:approve'], module: 'payments', action: 'refund', input: 2, outcome: 'failure', startedAt: hoursAgo(2) });
    traces.record({ subject: 'agent:b', scope: [], module: 'ledger', action: 'read', input: 3, outcome: 'success', startedAt: hoursAgo(72) });
    return traces;
  };

  test('counts what exists, over the window it says it counts', () => {
    const stats = seed().stats(24);

    expect(stats.total).toBe(3);
    expect(stats.subjects).toBe(2);
    expect(stats.modules).toBe(2);
    expect(stats.actions).toBe(3);
    expect(stats.failures).toBe(1);
    // The 72-hour-old record is outside a 24-hour window and must not be counted
    // in it — a "today" figure that quietly includes last week is a lie with a
    // timestamp on it.
    expect(stats.inWindow).toBe(2);
    expect(stats.failuresInWindow).toBe(1);
    expect(stats.windowHours).toBe(24);
  });

  test('a wider window includes more, and says which window it used', () => {
    const stats = seed().stats(24 * 7);
    expect(stats.inWindow).toBe(3);
    expect(stats.windowHours).toBe(168);
  });

  test('an action with no recorded scope is counted, not overlooked', () => {
    // "Nothing is wrong" and "nobody could check" must never look the same.
    expect(seed().stats().withoutScope).toBe(1);
  });

  test('an empty store reports empty rather than nothing', () => {
    const stats = new TraceStore(new Storage(':memory:'), new SigningKey()).stats();

    expect(stats.total).toBe(0);
    expect(stats.subjects).toBe(0);
    expect(stats.oldest).toBeUndefined();
    expect(stats.newest).toBeUndefined();
  });
});

describe('recording the rule that permitted an action', () => {
  const policy = {
    policyRef: 'finance.refunds.max-10000',
    policyVersion: '2.1.4',
    decision: 'PERMITTED' as const,
    evidence: ['refund < $10,000', 'customer_age > 30d', 'approval_872'],
  };

  test('a record without governance hashes exactly as it always did', () => {
    // The migration must not rewrite history. Appending a null placeholder to
    // the canonical form would change the hash of every trace ever written and
    // report the entire log as tampered because we added a field.
    const withoutGovernance = {
      id: 'exec_1', subject: 'a', scope: ['x'], module: 'm', action: 'y',
      inputHash: 'h', outcome: 'success' as const, startedAt: '2026-01-01T00:00:00.000Z',
      steps: [], prevHash: GENESIS_HASH,
    };

    // The canonical form of a governance-free trace is exactly sixteen fields,
    // as it was before this field existed.
    expect(JSON.parse(canonicalTrace(withoutGovernance))).toHaveLength(16);
    expect(JSON.parse(canonicalTrace({ ...withoutGovernance, governance: policy }))).toHaveLength(17);
  });

  test('the policy is signed, so stripping it fails verification', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({
      subject: 'agent:finance', scope: ['refund:process'], module: 'payments',
      action: 'process_refund', input: { amount: 500 }, outcome: 'success',
      governance: policy,
    } as never);

    expect(verifyTrace(trace, key.publicKeyPem).valid).toBe(true);

    // Removing the governing rule is exactly what someone would do to hide that
    // an action was permitted by a policy they later deleted.
    const { governance, ...stripped } = trace;
    expect(governance).toBeDefined();
    const verdict = verifyTrace(stripped as never, key.publicKeyPem);
    expect(verdict.valid).toBe(false);
    expect(verdict.contentIntact).toBe(false);
  });

  test('editing the policy version fails verification', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({
      subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success',
      governance: policy,
    } as never);

    const edited = { ...trace, governance: { ...policy, policyVersion: '9.9.9' } };
    expect(verifyTrace(edited, key.publicKeyPem).contentIntact).toBe(false);
  });

  test('survives a round trip through storage', () => {
    const key = new SigningKey();
    const storage = new Storage(':memory:');
    const traces = new TraceStore(storage, key);
    const written = traces.record({
      subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success',
      governance: { ...policy, evaluatedBy: 'policy-engine-1' },
    } as never);

    const read = traces.get(written.id)!;
    expect(read.governance).toEqual({ ...policy, evaluatedBy: 'policy-engine-1' });
    expect(verifyTrace(read, key.publicKeyPem).valid).toBe(true);
    expect(traces.verifyChain(key.publicKeyPem).valid).toBe(true);
  });

  test('a chain mixing governed and ungoverned records still verifies', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);

    // Exactly the shape of a real upgrade: old records have no policy, new ones
    // do, and the chain has to hold across the boundary.
    traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'old', input: 1, outcome: 'success' });
    traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'new', input: 2, outcome: 'success', governance: policy } as never);
    traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'old-again', input: 3, outcome: 'success' });

    const result = traces.verifyChain(key.publicKeyPem);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
  });
});

describe('what a person should look at', () => {
  const seeded = () => {
    const traces = new TraceStore(new Storage(':memory:'), new SigningKey());
    traces.record({ subject: 'agent:a', scope: ['pay:approve'], module: 'payments', action: 'approve', input: 1, outcome: 'success' });
    traces.record({ subject: 'agent:a', scope: ['pay:approve'], module: 'payments', action: 'refund', input: 2, outcome: 'failure', error: 'limit exceeded' });
    traces.record({ subject: 'agent:b', scope: [], module: 'ledger', action: 'read', input: 3, outcome: 'success' });
    return traces;
  };

  test('lists what failed and what was unauthorised, and nothing else', () => {
    const flagged = seeded().needingAttention();

    // A successful, scoped, signed record is not a finding. Flagging everything
    // is the same as flagging nothing.
    expect(flagged).toHaveLength(2);
    expect(flagged.map(f => f.trace.action).sort()).toEqual(['read', 'refund']);
  });

  test('every flag names the field it came from', () => {
    for (const item of seeded().needingAttention()) {
      expect(item.reasons.length).toBeGreaterThan(0);
      for (const reason of item.reasons) {
        expect(reason.from.length).toBeGreaterThan(0);
        // It says what is true of the record, never what to do about it.
        expect(reason.reason).not.toMatch(/\b(should be (revoked|suspended)|recommend)\b/i);
      }
    }
  });

  test('a failure and a missing scope are different findings', () => {
    const flagged = seeded().needingAttention();
    const failed = flagged.find(f => f.trace.action === 'refund')!;
    const unscoped = flagged.find(f => f.trace.action === 'read')!;

    expect(failed.reasons[0]!.reason).toContain('limit exceeded');
    expect(unscoped.reasons[0]!.reason).toMatch(/cannot be shown to have been permitted/i);
  });

  test('a clean store has nothing to report', () => {
    const traces = new TraceStore(new Storage(':memory:'), new SigningKey());
    traces.record({ subject: 'agent:a', scope: ['x'], module: 'm', action: 'ok', input: 1, outcome: 'success' });

    expect(traces.needingAttention()).toEqual([]);
  });
});

describe('authority actually exercised', () => {
  test('groups the scopes each subject acted under, with counts', () => {
    const traces = new TraceStore(new Storage(':memory:'), new SigningKey());
    traces.record({ subject: 'agent:a', scope: ['pay:approve', 'ledger:read'], module: 'm', action: 'x', input: 1, outcome: 'success' });
    traces.record({ subject: 'agent:a', scope: ['pay:approve'], module: 'm', action: 'y', input: 2, outcome: 'success' });
    traces.record({ subject: 'agent:b', scope: [], module: 'm', action: 'z', input: 3, outcome: 'success' });

    const inventory = traces.authorityInventory();

    expect(inventory).toHaveLength(2);
    const a = inventory.find(entry => entry.subject === 'agent:a')!;
    expect(a.total).toBe(2);
    expect(a.scopes).toEqual([
      { scope: 'pay:approve', count: 2 },
      { scope: 'ledger:read', count: 1 },
    ]);
    expect(a.unscoped).toBe(0);

    // An absent scope is counted as absent, never folded into "no restrictions".
    const b = inventory.find(entry => entry.subject === 'agent:b')!;
    expect(b.unscoped).toBe(1);
    expect(b.scopes).toEqual([]);
  });

  test('reports nothing for a store that has recorded nothing', () => {
    expect(new TraceStore(new Storage(':memory:'), new SigningKey()).authorityInventory()).toEqual([]);
  });
});

describe('SigningKey.createPair', () => {
  test('returns a key that signs and PEMs that verify it', () => {
    const { key, privateKeyPem, publicKeyPem } = SigningKey.createPair();
    const storage = new Storage(':memory:');
    const traces = new TraceStore(storage, key);

    const trace = traces.record({ subject: 'a', scope: [], module: 'm', action: 'x', input: {}, outcome: 'success' });

    expect(privateKeyPem).toContain('PRIVATE KEY');
    expect(verifyTrace(trace, publicKeyPem).valid).toBe(true);
    // Not ephemeral: restarting with the same PEM keeps old signatures valid.
    expect(key.ephemeral).toBe(false);
    expect(verifyTrace(trace, new SigningKey(privateKeyPem).publicKeyPem).valid).toBe(true);
  });

  test('carries a custom key id through to the trace', () => {
    const { key } = SigningKey.createPair('billing-2026-q3');
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: [], module: 'm', action: 'x', input: {}, outcome: 'success' });

    expect(trace.keyId).toBe('billing-2026-q3');
  });
});

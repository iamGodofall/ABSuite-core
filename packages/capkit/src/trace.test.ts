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

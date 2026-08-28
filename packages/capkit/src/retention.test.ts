/**
 * Retention on a hash-chained ledger.
 *
 * The interesting assertions here are the negative ones. "The chain still
 * verifies after a sweep" is trivially true of a sweep that removes nothing, so
 * every positive case is paired with a control: a gap with no anchor, and a gap
 * with an anchor signed by the wrong key, must both still read as BROKEN. If
 * they do not, the anchor is excusing truncation rather than explaining
 * retention, which is the one thing this feature must never do.
 */
import { Storage } from './storage';
import { TraceStore, SigningKey, hashPayload } from './trace';

const freshStore = (withKey = true) => {
  const storage = new Storage(':memory:');
  const key = withKey ? new SigningKey() : undefined;
  return { storage, key, traces: new TraceStore(storage, key) };
};

/** A record whose `startedAt` is `daysAgo` days before `now`. */
const aged = (daysAgo: number, now: Date, overrides: Record<string, unknown> = {}) => {
  const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    subject: 'agent-001',
    scope: ['queue:write'],
    module: 'edge-run',
    action: 'http:POST https://api.example.com/sync',
    inputHash: hashPayload({ day: daysAgo }),
    outcome: 'success' as const,
    startedAt: at,
    completedAt: at,
    steps: [{ seq: 1, name: 'queued', at }],
    ...overrides,
  };
};

const NOW = new Date('2026-08-28T00:00:00.000Z');

describe('pruneToRetention', () => {
  test('removes records past the window and keeps the rest', () => {
    const { traces } = freshStore();
    for (const d of [100, 95, 90, 5, 1]) traces.record(aged(d, NOW));

    const result = traces.pruneToRetention({ retentionDays: 30, now: NOW });

    expect(result.removed).toBe(3);
    expect(result.anchor?.seq).toBe(3);
    expect(result.anchor?.policyDays).toBe(30);
  });

  test('the chain still verifies after a sweep', () => {
    const { traces, key } = freshStore();
    for (const d of [100, 95, 90, 5, 1]) traces.record(aged(d, NOW));

    traces.pruneToRetention({ retentionDays: 30, now: NOW });
    const verdict = traces.verifyChain(key!.publicKeyPem);

    expect(verdict.valid).toBe(true);
    expect(verdict.retainedFrom?.removed).toBe(3);
    // A deletion is not a shortcut: the checkpoint field must stay absent.
    expect(verdict.verifiedFrom).toBeUndefined();
    expect(verdict.scope).toContain('gone, not unchecked');
  });

  test('CONTROL — the same gap with no anchor is BROKEN', () => {
    const { traces, key, storage } = freshStore();
    for (const d of [100, 95, 90, 5, 1]) traces.record(aged(d, NOW));

    // Exactly what the sweep does to the executions table, and nothing else.
    storage.run('DELETE FROM executions WHERE seq <= ?', 3);

    const verdict = traces.verifyChain(key!.publicKeyPem);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('Trace does not link to its predecessor');
  });

  test('CONTROL — a forged anchor does not excuse a truncation', () => {
    const { traces, key, storage } = freshStore();
    for (const d of [100, 95, 90, 5, 1]) traces.record(aged(d, NOW));

    const cutHash = storage.get<{ hash: string }>('SELECT hash FROM executions WHERE seq = 3')!.hash;

    /*
     * The attacker's position: they can write to the database — that is what
     * truncation means — but they do not hold the ledger's signing key. So they
     * trim the tail and forge the note explaining it with a key of their own.
     *
     * Every surviving record is still signed by the REAL key and still verifies,
     * which is what makes this the sharp case: nothing here fails except the
     * anchor, so the anchor is the only thing that can catch it. An earlier
     * version of this test verified against the stranger's key instead and went
     * green on a build with no signature check at all — it was failing on the
     * record signatures and never reaching the anchor.
     */
    const attacker = new SigningKey();
    storage.run('DELETE FROM executions WHERE seq <= ?', 3);
    storage.run(
      `INSERT INTO retention_anchors (seq, hash, removed, policy_days, pruned_at, key_id, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      3, cutHash, 3, 30, NOW.toISOString(), attacker.keyId,
      attacker.sign(`absuite.chain.retention.v1:3:${cutHash}:3:30`)
    );

    const verdict = traces.verifyChain(key!.publicKeyPem);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('Trace does not link to its predecessor');
    expect(verdict.retainedFrom).toBeUndefined();
  });

  test('CONTROL — an anchor cannot be re-pointed at a deeper cut', () => {
    const { traces, key, storage } = freshStore();
    for (const d of [100, 95, 90, 60, 5, 1]) traces.record(aged(d, NOW));
    traces.pruneToRetention({ retentionDays: 30, now: NOW });
    expect(traces.verifyChain(key!.publicKeyPem).valid).toBe(true);

    // Remove one more record than the signed anchor accounts for. The signature
    // still verifies — it is over the original seq and hash — but the anchor no
    // longer sits immediately below the oldest survivor, so it must not apply.
    storage.run('DELETE FROM executions WHERE seq = ?', 5);

    expect(traces.verifyChain(key!.publicKeyPem).valid).toBe(false);
  });

  test('never removes the most recent record, however old', () => {
    const { traces, key } = freshStore();
    for (const d of [400, 380, 370]) traces.record(aged(d, NOW));

    const result = traces.pruneToRetention({ retentionDays: 30, now: NOW });

    expect(result.removed).toBe(2);
    expect(traces.verifyChain(key!.publicKeyPem).valid).toBe(true);
  });

  test('records written after a sweep extend the same chain', () => {
    const { traces, key } = freshStore();
    for (const d of [100, 95, 90, 1]) traces.record(aged(d, NOW));
    traces.pruneToRetention({ retentionDays: 30, now: NOW });

    traces.record(aged(0, NOW));
    const verdict = traces.verifyChain(key!.publicKeyPem);

    expect(verdict.valid).toBe(true);
    expect(verdict.retainedFrom?.seq).toBe(3);
  });

  test('a sweep that empties the table still leaves an extendable chain', () => {
    const { traces, key } = freshStore();
    for (const d of [400, 390]) traces.record(aged(d, NOW));

    // The head survives by rule, so one sweep cannot empty it; a second sweep
    // after the head has also aged out is the case that would.
    traces.pruneToRetention({ retentionDays: 30, now: NOW });
    traces.record(aged(0, NOW));

    expect(traces.verifyChain(key!.publicKeyPem).valid).toBe(true);
  });

  test('does nothing when every record is inside the window', () => {
    const { traces } = freshStore();
    for (const d of [5, 3, 1]) traces.record(aged(d, NOW));

    expect(traces.pruneToRetention({ retentionDays: 30, now: NOW }).removed).toBe(0);
  });

  test('unlimited retention is a no-op', () => {
    const { traces } = freshStore();
    for (const d of [900, 800]) traces.record(aged(d, NOW));

    expect(traces.pruneToRetention({ retentionDays: -1, now: NOW }).removed).toBe(0);
  });

  test('refuses to prune with no signing key, rather than breaking the chain', () => {
    const { traces } = freshStore(false);
    for (const d of [100, 95, 1]) traces.record(aged(d, NOW));

    expect(traces.pruneToRetention({ retentionDays: 30, now: NOW }).removed).toBe(0);
  });

  test('a record written out of order holds the boundary back', () => {
    const { traces, key } = freshStore();
    traces.record(aged(100, NOW));            // seq 1 — expired
    traces.record(aged(1, NOW));              // seq 2 — inside the window
    traces.record(aged(99, NOW));             // seq 3 — expired, but written late
    traces.record(aged(0, NOW));              // seq 4 — head

    // Cutting by timestamp would take seq 1 and seq 3 and leave a hole at 2.
    // The boundary is the last sequence at which everything is expired: seq 1.
    const result = traces.pruneToRetention({ retentionDays: 30, now: NOW });

    expect(result.removed).toBe(1);
    expect(traces.verifyChain(key!.publicKeyPem).valid).toBe(true);
  });

  test('latestRetentionAnchor requires a key to return anything', () => {
    const { traces, key } = freshStore();
    for (const d of [100, 95, 1]) traces.record(aged(d, NOW));
    traces.pruneToRetention({ retentionDays: 30, now: NOW });

    expect(traces.latestRetentionAnchor()).toBeUndefined();
    expect(traces.latestRetentionAnchor(key!.publicKeyPem)?.removed).toBe(2);
  });
});

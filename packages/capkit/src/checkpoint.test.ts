/**
 * Chain checkpointing — a performance aid that must not become a place to hide.
 *
 * Measured before it was built, because the project's rule is that no number is
 * published a measurement did not produce: a signed walk costs ~161µs per
 * record on this machine, so twenty thousand records is **3.2 seconds**, and
 * the watch pays that in full on every sweep.
 *
 * The hazard is the whole design. A checkpoint says *I walked to seq N and
 * found hash H*, and if you trust it you have stopped verifying everything
 * before N. It lives in the same SQLite file as the records it vouches for, so
 * anybody able to edit an execution can edit the checkpoint too.
 *
 * That cannot be engineered away, so it is stated instead: the default stays a
 * full walk, resuming is opt-in, and a resumed result carries `verifiedFrom`
 * and `scope` so it can never be mistaken for the stronger claim. The tests
 * below hold exactly those properties.
 */
import { Storage } from './storage';
import { TraceStore, SigningKey } from './trace';

const build = (n: number) => {
  const storage = new Storage(':memory:');
  const { key, publicKeyPem } = SigningKey.createPair();
  const traces = new TraceStore(storage, key);
  for (let i = 0; i < n; i++) {
    traces.record({
      subject: 'agent:a', scope: ['x:y'], module: 'm', action: 'a',
      outcome: 'success', input: { i }, output: { i },
    });
  }
  return { storage, traces, publicKeyPem, key };
};

describe('checkpoints', () => {
  test('a checkpoint is only written after the chain verifies', () => {
    const { traces, publicKeyPem } = build(5);
    const checkpoint = traces.checkpoint(publicKeyPem);

    expect(checkpoint).toBeDefined();
    expect(checkpoint!.seq).toBe(5);
    expect(checkpoint!.hash).toBe(traces.verifyChain(publicKeyPem).headHash);
  });

  test('an empty chain produces no checkpoint, rather than one vouching for nothing', () => {
    const { traces, publicKeyPem } = build(0);
    expect(traces.checkpoint(publicKeyPem)).toBeUndefined();
  });

  test('a store with no signing key cannot checkpoint', () => {
    // An unsigned checkpoint is a row anybody can write. Refusing is the only
    // honest option — there is nothing to bind it to this instance.
    const storage = new Storage(':memory:');
    const traces = new TraceStore(storage);
    traces.record({ subject: 'a', scope: [], module: 'm', action: 'a', outcome: 'success', input: {} });

    expect(traces.checkpoint()).toBeUndefined();
  });

  test('resuming verifies only what arrived after the checkpoint', () => {
    const { traces, publicKeyPem } = build(10);
    traces.checkpoint(publicKeyPem);
    for (let i = 0; i < 3; i++) {
      traces.record({ subject: 'a', scope: [], module: 'm', action: 'later', outcome: 'success', input: { i } });
    }

    const resumed = traces.verifyChain(publicKeyPem, { from: 'checkpoint' });

    expect(resumed.valid).toBe(true);
    expect(resumed.checked).toBe(3);                 // not 13
    expect(resumed.verifiedFrom?.seq).toBe(10);
  });

  test('a resumed result is shaped differently from a full one, so the claims cannot be confused', () => {
    const { traces, publicKeyPem } = build(6);
    traces.checkpoint(publicKeyPem);

    const full = traces.verifyChain(publicKeyPem);
    const resumed = traces.verifyChain(publicKeyPem, { from: 'checkpoint' });

    // Both say valid. Only one says what it did not look at.
    expect(full.valid).toBe(true);
    expect(full.verifiedFrom).toBeUndefined();
    expect(full.scope).toBeUndefined();

    expect(resumed.valid).toBe(true);
    expect(resumed.scope).toMatch(/were not re-examined/);
    expect(resumed.scope).toMatch(/walk from genesis/);
  });

  test('the default is still a full walk — no caller opts in by accident', () => {
    const { traces, publicKeyPem } = build(4);
    traces.checkpoint(publicKeyPem);

    const result = traces.verifyChain(publicKeyPem);

    expect(result.checked).toBe(4);
    expect(result.verifiedFrom).toBeUndefined();
  });
});

describe('a checkpoint must not become a place to hide', () => {
  /*
   * The attack the whole design has to survive.
   *
   * Tamper with a record *before* the checkpoint, then ask for a resumed
   * verification. If it answered `valid: true` with no qualification, a
   * checkpoint would be a way to launder edited history — and this feature
   * would have made the product worse than not having it.
   */
  test('a resumed pass does NOT detect tampering before the checkpoint, and the full walk does', () => {
    /*
     * This test was written expecting the resumed pass to catch it. It does
     * not, and the code is right — the expectation was wrong.
     *
     * Editing `action` at seq 3 does not alter the stored `hash` column at seq
     * 10, so the checkpoint's anchor still matches and the walk legitimately
     * starts after it. **Skipping the walk is the entire feature; not seeing
     * what you skipped is not a bug in it, it is what it means.**
     *
     * There is no way to detect pre-checkpoint tampering without re-walking,
     * which is the thing being avoided. So the danger cannot be engineered
     * away, and pretending otherwise would be far worse than stating it: this
     * assertion exists so that anyone who later "fixes" the resumed pass to
     * return `valid: false` here has to read why it cannot.
     *
     * The mitigation is entirely in the reporting, and the pairing below is the
     * whole argument for the feature being safe to ship.
     */
    const { storage, traces, publicKeyPem } = build(10);
    traces.checkpoint(publicKeyPem);

    storage.run("UPDATE executions SET action = 'tampered' WHERE seq = 3");

    const resumed = traces.verifyChain(publicKeyPem, { from: 'checkpoint' });
    expect(resumed.valid).toBe(true);              // it did not look, and does not pretend to have
    expect(resumed.checked).toBe(0);
    expect(resumed.scope).toMatch(/Records up to 10 were not re-examined/);

    // The default answers the question the resumed pass declined to.
    const full = traces.verifyChain(publicKeyPem);
    expect(full.valid).toBe(false);
    expect(full.brokenAt).toBe(3);
  });

  test('a checkpoint pointing at a sequence that no longer holds its hash is discarded', () => {
    // The cheap sanity check the anchor *does* perform: truncation, rollback,
    // or a checkpoint carried into a different chain. Not tamper detection.
    const { storage, traces, publicKeyPem } = build(10);
    traces.checkpoint(publicKeyPem);

    storage.run("UPDATE executions SET hash = 'deadbeef' WHERE seq = 10");

    const resumed = traces.verifyChain(publicKeyPem, { from: 'checkpoint' });
    expect(resumed.verifiedFrom).toBeUndefined();
    expect(resumed.valid).toBe(false);
  });

  test('a forged checkpoint row is ignored, not trusted', () => {
    const { storage, traces, publicKeyPem } = build(8);

    // Somebody writes a checkpoint by hand claiming the chain is good to seq 8.
    storage.run(
      `INSERT INTO chain_checkpoints (seq, hash, verified_at, key_id, signature)
       VALUES (?, ?, ?, ?, ?)`,
      8, traces.verifyChain(publicKeyPem).headHash, new Date().toISOString(), 'forged', 'bm90LWEtc2lnbmF0dXJl'
    );

    expect(traces.latestCheckpoint(publicKeyPem)).toBeUndefined();

    // And a resumed verification silently becomes a full one.
    const resumed = traces.verifyChain(publicKeyPem, { from: 'checkpoint' });
    expect(resumed.checked).toBe(8);
    expect(resumed.verifiedFrom).toBeUndefined();
  });

  test('a checkpoint replayed at a different sequence does not verify', () => {
    // The signature covers seq *and* hash. Signing the hash alone would let a
    // genuine checkpoint be moved to a sequence it never described, which is
    // how a signed cache stops meaning anything.
    const { storage, traces, publicKeyPem } = build(9);
    const real = traces.checkpoint(publicKeyPem)!;

    storage.run('DELETE FROM chain_checkpoints');
    storage.run(
      `INSERT INTO chain_checkpoints (seq, hash, verified_at, key_id, signature) VALUES (?, ?, ?, ?, ?)`,
      4, real.hash, real.verifiedAt, real.keyId ?? null, real.signature
    );

    expect(traces.latestCheckpoint(publicKeyPem)).toBeUndefined();
  });

  test('a checkpoint from a different key is ignored after rotation', () => {
    const { traces, publicKeyPem } = build(5);
    traces.checkpoint(publicKeyPem);

    const other = SigningKey.createPair().publicKeyPem;

    // Not an error — a rotation is not an intrusion. The correct response is
    // the same either way: fall back to walking from genesis.
    expect(traces.latestCheckpoint(other)).toBeUndefined();
    expect(traces.verifyChain(publicKeyPem, { from: 'checkpoint' }).valid).toBe(true);
  });
});

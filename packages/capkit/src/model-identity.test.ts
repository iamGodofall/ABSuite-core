import { Storage } from './storage';
import { ModelRegistry, ModelIdentityError, fingerprintHash } from './model-identity';

const fresh = () => {
  const storage = new Storage(':memory:');
  return { storage, models: new ModelRegistry(storage) };
};

const claude = { provider: 'anthropic', model: 'claude-sonnet-4-5', version: '20250929' };
const approval = { approvedBy: 'risk@example.com', basis: 'Passed the refunds evaluation set on 2026-07-14, 412/412.' };

describe('fingerprinting', () => {
  test('field order does not change the hash', () => {
    expect(fingerprintHash({ provider: 'a', model: 'b', version: 'c' }))
      .toBe(fingerprintHash({ model: 'b', version: 'c', provider: 'a' } as never));
  });

  test('attribute order does not change the hash', () => {
    const one = fingerprintHash({ provider: 'a', model: 'b', attributes: { x: '1', y: '2' } });
    const two = fingerprintHash({ provider: 'a', model: 'b', attributes: { y: '2', x: '1' } });
    expect(one).toBe(two);
  });

  test('losing a field is a change, because it changes what you can see', () => {
    const withVersion = fingerprintHash({ provider: 'a', model: 'b', version: '1' });
    const without = fingerprintHash({ provider: 'a', model: 'b' });
    expect(withVersion).not.toBe(without);
  });
});

describe('approving a model', () => {
  test('records who approved it and on what basis', () => {
    const { models } = fresh();
    const approved = models.approve({ name: 'refunds-classifier', fingerprint: claude, ...approval });

    expect(approved.hash).toHaveLength(64);
    expect(approved.approvedBy).toBe('risk@example.com');
    expect(approved.basis).toMatch(/412\/412/);
  });

  test('refuses an approval nobody stands behind', () => {
    const { models } = fresh();
    // An approval with no name attached cannot be reviewed, revoked or defended.
    expect(() => models.approve({ name: 'x', fingerprint: claude, approvedBy: '', basis: 'b' }))
      .toThrow(/approvedBy is required/);
    expect(() => models.approve({ name: 'x', fingerprint: claude, approvedBy: 'a@b.c', basis: '  ' }))
      .toThrow(/basis is required/);
  });

  test('refuses a fingerprint with nothing identifying in it', () => {
    const { models } = fresh();
    expect(() => models.approve({ name: 'x', fingerprint: { model: 'y' }, ...approval })).toThrow(/provider is required/);
    expect(() => models.approve({ name: 'x', fingerprint: { provider: 'y' }, ...approval })).toThrow(/model is required/);
  });

  test('will not silently re-approve under the same name', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    // Approving a different model under an existing name is exactly how a swap
    // goes unnoticed — it has to be a deliberate supersede.
    expect(() => models.approve({ name: 'refunds', fingerprint: { ...claude, version: '20260101' }, ...approval }))
      .toThrow(/already approved/);
  });
});

describe('is this the model that was approved?', () => {
  test('an identical fingerprint is DEMONSTRATED', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    const attestation = models.attest('refunds', { ...claude });
    expect(attestation.state).toBe('DEMONSTRATED');
    expect(attestation.drift).toEqual([]);
    // And it still says what it does not know.
    expect(attestation.limits.join(' ')).toMatch(/not behaviour/);
  });

  test('a silently rolled version is FAILED, and names the field', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    // The event this exists for: a provider rolls a snapshot and nothing in an
    // execution log would ever mention it.
    const attestation = models.attest('refunds', { ...claude, version: '20260115' });

    expect(attestation.state).toBe('FAILED');
    expect(attestation.drift).toEqual([{ field: 'version', approved: '20250929', observed: '20260115' }]);
    // A finding, not a verdict on the new model.
    expect(attestation.finding).toMatch(/not a judgement about the new model/);
  });

  test('a repointed proxy shows as a provider change', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    const attestation = models.attest('refunds', { ...claude, provider: 'some-gateway' });
    expect(attestation.state).toBe('FAILED');
    expect(attestation.drift.map(d => d.field)).toEqual(['provider']);
  });

  test('a changed quantisation shows through attributes', () => {
    const { models } = fresh();
    models.approve({ name: 'local', fingerprint: { provider: 'ollama', model: 'llama3.2', attributes: { quantisation: 'Q8_0' } }, ...approval });

    const attestation = models.attest('local', { provider: 'ollama', model: 'llama3.2', attributes: { quantisation: 'Q4_K_M' } });
    expect(attestation.state).toBe('FAILED');
    expect(attestation.drift).toEqual([{ field: 'attributes.quantisation', approved: 'Q8_0', observed: 'Q4_K_M' }]);
  });

  test('nothing approved is ABSENT, not a pass and not a failure', () => {
    const { models } = fresh();
    const attestation = models.attest('never-approved', claude);

    expect(attestation.state).toBe('ABSENT');
    expect(attestation.finding).toMatch(/no baseline to compare against/);
  });

  test('nothing observed is UNKNOWN', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    // An approval on file and nothing to check it against is not a pass.
    expect(models.attest('refunds').state).toBe('UNKNOWN');
    expect(models.attest('refunds', null).state).toBe('UNKNOWN');
  });

  test('an unreadable observation is UNKNOWN rather than FAILED', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    // "I could not read this" and "this is the wrong model" are different
    // statements, and collapsing them accuses somebody of a swap over a typo.
    const attestation = models.attest('refunds', { model: 'no-provider' });
    expect(attestation.state).toBe('UNKNOWN');
    expect(attestation.finding).toMatch(/could not be read/);
  });

  test('every attestation carries what it cannot tell you', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    for (const attestation of [models.attest('refunds', claude), models.attest('refunds'), models.attest('nope')]) {
      // The refusal from INTERPRETABILITY.md, enforced rather than written down.
      expect(attestation.limits.join(' ')).toMatch(/ABSuite does not load models/);
      expect(JSON.stringify(attestation)).not.toMatch(/think|reason|belie/i);
    }
  });
});

describe('superseding', () => {
  test('replaces the baseline and requires a reason', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });

    const next = { ...claude, version: '20260115' };
    const superseded = models.supersede('refunds', { fingerprint: next, approvedBy: 'risk@example.com', basis: 'Re-ran the evaluation set on the new snapshot, 410/412.' });

    expect(superseded.hash).toBe(fingerprintHash(next));
    expect(models.attest('refunds', next).state).toBe('DEMONSTRATED');
    // The old one now reads as drift, which is the point.
    expect(models.attest('refunds', claude).state).toBe('FAILED');
  });

  test('will not supersede something that was never approved', () => {
    const { models } = fresh();
    expect(() => models.supersede('ghost', { fingerprint: claude, ...approval })).toThrow(ModelIdentityError);
  });

  test('will not supersede without a stated basis', () => {
    const { models } = fresh();
    models.approve({ name: 'refunds', fingerprint: claude, ...approval });
    expect(() => models.supersede('refunds', { fingerprint: claude, approvedBy: 'a@b.c', basis: '' }))
      .toThrow(/requires approvedBy and basis/);
  });
});

import { sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { Storage } from './storage';
import { TraceStore, SigningKey, hashPayload } from './trace';
import { trustConditions } from './conditions';
import {
  IdentityRegistry,
  IdentityError,
  generateIdentityKeypair,
  suggestSubjectId,
  IDENTITY_KINDS,
} from './identity';

const fresh = () => {
  const storage = new Storage(':memory:');
  return { storage, registry: new IdentityRegistry(storage) };
};

/** What an agent does with its own private key. Never done server-side. */
const signNonce = (nonce: string, privateKeyPem: string) =>
  cryptoSign(null, Buffer.from(nonce, 'utf8'), createPrivateKey(privateKeyPem)).toString('base64');

describe('enrolling an identity', () => {
  test('records a subject against the public half of a key it holds', () => {
    const { registry } = fresh();
    const { publicKeyPem } = generateIdentityKeypair();

    const identity = registry.enrol({ subject: 'agent:writer', publicKeyPem, kind: 'agent', label: 'Drafting agent' });

    expect(identity.subject).toBe('agent:writer');
    expect(identity.status).toBe('active');
    expect(identity.enrolledAt).toBeTruthy();
    expect(registry.get('agent:writer')?.publicKeyPem).toBe(publicKeyPem);
  });

  test('refuses a private key, and says why that matters', () => {
    const { registry } = fresh();
    const { privateKeyPem } = generateIdentityKeypair();

    // The one mistake worth naming specifically: it would parse, it would work,
    // and the operator would have handed their signing key to a service that
    // only ever needed the public half.
    expect(() => registry.enrol({ subject: 'agent:oops', publicKeyPem: privateKeyPem }))
      .toThrow(/public half only/);
  });

  test('refuses a key of the wrong algorithm rather than failing later', () => {
    const { registry } = fresh();
    const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();

    expect(() => registry.enrol({ subject: 'agent:rsa', publicKeyPem: rsa })).toThrow(/Ed25519/);
  });

  test('refuses gibberish rather than storing an identity that can never prove itself', () => {
    const { registry } = fresh();
    expect(() => registry.enrol({ subject: 'agent:x', publicKeyPem: 'not a pem' })).toThrow(/readable PEM/);
    expect(registry.list()).toEqual([]);
  });

  test('will not silently replace an existing key', () => {
    const { registry } = fresh();
    registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem });

    // Re-enrolment under a new key is exactly how an identity gets taken over.
    expect(() => registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem }))
      .toThrow(/already enrolled/);
  });

  test('every kind in the published list is accepted, and nothing else is', () => {
    const { registry } = fresh();
    for (const kind of IDENTITY_KINDS) {
      const subject = suggestSubjectId(kind);
      expect(registry.enrol({ subject, publicKeyPem: generateIdentityKeypair().publicKeyPem, kind }).kind).toBe(kind);
    }
    expect(() => registry.enrol({ subject: 'x', publicKeyPem: generateIdentityKeypair().publicKeyPem, kind: 'deity' }))
      .toThrow(/kind must be one of/);
  });
});

describe('proving possession', () => {
  test('a signature over the challenge verifies against the enrolled key', () => {
    const { registry } = fresh();
    const { publicKeyPem, privateKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });

    const { nonce } = registry.challenge('agent:a');
    const result = registry.prove('agent:a', nonce, signNonce(nonce, privateKeyPem));

    expect(result.subject).toBe('agent:a');
    expect(registry.get('agent:a')?.lastProvenAt).toBeTruthy();
  });

  test('a different key does not prove anything', () => {
    const { registry } = fresh();
    registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem });
    const impostor = generateIdentityKeypair();

    const { nonce } = registry.challenge('agent:a');
    expect(() => registry.prove('agent:a', nonce, signNonce(nonce, impostor.privateKeyPem)))
      .toThrow(/does not verify against the public key enrolled/);
  });

  test('a challenge is good exactly once, even when the proof succeeded', () => {
    const { registry } = fresh();
    const { publicKeyPem, privateKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });

    const { nonce } = registry.challenge('agent:a');
    const signature = signNonce(nonce, privateKeyPem);
    registry.prove('agent:a', nonce, signature);

    // A replayed proof is the whole reason the nonce exists.
    expect(() => registry.prove('agent:a', nonce, signature)).toThrow(/No such challenge/);
  });

  test('a failed attempt consumes the challenge too', () => {
    const { registry } = fresh();
    const { publicKeyPem, privateKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });

    const { nonce } = registry.challenge('agent:a');
    expect(() => registry.prove('agent:a', nonce, 'bm90LWEtc2lnbmF0dXJl')).toThrow(/does not verify/);

    // A challenge that survives a failure is one an attacker may keep trying.
    expect(() => registry.prove('agent:a', nonce, signNonce(nonce, privateKeyPem))).toThrow(/No such challenge/);
  });

  test('one subject cannot use another subject’s challenge', () => {
    const { registry } = fresh();
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem: a.publicKeyPem });
    registry.enrol({ subject: 'agent:b', publicKeyPem: b.publicKeyPem });

    const { nonce } = registry.challenge('agent:a');
    expect(() => registry.prove('agent:b', nonce, signNonce(nonce, b.privateKeyPem)))
      .toThrow(/issued to a different subject/);
  });

  test('an expired challenge is refused', () => {
    const { storage, registry } = fresh();
    const { publicKeyPem, privateKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });

    const { nonce } = registry.challenge('agent:a');
    storage.run('UPDATE identity_challenges SET expires_at = ? WHERE nonce = ?', '2020-01-01T00:00:00.000Z', nonce);

    expect(() => registry.prove('agent:a', nonce, signNonce(nonce, privateKeyPem))).toThrow(/expired/);
  });

  test('an unenrolled subject has nothing to challenge', () => {
    const { registry } = fresh();
    expect(() => registry.challenge('agent:ghost')).toThrow(IdentityError);
    expect(() => registry.challenge('agent:ghost')).toThrow(/No identity is enrolled/);
  });
});

describe('suspension', () => {
  test('stops new authority and leaves history alone', () => {
    const { registry } = fresh();
    const { publicKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });

    const suspended = registry.suspend('agent:a', 'Key suspected compromised on 2026-08-01');
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedReason).toMatch(/compromised/);

    // No challenge, so no token, so no new authority.
    expect(() => registry.challenge('agent:a')).toThrow(/suspended/);
  });

  test('requires a stated reason', () => {
    const { registry } = fresh();
    registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem });

    // Access removed without a cause cannot be reviewed by anyone later.
    expect(() => registry.suspend('agent:a', '   ')).toThrow(/reason is required/);
  });

  test('reinstating clears the suspension without rewriting it away', () => {
    const { registry } = fresh();
    const { publicKeyPem, privateKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });
    registry.suspend('agent:a', 'precaution');

    const back = registry.reinstate('agent:a');
    expect(back.status).toBe('active');
    expect(registry.get('agent:a')?.suspendedReason).toBeUndefined();

    const { nonce } = registry.challenge('agent:a');
    expect(registry.prove('agent:a', nonce, signNonce(nonce, privateKeyPem)).subject).toBe('agent:a');
  });
});

describe('rotation', () => {
  test('changes which key future proofs are checked against', () => {
    const { registry } = fresh();
    const first = generateIdentityKeypair();
    const second = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem: first.publicKeyPem });
    registry.rotate('agent:a', second.publicKeyPem);

    const { nonce } = registry.challenge('agent:a');
    expect(() => registry.prove('agent:a', nonce, signNonce(nonce, first.privateKeyPem))).toThrow(/does not verify/);

    const next = registry.challenge('agent:a');
    expect(registry.prove('agent:a', next.nonce, signNonce(next.nonce, second.privateKeyPem)).subject).toBe('agent:a');
  });

  test('rotating to the same key is refused', () => {
    const { registry } = fresh();
    const { publicKeyPem } = generateIdentityKeypair();
    registry.enrol({ subject: 'agent:a', publicKeyPem });
    expect(() => registry.rotate('agent:a', publicKeyPem)).toThrow(/not a rotation/);
  });
});

describe('what the record is entitled to claim about who acted', () => {
  const record = (traces: TraceStore, subject: string, jti?: string) =>
    traces.record({
      subject,
      ...(jti ? { jti } : {}),
      scope: ['x:y'],
      module: 'm',
      action: 'act',
      inputHash: hashPayload({ a: 1 }),
      outcome: 'success',
    });

  test('a name nobody enrolled is UNKNOWN, not DEMONSTRATED', () => {
    const { storage, registry } = fresh();
    const key = new SigningKey();
    const traces = new TraceStore(storage, key);
    const trace = record(traces, 'agent:cfo', 'tok_1');

    /*
     * The regression this whole layer exists for.
     *
     * This previously answered DEMONSTRATED, because the check was "does the
     * record's signature verify" — which is always true for a record the server
     * just wrote. Anyone with an admin key could type `subject: "agent:cfo"` and
     * the strongest word the product has appeared next to it.
     */
    const report = trustConditions(trace, undefined, true, registry.attest(trace.subject, trace.jti));
    const identity = report.conditions.find(c => c.condition === 'Identity')!;

    expect(identity.state).toBe('UNKNOWN');
    expect(identity.finding).toMatch(/not an enrolled identity/);
    expect(identity.resolvedBy).toMatch(/Enrol this subject/);
    // And it drags the overall answer down, because nothing composes upward.
    expect(report.overall).not.toBe('DEMONSTRATED');
  });

  test('an enrolled subject whose token was proof-backed is DEMONSTRATED', () => {
    const { storage, registry } = fresh();
    const traces = new TraceStore(storage, new SigningKey());
    registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem });
    registry.bindToken('tok_proven', 'agent:a', true);

    const trace = record(traces, 'agent:a', 'tok_proven');
    const identity = trustConditions(trace, undefined, true, registry.attest(trace.subject, trace.jti))
      .conditions.find(c => c.condition === 'Identity')!;

    expect(identity.state).toBe('DEMONSTRATED');
    expect(identity.finding).toMatch(/signed a challenge with the key on file/);
  });

  test('an enrolled subject whose token skipped proof is FAILED, not UNKNOWN', () => {
    const { storage, registry } = fresh();
    const traces = new TraceStore(storage, new SigningKey());
    registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem });
    registry.bindToken('tok_bypassed', 'agent:a', false);

    const trace = record(traces, 'agent:a', 'tok_bypassed');
    const identity = trustConditions(trace, undefined, true, registry.attest(trace.subject, trace.jti))
      .conditions.find(c => c.condition === 'Identity')!;

    // An enrolled identity whose authority can be obtained without its key is
    // not an identity — so this is a finding, not an absence of one.
    expect(identity.state).toBe('FAILED');
  });

  test('a suspended subject is FAILED, and its old records are untouched', () => {
    const { storage, registry } = fresh();
    const traces = new TraceStore(storage, new SigningKey());
    registry.enrol({ subject: 'agent:a', publicKeyPem: generateIdentityKeypair().publicKeyPem });
    registry.bindToken('tok_1', 'agent:a', true);
    const trace = record(traces, 'agent:a', 'tok_1');

    registry.suspend('agent:a', 'offboarded');

    const identity = trustConditions(trace, undefined, true, registry.attest(trace.subject, trace.jti))
      .conditions.find(c => c.condition === 'Identity')!;
    expect(identity.state).toBe('FAILED');
    // The record itself is not revised because someone was later distrusted.
    expect(traces.verifyChain().valid).toBe(true);
  });

  test('no subject at all is ABSENT', () => {
    const { registry } = fresh();
    expect(registry.attest('', undefined).state).toBe('ABSENT');
    expect(registry.attest(undefined, undefined).state).toBe('ABSENT');
  });

  test('without a registry at all the answer is UNKNOWN, never DEMONSTRATED', () => {
    const { storage } = fresh();
    const traces = new TraceStore(storage, new SigningKey());
    const trace = record(traces, 'agent:a', 'tok_1');

    // A deployment that has enrolled nobody behaves as it always did and says so.
    const identity = trustConditions(trace, undefined, true)
      .conditions.find(c => c.condition === 'Identity')!;
    expect(identity.state).toBe('UNKNOWN');
    expect(identity.finding).toMatch(/proves who wrote the record, not who acted/);
  });
});

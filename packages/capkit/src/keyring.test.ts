import { KeyRing } from './keyring';
import { CapabilityToken } from './capability';

const A = 'secret-alpha-that-is-at-least-32-characters';
const B = 'secret-bravo-that-is-at-least-32-characters';
const C = 'secret-charlie-that-is-at-least-32-characters';

describe('key ring construction', () => {
  test('requires exactly one active key', () => {
    expect(() => new KeyRing([])).toThrow(/at least one key/i);
    expect(() => new KeyRing([{ kid: 'a', secret: A, status: 'retired' }])).toThrow(/active/i);
    expect(() => new KeyRing([
      { kid: 'a', secret: A, status: 'active' },
      { kid: 'b', secret: B, status: 'active' },
    ])).toThrow(/only have one active/i);
  });

  test('rejects duplicate key ids', () => {
    expect(() => new KeyRing([
      { kid: 'a', secret: A, status: 'active' },
      { kid: 'a', secret: B, status: 'retired' },
    ])).toThrow(/duplicate/i);
  });

  test('never exposes secrets when describing itself', () => {
    const ring = new KeyRing([{ kid: 'a', secret: A, status: 'active' }]);
    expect(JSON.stringify(ring.describe())).not.toContain(A);
  });
});

describe('rotation', () => {
  test('the previous key still verifies tokens it signed', () => {
    const before = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]);
    const issued = CapabilityToken.create({ sub: 'agent', scope: ['read:x'], kid: 'k1' }, before.active.secret);

    const after = before.rotate(B, 'k2');

    expect(after.active.kid).toBe('k2');
    // The whole point: rotating does not log everyone out.
    expect(CapabilityToken.validate(issued.token, after).valid).toBe(true);
  });

  test('tokens signed after rotation verify too', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]).rotate(B, 'k2');
    const issued = CapabilityToken.create({ sub: 'agent', scope: ['read:x'], kid: 'k2' }, ring.active.secret);

    expect(CapabilityToken.validate(issued.token, ring).valid).toBe(true);
  });

  test('a key dropped from the ring stops verifying', () => {
    const first = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]);
    const issued = CapabilityToken.create({ sub: 'agent', scope: ['read:x'], kid: 'k1' }, A);

    // Two rotations with maxRetained=1 push k1 out entirely.
    const rotated = first.rotate(B, 'k2', 1).rotate(C, 'k3', 1);

    expect(rotated.describe().some(k => k.kid === 'k1')).toBe(false);
    expect(CapabilityToken.validate(issued.token, rotated).valid).toBe(false);
  });

  test('bounds how many retired keys are kept', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }])
      .rotate(B, 'k2', 2)
      .rotate(C, 'k3', 2);

    expect(ring.retired).toHaveLength(2);
  });

  test('refuses a weak or duplicate rotation secret', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]);

    expect(() => ring.rotate('short', 'k2')).toThrow(/at least 32/i);
    expect(() => ring.rotate(B, 'k1')).toThrow(/already in the ring/i);
  });

  test('records when a key was retired', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]).rotate(B, 'k2');
    expect(ring.describe().find(k => k.kid === 'k1')?.retiredAt).toBeTruthy();
  });
});

describe('verification against a ring', () => {
  test('rejects a token signed by a key not in the ring', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]);
    const foreign = CapabilityToken.create({ sub: 'attacker', scope: ['*'] }, 'an-entirely-unrelated-secret-value-32ch');

    expect(CapabilityToken.validate(foreign.token, ring).valid).toBe(false);
  });

  test('verifies a token with no kid by trying each key', () => {
    const ring = new KeyRing([
      { kid: 'k2', secret: B, status: 'active' },
      { kid: 'k1', secret: A, status: 'retired' },
    ]);
    // No kid supplied at creation.
    const issued = CapabilityToken.create({ sub: 'legacy', scope: ['read:x'] }, A);

    expect(CapabilityToken.validate(issued.token, ring).valid).toBe(true);
  });

  test('an expired token stays expired under every key', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]).rotate(B, 'k2');
    const expired = CapabilityToken.create({ sub: 'a', scope: ['read:x'], expiresIn: 1, kid: 'k1' }, A);

    // Move past the one-second lifetime.
    const realNow = Date.now;
    Date.now = () => realNow() + 5000;
    try {
      const result = CapabilityToken.validate(expired.token, ring);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe('TOKEN_EXPIRED');
    } finally {
      Date.now = realNow;
    }
  });

  test('still enforces required scope through a ring', () => {
    const ring = new KeyRing([{ kid: 'k1', secret: A, status: 'active' }]);
    const issued = CapabilityToken.create({ sub: 'a', scope: ['read:x'], kid: 'k1' }, A);

    const result = CapabilityToken.validate(issued.token, ring, { requiredScope: 'write:x' });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('CAPABILITY_INSUFFICIENT');
  });
});

describe('building from the environment', () => {
  test('reads the active key and retired secrets', () => {
    const ring = KeyRing.fromEnv({
      CAPKIT_HMAC_SECRET: A,
      CAPKIT_KEY_ID: 'current',
      CAPKIT_PREVIOUS_SECRETS: `old1:${B},${C}`,
    });

    expect(ring.active.kid).toBe('current');
    expect(ring.retired.map(k => k.kid)).toEqual(['old1', 'retired-2']);
  });

  test('requires an active secret', () => {
    expect(() => KeyRing.fromEnv({})).toThrow(/CAPKIT_HMAC_SECRET/);
  });

  test('works with no retired keys configured', () => {
    expect(KeyRing.fromEnv({ CAPKIT_HMAC_SECRET: A }).retired).toHaveLength(0);
  });
});

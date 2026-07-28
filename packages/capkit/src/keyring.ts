/**
 * Signing key rotation.
 *
 * A single active secret means rotating it invalidates every token in flight —
 * so in practice nobody rotates, and a leaked secret stays valid forever. A
 * keyring fixes that: new tokens are signed with the active key, while tokens
 * signed by recently retired keys still verify until they expire naturally.
 *
 * The `kid` header already emitted by `signJwt` is what makes this efficient:
 * verification looks up one key instead of trying all of them.
 */

export type KeyStatus = 'active' | 'retired';

export interface SigningKeyEntry {
  kid: string;
  secret: string;
  status: KeyStatus;
  /** When this key was retired, for operator visibility. */
  retiredAt?: string;
}

export class KeyRing {
  private readonly keys: SigningKeyEntry[];

  constructor(keys: SigningKeyEntry[]) {
    const usable = keys.filter(key => key.kid && key.secret);
    if (usable.length === 0) {
      throw new Error('A key ring requires at least one key');
    }
    if (!usable.some(key => key.status === 'active')) {
      throw new Error('A key ring requires exactly one active key');
    }
    if (usable.filter(key => key.status === 'active').length > 1) {
      throw new Error('A key ring may only have one active key');
    }

    const seen = new Set<string>();
    for (const key of usable) {
      if (seen.has(key.kid)) throw new Error(`Duplicate key id in ring: ${key.kid}`);
      seen.add(key.kid);
    }

    this.keys = usable;
  }

  /** The key new tokens are signed with. */
  get active(): SigningKeyEntry {
    return this.keys.find(key => key.status === 'active')!;
  }

  get retired(): SigningKeyEntry[] {
    return this.keys.filter(key => key.status === 'retired');
  }

  /**
   * Resolve the key a token was signed with.
   *
   * A token with no `kid` predates rotation, so every key is a candidate — the
   * caller falls back to trying them in turn.
   */
  find(kid?: string): SigningKeyEntry | undefined {
    if (!kid) return undefined;
    return this.keys.find(key => key.kid === kid);
  }

  /** Every secret, active first — the order to try when a token carries no kid. */
  candidates(): string[] {
    return [this.active.secret, ...this.retired.map(key => key.secret)];
  }

  /**
   * Promote a new key to active and retire the current one.
   *
   * Retired keys are kept so tokens already issued keep working; `maxRetained`
   * bounds the ring so a compromised key cannot verify forever.
   */
  rotate(newSecret: string, newKid: string, maxRetained = 2): KeyRing {
    if (!newSecret || newSecret.length < 32) {
      throw new Error('A rotation secret must be at least 32 characters');
    }
    if (this.keys.some(key => key.kid === newKid)) {
      throw new Error(`Key id already in the ring: ${newKid}`);
    }

    const retiredAt = new Date().toISOString();
    const previouslyRetired = this.retired.slice(0, Math.max(0, maxRetained - 1));

    return new KeyRing([
      { kid: newKid, secret: newSecret, status: 'active' },
      { ...this.active, status: 'retired', retiredAt },
      ...previouslyRetired,
    ]);
  }

  /** Operator view. Secrets are never included. */
  describe(): Array<{ kid: string; status: KeyStatus; retiredAt?: string }> {
    return this.keys.map(key => ({
      kid: key.kid,
      status: key.status,
      ...(key.retiredAt ? { retiredAt: key.retiredAt } : {}),
    }));
  }

  /**
   * Build a ring from the environment.
   *
   * `CAPKIT_HMAC_SECRET` is the active key. `CAPKIT_PREVIOUS_SECRETS` holds
   * comma-separated retired secrets, optionally as `kid:secret`, so a rotation
   * is a config change and a restart rather than a migration.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): KeyRing {
    const activeSecret = (env.CAPKIT_HMAC_SECRET || env.CAPKIT_JWT_SECRET || '').trim();
    if (!activeSecret) {
      throw new Error('CAPKIT_HMAC_SECRET is required to build a key ring');
    }

    const activeKid = (env.CAPKIT_KEY_ID || 'capkit-default').trim();

    const retired = (env.CAPKIT_PREVIOUS_SECRETS || '')
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map((entry, index): SigningKeyEntry => {
        const separator = entry.indexOf(':');
        // A bare secret gets a synthetic id; it will simply be tried in turn.
        return separator > 0
          ? { kid: entry.slice(0, separator), secret: entry.slice(separator + 1), status: 'retired' }
          : { kid: `retired-${index + 1}`, secret: entry, status: 'retired' };
      })
      .filter(key => key.secret.length > 0);

    return new KeyRing([{ kid: activeKid, secret: activeSecret, status: 'active' }, ...retired]);
  }
}

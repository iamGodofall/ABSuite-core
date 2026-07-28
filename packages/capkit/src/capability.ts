/**
 * Capability tokens — scoped, expiring, signed grants for agents.
 *
 * A capability token is an HS256 JWT whose payload carries an explicit list of
 * `resource:action` scopes. Services authorise a request by asking whether the
 * token's granted scopes satisfy the scope the endpoint requires, so an agent
 * only ever holds the narrow authority it was issued.
 */
import { randomUUID } from 'node:crypto';
import { signJwt, verifyJwt, parseDuration, base64UrlDecode, type JwtErrorCode } from './jwt';
import { KeyRing } from './keyring';

/** A single secret, or a ring that also accepts recently retired keys. */
export type VerificationKey = string | KeyRing;

/**
 * Read the `kid` header without verifying anything.
 *
 * Used only to pick which key to verify *with* — the signature check that
 * follows is what actually establishes trust, so an attacker controlling this
 * value gains nothing beyond choosing which key rejects them.
 */
function peekKid(token: string): string | undefined {
  try {
    const header = JSON.parse(base64UrlDecode(token.split('.')[0] ?? '').toString('utf8'));
    return typeof header.kid === 'string' ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verify against a single secret or every candidate in a ring.
 *
 * With a ring we try the key named by `kid` first, then fall back to the rest,
 * so tokens issued before a rotation keep working until they expire.
 */
function verifyWithKey(
  token: string,
  key: VerificationKey,
  options: { audience?: string }
): ReturnType<typeof verifyJwt> {
  if (typeof key === 'string') {
    return verifyJwt(token, key, options);
  }

  const named = key.find(peekKid(token));
  const secrets = named ? [named.secret, ...key.candidates().filter(s => s !== named.secret)] : key.candidates();

  let lastResult = verifyJwt(token, secrets[0]!, options);
  for (const secret of secrets.slice(1)) {
    if (lastResult.valid) return lastResult;
    // Only a signature mismatch is worth retrying; an expired token is expired
    // whichever key signed it.
    if (!lastResult.valid && lastResult.error !== 'TOKEN_INVALID') return lastResult;
    lastResult = verifyJwt(token, secret, options);
  }
  return lastResult;
}

/**
 * Declared as a type alias rather than an interface so it stays structurally
 * assignable to the JWT payload's index signature.
 */
export type CapabilityClaims = {
  sub: string;
  scope: string[];
  aud?: string;
  iat: number;
  exp: number;
  jti: string;
  kid?: string;
};

export interface CreateCapabilityOptions {
  sub: string;
  scope: string[];
  expiresIn?: string | number;
  aud?: string;
  kid?: string;
}

export interface CreatedCapability {
  token: string;
  jti: string;
  iat: number;
  exp: number;
  kid?: string;
}

export type CapabilityValidation =
  | { valid: true; claims: CapabilityClaims }
  | { valid: false; error: JwtErrorCode | 'TOKEN_REVOKED' | 'CAPABILITY_INSUFFICIENT'; message: string };

const DEFAULT_EXPIRY = '24h';

/**
 * Does a single granted scope satisfy a required scope?
 *
 * Matching is segment-wise on ':' so `read:*` grants `read:users`, and a bare
 * `*` grants everything. Segment counts must match otherwise, which keeps
 * `read:users` from accidentally granting `read:users:delete`.
 */
export function scopeSatisfies(granted: string, required: string): boolean {
  if (granted === '*' || granted === '*:*') return true;
  if (granted === required) return true;

  const grantedParts = granted.split(':');
  const requiredParts = required.split(':');
  if (grantedParts.length !== requiredParts.length) return false;

  return grantedParts.every((part, index) => part === '*' || part === requiredParts[index]);
}

/** Does any scope in the token satisfy the required scope? */
export function hasCapability(grantedScopes: readonly string[], required: string): boolean {
  return grantedScopes.some(granted => scopeSatisfies(granted, required));
}

function normaliseScope(scope: unknown): string[] {
  const raw = Array.isArray(scope)
    ? scope
    : typeof scope === 'string'
      ? scope.split(/[,\s]+/)
      : [];

  const cleaned = raw
    .map(entry => String(entry).trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(cleaned));
}

export const CapabilityToken = {
  create(options: CreateCapabilityOptions, secret: string): CreatedCapability {
    const sub = String(options.sub || '').trim();
    if (!sub) {
      throw new Error('A subject (sub) is required to issue a capability token');
    }

    const scope = normaliseScope(options.scope);
    if (scope.length === 0) {
      throw new Error('At least one scope is required to issue a capability token');
    }

    const ttlSeconds = parseDuration(options.expiresIn ?? DEFAULT_EXPIRY);
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + ttlSeconds;
    const jti = randomUUID();

    const claims: CapabilityClaims = {
      sub,
      scope,
      iat,
      exp,
      jti,
      ...(options.aud ? { aud: options.aud } : {}),
      ...(options.kid ? { kid: options.kid } : {}),
    };

    const token = signJwt(claims, secret, options.kid ? { kid: options.kid } : {});

    return { token, jti, iat, exp, ...(options.kid ? { kid: options.kid } : {}) };
  },

  validate(
    token: string,
    key: VerificationKey,
    options: { audience?: string; requiredScope?: string; isRevoked?: (jti: string) => boolean } = {}
  ): CapabilityValidation {
    const result = verifyWithKey(token, key, options.audience ? { audience: options.audience } : {});
    if (!result.valid) {
      return { valid: false, error: result.error, message: result.message };
    }

    const payload = result.payload;
    const claims: CapabilityClaims = {
      sub: String(payload.sub ?? ''),
      scope: normaliseScope(payload.scope),
      iat: Number(payload.iat ?? 0),
      exp: Number(payload.exp ?? 0),
      jti: String(payload.jti ?? ''),
      ...(typeof payload.aud === 'string' ? { aud: payload.aud } : {}),
      ...(typeof payload.kid === 'string' ? { kid: payload.kid } : {}),
    };

    if (options.isRevoked && claims.jti && options.isRevoked(claims.jti)) {
      return { valid: false, error: 'TOKEN_REVOKED', message: 'Token has been revoked' };
    }

    if (options.requiredScope && !hasCapability(claims.scope, options.requiredScope)) {
      return {
        valid: false,
        error: 'CAPABILITY_INSUFFICIENT',
        message: `Token missing required scope: ${options.requiredScope}`,
      };
    }

    return { valid: true, claims };
  },
};

/**
 * In-memory revocation list.
 *
 * Deliberately simple and process-local: it is correct for a single CapKit
 * instance and is the documented limitation for multi-replica deployments,
 * where a shared store is required instead.
 */
export class RevocationList {
  private readonly revoked = new Map<string, number>();

  revoke(jti: string, expiresAtEpochSec: number): void {
    if (!jti) return;
    this.revoked.set(jti, expiresAtEpochSec);
  }

  isRevoked(jti: string): boolean {
    this.prune();
    return this.revoked.has(jti);
  }

  get size(): number {
    this.prune();
    return this.revoked.size;
  }

  /** Drop entries whose underlying token has expired anyway. */
  private prune(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, expiresAt] of this.revoked) {
      if (expiresAt && expiresAt < now) {
        this.revoked.delete(jti);
      }
    }
  }
}

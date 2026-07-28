/**
 * HS256 JWT primitives built on node:crypto.
 *
 * CapKit deliberately avoids a third-party JWT dependency: the signing surface
 * is small, and owning it keeps the security-critical path auditable.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
  kid?: string;
}

export type JwtPayload = Record<string, unknown> & {
  iat?: number;
  exp?: number;
  sub?: string;
  aud?: string;
  jti?: string;
};

export type JwtErrorCode =
  | 'TOKEN_MALFORMED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_NOT_ACTIVE'
  | 'TOKEN_AUDIENCE_MISMATCH';

export type VerifyResult =
  | { valid: true; header: JwtHeader; payload: JwtPayload }
  | { valid: false; error: JwtErrorCode; message: string };

export function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64');
}

/**
 * Parse a duration string ("30s", "15m", "8h", "7d") or a raw number of
 * seconds into seconds. Throws on anything it cannot interpret rather than
 * silently defaulting — a mis-parsed expiry is a security bug.
 */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid duration: ${value}`);
    }
    return Math.floor(value);
  }

  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const multiplier = multipliers[unit];

  if (amount <= 0 || multiplier === undefined) {
    throw new Error(`Invalid duration: ${value}`);
  }

  return amount * multiplier;
}

function sign(signingInput: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(signingInput).digest());
}

/** Compare two signatures without leaking length or content through timing. */
function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export function signJwt(payload: JwtPayload, secret: string, options: { kid?: string } = {}): string {
  if (!secret) {
    throw new Error('A signing secret is required');
  }

  const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
  if (options.kid) header.kid = options.kid;

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  return `${signingInput}.${sign(signingInput, secret)}`;
}

export function verifyJwt(
  token: string,
  secret: string,
  options: { audience?: string; clockToleranceSec?: number } = {}
): VerifyResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'TOKEN_MALFORMED', message: 'Token is missing' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'TOKEN_MALFORMED', message: 'Token must have three segments' };
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts as [string, string, string];

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  } catch {
    return { valid: false, error: 'TOKEN_MALFORMED', message: 'Token segments are not valid JSON' };
  }

  // Reject any algorithm we did not issue. This is what stops the classic
  // "alg: none" and RS256->HS256 confusion attacks.
  if (header.alg !== 'HS256') {
    return { valid: false, error: 'TOKEN_INVALID', message: `Unsupported algorithm: ${String(header.alg)}` };
  }

  const expected = sign(`${encodedHeader}.${encodedPayload}`, secret);
  if (!signaturesMatch(expected, providedSignature)) {
    return { valid: false, error: 'TOKEN_INVALID', message: 'Signature verification failed' };
  }

  const tolerance = options.clockToleranceSec ?? 0;
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === 'number' && now > payload.exp + tolerance) {
    return { valid: false, error: 'TOKEN_EXPIRED', message: 'Token has expired' };
  }

  if (typeof payload.nbf === 'number' && now + tolerance < payload.nbf) {
    return { valid: false, error: 'TOKEN_NOT_ACTIVE', message: 'Token is not yet active' };
  }

  if (options.audience && payload.aud !== options.audience) {
    return { valid: false, error: 'TOKEN_AUDIENCE_MISMATCH', message: 'Token audience mismatch' };
  }

  return { valid: true, header, payload };
}

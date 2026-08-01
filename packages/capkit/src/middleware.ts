/**
 * Express middleware for enforcing capability tokens.
 *
 * This is what makes ABSuite a suite rather than a pile of services: Edge-Run,
 * QuickBench and Connector-Starter all import this and enforce the same
 * capability model, issued and revoked centrally by CapKit.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { CapabilityToken, type CapabilityClaims, type VerificationKey } from './capability';
import { KeyRing } from './keyring';
import type { RevocationStore } from './revocation-store';

export interface CapabilityRequest extends Request {
  capability?: CapabilityClaims;
  actor?: string;
}

export interface CapabilityGuardOptions {
  /** Shared HMAC secret. Defaults to CAPKIT_HMAC_SECRET / CAPKIT_JWT_SECRET. */
  secret?: string;
  /** Audience to enforce. Defaults to CAPKIT_AUDIENCE when set. */
  audience?: string;
  /** Bootstrap key that bypasses token checks. Defaults to CAPKIT_ADMIN_KEY. */
  adminKey?: string;
  /** Revocation backend. Omit to skip revocation checks. */
  revocations?: Pick<RevocationStore, 'isRevoked'>;
  /** Called for every allow/deny so the service can write its own audit trail. */
  onDecision?: (decision: {
    allowed: boolean;
    subject: string;
    scope: string;
    reason?: string;
    req: Request;
  }) => void;
}

/**
 * Resolve the verification key.
 *
 * An explicit secret wins for callers that manage their own keys; otherwise we
 * build a ring from the environment so tokens signed by a recently retired key
 * still verify through a rotation.
 */
function resolveKey(explicit?: string): VerificationKey {
  const secret = (explicit || '').trim();
  if (secret) return secret;

  try {
    return KeyRing.fromEnv();
  } catch {
    throw new Error('A CapKit signing secret is required (set CAPKIT_HMAC_SECRET)');
  }
}

/**
 * Build a guard that requires a specific capability scope.
 *
 * Usage:
 *   const guard = capabilityGuard({ revocations });
 *   app.post('/schedule', guard('schedule:create'), handler);
 */
/**
 * Compare two secrets without leaking their contents through timing.
 *
 * `===` on strings returns as soon as two bytes differ, so the time taken is a
 * function of how many leading characters an attacker guessed correctly. Over a
 * network the signal is small and heavily masked by jitter — and it is free to
 * remove, on the check that decides whether a caller may mint capability tokens
 * for any subject they like.
 *
 * The dashboard's own admin check has used timingSafeEqual since it was written.
 * This one did not, which meant the two halves of the same product disagreed
 * about the same secret, and the weaker one guarded the stronger capability.
 *
 * Lengths are compared first because timingSafeEqual throws on a length
 * mismatch. That does leak the length, which is not sensitive here: the key's
 * length is chosen by the operator and knowing it does not narrow a 256-bit
 * search in any useful way.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function capabilityGuard(options: CapabilityGuardOptions = {}) {
  const audience = options.audience ?? process.env.CAPKIT_AUDIENCE ?? '';
  const adminKey = (options.adminKey ?? process.env.CAPKIT_ADMIN_KEY ?? process.env.ABSUITE_ADMIN_API_KEY ?? '').trim();

  return function requireCapability(requiredScope: string): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const request = req as CapabilityRequest;

      const providedAdminKey = (req.header('x-absuite-admin-key') || '').trim();
      if (adminKey && providedAdminKey && secretsMatch(providedAdminKey, adminKey)) {
        request.actor = 'admin-key';
        options.onDecision?.({ allowed: true, subject: 'admin-key', scope: requiredScope, req });
        return next();
      }

      const authHeader = req.header('authorization') || '';
      const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

      if (!token) {
        options.onDecision?.({ allowed: false, subject: 'anonymous', scope: requiredScope, reason: 'TOKEN_MISSING', req });
        res.status(401).json({ error: { code: 'TOKEN_MISSING', message: 'No Authorization header' } });
        return;
      }

      let secret: VerificationKey;
      try {
        secret = resolveKey(options.secret);
      } catch (error) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (error as Error).message } });
        return;
      }

      // The revocation store may be remote, so resolve it before validating.
      let revoked = false;
      let revokedJti = '';
      const peek = CapabilityToken.validate(token, secret, audience ? { audience } : {});
      if (peek.valid && options.revocations) {
        revokedJti = peek.claims.jti;
        try {
          revoked = await options.revocations.isRevoked(revokedJti);
        } catch {
          // A revocation backend outage must not silently grant access.
          options.onDecision?.({ allowed: false, subject: peek.claims.sub, scope: requiredScope, reason: 'REVOCATION_UNAVAILABLE', req });
          res.status(503).json({
            error: { code: 'REVOCATION_UNAVAILABLE', message: 'Revocation store is unreachable; refusing to authorise' },
          });
          return;
        }
      }

      const result = CapabilityToken.validate(token, secret, {
        requiredScope,
        ...(audience ? { audience } : {}),
        ...(revoked ? { isRevoked: () => true } : {}),
      });

      if (!result.valid) {
        const status = result.error === 'CAPABILITY_INSUFFICIENT' ? 403 : 401;
        options.onDecision?.({
          allowed: false,
          subject: peek.valid ? peek.claims.sub : 'unknown',
          scope: requiredScope,
          reason: result.error,
          req,
        });
        res.status(status).json({ error: { code: result.error, message: result.message } });
        return;
      }

      request.capability = result.claims;
      request.actor = result.claims.sub;
      options.onDecision?.({ allowed: true, subject: result.claims.sub, scope: requiredScope, req });
      return next();
    };
  };
}

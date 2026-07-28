/**
 * CapKit HTTP server — the authorisation service for ABSuite.
 *
 * Exposes the capability-token API documented in docs/API.md, plus the
 * compatibility endpoints the dashboard calls (`/issue`, `/ai/providers`,
 * `/ai/policy/generate`).
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { CapabilityToken } from './capability';
import { capabilityGuard } from './middleware';
import { revocationStoreFromEnv } from './revocation-store';
import { AuditLog } from './audit';
import { generatePolicy } from './ai-policy-generator';
import { describeProviders } from './llm-provider';

const PORT = Number(process.env.CAPKIT_PORT || process.env.PORT || 8081);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const STARTED_AT = Date.now();
const VERSION = '1.0.0';

/**
 * Resolve the signing secret.
 *
 * In production a real secret is mandatory — starting with an ephemeral key
 * would silently invalidate every token on restart and give operators a false
 * sense of security. In development we generate one and say so loudly.
 */
function resolveSecret(): string {
  const configured = (process.env.CAPKIT_HMAC_SECRET || process.env.CAPKIT_JWT_SECRET || '').trim();

  if (configured) {
    if (IS_PRODUCTION && configured.length < 32) {
      throw new Error('CAPKIT_HMAC_SECRET must be at least 32 characters in production');
    }
    return configured;
  }

  if (IS_PRODUCTION) {
    throw new Error('CAPKIT_HMAC_SECRET is required when NODE_ENV=production');
  }

  const ephemeral = randomBytes(32).toString('hex');
  console.warn('[capkit] No CAPKIT_HMAC_SECRET set — generated an ephemeral development secret.');
  console.warn('[capkit] Tokens will be invalidated on restart. Set CAPKIT_HMAC_SECRET for stable tokens.');
  return ephemeral;
}

const SECRET = resolveSecret();
const ADMIN_KEY = (process.env.CAPKIT_ADMIN_KEY || process.env.ABSUITE_ADMIN_API_KEY || '').trim();
const AUDIENCE = process.env.CAPKIT_AUDIENCE || '';
const KEY_ID = process.env.CAPKIT_KEY_ID || 'capkit-default';

const audit = new AuditLog(process.env.CAPKIT_AUDIT_LOG || undefined);

// Backed by CAPKIT_REVOCATION_FILE when set, so a revocation issued here is
// visible to Edge-Run, QuickBench and Connector-Starter too.
const revocations = revocationStoreFromEnv();

// Annotated explicitly so the emitted declaration file does not need to name
// a transitive @types/express-serve-static-core path.
const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

const allowedOrigins = (process.env.ABSUITE_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const origin = req.headers.origin;
  if (origin && (allowedOrigins.length === 0 ? !IS_PRODUCTION : allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ABSuite-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  return next();
});

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/**
 * Authorise a request against a required scope.
 *
 * Uses the same guard the other ABSuite services import, so CapKit enforces
 * exactly the rules it hands out. The admin key is a bootstrap credential: it
 * grants full authority so an operator can mint the very first token.
 */
const authorise = capabilityGuard({
  secret: SECRET,
  adminKey: ADMIN_KEY,
  revocations,
  ...(AUDIENCE ? { audience: AUDIENCE } : {}),
  onDecision: ({ allowed, subject, reason, req }) => {
    if (!allowed) {
      audit.record({
        subject,
        action: `${req.method} ${req.path}`,
        resource: req.path,
        result: 'deny',
        ...(reason ? { reason } : {}),
      });
    }
  },
});

// ---- Health ----

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'capkit',
    version: VERSION,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
});

// ---- Documented capability-token API ----

app.post('/auth/token', authorise('auth:token:create'), (req, res) => {
  const startedAt = Date.now();
  const { sub, scope, expiresIn, aud } = req.body ?? {};

  try {
    const created = CapabilityToken.create(
      {
        sub: String(sub ?? ''),
        scope,
        expiresIn: expiresIn ?? '24h',
        kid: KEY_ID,
        ...(aud || AUDIENCE ? { aud: aud || AUDIENCE } : {}),
      },
      SECRET
    );

    audit.record({
      subject: (req as express.Request & { actor?: string }).actor || 'unknown',
      action: 'POST /auth/token',
      resource: `token:${created.jti}`,
      result: 'allow',
      durationMs: Date.now() - startedAt,
    });

    return res.status(200).json({
      token: created.token,
      kid: created.kid ?? KEY_ID,
      jti: created.jti,
      iat: created.iat,
      exp: created.exp,
    });
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.post('/auth/token/validate', authorise('auth:token:validate'), async (req, res) => {
  const token = String(req.body?.token ?? '');
  const peek = CapabilityToken.validate(token, SECRET, AUDIENCE ? { audience: AUDIENCE } : {});
  const revoked = peek.valid ? await revocations.isRevoked(peek.claims.jti) : false;

  const result = CapabilityToken.validate(token, SECRET, {
    ...(revoked ? { isRevoked: () => true } : {}),
    ...(AUDIENCE ? { audience: AUDIENCE } : {}),
  });

  if (!result.valid) {
    return res.status(400).json({ valid: false, error: result.error });
  }

  return res.status(200).json({
    valid: true,
    sub: result.claims.sub,
    scope: result.claims.scope,
    exp: result.claims.exp,
  });
});

app.post('/auth/token/revoke', authorise('auth:token:revoke'), async (req, res) => {
  const token = String(req.body?.token ?? '');
  const jti = String(req.body?.jti ?? '');

  if (token) {
    const result = CapabilityToken.validate(token, SECRET);
    if (!result.valid) {
      return fail(res, 400, 'INVALID_REQUEST', 'Token could not be parsed for revocation');
    }
    await revocations.revoke(result.claims.jti, result.claims.exp);
    audit.record({ subject: result.claims.sub, action: 'POST /auth/token/revoke', resource: `token:${result.claims.jti}`, result: 'allow' });
    return res.status(200).json({ revoked: true, jti: result.claims.jti });
  }

  if (jti) {
    // Without the token we cannot read its expiry, so hold the entry for the
    // maximum plausible token lifetime rather than dropping it early.
    await revocations.revoke(jti, Math.floor(Date.now() / 1000) + 86400 * 30);
    audit.record({ subject: 'unknown', action: 'POST /auth/token/revoke', resource: `token:${jti}`, result: 'allow' });
    return res.status(200).json({ revoked: true, jti });
  }

  return fail(res, 400, 'INVALID_REQUEST', 'Provide either a token or a jti to revoke');
});

app.get('/audit', authorise('audit:read'), (req, res) => {
  const { limit, offset, subject, action, result, from, to } = req.query;
  return res.status(200).json(
    audit.query({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      subject: subject ? String(subject) : undefined,
      action: action ? String(action) : undefined,
      result: result ? String(result) : undefined,
      from: from ? String(from) : undefined,
      to: to ? String(to) : undefined,
    })
  );
});

// ---- Dashboard compatibility ----

/**
 * The dashboard issues tokens with an {actor, action, resource, expires}
 * shape. Map it onto the capability model rather than making the dashboard
 * speak two dialects.
 */
app.post('/issue', authorise('auth:token:create'), (req, res) => {
  const { actor, action, resource, expires } = req.body ?? {};

  const scope = String(action ?? 'read')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(verb => (verb.includes(':') ? verb : `${verb}:${String(resource ?? 'absuite')}`));

  try {
    const created = CapabilityToken.create(
      {
        sub: String(actor ?? 'absuite-agent'),
        scope,
        expiresIn: expires ?? '24h',
        kid: KEY_ID,
        ...(AUDIENCE ? { aud: AUDIENCE } : {}),
      },
      SECRET
    );

    audit.record({
      subject: String(actor ?? 'absuite-agent'),
      action: 'POST /issue',
      resource: `token:${created.jti}`,
      result: 'allow',
    });

    return res.status(200).json({ capability: created.token, jti: created.jti, exp: created.exp, scope });
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/ai/providers', (_req, res) => {
  const { providers, recommended } = describeProviders();
  return res.status(200).json({ providers, recommended });
});

app.post('/ai/policy/generate', (req, res) => {
  const description = String(req.body?.description ?? req.body?.prompt ?? '').trim();
  if (!description) {
    return fail(res, 400, 'INVALID_REQUEST', 'A policy description is required');
  }

  const policy = generatePolicy(description);
  audit.record({ subject: 'dashboard', action: 'POST /ai/policy/generate', resource: 'policy', result: 'allow' });
  return res.status(200).json(policy);
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app };

// Only listen when run directly, so tests can import the app without binding a port.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[capkit] listening on :${PORT}`);
    if (!ADMIN_KEY) {
      console.warn('[capkit] No CAPKIT_ADMIN_KEY/ABSUITE_ADMIN_API_KEY set — token issuance requires an existing capability token.');
    }
  });
}

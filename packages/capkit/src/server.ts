/**
 * CapKit HTTP server — the authorisation service for ABSuite.
 *
 * Exposes the capability-token API documented in docs/API.md, plus the
 * compatibility endpoints the dashboard calls (`/issue`, `/ai/providers`,
 * `/ai/policy/generate`).
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CapabilityToken } from './capability';
import { capabilityGuard } from './middleware';
import { revocationStoreFromEnv } from './revocation-store';
import { AuditLog } from './audit';
import { generatePolicy } from './ai-policy-generator';
import { describeProviders } from './llm-provider';
import { getStorage } from './storage';
import { TenantService, currentPeriod, type Tenant } from './tenancy';
import { PLANS, isPlanId, verifyStripeSignature, planFromStripeEvent } from './billing';
import { createServiceMetrics } from './metrics';
import { TraceStore, SigningKey, verifyTrace, replayManifest, compareReplay, hashPayload } from './trace';
import { SIGNUP_PAGE, SignupThrottle, validateSignup } from './signup';
import { TenantRateLimiter } from './rate-limit';

const PORT = Number(process.env.CAPKIT_PORT || process.env.PORT || 8081);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const STARTED_AT = Date.now();

/**
 * The version `/health` reports, read from the manifest rather than typed in.
 *
 * A hardcoded constant drifts the first time anyone forgets it, and an operator
 * debugging a deployment reads `/health` and is told the wrong thing with
 * complete confidence. That is the failure mode this project exists to argue
 * against, so it should not be in this project.
 */
const VERSION = readVersion();

function readVersion(): string {
  try {
    return String(
      JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version || 'unknown'
    );
  } catch {
    // Better to admit ignorance than to assert a number nobody checked.
    return 'unknown';
  }
}

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

// Backed by SQLite (ABSUITE_DB_PATH) or a shared file, so a revocation issued
// here is visible to Edge-Run, QuickBench and Connector-Starter too.
const revocations = revocationStoreFromEnv();

const storage = getStorage();
const tenancy = new TenantService(storage);
const metrics = createServiceMetrics('capkit');

// Monthly quotas cap volume; this caps rate, so one tenant cannot saturate the
// node while still sitting inside their plan allowance.
const rateLimiter = new TenantRateLimiter();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

// Ed25519 keypair for signing execution traces. Asymmetric on purpose: an
// auditor must be able to verify a trace without also being able to forge one.
const signingKey = new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY, process.env.CAPKIT_TRACE_KEY_ID || 'absuite-trace-key');
const traces = new TraceStore(storage, signingKey);

// Annotated explicitly so the emitted declaration file does not need to name
// a transitive @types/express-serve-static-core path.
const app: express.Express = express();
app.disable('x-powered-by');

// Stash the raw body: Stripe signs the exact bytes it sent, so a re-serialised
// JSON object would never verify.
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
  },
}));

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ABSuite-Admin-Key, X-ABSuite-Tenant-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  return next();
});

metrics.counter('absuite_executions_total', 'Verifiable executions recorded, by outcome');
metrics.counter('absuite_rate_limited_total', 'Requests rejected for exceeding a burst rate limit');

// Request metrics. Recorded on finish so the duration covers the handler.
app.use((req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    const route = req.path.split('/').slice(0, 3).join('/') || '/';
    metrics.increment('absuite_requests_total', { service: 'capkit', route, status: res.statusCode });
    metrics.observe('absuite_request_duration_ms', performance.now() - startedAt, { service: 'capkit', route });
  });
  return next();
});

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

type TenantRequest = express.Request & { tenant?: Tenant };

/**
 * Resolve the calling tenant from `X-ABSuite-Tenant-Key`.
 *
 * Tenancy is optional: a self-hosted single-team deployment issues no tenant
 * keys and is simply unmetered. When a key *is* supplied it must be valid — a
 * wrong key is an error, never a silent fallback to unmetered access.
 */
function resolveTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = (req.header('x-absuite-tenant-key') || '').trim();
  if (!key) return next();

  const tenant = tenancy.tenants.byApiKey(key);
  if (!tenant) {
    return fail(res, 401, 'TENANT_KEY_INVALID', 'The supplied tenant key is not recognised');
  }

  (req as TenantRequest).tenant = tenant;
  return next();
}

/**
 * Enforce a plan quota for the resolved tenant.
 *
 * Returns 402 Payment Required for an exhausted quota and 403 for a suspended
 * tenant, so a client can tell "upgrade" apart from "fix your billing".
 */
function enforceQuota(metric: 'validations' | 'agents' | 'schedules' | 'benchmarkRuns') {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tenant = (req as TenantRequest).tenant;
    if (!tenant) return next();

    const verdict = tenancy.authorise(tenant, metric);

    if (verdict.suspended) {
      metrics.increment('absuite_quota_rejections_total', { tenant: tenant.id, metric, reason: 'suspended' });
      return fail(res, 403, 'TENANT_SUSPENDED', 'This account is suspended. Please update your billing details.');
    }

    if (!verdict.allowed) {
      metrics.increment('absuite_quota_rejections_total', { tenant: tenant.id, metric, reason: 'quota' });
      res.setHeader('X-ABSuite-Quota-Limit', String(verdict.limit));
      res.setHeader('X-ABSuite-Quota-Used', String(verdict.used));
      return fail(
        res, 402, 'QUOTA_EXCEEDED',
        `Monthly ${metric} limit of ${verdict.limit} reached on the ${tenant.plan} plan.`
      );
    }

    if (verdict.limit > 0) {
      res.setHeader('X-ABSuite-Quota-Limit', String(verdict.limit));
      res.setHeader('X-ABSuite-Quota-Remaining', String(verdict.remaining));
    }

    tenancy.meters.record(tenant.id, metric, 1);
    return next();
  };
}

/**
 * Per-tenant burst limiting, applied after the tenant is known.
 *
 * Unmetered callers (no tenant key) are limited by address instead, so an
 * anonymous flood cannot take the service down either.
 */
function enforceRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === '/health' || req.path === '/ready' || req.path === '/metrics') return next();

  const tenant = (req as TenantRequest).tenant;
  const key = tenant ? `tenant:${tenant.id}` : `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const perMinute = tenant ? tenancy.planFor(tenant).rateLimitPerMinute : undefined;

  const verdict = rateLimiter.consume(key, perMinute);

  if (verdict.limit > 0) {
    res.setHeader('X-RateLimit-Limit', String(verdict.limit));
    res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
  }

  if (!verdict.allowed) {
    res.setHeader('Retry-After', String(verdict.retryAfter));
    metrics.increment('absuite_rate_limited_total', { tenant: tenant?.id ?? 'anonymous' });
    return fail(res, 429, 'RATE_LIMITED', `Rate limit of ${verdict.limit}/min exceeded. Retry in ${verdict.retryAfter}s.`);
  }
  return next();
}

app.use(resolveTenant);
app.use(enforceRateLimit);

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

app.post('/auth/token', authorise('auth:token:create'), enforceQuota('agents'), (req, res) => {
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

/**
 * Validate a token, optionally against a specific capability.
 *
 * `requiredScope` is honoured. It was accepted and silently ignored until
 * 1.1.0, which meant asking "is this token good for payment:refund?" about a
 * token holding only `payment:approve` answered `{"valid": true}` — a false
 * allow produced by an unrecognised field, in the endpoint whose entire job is
 * to answer that question. The response now echoes `requiredScope` back, so a
 * caller can see the check was performed rather than assume it.
 */
app.post('/auth/token/validate', authorise('auth:token:validate'), enforceQuota('validations'), async (req, res) => {
  const token = String(req.body?.token ?? '');
  const requiredScope = typeof req.body?.requiredScope === 'string' ? req.body.requiredScope.trim() : '';

  const peek = CapabilityToken.validate(token, SECRET, AUDIENCE ? { audience: AUDIENCE } : {});
  const revoked = peek.valid ? await revocations.isRevoked(peek.claims.jti) : false;

  const result = CapabilityToken.validate(token, SECRET, {
    ...(revoked ? { isRevoked: () => true } : {}),
    ...(AUDIENCE ? { audience: AUDIENCE } : {}),
    ...(requiredScope ? { requiredScope } : {}),
  });

  if (!result.valid) {
    return res.status(400).json({ valid: false, error: result.error });
  }

  return res.status(200).json({
    valid: true,
    sub: result.claims.sub,
    scope: result.claims.scope,
    exp: result.claims.exp,
    ...(requiredScope ? { requiredScope, scopeSatisfied: true } : {}),
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

// ---- Operations ----

app.get('/metrics', (_req, res) => {
  metrics.set('absuite_uptime_seconds', Math.floor((Date.now() - STARTED_AT) / 1000), { service: 'capkit' });
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(metrics.render());
});

/** Readiness differs from liveness: it fails if storage is unusable. */
app.get('/ready', (_req, res) => {
  try {
    storage.get('SELECT 1 AS ok');
    return res.status(200).json({ ready: true });
  } catch (error) {
    return res.status(503).json({ ready: false, error: (error as Error).message });
  }
});

app.get('/audit/verify', authorise('audit:read'), (_req, res) => {
  res.status(200).json({ ...audit.verifyChain(), headHash: audit.headHash });
});

// ---- Self-serve signup ----

/**
 * Signup is opt-in via ABSUITE_SIGNUP_ENABLED.
 *
 * A public endpoint that mints credentials should never appear by surprise on
 * someone's private deployment, so it stays off unless deliberately turned on.
 */
const SIGNUP_ENABLED = ['1', 'true', 'yes'].includes((process.env.ABSUITE_SIGNUP_ENABLED || '').toLowerCase());
const SIGNUP_PLAN = (process.env.ABSUITE_SIGNUP_PLAN || 'free').trim();
const signupThrottle = new SignupThrottle();

app.get('/signup', (_req, res) => {
  if (!SIGNUP_ENABLED) return fail(res, 404, 'NOT_FOUND', 'Self-serve signup is not enabled on this deployment');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(SIGNUP_PAGE);
});

app.post('/signup', (req, res) => {
  if (!SIGNUP_ENABLED) return fail(res, 404, 'NOT_FOUND', 'Self-serve signup is not enabled on this deployment');

  const key = req.ip || req.socket.remoteAddress || 'unknown';
  if (!signupThrottle.allow(key)) {
    return fail(res, 429, 'RATE_LIMITED', 'Too many signups from this address. Try again later.');
  }

  const validated = validateSignup(req.body ?? {});
  if (!validated.ok) return fail(res, 400, 'INVALID_REQUEST', validated.error);

  // Signup can only ever create the configured plan — never a paid one.
  const plan = isPlanId(SIGNUP_PLAN) ? SIGNUP_PLAN : 'free';

  try {
    const created = tenancy.tenants.create(validated.name, plan, `signup:${validated.email}`);
    audit.record({ subject: validated.email, action: 'POST /signup', resource: `tenant:${created.id}`, result: 'allow' });

    return res.status(201).json({
      id: created.id,
      name: created.name,
      plan: created.plan,
      // Returned exactly once; only the hash is stored.
      apiKey: created.apiKey,
    });
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

// ---- Verifiable execution ----

/**
 * The public half of the trace signing key.
 *
 * Deliberately unauthenticated: verification is meant to be possible by an
 * auditor or customer who holds no ABSuite credentials at all.
 */
app.get('/executions/public-key', (_req, res) => {
  res.status(200).json({
    keyId: signingKey.keyId,
    algorithm: 'Ed25519',
    publicKey: signingKey.publicKeyPem,
    ephemeral: signingKey.ephemeral,
  });
});

app.post('/executions', authorise('execution:record'), (req, res) => {
  const { subject, jti, scope, module, action, input, output, outcome, error, startedAt, completedAt, durationMs, steps } = req.body ?? {};

  if (!subject || !module || !action || !outcome) {
    return fail(res, 400, 'INVALID_REQUEST', 'subject, module, action and outcome are required');
  }
  if (!['success', 'failure'].includes(String(outcome))) {
    return fail(res, 400, 'INVALID_REQUEST', 'outcome must be success or failure');
  }

  const tenant = (req as TenantRequest).tenant;

  const trace = traces.record({
    ...(tenant ? { tenantId: tenant.id } : {}),
    subject: String(subject),
    ...(jti ? { jti: String(jti) } : {}),
    scope: Array.isArray(scope) ? scope.map(String) : [],
    module: String(module),
    action: String(action),
    // Payloads are hashed, never stored — proof without retaining customer data.
    inputHash: typeof req.body?.inputHash === 'string' ? req.body.inputHash : hashPayload(input),
    ...(output !== undefined || typeof req.body?.outputHash === 'string'
      ? { outputHash: typeof req.body?.outputHash === 'string' ? req.body.outputHash : hashPayload(output) }
      : {}),
    outcome: String(outcome) as 'success' | 'failure',
    ...(error ? { error: String(error) } : {}),
    startedAt: String(startedAt || new Date().toISOString()),
    ...(completedAt ? { completedAt: String(completedAt) } : {}),
    ...(durationMs !== undefined ? { durationMs: Number(durationMs) } : {}),
    steps: Array.isArray(steps) ? steps : [],
  });

  metrics.increment('absuite_executions_total', { outcome: trace.outcome, module: trace.module });
  return res.status(201).json(trace);
});

app.get('/executions', authorise('execution:read'), (req, res) => {
  const tenant = (req as TenantRequest).tenant;
  res.status(200).json({
    executions: traces.list({
      limit: Number(req.query.limit ?? 50),
      // A tenant key scopes the view to that tenant's own records.
      ...(tenant ? { tenantId: tenant.id } : {}),
      ...(req.query.subject ? { subject: String(req.query.subject) } : {}),
      ...(req.query.outcome ? { outcome: String(req.query.outcome) } : {}),
    }),
  });
});

app.get('/executions/:id', authorise('execution:read'), (req, res) => {
  const trace = traces.get(String(req.params.id));
  if (!trace) return fail(res, 404, 'NOT_FOUND', 'No such execution');
  return res.status(200).json(trace);
});

app.get('/executions/:id/replay', authorise('execution:read'), (req, res) => {
  const trace = traces.get(String(req.params.id));
  if (!trace) return fail(res, 404, 'NOT_FOUND', 'No such execution');
  return res.status(200).json(replayManifest(trace));
});

/** Compare a re-run of an execution against its recorded hashes. */
app.post('/executions/:id/replay', authorise('execution:read'), (req, res) => {
  const trace = traces.get(String(req.params.id));
  if (!trace) return fail(res, 404, 'NOT_FOUND', 'No such execution');

  const comparison = compareReplay(trace, { input: req.body?.input, output: req.body?.output });
  return res.status(200).json({ id: trace.id, ...comparison });
});

/**
 * Verify a single trace, or the whole chain.
 *
 * Unauthenticated by design: a customer or regulator must be able to check a
 * trace they were handed without holding an ABSuite credential.
 */
app.post('/executions/verify', (req, res) => {
  const trace = req.body?.trace;
  if (!trace || typeof trace !== 'object') {
    return fail(res, 400, 'INVALID_REQUEST', 'A trace object is required');
  }

  const publicKey = typeof req.body?.publicKey === 'string' ? req.body.publicKey : signingKey.publicKeyPem;
  return res.status(200).json(verifyTrace(trace, publicKey));
});

app.get('/executions-verify-chain', authorise('execution:read'), (_req, res) => {
  res.status(200).json(traces.verifyChain(signingKey.publicKeyPem));
});

// ---- Billing & tenancy ----

app.get('/plans', (_req, res) => {
  res.status(200).json({ plans: Object.values(PLANS) });
});

/** A tenant's own usage and quota position, for a billing page. */
app.get('/usage', (req, res) => {
  const tenant = (req as TenantRequest).tenant;
  if (!tenant) {
    return fail(res, 401, 'TENANT_KEY_REQUIRED', 'Supply X-ABSuite-Tenant-Key to read usage');
  }
  return res.status(200).json(tenancy.usageReport(tenant, String(req.query.period || currentPeriod())));
});

app.post('/admin/tenants', authorise('tenant:manage'), (req, res) => {
  const { name, plan = 'free', externalRef } = req.body ?? {};
  if (!name) return fail(res, 400, 'INVALID_REQUEST', 'A tenant name is required');
  if (!isPlanId(String(plan))) return fail(res, 400, 'INVALID_REQUEST', `Unknown plan: ${plan}`);

  try {
    const created = tenancy.tenants.create(String(name), plan, externalRef ? String(externalRef) : undefined);
    // apiKey is present exactly once, here.
    return res.status(201).json(created);
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/admin/tenants', authorise('tenant:manage'), (req, res) => {
  const tenants = tenancy.tenants.list(Number(req.query.limit ?? 100));
  res.status(200).json({
    tenants: tenants.map(tenant => tenancy.usageReport(tenant)),
  });
});

app.get('/admin/tenants/:id', authorise('tenant:manage'), (req, res) => {
  const tenant = tenancy.tenants.get(String(req.params.id));
  if (!tenant) return fail(res, 404, 'NOT_FOUND', 'No such tenant');
  return res.status(200).json(tenancy.usageReport(tenant));
});

app.post('/admin/tenants/:id/plan', authorise('tenant:manage'), (req, res) => {
  const plan = String(req.body?.plan ?? '');
  if (!isPlanId(plan)) return fail(res, 400, 'INVALID_REQUEST', `Unknown plan: ${plan}`);

  const updated = tenancy.tenants.setPlan(String(req.params.id), plan);
  if (!updated) return fail(res, 404, 'NOT_FOUND', 'No such tenant');
  return res.status(200).json(updated);
});

app.post('/admin/tenants/:id/status', authorise('tenant:manage'), (req, res) => {
  const status = String(req.body?.status ?? '');
  if (!['active', 'suspended'].includes(status)) {
    return fail(res, 400, 'INVALID_REQUEST', 'status must be active or suspended');
  }

  const updated = tenancy.tenants.setStatus(String(req.params.id), status as 'active' | 'suspended');
  if (!updated) return fail(res, 404, 'NOT_FOUND', 'No such tenant');
  return res.status(200).json(updated);
});

app.post('/admin/tenants/:id/rotate-key', authorise('tenant:manage'), (req, res) => {
  const rotated = tenancy.tenants.rotateApiKey(String(req.params.id));
  if (!rotated) return fail(res, 404, 'NOT_FOUND', 'No such tenant');
  return res.status(200).json({ id: req.params.id, ...rotated });
});

/**
 * Stripe webhook.
 *
 * Verified against the raw body before anything is trusted. Without a
 * configured secret the endpoint refuses outright rather than accepting
 * unsigned plan changes.
 */
app.post('/billing/webhook', (req, res) => {
  const raw = (req as express.Request & { rawBody?: string }).rawBody ?? '';
  const signature = req.header('stripe-signature') || '';

  const verified = verifyStripeSignature(raw, signature, STRIPE_WEBHOOK_SECRET);
  if (!verified.valid) {
    audit.record({ subject: 'stripe', action: 'POST /billing/webhook', resource: 'billing', result: 'deny', reason: verified.reason ?? 'invalid' });
    return fail(res, 400, 'SIGNATURE_INVALID', verified.reason ?? 'Signature verification failed');
  }

  const outcome = planFromStripeEvent(req.body ?? {});
  if (outcome.action === 'ignore' || !outcome.customer) {
    return res.status(200).json({ received: true, applied: false });
  }

  const tenant = tenancy.tenants.byExternalRef(outcome.customer);
  if (!tenant) {
    // Acknowledge so Stripe stops retrying an event we cannot map.
    return res.status(200).json({ received: true, applied: false, reason: 'No tenant for that customer' });
  }

  if (outcome.action === 'suspend') {
    tenancy.tenants.setStatus(tenant.id, 'suspended');
  } else if (outcome.plan) {
    tenancy.tenants.setPlan(tenant.id, outcome.plan);
  }

  audit.record({ subject: 'stripe', action: `billing.${outcome.action}`, resource: `tenant:${tenant.id}`, result: 'allow' });
  return res.status(200).json({ received: true, applied: true, tenant: tenant.id, action: outcome.action });
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app };

// Only listen when run directly, so tests can import the app without binding a port.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[capkit] listening on :${PORT} (storage: ${storage.path})`);
    if (!ADMIN_KEY) {
      console.warn('[capkit] No CAPKIT_ADMIN_KEY/ABSUITE_ADMIN_API_KEY set — token issuance requires an existing capability token.');
    }
    if (!STRIPE_WEBHOOK_SECRET) {
      console.log('[capkit] STRIPE_WEBHOOK_SECRET not set — the billing webhook will reject all calls.');
    }

    // An ephemeral signing key plus a durable database is the worst
    // combination this service can be started in, and until 1.1.0 it started
    // that way in silence. Every trace recorded before a restart stops
    // verifying afterwards, and /executions-verify-chain then reports the whole
    // chain broken — indistinguishable from someone having tampered with it.
    // A tamper-evidence product must not raise its own false alarm quietly.
    if (signingKey.ephemeral) {
      const durable = storage.path && storage.path !== ':memory:';
      console.warn(
        '[capkit] CAPKIT_TRACE_PRIVATE_KEY is not set — traces are signed with an ephemeral key ' +
          'that is regenerated on every restart.'
      );
      if (durable) {
        console.warn(
          `[capkit] Traces are persisted to ${storage.path} but the key is not. After a restart ` +
            'every existing trace will fail verification and the chain will report as broken. ' +
            'Generate a key with SigningKey.createPair() and set CAPKIT_TRACE_PRIVATE_KEY.'
        );
      }
    }
  });

  // Expired revocations are dead weight; the token is rejected on expiry anyway.
  const pruneTimer = setInterval(() => void revocations.prune(), 3_600_000);
  pruneTimer.unref?.();

  // Drain in-flight requests before exiting so a deploy does not drop work.
  const shutdown = (signal: string) => {
    console.log(`[capkit] ${signal} received, shutting down`);
    clearInterval(pruneTimer);
    server.close(() => {
      try {
        storage.close();
      } catch {
        // Already closed; nothing to recover.
      }
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

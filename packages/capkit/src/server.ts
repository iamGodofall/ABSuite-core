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
import { PLANS, isPlanId, verifyStripeSignature, planFromStripeEvent, planFromPayPalEvent, rewriteWindowHours, witnessDue, annualPriceCents, annualSavingCents, ANNUAL_MONTHS_CHARGED } from './billing';
import { isPayPalCertUrl, verifyPayPalWebhook, type PayPalWebhookHeaders } from './paypal-webhook';
import { verifyPaystackSignature, planFromPaystackEvent } from './paystack';
import { buildAuditExport } from './audit-export';
import { instanceWitnessInterval, witnessHead } from './witness';
import { isSellable, annualPitch } from './paypal-plans';
import { createServiceMetrics } from './metrics';
import { TraceStore, SigningKey, verifyTrace, replayManifest, compareReplay, hashPayload, normaliseCost, CANONICAL_VERSION, SUPPORTED_CANONICAL_VERSIONS, type GovernanceRecord, type CostRecord, type ExecutionTrace } from './trace';
import { explainTrace } from './explain';
import { trustConditions } from './conditions';
import { IdentityRegistry, IdentityError } from './identity';
import { ProvenanceGraph } from './provenance';
import { ModelRegistry, ModelIdentityError } from './model-identity';
import { ApprovalRegistry, ApprovalError, approvalStatement, type ApprovalAction, type ApprovalAssurance } from './approval';
import { Watch, type NoticeState } from './watch';
import { determineTrace } from './determination';
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

/**
 * Whether a human approval must be signed to count.
 *
 * Off by default. Turning it on retroactively fails every approval recorded
 * without a signature, which is a claim about those records that they do not
 * support — nothing about them changed, only how strictly this deployment reads
 * them. That is an operator's decision, so it is an operator's switch.
 *
 * Anyone relying on approvals for a regulated obligation should set it. See
 * docs/AUDIT.md §3 and docs/COMPLIANCE.md.
 */
const REQUIRED_APPROVAL_ASSURANCE: ApprovalAssurance =
  /^(1|true|yes|on)$/i.test((process.env.ABSUITE_REQUIRE_SIGNED_APPROVALS || '').trim())
    ? 'PROVEN'
    : 'ASSERTED';

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
const PAYPAL_WEBHOOK_ID = (process.env.PAYPAL_WEBHOOK_ID || '').trim();
/* Paystack signs with the secret key itself — see paystack.ts. Never logged. */
const PAYSTACK_SECRET_KEY = (process.env.PAYSTACK_SECRET_KEY || '').trim();
const NOTARY_WITNESS_URL = (process.env.ABSUITE_NOTARY_URL || '').trim();
const NOTARY_CHAIN_ID = (process.env.ABSUITE_CHAIN_ID || '').trim();

/*
 * Signing certificates, keyed by the URL they came from.
 *
 * PayPal rotates certificates rarely and re-sends the same URL for every event
 * in between, so fetching per webhook would be one outbound request per event
 * for an answer that almost never changes. The cache is keyed by URL rather
 * than time-boxed: a rotation changes the URL, so a new key is a new fetch and
 * a stale entry cannot outlive the certificate it holds.
 *
 * Bounded, because the key comes from a header. Without a ceiling an attacker
 * posting a thousand distinct paypal.com URLs would grow this without limit —
 * the host check stops them supplying their OWN certificate, not from making
 * us remember a lot of PayPal's.
 */
const payPalCerts = new Map<string, string>();
const PAYPAL_CERT_CACHE_MAX = 8;

// Ed25519 keypair for signing execution traces. Asymmetric on purpose: an
// auditor must be able to verify a trace without also being able to forge one.
const signingKey = new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY, process.env.CAPKIT_TRACE_KEY_ID || 'absuite-trace-key');
const traces = new TraceStore(storage, signingKey);

// Layer 1. Subjects enrolled against public keys they hold the private half of,
// so `subject` on a record stops being a string the caller typed.
const identities = new IdentityRegistry(storage);

// Which agent handed work to which, computed from the hashes already recorded.
// Nothing new is stored for this — the graph was always latent in the data.
const provenance = new ProvenanceGraph(storage);

// Verify's fourth target. Compares identifying material against what was
// approved; it never loads a model and never claims anything about behaviour.
const models = new ModelRegistry(storage);
const approvals = new ApprovalRegistry(storage, identities);

/**
 * Layer 6 — Autonomy. Started below, when this file is run as a service.
 *
 * Constructed unconditionally so `/watch` answers honestly in an embedded or
 * test process too: it reports `everRun: false`, which is the truth, rather than
 * an empty list of notices that reads like an all-clear.
 */
const watch = new Watch(storage, traces, approvals, {
  intervalMs: Number(process.env.ABSUITE_WATCH_INTERVAL_MS || 60_000),
  signingKeyEphemeral: signingKey.ephemeral,
  publicKeyPem: signingKey.publicKeyPem,
});

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

/**
 * The approval standing behind an execution, when its policy demanded one.
 *
 * Looked up from the four fields on the record itself — subject, module, action
 * and input hash — because those are what the approval was hashed over. There is
 * no approval id on the trace to follow, deliberately: a link written onto the
 * record afterwards is a link the operator can write afterwards.
 *
 * Nothing is consulted for a record whose policy did not require an approval.
 * Reporting "no approval found" against an action that never needed one would be
 * a finding manufactured out of a question nobody asked.
 */
function approvalFor(trace: ExecutionTrace) {
  if (trace.governance?.decision !== 'REQUIRES_APPROVAL') return undefined;
  return approvals.attest(
    {
      subject: trace.subject,
      module: trace.module,
      action: trace.action,
      inputHash: trace.inputHash,
    },
    trace.id
  );
}

/** Who the caller is, as `authorise` recorded it. Never trusted as an approver. */
function actorOf(req: express.Request): string | undefined {
  return (req as express.Request & { actor?: string }).actor || undefined;
}

/** Parse stored JSON without letting one bad row take a whole response down. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/**
 * Provenance for anything a person might save and read later.
 *
 * A report opened in 2046 that says "3 records require attention" has told its
 * reader almost nothing. One that says which build produced it, when, and over
 * what scope can still be interpreted by someone with no access to this system
 * and no memory of how it worked.
 *
 * Context is part of the evidence, and a report that outlives the software
 * needs to carry its own. The benchmark has done this from the start — every
 * figure names its machine — and this is the same idea applied to every other
 * report the product emits.
 */
function generated(scope: string): {
  service: string;
  version: string;
  at: string;
  canonicalVersion: number;
  canonicalVersionsVerified: readonly number[];
  scope: string;
} {
  return {
    service: 'capkit',
    version: VERSION,
    at: new Date().toISOString(),
    // The newest form this build writes. Not every record underneath is in it —
    // a record is written in the oldest form that can carry its fields — so this
    // is the ceiling, not a description of the log.
    canonicalVersion: CANONICAL_VERSION,
    // What the records underneath were actually verified against. Reporting only
    // the ceiling would imply a uniformity the log does not have, and a reader in
    // 2046 holding just this file needs to know which rules were in play.
    canonicalVersionsVerified: SUPPORTED_CANONICAL_VERSIONS,
    scope,
  };
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

// public-route: a platform health probe cannot carry credentials.
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
  const { sub, scope, expiresIn, aud, proof } = req.body ?? {};

  /*
   * Identity, enforced at the gate.
   *
   * The constitution's ascent says Identity enables Capability — you cannot
   * grant to nobody — and this is the line where that stops being a diagram.
   *
   * Enrolment is optional. A deployment that has enrolled nobody behaves exactly
   * as it always did, and every condition report says Identity: UNKNOWN, which
   * is the truth. But once a subject *is* enrolled, a token in its name requires
   * proof of possession — because an identity whose authority can be obtained by
   * simply not proving anything is not an identity, it is a suggestion.
   */
  const requestedSubject = String(sub ?? '').trim();
  const enrolled = requestedSubject ? identities.get(requestedSubject) : undefined;

  if (enrolled) {
    if (enrolled.status === 'suspended') {
      return fail(res, 403, 'IDENTITY_SUSPENDED',
        `${requestedSubject} is suspended: ${enrolled.suspendedReason ?? 'no reason recorded'}. No new authority is issued to a suspended identity; everything it already did stands unchanged.`);
    }
    if (!proof || typeof proof !== 'object') {
      return fail(res, 401, 'PROOF_REQUIRED',
        `${requestedSubject} is an enrolled identity, so a token in its name requires proof of possession. Request a challenge from POST /identities/${encodeURIComponent(requestedSubject)}/challenge, sign the nonce with the private key, and send { proof: { nonce, signature } }.`);
    }
    try {
      const { nonce, signature } = proof as Record<string, unknown>;
      identities.prove(requestedSubject, String(nonce ?? ''), String(signature ?? ''));
    } catch (error) {
      const identityError = error as IdentityError;
      return fail(res, 401, identityError.code ?? 'PROOF_INVALID', identityError.message);
    }
  }

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

    // Remembered so a record written weeks from now can still be asked whether
    // the authority behind it was ever tied to a subject that proved itself.
    identities.bindToken(created.jti, requestedSubject, Boolean(enrolled));

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

// public-route: reports which providers have keys configured, never key
// material. The dashboard renders it before an admin key exists.
app.get('/ai/providers', (_req, res) => {
  const { providers, recommended } = describeProviders();
  return res.status(200).json({ providers, recommended });
});

// public-route: deterministic, rule-based, reads nothing. Bounded compute
// behind the rate limiter.
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

// public-route: Prometheus scrape. Discloses route names, status codes and
// counts — operational shape, no record content and no credential. Restrict it
// at the network if that shape matters to you; nothing here can gate it,
// because a scraper cannot carry a capability token.
app.get('/metrics', (_req, res) => {
  metrics.set('absuite_uptime_seconds', Math.floor((Date.now() - STARTED_AT) / 1000), { service: 'capkit' });
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(metrics.render());
});

/** Readiness differs from liveness: it fails if storage is unusable. */
// public-route: readiness probe, same reason as /health.
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

// public-route: signup by definition. Returns 404 unless self-serve signup is
// explicitly enabled, so the default deployment exposes nothing.
app.get('/signup', (_req, res) => {
  if (!SIGNUP_ENABLED) return fail(res, 404, 'NOT_FOUND', 'Self-serve signup is not enabled on this deployment');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(SIGNUP_PAGE);
});

// public-route: as above, and off by default.
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

// ---- Identity ----

/**
 * Enrol a subject against a public key it holds the private half of.
 *
 * This is the line where `subject` stops being a string somebody typed. Until a
 * subject is enrolled, every condition report says Identity: UNKNOWN — because a
 * name on a record is a label, and the check that used to sit here proved only
 * that this server wrote the record, which is a fact about us.
 */
app.post('/identities', authorise('identity:manage'), (req, res) => {
  try {
    const { subject, publicKeyPem, kind, label } = req.body ?? {};
    return res.status(201).json(identities.enrol({ subject, publicKeyPem, kind, label }));
  } catch (error) {
    const identityError = error as IdentityError;
    const status = identityError.code === 'ALREADY_ENROLLED' ? 409 : 400;
    return fail(res, status, identityError.code ?? 'INVALID_REQUEST', identityError.message);
  }
});

/** Every enrolled identity. Public keys only — no private material is ever held. */
app.get('/identities', authorise('identity:read'), (_req, res) => {
  const all = identities.list();
  res.status(200).json({
    generated: generated(`${all.length} enrolled identit${all.length === 1 ? 'y' : 'ies'}`),
    identities: all,
    unverifiable: [
      { field: 'liveness', because: 'An enrolled identity is not a running agent. Nothing here reports whether it is up.' },
      { field: 'trustworthiness', because: 'Enrolment shows a subject holds a key. It says nothing about whether it should be believed.' },
    ],
  });
});

app.get('/identities/:subject', authorise('identity:read'), (req, res) => {
  const identity = identities.get(String(req.params.subject));
  if (!identity) return fail(res, 404, 'IDENTITY_UNKNOWN', `No identity is enrolled for ${req.params.subject}.`);
  return res.status(200).json(identity);
});

/**
 * A single-use challenge for a subject to sign.
 *
 * Deliberately unauthenticated: asking for a nonce proves nothing and grants
 * nothing. The credential is the *signature*, and only the holder of the private
 * key can produce one. Gating this behind a token would mean an agent needed
 * authority before it could prove who it was, which inverts the whole layer.
 */
// public-route: asking for a nonce proves nothing and grants nothing, and
// gating it would mean an agent needed authority before it could prove who it
// was. That inverts the layer.
//
// It is a subject-enumeration oracle, and that is stated rather than glossed:
// an unknown subject answers 404 IDENTITY_UNKNOWN, an enrolled one answers 200
// with a nonce, and a suspended one answers 403 — so an anonymous caller can
// learn which subjects exist and which are suspended, at the rate limiter's 60
// requests a minute.
//
// Returning a nonce for every subject would close it and cost more than it
// saves: the commonest real failure here is a typo in a subject name, and the
// operator would get "your signature is invalid" for a subject that was never
// enrolled. Subject names are inventory, not credentials. The trade is stated
// in docs/SECURITY-MODEL.md rather than decided silently.
app.post('/identities/:subject/challenge', (req, res) => {
  try {
    return res.status(200).json(identities.challenge(String(req.params.subject)));
  } catch (error) {
    const identityError = error as IdentityError;
    const status = identityError.code === 'IDENTITY_UNKNOWN' ? 404 : identityError.code === 'IDENTITY_SUSPENDED' ? 403 : 400;
    return fail(res, status, identityError.code ?? 'INVALID_REQUEST', identityError.message);
  }
});

/** Rotate the public key on file. History is untouched; future proofs change key. */
app.post('/identities/:subject/rotate', authorise('identity:manage'), (req, res) => {
  try {
    return res.status(200).json(identities.rotate(String(req.params.subject), String(req.body?.publicKeyPem ?? '')));
  } catch (error) {
    const identityError = error as IdentityError;
    return fail(res, identityError.code === 'IDENTITY_UNKNOWN' ? 404 : 400, identityError.code ?? 'INVALID_REQUEST', identityError.message);
  }
});

/**
 * Suspend an identity. It stops obtaining authority immediately.
 *
 * Nothing it already recorded is altered, hidden or re-scored. History is not
 * revised because somebody was later distrusted — that would make the record a
 * reflection of current opinion rather than of what happened.
 */
app.post('/identities/:subject/suspend', authorise('identity:manage'), (req, res) => {
  try {
    return res.status(200).json(identities.suspend(String(req.params.subject), String(req.body?.reason ?? '')));
  } catch (error) {
    const identityError = error as IdentityError;
    return fail(res, identityError.code === 'IDENTITY_UNKNOWN' ? 404 : 400, identityError.code ?? 'INVALID_REQUEST', identityError.message);
  }
});

app.post('/identities/:subject/reinstate', authorise('identity:manage'), (req, res) => {
  try {
    return res.status(200).json(identities.reinstate(String(req.params.subject)));
  } catch (error) {
    const identityError = error as IdentityError;
    return fail(res, identityError.code === 'IDENTITY_UNKNOWN' ? 404 : 400, identityError.code ?? 'INVALID_REQUEST', identityError.message);
  }
});


// ---- Verify's fourth target: model identity ----

/**
 * Record that a model was approved, and what it looked like at the time.
 *
 * Deliberately narrow. This makes no claim about what a model thinks — a
 * refusal written down in docs/internal/INTERPRETABILITY.md and kept here. The
 * question it answers is a governance one an operator actually has an interest
 * in: *you approved a model; is the thing answering you still that model?*
 * Providers roll versions silently, quantisations change numerics, and a proxy
 * can be repointed — none of which announces itself in an execution log.
 */
app.post('/models', authorise('model:approve'), (req, res) => {
  try {
    const { name, fingerprint, approvedBy, basis } = req.body ?? {};
    return res.status(201).json(models.approve({ name, fingerprint, approvedBy, basis }));
  } catch (error) {
    const modelError = error as ModelIdentityError;
    return fail(res, modelError.code === 'ALREADY_APPROVED' ? 409 : 400, modelError.code ?? 'INVALID_REQUEST', modelError.message);
  }
});

app.get('/models', authorise('execution:read'), (_req, res) => {
  const all = models.list();
  res.status(200).json({
    generated: generated(`${all.length} approved model(s)`),
    models: all,
    unverifiable: [
      { field: 'behaviour', because: 'This compares identifying material. A model reporting the same version can still answer differently, and nothing here would know.' },
      { field: 'reasoning', because: 'No claim is made about what a model thinks. Ranked tokens under a linear lens are not thoughts, and this endpoint does not produce even those.' },
    ],
  });
});

/** Replace an approval deliberately. Never a side effect of re-running setup. */
app.post('/models/:name/supersede', authorise('model:approve'), (req, res) => {
  try {
    const { fingerprint, approvedBy, basis } = req.body ?? {};
    return res.status(200).json(models.supersede(String(req.params.name), { fingerprint, approvedBy, basis }));
  } catch (error) {
    const modelError = error as ModelIdentityError;
    return fail(res, modelError.code === 'NOT_FOUND' ? 404 : 400, modelError.code ?? 'INVALID_REQUEST', modelError.message);
  }
});

/** Is what is answering now the model that was approved? */
app.post('/models/:name/attest', authorise('execution:read'), (req, res) => {
  const attestation = models.attest(String(req.params.name), req.body?.fingerprint);
  return res.status(200).json({
    generated: generated(`model identity for ${req.params.name}`),
    ...attestation,
  });
});

// ---- Layer 5 — Governance: the approval workflow ----

/**
 * Open an approval request, because a rule said `REQUIRES_APPROVAL`.
 *
 * The decision a policy records is the *demand* for an approval. This is where
 * one is actually asked for, and the action it covers is hashed from the four
 * fields the finished execution will also carry — so afterwards, "was this
 * approved?" is answerable from the execution record alone, with no approval id
 * written onto the trace for somebody to fill in later.
 */
app.post('/approvals', authorise('execution:record'), (req, res) => {
  try {
    const { action, context, policyRef, policyVersion, requestedBy, ttlMs } = req.body ?? {};
    const approval = approvals.request({
      action, context, policyRef, policyVersion,
      requestedBy: requestedBy ?? actorOf(req),
      ...(ttlMs !== undefined ? { ttlMs: Number(ttlMs) } : {}),
    });
    return res.status(201).json({
      approval,
      /** What the approver signs, if they hold an enrolled key. Handed over so nobody has to rebuild it. */
      statementToSign: approvalStatement({
        id: approval.id,
        actionHash: approval.actionHash,
        contextHash: approval.contextHash,
        decision: 'GRANTED',
        decidedBy: '<the approver\'s enrolled subject>',
      }),
      means: 'This action is waiting on a person. Nothing here permits it — an open request is UNKNOWN, and running on an UNKNOWN is running unapproved.',
    });
  } catch (error) {
    const approvalError = error as ApprovalError;
    return fail(res, 400, approvalError.code ?? 'INVALID_REQUEST', approvalError.message);
  }
});

/** The queue a person works. Oldest first, and a lapsed request is not pending. */
app.get('/approvals', authorise('execution:read'), (req, res) => {
  const onlyPending = String(req.query.state ?? '').toUpperCase() === 'PENDING';
  const all = onlyPending ? approvals.pending() : approvals.list(Number(req.query.limit ?? 100));
  return res.status(200).json({
    generated: generated(`${all.length} approval(s)`),
    approvals: all,
    unverifiable: [
      { field: 'authority', because: 'An approval is not a capability. It permits one execution of one payload; what an agent may generally do is a token\'s question.' },
      { field: 'correctness', because: 'This records that somebody decided, who, and on what basis. Whether they should have is a judgement, and it is not ABSuite\'s.' },
    ],
  });
});

app.get('/approvals/:id', authorise('execution:read'), (req, res) => {
  const approval = approvals.get(String(req.params.id));
  if (!approval) return fail(res, 404, 'NOT_FOUND', `No approval ${req.params.id}.`);
  return res.status(200).json({ approval, signature: approvals.verify(approval.id) });
});

/**
 * Grant or refuse.
 *
 * `approval:decide` is a separate scope from `execution:record` on purpose: an
 * agent that can request an approval must not hold the authority to grant one,
 * or the whole workflow is theatre performed by a single party.
 */
app.post('/approvals/:id/decide', authorise('approval:decide'), (req, res) => {
  try {
    const { decision, decidedBy, basis, signature } = req.body ?? {};
    const decided = approvals.decide(String(req.params.id), {
      decision,
      decidedBy: decidedBy ?? actorOf(req),
      basis,
      ...(signature ? { signature: String(signature) } : {}),
    });
    return res.status(200).json({
      approval: decided,
      means: decided.assurance === 'PROVEN'
        ? 'Signed by the approver\'s enrolled key. Anyone holding that public key can check this decision without trusting this server.'
        : 'Recorded, and attributed by the name supplied. It is reported as ASSERTED rather than PROVEN, because nothing here proves the named person made it.',
    });
  } catch (error) {
    const approvalError = error as ApprovalError;
    const status = approvalError.code === 'NOT_FOUND' ? 404
      : approvalError.code === 'SELF_APPROVAL' || approvalError.code === 'APPROVER_SUSPENDED' ? 403
      : approvalError.code === 'APPROVAL_DECIDED' ? 409
      : 400;
    return fail(res, status, approvalError.code ?? 'INVALID_REQUEST', approvalError.message);
  }
});

app.post('/approvals/:id/withdraw', authorise('execution:record'), (req, res) => {
  try {
    const { by, reason } = req.body ?? {};
    return res.status(200).json(approvals.withdraw(String(req.params.id), by ?? actorOf(req), reason));
  } catch (error) {
    const approvalError = error as ApprovalError;
    return fail(res, approvalError.code === 'NOT_FOUND' ? 404 : 409, approvalError.code ?? 'INVALID_REQUEST', approvalError.message);
  }
});

/** Spend a granted approval on one execution. The second call fails, by design. */
app.post('/approvals/:id/consume', authorise('execution:record'), (req, res) => {
  try {
    return res.status(200).json(approvals.consume(String(req.params.id), req.body?.traceId));
  } catch (error) {
    const approvalError = error as ApprovalError;
    return fail(res, approvalError.code === 'NOT_FOUND' ? 404 : 409, approvalError.code ?? 'INVALID_REQUEST', approvalError.message);
  }
});

/**
 * Was this action approved before it ran?
 *
 * Takes either the four fields or the hash of them, so an auditor holding only
 * an execution record can ask without knowing an approval id exists.
 */
app.post('/approvals/attest', authorise('execution:read'), (req, res) => {
  const { action, actionHash, traceId } = req.body ?? {};
  if (!action && !actionHash) {
    return fail(res, 400, 'INVALID_REQUEST', 'Send either action { subject, module, action, inputHash } or actionHash.');
  }
  try {
    return res.status(200).json({
      generated: generated('approval attestation'),
      ...approvals.attest(actionHash ? String(actionHash) : (action as ApprovalAction), traceId ? String(traceId) : undefined),
    });
  } catch (error) {
    const approvalError = error as ApprovalError;
    return fail(res, 400, approvalError.code ?? 'INVALID_REQUEST', approvalError.message);
  }
});

// ---- Layer 6 — Autonomy: what the watch has seen ----

/**
 * What a person should look at, and how much of the record that answer covers.
 *
 * `coverage` is not a footer. An empty `notices` array means "the last sweep
 * found none" or it means "nothing has ever swept", and those are opposite
 * statements that look identical in a list. Every response here carries the
 * sentence that tells them apart, so an interface cannot render the list
 * without rendering what the list means.
 */
app.get('/watch', authorise('execution:read'), (req, res) => {
  const state = String(req.query.state ?? '').toUpperCase();
  const notices = watch.notices({
    ...(state === 'OPEN' || state === 'ACKNOWLEDGED' ? { state: state as NoticeState } : {}),
    limit: Number(req.query.limit ?? 100),
  });

  return res.status(200).json({
    generated: generated(`${notices.length} notice(s)`),
    notices,
    coverage: watch.coverage(),
    running: watch.running,
    unverifiable: [
      { field: 'severity', because: 'Nothing here is ranked. Which of these matters most is a judgement about your business, and ABSuite does not have one.' },
      { field: 'completeness', because: 'A sweep finds what it knows how to look for. An absence of notices is an absence of findings, not evidence of health.' },
    ],
  });
});

/** Sweep now, rather than waiting for the interval. Same code path, no shortcuts. */
app.post('/watch/sweep', authorise('execution:read'), (_req, res) => {
  const result = watch.sweep();
  return res.status(200).json({
    generated: generated(`a sweep of ${result.read} record(s)`),
    ...result,
  });
});

/**
 * Close a notice, with a name and a reason.
 *
 * Never a delete. A notice that was raised and dismissed is part of the history
 * of the thing it was raised about, and the reason somebody gave is usually the
 * most useful sentence in it a year later.
 *
 * `watch:acknowledge` is its own scope, and this was wrong when it shipped: it
 * required `execution:record`, which every recording agent holds. That meant the
 * subject of a finding could silence the finding about itself — an agent that
 * ran without authority could close the notice saying so, and the queue would
 * look clean. Separation of duties applies to a monitor exactly as it applies to
 * an approval, and for the same reason.
 */
app.post('/watch/notices/:id/acknowledge', authorise('watch:acknowledge'), (req, res) => {
  try {
    const { by, basis } = req.body ?? {};
    return res.status(200).json(watch.acknowledge(String(req.params.id), by ?? actorOf(req), basis));
  } catch (error) {
    const message = (error as Error).message;
    return fail(res, message.startsWith('No notice') ? 404 : 400, 'INVALID_REQUEST', message);
  }
});

// ---- Verifiable execution ----

/**
 * The public half of the trace signing key.
 *
 * Deliberately unauthenticated: verification is meant to be possible by an
 * auditor or customer who holds no ABSuite credentials at all.
 */
// public-route: deliberately. An auditor with no relationship to the operator
// must be able to fetch the key and check a record without asking permission.
app.get('/executions/public-key', (_req, res) => {
  res.status(200).json({
    keyId: signingKey.keyId,
    algorithm: 'Ed25519',
    publicKey: signingKey.publicKeyPem,
    ephemeral: signingKey.ephemeral,
  });
});

app.post('/executions', authorise('execution:record'), (req, res) => {
  const { subject, jti, scope, module, action, input, output, outcome, error, startedAt, completedAt, durationMs, steps, governance, cost } = req.body ?? {};

  if (!subject || !module || !action || !outcome) {
    return fail(res, 400, 'INVALID_REQUEST', 'subject, module, action and outcome are required');
  }
  if (!['success', 'failure'].includes(String(outcome))) {
    return fail(res, 400, 'INVALID_REQUEST', 'outcome must be success or failure');
  }

  // The governing rule, when the caller evaluated one. Validated rather than
  // trusted: a half-filled policy reference is worse than none, because it looks
  // like an answer to "under what rule?" without being one.
  let governanceRecord: GovernanceRecord | undefined;
  if (governance !== undefined && governance !== null) {
    const { policyRef, policyVersion, decision, evidence, evaluatedBy } = governance as Record<string, unknown>;
    if (!policyRef || !policyVersion || !decision) {
      return fail(res, 400, 'INVALID_REQUEST', 'governance requires policyRef, policyVersion and decision');
    }
    if (!['PERMITTED', 'DENIED', 'REQUIRES_APPROVAL'].includes(String(decision))) {
      return fail(res, 400, 'INVALID_REQUEST', 'governance.decision must be PERMITTED, DENIED or REQUIRES_APPROVAL');
    }
    governanceRecord = {
      policyRef: String(policyRef),
      policyVersion: String(policyVersion),
      decision: String(decision) as GovernanceRecord['decision'],
      evidence: Array.isArray(evidence) ? evidence.map(String) : [],
      ...(evaluatedBy ? { evaluatedBy: String(evaluatedBy) } : {}),
    };
  }

  // What it cost, when the caller states one. Rejected loudly rather than
  // coerced: the figure is about to be signed into a record that cannot be
  // edited, and normaliseCost already carries the sentence explaining what was
  // wrong with it, so it is passed straight through to the caller.
  let costRecord: CostRecord | undefined;
  if (cost !== undefined && cost !== null) {
    try {
      costRecord = normaliseCost(cost);
    } catch (invalid) {
      return fail(res, 400, 'INVALID_REQUEST', (invalid as Error).message);
    }
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
    ...(governanceRecord ? { governance: governanceRecord } : {}),
    ...(costRecord ? { cost: costRecord } : {}),
  });

  metrics.increment('absuite_executions_total', { outcome: trace.outcome, module: trace.module });
  return res.status(201).json(trace);
});

/**
 * A tenant's witnessing history.
 *
 * The paid tiers sell being seen by somebody with no stake in the answer, and a
 * thing nobody can look at is a thing nobody believes they are buying. This is
 * the receipts, raw, oldest first.
 *
 * They are served EXACTLY as the notary returned them and are not verified
 * here. A receipt is signed by the notary's key, and checking it against a key
 * this instance holds would be this instance vouching for its own witness —
 * which is the property being purchased, spent.
 */
// public-route: unauthenticated at the router and guarded inside, matching
// /usage — it returns 401 TENANT_KEY_REQUIRED without an X-ABSuite-Tenant-Key.
app.get('/notary/receipts', (req, res) => {
  const tenant = (req as TenantRequest).tenant;
  if (!tenant) {
    return fail(res, 401, 'TENANT_KEY_REQUIRED', 'Supply X-ABSuite-Tenant-Key to read receipts');
  }

  const plan = tenancy.planFor(tenant);
  const rows = storage.all<{ head_hash: string; claimed_length: number; witnessed_at: string; notary_url: string; body: string }>(
    'SELECT head_hash, claimed_length, witnessed_at, notary_url, body FROM notary_receipts ORDER BY id DESC LIMIT ?',
    Math.min(Number(req.query.limit ?? 100), 1000)
  );

  return res.status(200).json({
    /*
     * The window is served beside the receipts because it is what the receipts
     * MEAN. A list of timestamps without it is trivia; with it, it is the
     * longest period in which this history could have been rewritten
     * unobserved.
     */
    rewriteWindowHours: rewriteWindowHours(plan),
    witnessed: rows.length > 0,
    /*
     * An instance nobody witnesses says so plainly. The notary's own rule: an
     * unwitnessed chain is UNWITNESSED, never suspicious, because punishing
     * somebody for not having started is the wrong incentive and the wrong
     * claim.
     */
    note: rewriteWindowHours(plan) === null
      ? 'This plan is not witnessed by us. Run your own notary — the package is MIT — or move to a plan that includes witnessing. An unwitnessed chain is unwitnessed, not suspicious.'
      : 'Receipts are shown as the notary returned them and are not checked here. Verify them with the notary\'s public key.',
    receipts: rows.map(r => ({
      headHash: r.head_hash,
      claimedLength: r.claimed_length,
      witnessedAt: r.witnessed_at,
      notary: r.notary_url,
      receipt: safeJson(r.body),
    })),
  });
});

/**
 * The audit export — every record, in a file an auditor can verify alone.
 *
 * `GET /executions` already lists records for somebody holding a key to this
 * instance. This is a different claim: a file that stands up to a reader with
 * no access and no reason to trust whoever handed it to them. It carries the
 * signatures, the links, the public key and the retention anchor, and
 * `verifyAuditExport` re-walks it from the file alone.
 *
 * Scoped to the caller's tenant like every other read here, so an export can
 * never become a way to read somebody else's records in bulk.
 */
app.get('/audit/export', authorise('execution:read'), (req, res) => {
  const tenant = (req as TenantRequest).tenant;

  /*
   * Oldest first, because the ORDER IS THE CHAIN — `list` returns newest first
   * for a screen, and handing that straight to the verifier would produce a
   * file that fails on its first link for no reason but sort order.
   */
  const records = traces.list({
    limit: Math.min(Number(req.query.limit ?? 10_000), 50_000),
    ...(tenant ? { tenantId: tenant.id } : {}),
  }).reverse();

  /*
   * The receipts travel with the records. A bundle carrying both is evidence;
   * one carrying only the chain is a story the chain tells about itself.
   */
  const receipts = storage
    .all<{ body: string }>('SELECT body FROM notary_receipts ORDER BY id ASC')
    .map(row => safeJson(row.body))
    .filter(r => r !== undefined);

  const bundle = buildAuditExport({
    records,
    receipts,
    publicKeyPem: signingKey.publicKeyPem,
    keyId: signingKey.keyId,
    ...(() => {
      const anchor = traces.latestRetentionAnchor(signingKey.publicKeyPem);
      return anchor ? { retainedFrom: anchor } : {};
    })(),
  });

  audit.record({ subject: actorOf(req) ?? 'unattributed', action: 'audit.export', resource: `records:${bundle.count}`, result: 'allow' });

  res.setHeader('content-disposition', `attachment; filename="absuite-audit-${bundle.exportedAt.slice(0, 10)}.json"`);
  return res.status(200).json(bundle);
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

/**
 * Aggregate counts across everything recorded, plus a live chain verification.
 *
 * This is what a control plane opens on, so it is also the easiest screen in the
 * product to lie on. Every field is a count of records that exist; the
 * verification result comes from actually walking the chain on this request
 * rather than from a cached "healthy". `unverifiable` names what we deliberately
 * do not track, so an absent number reads as absent rather than as zero.
 */
app.get('/executions/stats', authorise('execution:read'), (req, res) => {
  const windowHours = Math.min(Math.max(Number(req.query.windowHours) || 24, 1), 24 * 90);
  const stats = traces.stats(windowHours);

  /*
   * Two different checks, and only one of them belongs on a page load.
   *
   * Content and linkage catch tampering: any edit to a record changes its hash
   * and the walk names the sequence number. Signatures catch something else —
   * forgery by somebody who can write to the database *and* recompute hashes,
   * but does not hold the key. Both matter. They answer different questions and
   * they cost wildly different amounts.
   *
   * Measured on this machine, and the reason this changed:
   *
   *     20,000 records   content + linkage   262 ms
   *     20,000 records   + Ed25519           3,046 ms
   *
   * This endpoint is what the control plane opens on and polls. Node is
   * single-threaded, so three seconds of synchronous Ed25519 does not merely
   * make one page slow — it blocks every other request to the service for three
   * seconds. At a hundred thousand records that is fifteen. A read of the
   * dashboard should not be able to stall the recorder.
   *
   * So the default walk is content and linkage, `?verify=full` asks for
   * signatures, and — this is the part that matters — the response says which
   * one ran. Reporting an unchecked signature as checked would be the exact
   * failure this product exists to refuse, and `signaturesChecked` is there so
   * nobody has to infer it from a response time.
   */
  const full = String(req.query.verify ?? '') === 'full';
  const chain = full ? traces.verifyChain(signingKey.publicKeyPem) : traces.verifyChain();

  res.status(200).json({
    generated: generated(`all ${stats.total} record(s) held, counted over a ${windowHours}-hour window`),
    ...stats,
    chain: {
      valid: chain.valid,
      checked: chain.checked,
      ...(chain.brokenAt !== undefined ? { brokenAt: chain.brokenAt } : {}),
      ...(chain.reason ? { reason: chain.reason } : {}),
      // Content intact with an invalid signature is a key problem, not an
      // intrusion, and the two must not read the same on a control plane.
      ...(chain.contentIntact !== undefined ? { contentIntact: chain.contentIntact } : {}),
      signaturesChecked: full,
      covers: full
        ? 'Content, linkage and Ed25519 signatures, walked on this request.'
        : 'Content and linkage, walked on this request. Signatures were not checked — that is a separate question about authorship, and it is slow enough that running it on every page load would stall the service. Add ?verify=full to check them.',
      headHash: chain.headHash,
    },
    // Named, not silently omitted: a dashboard that shows "0 incidents" when it
    // has never had a concept of an incident is worse than one that says so.
    unverifiable: [
      { field: 'activeAgents', because: 'A subject that acted once is not an agent that is running. Nothing here reports liveness.' },
      { field: 'incidents', because: 'An incident is a judgement. ABSuite records what happened and flags what warrants a look; it does not declare incidents.' },
      { field: 'openDisputes', because: 'Arbitrations are answered on request and not persisted, so there is no count to give.' },
    ],
  });
});

/**
 * Spend, attributed to the agent that caused it.
 *
 * The question this exists to answer is *"which agent spent that, and under what
 * authority?"* — not *"what is the cluster costing?"*. The difference is the
 * whole product: a utilisation gauge tells an operator a number, and this tells
 * them a subject, a scope, and a signed record they can hand to someone else.
 *
 * The response leads with coverage rather than with the total, deliberately.
 * Sending a figure first invites it to be read as the bill; every deployment
 * starts with zero costed records, and a screen that says "$0.00" when it means
 * "nobody has recorded a cost yet" is the exact failure this repository exists
 * to refuse.
 */
app.get('/executions/cost', authorise('execution:read'), (_req, res) => {
  const subjects = traces.costBySubject();
  const stats = traces.stats();
  const priced = stats.total - stats.withoutCost;

  res.status(200).json({
    generated: generated(`${priced} of ${stats.total} record(s) that carry a signed cost`),
    coverage: {
      records: stats.total,
      priced,
      unpriced: stats.withoutCost,
      // Said in words as well as numbers, because the ratio is the finding.
      meaning: stats.total === 0
        ? 'Nothing has been recorded yet, so there is nothing to attribute.'
        : priced === 0
          ? 'No record carries a cost. Nothing here can be attributed to spend until one does.'
          : priced === stats.total
            ? 'Every record held carries a cost, so these totals cover the whole log.'
            : `These totals cover ${priced} of ${stats.total} records. The other ${stats.withoutCost} may have cost something; nothing here knows.`,
    },
    // One per currency, never summed together — no exchange rate appears in any
    // record, so a combined figure would be invented at read time.
    totals: stats.cost,
    subjects,
    unverifiable: [
      { field: 'measured', because: 'ABSuite meters nothing. Every figure here is a claim recorded by the caller, attributed to the source named on it.' },
      { field: 'projected', because: 'No run rate, forecast or annualisation is offered. Those are this record multiplied by an assumption.' },
      { field: 'converted', because: 'Currencies are reported separately. Combining them needs an exchange rate, and no record carries one.' },
    ],
  });
});


/**
 * What one agent handed to another.
 *
 * The gap this closes: agent A writes a bad summary, agent B consumes it, agent
 * C acts on it, and the log shows three successes. Each record is individually
 * signed and verifiable, and the failure lives entirely in the seam between
 * them.
 *
 * The edges are computed from content hashes already on every record — when B's
 * input hash equals A's output hash, B consumed byte for byte what A produced.
 * That is content identity under SHA-256, not a log line somebody wrote.
 *
 * `coverage` leads, for the usual reason: a graph with two edges over four
 * hundred records is not a tidy system, it is one whose handoffs are going
 * unrecorded, and printing the graph without that reading would hide it.
 */
app.get('/executions/provenance', authorise('execution:read'), (_req, res) => {
  const summary = provenance.summary();
  res.status(200).json({
    generated: generated(`${summary.edges} traced handoff(s) across ${summary.records} record(s)`),
    coverage: {
      records: summary.records,
      linked: summary.linked,
      unlinked: summary.unlinked,
      meaning: summary.meaning,
    },
    edges: provenance.edges(),
    // Failures whose output something else went on to consume. The single most
    // misleading row in any agent log is a success that ate a failure.
    failuresWithConsumers: summary.failuresWithConsumers,
    unverifiable: [
      { field: 'causation', because: 'An edge shows the same content moved between two records. Two agents reading one source produce the same hash without either feeding the other, so this is evidence of flow, never proof of intent.' },
      { field: 'unrecorded handoffs', because: 'Anything passed between agents without recording an execution is invisible here, and no honest count can include it.' },
    ],
  });
});

/** One record's ancestry and descendants, plus any failure it inherited. */
app.get('/executions/:id/lineage', authorise('execution:read'), (req, res) => {
  const lineage = provenance.lineage(String(req.params.id));
  if (!lineage) return fail(res, 404, 'NOT_FOUND', 'No such execution');
  return res.status(200).json({
    generated: generated(`the flow around execution ${req.params.id}`),
    ...lineage,
    blastRadius: provenance.blastRadius(String(req.params.id)),
  });
});

/**
 * What a person should look at, with the field that says so.
 *
 * Deliberately not called "incidents". An incident is a judgement about meaning;
 * this is the narrower claim ABSuite is entitled to make — these records are
 * failed, unproven or unauthorised on their face. Whether any of it matters is
 * the reader's call, and the response says so.
 */
app.get('/executions/attention', authorise('execution:read'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const items = traces.needingAttention(limit);
  const chain = traces.verifyChain(signingKey.publicKeyPem);
  const held = traces.stats().total;

  res.status(200).json({
    generated: generated(
      items.length === limit
        ? `the ${limit} most recent flagged record(s) of an unknown larger number, among ${held} held`
        : `all flagged records among ${held} held`
    ),
    items,
    count: items.length,
    // A count with no denominator reads the same whether it is 3 of 10 or 3 of
    // ten million, and a truncated list reads exactly like a complete one.
    // Every number here states what it is a number *of*.
    held,
    limit,
    truncated: items.length === limit,
    chain: {
      valid: chain.valid,
      ...(chain.brokenAt !== undefined ? { brokenAt: chain.brokenAt } : {}),
      ...(chain.reason ? { reason: chain.reason } : {}),
      ...(chain.contentIntact !== undefined ? { contentIntact: chain.contentIntact } : {}),
    },
    note:
      (items.length === limit
        ? `Showing the ${limit} most recent of an unknown larger number — raise the limit to see the rest. `
        : `All ${items.length} found among ${held} record(s) held. `) +
      'These records are failed, unproven or carry no recorded authority. ABSuite states that; it does not declare an incident or recommend an action.',
  });
});

/**
 * Everything this instance could know and does not, grouped by what would fix it.
 *
 * An UNKNOWN is not a destination; it is a queue of work. Every unknown in the
 * system already carries its own route out, and once you have thousands of
 * records those routes collapse into a handful of distinct actions — supply the
 * public key, record output hashes, attach a policy reference. This groups them
 * and counts how many records each one would resolve.
 *
 * Counts, not priorities. Which of these matters is a judgement, and ordering
 * them by importance would be ABSuite making it.
 */
app.get('/executions/unknowns', authorise('execution:read'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const held = traces.stats().total;
  const records = traces.list({ limit });

  // Walked once for all of them rather than per record.
  const chainValid = traces.verifyChain(signingKey.publicKeyPem).valid;

  const byResolution = new Map<string, { conditions: Set<string>; records: string[] }>();

  for (const trace of records) {
    const report = trustConditions(trace, verifyTrace(trace, signingKey.publicKeyPem), chainValid, identities.attest(trace.subject, trace.jti), approvalFor(trace), REQUIRED_APPROVAL_ASSURANCE);
    for (const condition of report.conditions) {
      if (condition.state !== 'UNKNOWN' || !condition.resolvedBy) continue;
      const entry = byResolution.get(condition.resolvedBy) ?? { conditions: new Set(), records: [] };
      entry.conditions.add(condition.condition);
      if (entry.records.length < 5) entry.records.push(trace.id);
      byResolution.set(condition.resolvedBy, entry);
    }
  }

  const queue = [...byResolution.entries()]
    .map(([resolution, entry]) => ({
      resolution,
      conditions: [...entry.conditions].sort(),
      examples: entry.records,
    }))
    .sort((a, b) => a.resolution.localeCompare(b.resolution));

  return res.status(200).json({
    generated: generated(`${records.length} of ${held} record(s) held`),
    examined: records.length,
    held,
    queue,
    note:
      queue.length === 0
        ? 'Nothing examined here is unknown for a reason this instance can act on.'
        : 'Each entry is work that would turn an unknown into an answer. They are listed alphabetically, not ranked — which of them matters is your judgement, not ABSuite’s.',
  });
});

/**
 * Authority actually exercised, per subject.
 *
 * Built from records of what happened rather than tokens that were issued: an
 * unused token grants nothing observable, and an access review needs behaviour,
 * not intent.
 */
app.get('/executions/authority', authorise('execution:read'), (_req, res) => {
  const subjects = traces.authorityInventory();
  const held = traces.stats().total;
  res.status(200).json({
    generated: generated(`all ${held} execution(s) held`),
    subjects,
    count: subjects.length,
    // Unlike the other listings this one is a complete scan, and saying so is
    // the difference between "these are the subjects" and "these are some".
    held,
    complete: true,
    note: `Derived from all ${held} execution(s) held — behaviour that happened, not tokens that were issued. A capability nobody used does not appear here.`,
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

/**
 * Explain a record in plain language.
 *
 * Derived from signed fields, never generated by a model: an explanation
 * produced by a system nobody can inspect, about a record whose value is that
 * it *can* be inspected, would be the least trustworthy thing on the page.
 */
app.get('/executions/:id/explain', authorise('execution:read'), (req, res) => {
  const trace = traces.get(String(req.params.id));
  if (!trace) return fail(res, 404, 'NOT_FOUND', 'No such execution');
  const verdict = verifyTrace(trace, signingKey.publicKeyPem);
  return res.status(200).json({
    generated: generated(`execution ${trace.id}`),
    id: trace.id,
    ...explainTrace(trace, verdict),
  });
});

/** Compare a re-run of an execution against its recorded hashes. */
/**
 * The five necessary conditions, assessed for one execution.
 *
 *     Trust := f(Identity, Capability, Evidence, Governance, Time)
 *
 * `f` is not implemented, here or anywhere. This returns the inputs — each
 * demonstrated, unproven or absent, each naming its source field — and a
 * conclusion in words. There is no score, and the absence is deliberate: a
 * number replaces evidence with something nobody audits.
 */
app.get('/executions/:id/conditions', authorise('execution:read'), (req, res) => {
  const trace = traces.get(String(req.params.id));
  if (!trace) return fail(res, 404, 'NOT_FOUND', 'No such execution');

  // Both checks run here rather than being assumed: an unverified record and a
  // verified one must never produce the same assessment.
  const verdict = verifyTrace(trace, signingKey.publicKeyPem);
  const chain = traces.verifyChain(signingKey.publicKeyPem);

  return res.status(200).json({
    generated: generated(`execution ${trace.id}, against a chain of ${chain.checked} record(s)`),
    ...trustConditions(trace, verdict, chain.valid, identities.attest(trace.subject, trace.jti), approvalFor(trace), REQUIRED_APPROVAL_ASSURANCE),
  });
});

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
// public-route: deliberately. Verification that requires the operator's
// blessing proves nothing.
app.post('/executions/verify', (req, res) => {
  const trace = req.body?.trace;
  if (!trace || typeof trace !== 'object') {
    return fail(res, 400, 'INVALID_REQUEST', 'A trace object is required');
  }

  const publicKey = typeof req.body?.publicKey === 'string' ? req.body.publicKey : signingKey.publicKeyPem;
  const verdict = verifyTrace(trace, publicKey);

  // `valid` is a boolean and booleans cannot carry "nobody checked". The
  // determination can, and it names what would resolve an UNKNOWN rather than
  // leaving a reader with a dead end they will eventually read as a pass.
  const assessed = determineTrace(verdict);
  return res.status(200).json({
    ...verdict,
    ...assessed.overall,
    integrity: assessed.integrity,
    authorship: assessed.authorship,
  });
});

/**
 * Walk the chain. `?from=checkpoint` resumes from the last signed checkpoint.
 *
 * The default is a full walk and stays that way: a caller who did not ask for
 * the cheaper answer must never silently receive it. A resumed response carries
 * `verifiedFrom` and `scope`, so the two claims cannot be confused by anything
 * reading this route.
 */
app.get('/executions-verify-chain', authorise('execution:read'), (req, res) => {
  const from = req.query.from === 'checkpoint' ? 'checkpoint' as const : 'genesis' as const;
  const result = traces.verifyChain(signingKey.publicKeyPem, { from });
  res.status(200).json({
    ...result,
    ...(result.valid
      ? { determination: 'DEMONSTRATED' as const, statement: `${result.checked} record(s) verified.` }
      : determineTrace({
          valid: false,
          contentIntact: result.contentIntact ?? false,
          signatureValid: result.contentIntact === false ? null : false,
          ...(result.checkable === false ? { checkable: false } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
        }).overall),
  });
});

/**
 * Walk the chain fully, and record a signed note that it verified.
 *
 * `execution:verify` rather than `execution:read`, because writing a checkpoint
 * is what later lets a walk be skipped. Anyone who can create one can decide
 * how much history a resumed verification stops examining, and that is not a
 * power that belongs with reading.
 */
app.post('/executions/checkpoint', authorise('execution:verify'), (_req, res) => {
  const checkpoint = traces.checkpoint(signingKey.publicKeyPem);

  if (!checkpoint) {
    const chain = traces.verifyChain(signingKey.publicKeyPem);
    return fail(
      res,
      409,
      'NOT_CHECKPOINTABLE',
      chain.valid
        ? 'Nothing to checkpoint: the chain is empty, or this instance holds no signing key to bind the note to.'
        : `The chain does not verify${chain.brokenAt !== undefined ? ` at record ${chain.brokenAt}` : ''}, so no checkpoint was written. A checkpoint taken over a broken chain would be a signed statement that nothing was wrong.`
    );
  }

  return res.status(201).json({
    generated: generated(`a checkpoint at record ${checkpoint.seq}`),
    checkpoint,
    means:
      'This instance walked the chain from genesis and found this head. A later verification may resume from here ' +
      'instead of re-walking, which is faster and is a weaker claim — it rests on this row, which lives in the same ' +
      'file as the records it vouches for.',
    unverifiable: [
      {
        field: 'history before this point, on a resumed pass',
        because:
          'Resuming skips it by design. Nothing about a checkpoint detects a record edited before it — that would ' +
          'require the walk the checkpoint exists to avoid. Verification from genesis remains the only strong answer.',
      },
    ],
  });
});

// ---- Billing & tenancy ----

/**
 * The published price list, in both terms.
 *
 * `priceCents` stays exactly what it was — the monthly figure — so nothing that
 * already reads this route changes meaning. Annual arrives as its own object
 * rather than by redefining the old field, because a consumer that had been
 * quoting `priceCents` monthly and silently started quoting a year is the worst
 * outcome available here.
 *
 * The saving is served rather than left to the reader to compute. A page doing
 * its own arithmetic on two numbers is a page that will one day advertise a
 * discount the billing plan does not give.
 */
// public-route: the published price list.
app.get('/plans', (_req, res) => {
  res.status(200).json({
    plans: Object.values(PLANS).map(plan => ({
      ...plan,
      /*
       * The window in which history could be rewritten unwitnessed. Served
       * rather than left to a page to assert, because it is the number a
       * compliance officer actually asks for and the one thing on this price
       * list a competitor cannot simply implement.
       */
      rewriteWindowHours: rewriteWindowHours(plan),
      annual: isSellable(plan)
        ? {
            priceCents: annualPriceCents(plan),
            savingCents: annualSavingCents(plan),
            monthsCharged: ANNUAL_MONTHS_CHARGED,
            ...annualPitch(plan),
          }
        : null,
    })),
  });
});

/** A tenant's own usage and quota position, for a billing page. */
// public-route: unauthenticated at the router, and guarded inside — it returns
// 401 TENANT_KEY_REQUIRED without an X-ABSuite-Tenant-Key. Verified by asking.
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
/**
 * Fetch a PayPal signing certificate, cached by URL.
 *
 * The URL is checked by the CALLER before this is reached. That ordering is the
 * security property: `isPayPalCertUrl` is what makes a valid signature mean
 * "signed by PayPal" rather than "signed by whoever chose the certificate", and
 * it has to run before the request, not after it.
 */
async function payPalCert(url: string): Promise<string | undefined> {
  const cached = payPalCerts.get(url);
  if (cached) return cached;

  try {
    // outbound-ok: `url` has already passed isPayPalCertUrl in the route below —
    // https, and a hostname that is paypal.com or a subdomain of it. It is never
    // reached with a host the sender chose.
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return undefined;
    const pem = await response.text();

    // Oldest out. A Map iterates in insertion order, so the first key is the
    // least recently added.
    if (payPalCerts.size >= PAYPAL_CERT_CACHE_MAX) {
      const oldest = payPalCerts.keys().next().value;
      if (oldest) payPalCerts.delete(oldest);
    }
    payPalCerts.set(url, pem);
    return pem;
  } catch {
    return undefined;
  }
}

/**
 * PayPal subscription webhooks.
 *
 * Mirrors `/billing/webhook` deliberately — same verify-then-map-then-apply
 * shape, same 200-on-unmappable so the sender stops retrying something we can
 * never act on. Only the verification and the event vocabulary differ, because
 * only those are provider-specific.
 */
// public-route: a payment provider cannot carry a capability token. The
// request is authenticated inside the handler by its signature, and by the
// certificate host check that runs before the certificate is even fetched.
app.post('/billing/paypal/webhook', async (req, res) => {
  const deny = (reason: string) => {
    audit.record({ subject: 'paypal', action: 'POST /billing/paypal/webhook', resource: 'billing', result: 'deny', reason });
    return fail(res, 400, 'SIGNATURE_INVALID', reason);
  };

  if (!PAYPAL_WEBHOOK_ID) return deny('No PayPal webhook id configured');

  const raw = (req as express.Request & { rawBody?: string }).rawBody ?? '';
  const certUrl = req.header('paypal-cert-url') ?? '';

  /*
   * The host check comes FIRST, before the certificate is fetched. An attacker
   * choosing the certificate can satisfy every cryptographic check that
   * follows, so this — not the signature — is what ties the event to PayPal.
   * It is also the SSRF guard: without it this route fetches a URL the caller
   * picked.
   */
  if (!isPayPalCertUrl(certUrl)) return deny('Certificate URL is not a PayPal host');

  const pem = await payPalCert(certUrl);
  if (!pem) return deny('Certificate could not be retrieved');

  const verified = verifyPayPalWebhook(raw, req.headers as PayPalWebhookHeaders, PAYPAL_WEBHOOK_ID, pem);
  if (!verified.valid) return deny(verified.reason ?? 'Signature verification failed');

  const outcome = planFromPayPalEvent(req.body ?? {});
  if (outcome.action === 'ignore' || !outcome.customer) {
    return res.status(200).json({ received: true, applied: false });
  }

  const tenant = tenancy.tenants.byExternalRef(outcome.customer);
  if (!tenant) {
    // Acknowledge so PayPal stops retrying an event we cannot map.
    return res.status(200).json({ received: true, applied: false, reason: 'No tenant for that subscription' });
  }

  if (outcome.action === 'suspend') {
    tenancy.tenants.setStatus(tenant.id, 'suspended');
  } else if (outcome.plan) {
    tenancy.tenants.setPlan(tenant.id, outcome.plan);
  }

  audit.record({ subject: 'paypal', action: `billing.${outcome.action}`, resource: `tenant:${tenant.id}`, result: 'allow' });
  return res.status(200).json({ received: true, applied: true, tenant: tenant.id, action: outcome.action });
});

// public-route: a payment provider cannot carry a capability token. The
// request is authenticated inside the handler by its signature.
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

  /*
   * Checkout completion, which is where a self-service tenant first acquires a
   * customer reference. Resolved by tenant id rather than by that reference,
   * because the whole point is that it does not have one yet.
   */
  if (outcome.action === 'bind') {
    const bound = tenancy.tenants.bindExternalRef(outcome.tenantId ?? '', outcome.customer);
    if (!bound.ok) {
      // 200 so Stripe stops retrying something a retry cannot fix, and audited
      // as a denial so a refused binding is visible rather than merely absent.
      audit.record({ subject: 'stripe', action: 'billing.bind', resource: `tenant:${outcome.tenantId ?? 'unknown'}`, result: 'deny', reason: bound.reason });
      return res.status(200).json({ received: true, applied: false, reason: bound.reason });
    }

    if (outcome.plan) tenancy.tenants.setPlan(bound.tenant.id, outcome.plan);

    audit.record({ subject: 'stripe', action: 'billing.bind', resource: `tenant:${bound.tenant.id}`, result: 'allow' });
    return res.status(200).json({ received: true, applied: true, tenant: bound.tenant.id, action: 'bind' });
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

/**
 * Paystack — the local rail, and the third to arrive.
 *
 * Same three steps as the other two: verify, map, apply. The differences are
 * that the signature is SHA-512 over the raw body keyed by the secret key, and
 * that the shapes it is written against have not yet been seen from a live
 * account. See paystack.ts. It fails closed, and it says what it did.
 */
app.post('/billing/paystack/webhook', (req, res) => {
  const raw = (req as express.Request & { rawBody?: string }).rawBody ?? '';
  const signature = req.header('x-paystack-signature') || '';

  const verified = verifyPaystackSignature(raw, signature, PAYSTACK_SECRET_KEY);
  if (!verified.valid) {
    audit.record({ subject: 'paystack', action: 'POST /billing/paystack/webhook', resource: 'billing', result: 'deny', reason: verified.reason ?? 'invalid' });
    return fail(res, 400, 'SIGNATURE_INVALID', verified.reason ?? 'Signature verification failed');
  }

  const outcome = planFromPaystackEvent(req.body ?? {});
  if (outcome.action === 'ignore' || !outcome.customer) {
    return res.status(200).json({ received: true, applied: false });
  }

  if (outcome.action === 'bind') {
    const bound = tenancy.tenants.bindExternalRef(outcome.tenantId ?? '', outcome.customer);
    if (!bound.ok) {
      audit.record({ subject: 'paystack', action: 'billing.bind', resource: `tenant:${outcome.tenantId ?? 'unknown'}`, result: 'deny', reason: bound.reason });
      return res.status(200).json({ received: true, applied: false, reason: bound.reason });
    }
    if (outcome.plan) tenancy.tenants.setPlan(bound.tenant.id, outcome.plan);
    audit.record({ subject: 'paystack', action: 'billing.bind', resource: `tenant:${bound.tenant.id}`, result: 'allow' });
    return res.status(200).json({ received: true, applied: true, tenant: bound.tenant.id, action: 'bind' });
  }

  const tenant = tenancy.tenants.byExternalRef(outcome.customer);
  if (!tenant) {
    // Acknowledge so Paystack stops retrying an event we cannot map.
    return res.status(200).json({ received: true, applied: false, reason: 'No tenant for that customer' });
  }

  if (outcome.action === 'suspend') {
    tenancy.tenants.setStatus(tenant.id, 'suspended');
  } else if (outcome.plan) {
    tenancy.tenants.setPlan(tenant.id, outcome.plan);
  }

  audit.record({ subject: 'paystack', action: `billing.${outcome.action}`, resource: `tenant:${tenant.id}`, result: 'allow' });
  return res.status(200).json({ received: true, applied: true, tenant: tenant.id, action: outcome.action });
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app };

// Only listen when run directly, so tests can import the app without binding a port.
if (require.main === module) {
/**
 * Apply audit retention.
 *
 * ## One chain, so one window
 *
 * Retention is declared per plan, but the execution ledger is a single hash
 * chain shared by every tenant — `tenant_id` is a column on it, not a separate
 * chain. There is therefore no way to expire one tenant's records and not
 * another's without punching a hole in the middle of the chain, which no anchor
 * can explain.
 *
 * So the instance keeps the LONGEST window any of its tenants is entitled to.
 * A free tenant on an instance that also serves a business tenant keeps their
 * records for a year — they are over-served, never under-served, and erring the
 * other way would delete data somebody paid to keep. `ABSUITE_RETENTION_DAYS`
 * overrides it for a single-tenant deployment that wants its own number.
 *
 * This is a real limitation and it is stated rather than implied: per-tenant
 * retention needs per-tenant chains, and that is a schema change, not a config.
 */
/**
 * Witness the chain head, if anybody on this instance is entitled to it.
 *
 * ## Why the cadence comes from the tenants and not from a setting
 *
 * One hash chain is shared by every tenant, so there is one cadence and it must
 * be the shortest anybody is owed. A business tenant paying for an hour gets an
 * hour even when a team tenant shares the instance. `instanceWitnessInterval`
 * decides that; nothing here re-derives it.
 *
 * ## Why the last receipt is read from storage rather than remembered
 *
 * A process that restarts every deploy and holds the last witnessing in memory
 * would witness on every boot — which is harmless, and would also mean an
 * instance restarting hourly never actually proves it can wait. The stored
 * receipt is the honest record of when somebody outside last saw this chain.
 */
async function sweepWitness(): Promise<void> {
  if (!NOTARY_WITNESS_URL) return;

  try {
    const plans = tenancy.tenants.list(1000).map(t => tenancy.planFor(t));
    const interval = instanceWitnessInterval(plans);
    // Nobody here is entitled to witnessing. Free tenants run their own.
    if (interval < 0) return;

    const last = storage.get<{ witnessed_at: string }>(
      'SELECT witnessed_at FROM notary_receipts ORDER BY id DESC LIMIT 1'
    );

    /*
     * `witnessDue` takes a plan, and the instance cadence is not one tenant's
     * plan — so it is asked about a plan-shaped value carrying the resolved
     * interval. Passing any single tenant's plan here would witness at that
     * tenant's cadence and quietly under-serve everybody paying for more.
     */
    if (!witnessDue({ ...PLANS.business, witnessIntervalHours: interval }, last?.witnessed_at)) return;

    const chainId = NOTARY_CHAIN_ID || `absuite:${signingKey.keyId}`;
    const head = traces.verifyChain(signingKey.publicKeyPem);

    const outcome = await witnessHead(
      NOTARY_WITNESS_URL,
      { chainId, headHash: head.headHash, claimedLength: head.checked },
      {
        /*
         * A notary on a private address is not a disinterested third party —
         * it is on the same network as the thing it is meant to be independent
         * of. Refusing these is a correctness rule here as much as an SSRF one,
         * and metadata endpoints are refused by guardedFetch regardless.
         */
        refuse: ['loopback', 'private', 'link-local', 'carrier-grade-nat', 'unspecified', 'unique-local'],
      }
    );

    if (!outcome.witnessed) {
      console.warn(`[capkit] witnessing skipped: ${outcome.error ?? 'unknown'}`);
      return;
    }

    /*
     * Stored exactly as returned. A receipt is evidence produced by somebody
     * else and re-serialising it is how a signature stops verifying for reasons
     * that have nothing to do with anybody lying.
     */
    storage.run(
      `INSERT INTO notary_receipts (chain_id, head_hash, claimed_length, witnessed_at, notary_url, body)
       VALUES (?, ?, ?, ?, ?, ?)`,
      chainId, head.headHash, head.checked, new Date().toISOString(),
      NOTARY_WITNESS_URL, JSON.stringify(outcome.receipt)
    );

    audit.record({ subject: 'notary', action: 'chain.witnessed', resource: chainId, result: 'allow' });
    console.log(`[capkit] chain head witnessed at ${chainId} (${head.checked} records)`);
  } catch (error) {
    // Same rule as the retention sweep: tidying up must never take the process
    // with it. A missed witnessing is recoverable on the next sweep; a crash
    // loop is not.
    console.error('[capkit] witnessing failed:', error instanceof Error ? error.message : error);
  }
}

function sweepRetention(): void {
  const override = Number(process.env.ABSUITE_RETENTION_DAYS);
  const explicit = Number.isFinite(override) && override !== 0;

  /*
   * A SELF-HOSTED DEPLOYMENT IS NEVER SWEPT, and this is the important rule.
   *
   * Plan retention is a term of a commercial arrangement. Somebody running
   * their own instance under the MIT licence has no such arrangement, so
   * applying the free plan's seven days to them would be enforcing a contract
   * that does not exist — deleting their records to encourage an upgrade they
   * were never offered. That is the one thing this must never do.
   *
   * So the sweep runs only where money is actually in play: a billing provider
   * is configured, or the operator named a window themselves. Everywhere else
   * every record is kept forever, which is what `if (!tenant) return next()` in
   * `enforceQuota` already promises about every other limit.
   */
  const billingConfigured = Boolean(STRIPE_WEBHOOK_SECRET) || Boolean(PAYPAL_WEBHOOK_ID) || Boolean(PAYSTACK_SECRET_KEY);
  if (!explicit && !billingConfigured) return;

  const days = explicit
    ? override
    : tenancy.tenants
        .list(1000)
        .reduce((longest, tenant) => {
          const limit = tenancy.planFor(tenant).limits.auditRetentionDays;
          // -1 is unlimited and wins outright.
          if (longest < 0 || limit < 0) return -1;
          return Math.max(longest, limit);
        }, 0);

  // No tenants yet means no entitlement to reason about, so nothing is removed.
  if (days === 0) return;

  try {
    const result = traces.pruneToRetention({ retentionDays: days });
    if (result.removed > 0) {
      console.log(`[capkit] retention: removed ${result.removed} record(s) older than ${days}d, anchored at seq ${result.anchor?.seq}`);
    }
  } catch (error) {
    // A failed sweep must never take the process with it: the records staying
    // is the safe direction, and an instance that will not boot because it
    // could not tidy up is strictly worse than one holding extra rows.
    console.error('[capkit] retention sweep failed:', error instanceof Error ? error.message : error);
  }
}

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
  // Retention rides the same hour rather than starting a clock of its own: two
  // timers is two things to be wrong about, and neither sweep is urgent to the
  // minute.
  const pruneTimer = setInterval(() => {
    void revocations.prune();
    sweepRetention();
    void sweepWitness();
  }, 3_600_000);
  pruneTimer.unref?.();

  // Also at boot, which is the only sweep a rarely-restarted instance gets and
  // the only one a frequently-restarted one is guaranteed.
  sweepRetention();
  void sweepWitness();

  // Layer 6 begins here rather than on first request. A watch that only runs
  // when somebody opens a page is not watching; it is answering.
  watch.start();
  console.log(`[capkit] watch sweeping every ${Number(process.env.ABSUITE_WATCH_INTERVAL_MS || 60_000)}ms`);

  // A gate that is on must say so, and a gate that is off must say that too.
  // An operator who believes signed approvals are enforced when they are not is
  // in a worse position than one who knows they are not — the belief is the
  // dangerous part, not the setting.
  console.log(
    REQUIRED_APPROVAL_ASSURANCE === 'PROVEN'
      ? '[capkit] approvals must be PROVEN — an unsigned decision reads FAILED on a REQUIRES_APPROVAL record'
      : '[capkit] approvals may be ASSERTED — a decision attributed by name counts, and says so. Set ABSUITE_REQUIRE_SIGNED_APPROVALS=true to require signatures.'
  );

  // Drain in-flight requests before exiting so a deploy does not drop work.
  const shutdown = (signal: string) => {
    console.log(`[capkit] ${signal} received, shutting down`);
    clearInterval(pruneTimer);
    watch.stop();
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

/**
 * Plans, quotas and billing.
 *
 * Plan definitions live in code so quota enforcement works with no billing
 * provider configured at all — a self-hosted deployment stays on the free plan
 * and never talks to Stripe. When Stripe *is* configured, webhooks move a
 * tenant between plans; nothing else in the system needs to know.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type PlanId = 'free' | 'team' | 'business' | 'enterprise';

export interface Plan {
  id: PlanId;
  label: string;
  /** Monthly price in minor units (cents). */
  priceCents: number;
  limits: {
    /** Distinct token subjects per month. -1 means unlimited. */
    agents: number;
    /** Token validations per month. */
    validations: number;
    /** Days of audit history retained. */
    auditRetentionDays: number;
    /** Scheduled jobs allowed concurrently. */
    schedules: number;
    /** Benchmark runs per month. */
    benchmarkRuns: number;
  };
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    priceCents: 0,
    limits: { agents: 3, validations: 10_000, auditRetentionDays: 7, schedules: 5, benchmarkRuns: 100 },
    features: ['Self-hosted', 'All five modules', 'Local audit log'],
  },
  team: {
    id: 'team',
    label: 'Team',
    priceCents: 4900,
    limits: { agents: 25, validations: 500_000, auditRetentionDays: 90, schedules: 50, benchmarkRuns: 2_000 },
    features: ['Shared revocation', '90-day audit retention', 'Email support'],
  },
  business: {
    id: 'business',
    label: 'Business',
    priceCents: 29900,
    limits: { agents: 250, validations: 5_000_000, auditRetentionDays: 365, schedules: 500, benchmarkRuns: 25_000 },
    features: ['SAML SSO', '1-year audit retention', 'Audit export', 'SLA'],
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    priceCents: 0, // negotiated
    limits: { agents: -1, validations: -1, auditRetentionDays: 2555, schedules: -1, benchmarkRuns: -1 },
    features: ['Unlimited', 'On-premise', 'Compliance support', 'Dedicated support'],
  },
};

export function getPlan(id: string): Plan {
  return PLANS[(id as PlanId)] ?? PLANS.free;
}

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

export type QuotaMetric = keyof Plan['limits'];

export interface QuotaVerdict {
  allowed: boolean;
  metric: QuotaMetric;
  limit: number;
  used: number;
  remaining: number;
  /** Fraction of the limit consumed, 0-1. Above 0.8 is worth warning about. */
  utilisation: number;
}

/**
 * Check usage against a plan limit.
 *
 * A limit of -1 means unlimited, which is checked first so an enterprise tenant
 * never divides by a negative and never gets throttled.
 */
export function checkQuota(plan: Plan, metric: QuotaMetric, used: number): QuotaVerdict {
  const limit = plan.limits[metric];

  if (limit < 0) {
    return { allowed: true, metric, limit: -1, used, remaining: -1, utilisation: 0 };
  }

  return {
    allowed: used < limit,
    metric,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    utilisation: limit === 0 ? 1 : Math.min(1, used / limit),
  };
}

/**
 * Verify a Stripe webhook signature.
 *
 * Implemented directly rather than pulling in the Stripe SDK: this is the only
 * part of Stripe that must be trusted, and the check is small enough to audit.
 * The timestamp tolerance stops an intercepted payload being replayed later.
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000)
): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: 'No webhook secret configured' };
  if (!signatureHeader) return { valid: false, reason: 'Missing signature header' };

  const parts = new Map<string, string[]>();
  for (const segment of signatureHeader.split(',')) {
    const [key, value] = segment.split('=');
    if (!key || !value) continue;
    const existing = parts.get(key.trim()) ?? [];
    existing.push(value.trim());
    parts.set(key.trim(), existing);
  }

  const timestamp = Number(parts.get('t')?.[0]);
  const signatures = parts.get('v1') ?? [];

  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'Malformed timestamp' };
  if (signatures.length === 0) return { valid: false, reason: 'No v1 signature present' };
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside tolerance' };
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  // Stripe may send several signatures during a secret rotation; any match wins.
  const matched = signatures.some(candidate => {
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
  });

  return matched ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
}

/** Map a Stripe event onto the plan change it implies. */
export function planFromStripeEvent(event: {
  type?: string;
  data?: { object?: { metadata?: { plan?: string }; status?: string; customer?: string } };
}): { action: 'set-plan' | 'suspend' | 'ignore'; plan?: PlanId; customer?: string } {
  const object = event.data?.object;
  const customer = object?.customer;
  const requested = object?.metadata?.plan ?? '';

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      if (object?.status && ['canceled', 'unpaid', 'incomplete_expired'].includes(object.status)) {
        return { action: 'set-plan', plan: 'free', ...(customer ? { customer } : {}) };
      }
      if (isPlanId(requested)) {
        return { action: 'set-plan', plan: requested, ...(customer ? { customer } : {}) };
      }
      return { action: 'ignore' };
    }

    case 'customer.subscription.deleted':
      // Downgrade rather than delete: the tenant keeps its data on the free plan.
      return { action: 'set-plan', plan: 'free', ...(customer ? { customer } : {}) };

    case 'invoice.payment_failed':
      return { action: 'suspend', ...(customer ? { customer } : {}) };

    default:
      return { action: 'ignore' };
  }
}

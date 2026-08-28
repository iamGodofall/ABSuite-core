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
  /**
   * Burst ceiling, requests per minute. Deliberately outside `limits`, which
   * are monthly counters — this caps rate, not volume, and the two are
   * enforced by different mechanisms.
   */
  rateLimitPerMinute: number;
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
    rateLimitPerMinute: 60,
    label: 'Free',
    priceCents: 0,
    limits: { agents: 3, validations: 10_000, auditRetentionDays: 7, schedules: 5, benchmarkRuns: 100 },
    features: ['Self-hosted', 'All five modules', 'Local audit log'],
  },
  team: {
    id: 'team',
    rateLimitPerMinute: 300,
    label: 'Team',
    priceCents: 4900,
    limits: { agents: 25, validations: 500_000, auditRetentionDays: 90, schedules: 50, benchmarkRuns: 2_000 },
    features: ['Shared revocation', '90-day audit retention', 'Email support'],
  },
  business: {
    id: 'business',
    rateLimitPerMinute: 1200,
    label: 'Business',
    priceCents: 29900,
    limits: { agents: 250, validations: 5_000_000, auditRetentionDays: 365, schedules: 500, benchmarkRuns: 25_000 },
    features: ['SAML SSO', '1-year audit retention', 'Audit export', 'SLA'],
  },
  enterprise: {
    id: 'enterprise',
    rateLimitPerMinute: -1,
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

/**
 * Map a PayPal subscription webhook onto the plan change it implies.
 *
 * Deliberately the same return type as `planFromStripeEvent`. A provider is an
 * adapter onto one entitlement decision, not a second decision — two functions
 * that each move a tenant between plans would drift, and the drift would show
 * up as a customer on the wrong tier rather than as a crash.
 *
 * ## Where the plan id comes from
 *
 * PayPal has no `metadata` on a subscription the way Stripe does. `custom_id`
 * is the field it round-trips for the merchant, so that is where the plan id
 * lives — set when the subscription is created and echoed back on every event.
 * `plan_id` is PayPal's OWN identifier for a billing plan and is deliberately
 * NOT trusted here: it is a value from their catalogue that would have to be
 * mapped by a table kept in step by hand, which is the fabrication this
 * repository exists to refuse. Unrecognised means ignore, never a guess.
 *
 * ## Why `SUSPENDED` suspends but `EXPIRED` downgrades
 *
 * A suspension is a billing problem and is recoverable — the tenant's data
 * stays and access resumes when they pay. An expiry or a cancellation is the
 * end of the arrangement, so the tenant returns to the free plan and keeps
 * their data, exactly as the Stripe path already does. Deleting on cancellation
 * would make an accounting event destructive.
 */
export function planFromPayPalEvent(event: {
  event_type?: string;
  resource?: { custom_id?: string; status?: string; id?: string; subscriber?: { payer_id?: string } };
}): { action: 'set-plan' | 'suspend' | 'ignore'; plan?: PlanId; customer?: string } {
  const resource = event.resource;
  /*
   * The subscription id is the stable handle, not the payer id: one payer may
   * hold several subscriptions, so keying on the payer would let a second
   * purchase overwrite the first one's tier.
   */
  const customer = resource?.id;
  const requested = resource?.custom_id ?? '';

  switch (event.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED':
    case 'BILLING.SUBSCRIPTION.UPDATED':
    case 'BILLING.SUBSCRIPTION.RE-ACTIVATED': {
      if (resource?.status && ['CANCELLED', 'EXPIRED'].includes(resource.status)) {
        return { action: 'set-plan', plan: 'free', ...(customer ? { customer } : {}) };
      }
      if (resource?.status === 'SUSPENDED') {
        return { action: 'suspend', ...(customer ? { customer } : {}) };
      }
      /*
       * ONLY `ACTIVE` GRANTS THE TIER, and the reason is that PayPal has two
       * states which mean "agreed but not yet paying".
       *
       * `SubscriptionStatus` in the official SDK is APPROVAL_PENDING, APPROVED,
       * ACTIVE, SUSPENDED, CANCELLED, EXPIRED. APPROVED means the subscriber
       * accepted at PayPal and billing has NOT started — an approval can still
       * fail at the first charge, and the subscription then goes to CANCELLED
       * without a cent moving. Granting on it hands over the paid tier for free
       * to anyone who begins a checkout and abandons it.
       *
       * An earlier version of this treated any non-terminal status as good
       * enough, because the states were assumed rather than read. Whitelisting
       * the one status that means money has actually moved is the honest rule,
       * and it fails closed: a status this build does not recognise is ignored,
       * never granted.
       */
      if (resource?.status === 'ACTIVE' && isPlanId(requested)) {
        return { action: 'set-plan', plan: requested, ...(customer ? { customer } : {}) };
      }
      return { action: 'ignore' };
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
      return { action: 'set-plan', plan: 'free', ...(customer ? { customer } : {}) };

    case 'BILLING.SUBSCRIPTION.SUSPENDED':
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
      return { action: 'suspend', ...(customer ? { customer } : {}) };

    default:
      return { action: 'ignore' };
  }
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

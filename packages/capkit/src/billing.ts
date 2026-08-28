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

/**
 * Months charged on an annual subscription.
 *
 * Ten, so a year costs two months less than paying monthly. That is the whole
 * offer and it is stated as a MULTIPLIER rather than as a second price per
 * tier, because two independently-typed numbers drift: somebody raises the
 * monthly price, forgets the annual one, and the discount silently becomes 40%
 * on the tier that just got more expensive. Nothing fails, and the loss is
 * invisible until somebody reconciles a year of invoices.
 *
 * Change this one number and every annual price moves with it.
 */
export const ANNUAL_MONTHS_CHARGED = 10;

/** How a subscription is billed. The TIER is the same either way. */
export type BillingTerm = 'monthly' | 'annual';

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

/*
 * THE LADDER, AND WHY EACH RUNG IS WORTH ITS PRICE.
 *
 *   free      IT WORKS. The whole trust layer, MIT, self-hosted, unmetered,
 *             every record kept forever. Not a trial and not crippled — a
 *             single developer securing a single service needs nothing else,
 *             and should not be made to pay for what they can run themselves.
 *
 *   team      IT WORKS ACROSS YOUR SERVICES. Revocation that only takes effect
 *             in one process is not revocation: the moment there are two
 *             services, a killed token is still live in the other one. That is
 *             the first thing you cannot self-host your way out of, and it is
 *             what the tier is actually for.
 *
 *   business  IT SATISFIES SOMEBODY WHO DOES NOT TRUST YOU. A year of history
 *             and an export an auditor verifies holding only a public key,
 *             without running our code. The point at which the records stop
 *             being your reassurance and start being evidence.
 *
 * Written here because a price is a claim about value, and the claim should be
 * legible to the next person choosing what to build. A feature that does not
 * move a customer up this ladder belongs in whichever tier they already have.
 */

/*
 * `features` IS A PROMISE, AND EVERY ENTRY HERE MUST BE SOMETHING THE CODE DOES.
 *
 * Two entries were removed rather than kept as aspirations. 'SAML SSO' appeared
 * nowhere in this repository except this array — no implementation, no route,
 * no test — and 'SLA' is a commitment a person makes rather than a thing the
 * software performs, so it belonged on a sales page and not in a machine-read
 * list of capabilities.
 *
 * Both were being sold at $299 a month. That is the same defect as retention,
 * which was listed here and enforced by nothing until this week — and the
 * reason it is called out rather than quietly fixed is that a pricing table is
 * the one place in this codebase where an unbacked claim takes somebody's
 * money.
 *
 * Add an entry the day its code lands, not the day it is planned.
 */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    rateLimitPerMinute: 60,
    label: 'Free',
    priceCents: 0,
    limits: { agents: 3, validations: 10_000, auditRetentionDays: 7, schedules: 5, benchmarkRuns: 100 },
    features: ['Self-hosted, unlimited', 'Capability tokens and signed records', 'Records kept forever'],
  },
  team: {
    id: 'team',
    rateLimitPerMinute: 300,
    label: 'Team',
    priceCents: 4900,
    limits: { agents: 25, validations: 500_000, auditRetentionDays: 90, schedules: 50, benchmarkRuns: 2_000 },
    features: ['Revocation shared across every service', '90-day audit retention', 'Email support'],
  },
  business: {
    id: 'business',
    rateLimitPerMinute: 1200,
    label: 'Business',
    priceCents: 29900,
    limits: { agents: 250, validations: 5_000_000, auditRetentionDays: 365, schedules: 500, benchmarkRuns: 25_000 },
    features: ['1-year audit retention', 'Independently verifiable audit export', 'Priority support'],
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

/**
 * What a year costs, derived from the month.
 *
 * `priceCents` stays the single authored number. An annual figure stored beside
 * it would be a second source of truth for the same fact.
 */
export function annualPriceCents(plan: Plan): number {
  return plan.priceCents * ANNUAL_MONTHS_CHARGED;
}

/** What an annual subscriber saves against paying monthly, in cents. */
export function annualSavingCents(plan: Plan): number {
  return plan.priceCents * 12 - annualPriceCents(plan);
}

/**
 * The price for one term.
 *
 * Callers ask for a term rather than reaching for `priceCents` directly, so a
 * screen or an invoice cannot accidentally quote the monthly figure against an
 * annual subscription.
 */
export function priceForTerm(plan: Plan, term: BillingTerm): number {
  return term === 'annual' ? annualPriceCents(plan) : plan.priceCents;
}

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

    /*
     * CREATED is named rather than left to `default`, because falling through
     * silently reads as an oversight and this is a decision.
     *
     * A created subscription is APPROVAL_PENDING: it exists, nobody has
     * approved it and nobody has paid. Granting here would be the same fault as
     * granting on APPROVED, one step earlier. ACTIVATED is the event that says
     * money moved, and it always follows.
     */
    case 'BILLING.SUBSCRIPTION.CREATED':
      return { action: 'ignore' };

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

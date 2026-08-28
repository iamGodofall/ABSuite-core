/**
 * PayPal billing plans, derived from `PLANS`.
 *
 * ## The price is written once
 *
 * PayPal keeps its own catalogue: a product, then a billing plan per tier, and
 * a subscription attaches to a plan. So the price exists in two places — in
 * `billing.ts` where quotas are enforced, and in PayPal's catalogue where the
 * card is charged. Typing it into both is how a customer ends up paying $49 for
 * a tier the code believes costs $299, with nothing failing and no error
 * raised.
 *
 * These functions BUILD the PayPal request from `PLANS`, so the number can only
 * be written in one place. A test asserts the generated body's price against
 * `priceCents` directly; changing one without the other fails the build rather
 * than reaching a customer.
 *
 * Nothing here touches the network. The bodies are data; `scripts/paypal-plans.mjs`
 * is what posts them, and it is a tool an operator runs once rather than
 * something the server does.
 */
import { PLANS, type PlanId, type Plan } from './billing';

/** The product every billing plan hangs off. PayPal requires one. */
export const PAYPAL_PRODUCT = {
  id: 'ABSUITE-TRUST-LAYER',
  name: 'ABSuite',
  description: 'The trust layer for autonomous systems — signed, verifiable execution records.',
  type: 'SERVICE',
  category: 'SOFTWARE',
} as const;

/**
 * Cents to the decimal string PayPal wants, by integer arithmetic.
 *
 * `(cents / 100).toFixed(2)` is the obvious version and it routes a monetary
 * value through a binary float, which is the one representation guaranteed
 * unable to hold it. It happens to be right for 4900 and 29900; relying on
 * "happens to be right" for money is how a rounding bug ships and is then
 * impossible to find, because every value anyone tests by hand is fine.
 */
export function centsToAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error(`Not a whole number of cents: ${cents}`);
  }
  const whole = Math.floor(cents / 100);
  const part = cents % 100;
  return `${whole}.${String(part).padStart(2, '0')}`;
}

/**
 * Which plans are actually sold through PayPal.
 *
 * `free` costs nothing, so a billing plan for it would be a subscription that
 * charges zero forever — a live payment agreement standing behind a tier
 * nobody pays for. `enterprise` is negotiated, and `priceCents: 0` there means
 * "not published", not "free"; minting a $0.00 enterprise plan would let anyone
 * who found the plan id subscribe to unlimited everything.
 *
 * Both are excluded by the same rule — a plan is sellable when its price is
 * above zero — rather than by a list naming them, so a fifth tier added later
 * is handled without anybody remembering this file exists.
 */
export function isSellable(plan: Plan): boolean {
  return plan.priceCents > 0;
}

export function sellablePlans(): Plan[] {
  return Object.values(PLANS).filter(isSellable);
}

/**
 * The billing-plan request body for one tier.
 *
 * `custom_id` carries the ABSuite plan id, and that is the whole contract with
 * `planFromPayPalEvent`: it is the field echoed back on every webhook, and the
 * only thing that maps a PayPal subscription onto a tier. PayPal's own
 * `plan_id` is deliberately not used for that — see the note there.
 */
export function billingPlanRequest(plan: Plan, productId: string = PAYPAL_PRODUCT.id) {
  if (!isSellable(plan)) {
    throw new Error(`${plan.id} is not sold through PayPal (priceCents is ${plan.priceCents})`);
  }

  return {
    product_id: productId,
    name: `ABSuite ${plan.label}`,
    description: `${plan.label} — ${plan.features.join(', ')}`,
    status: 'ACTIVE',
    // The plan id travels here so every webhook carries it back.
    custom_id: plan.id,
    billing_cycles: [
      {
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        // Zero means "until cancelled". A finite count would silently expire
        // every subscriber's plan on a date nobody chose.
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: { value: centsToAmount(plan.priceCents), currency_code: 'USD' },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CONTINUE',
      /*
       * Three attempts before PayPal suspends the subscription. It is not a
       * silent setting: a suspension raises BILLING.SUBSCRIPTION.SUSPENDED,
       * which `planFromPayPalEvent` turns into `suspend` — the tenant keeps
       * their tier and their data and loses access until they pay, rather than
       * being downgraded for a card that expired.
       */
      payment_failure_threshold: 3,
    },
  };
}

/** Every plan ABSuite sells, ready to POST. */
export function allBillingPlanRequests(productId: string = PAYPAL_PRODUCT.id) {
  return sellablePlans().map(plan => billingPlanRequest(plan, productId));
}

export type BillingPlanRequest = ReturnType<typeof billingPlanRequest>;
export type { PlanId };

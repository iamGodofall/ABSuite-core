/**
 * Billing plans derived from PLANS.
 *
 * The assertion that earns this file is the one tying the generated price to
 * `priceCents`. Everything else could be checked by reading; a drift between
 * what the code enforces and what PayPal charges cannot, because neither side
 * raises an error — the customer simply pays the wrong amount forever.
 */
import { PLANS } from './billing';
import {
  centsToAmount,
  isSellable,
  sellablePlans,
  billingPlanRequest,
  allBillingPlanRequests,
  PAYPAL_PRODUCT,
} from './paypal-plans';

describe('centsToAmount', () => {
  test('the two real prices', () => {
    expect(centsToAmount(4900)).toBe('49.00');
    expect(centsToAmount(29900)).toBe('299.00');
  });

  test('pads the cents, and does not lose them', () => {
    expect(centsToAmount(5)).toBe('0.05');
    expect(centsToAmount(50)).toBe('0.50');
    expect(centsToAmount(105)).toBe('1.05');
    expect(centsToAmount(1000)).toBe('10.00');
    expect(centsToAmount(0)).toBe('0.00');
  });

  test('a large amount stays exact where a float would not', () => {
    // 1000000.15 has no exact binary representation; integer arithmetic does
    // not care. This is the case `(cents / 100).toFixed(2)` gets wrong.
    expect(centsToAmount(100000015)).toBe('1000000.15');
  });

  test('REFUSAL — fractional or negative cents throw rather than round', () => {
    expect(() => centsToAmount(49.5)).toThrow();
    expect(() => centsToAmount(-100)).toThrow();
  });
});

describe('which plans are sold', () => {
  test('only team and business', () => {
    expect(sellablePlans().map(p => p.id).sort()).toEqual(['business', 'team']);
  });

  test('REFUSAL — free gets no billing plan', () => {
    // A $0.00 plan is a live payment agreement behind a tier nobody pays for.
    expect(isSellable(PLANS.free)).toBe(false);
    expect(() => billingPlanRequest(PLANS.free)).toThrow();
  });

  test('REFUSAL — enterprise gets no billing plan', () => {
    // priceCents 0 there means "negotiated", not "free". A $0.00 enterprise
    // plan would let anyone who found the plan id subscribe to unlimited
    // everything.
    expect(isSellable(PLANS.enterprise)).toBe(false);
    expect(() => billingPlanRequest(PLANS.enterprise)).toThrow();
  });
});

describe('billingPlanRequest', () => {
  test('THE PRICE COMES FROM PLANS — a drift fails here, not at a customer', () => {
    for (const plan of sellablePlans()) {
      const body = billingPlanRequest(plan);
      const charged = body.billing_cycles[0]!.pricing_scheme.fixed_price.value;
      expect(charged).toBe(centsToAmount(plan.priceCents));
      // Stated a second way, against the raw number rather than the helper, so
      // a bug inside centsToAmount cannot make both sides agree wrongly.
      expect(Math.round(parseFloat(charged) * 100)).toBe(plan.priceCents);
    }
  });

  test('custom_id carries the ABSuite plan id — the contract with the mapper', () => {
    // This is the only field mapping a PayPal subscription onto a tier.
    // planFromPayPalEvent reads it and refuses anything it does not recognise.
    for (const plan of sellablePlans()) {
      expect(billingPlanRequest(plan).custom_id).toBe(plan.id);
    }
  });

  test('bills monthly, forever', () => {
    const cycle = billingPlanRequest(PLANS.team).billing_cycles[0]!;
    expect(cycle.frequency).toEqual({ interval_unit: 'MONTH', interval_count: 1 });
    // Zero is "until cancelled". A finite count expires every subscriber on a
    // date nobody chose.
    expect(cycle.total_cycles).toBe(0);
    expect(cycle.tenure_type).toBe('REGULAR');
  });

  test('a failed payment suspends rather than cancelling', () => {
    const prefs = billingPlanRequest(PLANS.business).payment_preferences;
    expect(prefs.payment_failure_threshold).toBe(3);
    expect(prefs.auto_bill_outstanding).toBe(true);
  });

  test('every request names the same product', () => {
    for (const body of allBillingPlanRequests()) {
      expect(body.product_id).toBe(PAYPAL_PRODUCT.id);
    }
  });

  test('a new paid tier is picked up without editing this file', () => {
    // sellablePlans() filters on price rather than naming tiers, so a fifth
    // plan needs no change here — which is the point of the rule.
    expect(allBillingPlanRequests().length).toBe(sellablePlans().length);
    expect(allBillingPlanRequests().every(b => parseFloat(b.billing_cycles[0]!.pricing_scheme.fixed_price.value) > 0)).toBe(true);
  });
});

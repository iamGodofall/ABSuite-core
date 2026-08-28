/**
 * Billing plans derived from PLANS.
 *
 * The assertion that earns this file is the one tying the generated price to
 * `priceCents`. Everything else could be checked by reading; a drift between
 * what the code enforces and what PayPal charges cannot, because neither side
 * raises an error — the customer simply pays the wrong amount forever.
 */
import { PLANS } from './billing';
import { planFromPayPalEvent } from './billing';
import { annualPriceCents, annualSavingCents, priceForTerm, ANNUAL_MONTHS_CHARGED } from './billing';
import {
  annualPitch,
  BILLING_TERMS,
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
    // plan needs no change here — which is the point of the rule. Every tier is
    // offered in every term, so the count is the product of the two.
    expect(allBillingPlanRequests().length).toBe(sellablePlans().length * BILLING_TERMS.length);
    expect(allBillingPlanRequests().every(b => parseFloat(b.billing_cycles[0]!.pricing_scheme.fixed_price.value) > 0)).toBe(true);
  });
});

describe('annual billing', () => {
  test('a year costs ten months, so two are free', () => {
    for (const plan of sellablePlans()) {
      expect(annualPriceCents(plan)).toBe(plan.priceCents * ANNUAL_MONTHS_CHARGED);
      expect(annualSavingCents(plan)).toBe(plan.priceCents * 2);
    }
  });

  test('the real annual prices', () => {
    expect(centsToAmount(annualPriceCents(PLANS.team))).toBe('490.00');
    expect(centsToAmount(annualPriceCents(PLANS.business))).toBe('2990.00');
  });

  test('the annual plan bills YEARLY, at the annual price', () => {
    const cycle = billingPlanRequest(PLANS.business, 'annual').billing_cycles[0]!;
    expect(cycle.frequency).toEqual({ interval_unit: 'YEAR', interval_count: 1 });
    expect(cycle.pricing_scheme.fixed_price.value).toBe('2990.00');
    // Still until-cancelled: a finite count would end the subscription on a
    // date nobody chose, and on an annual plan that is a year of silence
    // followed by a lapse.
    expect(cycle.total_cycles).toBe(0);
  });

  test('REFUSAL — an annual plan never carries the monthly price', () => {
    // The mistake worth guarding: charging $299 for a year of Business.
    for (const plan of sellablePlans()) {
      const annual = billingPlanRequest(plan, 'annual').billing_cycles[0]!.pricing_scheme.fixed_price.value;
      expect(annual).not.toBe(centsToAmount(plan.priceCents));
      expect(parseFloat(annual)).toBeGreaterThan(plan.priceCents / 100);
    }
  });

  test('THE TERM IS NOT IN custom_id — both terms map to the same tier', () => {
    // planFromPayPalEvent refuses any custom_id that is not a known plan id, so
    // encoding the term would break entitlement for every annual subscriber.
    for (const plan of sellablePlans()) {
      for (const term of BILLING_TERMS) {
        expect(billingPlanRequest(plan, term).custom_id).toBe(plan.id);
      }
    }
  });

  test('an annual subscriber gets the same tier through the real mapper', () => {
    // End to end across the two modules, because the contract between them is
    // the only thing that makes an annual payment grant anything at all.
    const annualPlan = billingPlanRequest(PLANS.business, 'annual');
    const verdict = planFromPayPalEvent({
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-ANNUAL', custom_id: annualPlan.custom_id, status: 'ACTIVE' },
    });
    expect(verdict).toEqual({ action: 'set-plan', plan: 'business', customer: 'I-ANNUAL' });
  });

  test('every sellable tier is offered in both terms', () => {
    expect(allBillingPlanRequests().length).toBe(sellablePlans().length * BILLING_TERMS.length);
    const names = allBillingPlanRequests().map(b => b.name);
    expect(new Set(names).size).toBe(names.length); // no two plans share a name
    expect(names).toContain('ABSuite Business (Annual)');
    expect(names).toContain('ABSuite Team (Monthly)');
  });

  test('priceForTerm cannot quote the wrong figure', () => {
    expect(priceForTerm(PLANS.team, 'monthly')).toBe(4900);
    expect(priceForTerm(PLANS.team, 'annual')).toBe(49000);
  });

  test('the annual pitch is arithmetically honest', () => {
    const pitch = annualPitch(PLANS.team);
    expect(pitch.yearly).toBe('490.00');
    // 490/12 = 40.83 a month against 49.00 — the claim a page would make.
    expect(pitch.monthlyEquivalent).toBe('40.83');
    expect(pitch.saving).toBe('98.00');
    // And the saving really is two months.
    expect(parseFloat(pitch.saving)).toBeCloseTo((PLANS.team.priceCents * 2) / 100, 2);
  });
});

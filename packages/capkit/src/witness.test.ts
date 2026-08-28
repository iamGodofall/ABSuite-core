/**
 * Witnessing cadence.
 *
 * The notary is the one thing on the price ladder a fork cannot replicate — its
 * value is being a party with no stake in the answer, which no amount of MIT
 * code confers. So the cadence IS the paid product, and getting it wrong means
 * either witnessing a free tenant for nothing or leaving a paying one
 * unattested. Both are silent.
 */
import { PLANS, witnessDue, rewriteWindowHours } from './billing';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('witnessDue', () => {
  test('REFUSAL — a free tenant is never witnessed by us', () => {
    // They may run their own notary; the code is MIT. What they cannot have is
    // a disinterested one, and pretending otherwise would be the sale.
    expect(witnessDue(PLANS.free, undefined, NOW)).toBe(false);
    expect(witnessDue(PLANS.free, hoursAgo(1000), NOW)).toBe(false);
  });

  test('a never-witnessed paying tenant is due immediately', () => {
    // Somebody who paid today should not wait a day for the first receipt, and
    // the first is the most valuable — everything before it is unattested.
    expect(witnessDue(PLANS.team, undefined, NOW)).toBe(true);
    expect(witnessDue(PLANS.business, undefined, NOW)).toBe(true);
  });

  test('team is daily', () => {
    expect(witnessDue(PLANS.team, hoursAgo(23), NOW)).toBe(false);
    expect(witnessDue(PLANS.team, hoursAgo(24), NOW)).toBe(true);
    expect(witnessDue(PLANS.team, hoursAgo(25), NOW)).toBe(true);
  });

  test('business is hourly', () => {
    expect(witnessDue(PLANS.business, hoursAgo(0.5), NOW)).toBe(false);
    expect(witnessDue(PLANS.business, hoursAgo(1), NOW)).toBe(true);
  });

  test('business is witnessed while team is not — the tiers actually differ', () => {
    // Without this the two cadences could both be daily and every test above
    // would still pass.
    const twoHoursAgo = hoursAgo(2);
    expect(witnessDue(PLANS.business, twoHoursAgo, NOW)).toBe(true);
    expect(witnessDue(PLANS.team, twoHoursAgo, NOW)).toBe(false);
  });

  test('an unreadable timestamp witnesses again rather than skipping', () => {
    // Witnessing costs 32 bytes and a signature. NOT witnessing because a date
    // failed to parse leaves a gap nobody notices until an audit needs it.
    expect(witnessDue(PLANS.business, 'not a date', NOW)).toBe(true);
  });

  test('accepts an ISO string as well as a Date', () => {
    expect(witnessDue(PLANS.team, hoursAgo(30).toISOString(), NOW)).toBe(true);
    expect(witnessDue(PLANS.team, hoursAgo(2).toISOString(), NOW)).toBe(false);
  });
});

describe('rewriteWindowHours — the number a compliance officer asks for', () => {
  test('is the cadence on a witnessed tier', () => {
    expect(rewriteWindowHours(PLANS.business)).toBe(1);
    expect(rewriteWindowHours(PLANS.team)).toBe(24);
  });

  test('is null, not zero, when nobody is witnessing', () => {
    // Zero would read as "cannot be rewritten", which is the opposite of true.
    expect(rewriteWindowHours(PLANS.free)).toBeNull();
  });

  test('paying more buys a strictly smaller window', () => {
    expect(rewriteWindowHours(PLANS.business)!).toBeLessThan(rewriteWindowHours(PLANS.team)!);
  });
});

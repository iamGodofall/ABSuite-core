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

import { instanceWitnessInterval, witnessHead } from './witness';

describe('instanceWitnessInterval — one chain, so one cadence', () => {
  test('takes the SHORTEST any tenant is entitled to', () => {
    // A business tenant paying for an hour must get an hour even when a team
    // tenant shares the instance.
    expect(instanceWitnessInterval([PLANS.team, PLANS.business])).toBe(1);
    expect(instanceWitnessInterval([PLANS.business, PLANS.team])).toBe(1);
  });

  test('the mirror of retention, which takes the LONGEST', () => {
    // Both err toward over-serving. Reversing either silently under-serves
    // somebody who paid.
    expect(instanceWitnessInterval([PLANS.team])).toBe(24);
    expect(instanceWitnessInterval([PLANS.business])).toBe(1);
  });

  test('a free tenant does not drag a paying one down', () => {
    // free is -1 and must be ignored rather than treated as the minimum.
    expect(instanceWitnessInterval([PLANS.free, PLANS.business])).toBe(1);
    expect(instanceWitnessInterval([PLANS.free, PLANS.team])).toBe(24);
  });

  test('-1 when nobody on the instance is witnessed', () => {
    expect(instanceWitnessInterval([PLANS.free])).toBe(-1);
    expect(instanceWitnessInterval([])).toBe(-1);
  });
});

describe('witnessHead', () => {
  test('REFUSAL — an empty chain is not witnessed', async () => {
    // A receipt for the hash of nothing is evidence of nothing that looks like
    // evidence.
    const out = await witnessHead('https://notary.example/witness', { chainId: 'c', headHash: '' });
    expect(out.witnessed).toBe(false);
    expect(out.error).toContain('No chain head');
  });

  test('a notary that cannot be reached is reported, never thrown', async () => {
    // A notary being down must not take down the instance whose evidence it
    // exists to strengthen.
    const out = await witnessHead(
      'https://127.0.0.1:1/witness',
      { chainId: 'c', headHash: 'a'.repeat(64) },
      { refuse: [], timeoutMs: 500 }
    );
    expect(out.witnessed).toBe(false);
    expect(typeof out.error).toBe('string');
  });

  test('REFUSAL — a URL that cannot be parsed does not throw either', async () => {
    const out = await witnessHead('not a url', { chainId: 'c', headHash: 'a'.repeat(64) });
    expect(out.witnessed).toBe(false);
  });
});

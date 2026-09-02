/**
 * The mapper, against a payload Paystack actually produced.
 *
 * Every other test in `paystack.test.ts` uses a fixture this repository wrote,
 * which proves the mapper agrees with its author's idea of Paystack. This one
 * uses `fixtures/paystack-charge.json`, captured from a real transaction on a
 * live test account via `/transaction/verify` — the customer code, the metadata
 * round trip and the status string are Paystack's, not ours.
 *
 * The fields kept are only the ones the mapper reads. Everything else in that
 * response is the payer's, and a test fixture is a bad place for it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planFromPaystackEvent, type PaystackEvent } from './paystack';

const real = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'paystack-charge.json'), 'utf8')
) as NonNullable<PaystackEvent['data']>;

describe('the mapper against a real Paystack payload', () => {
  test('the captured payload is the shape the mapper reads', () => {
    // If Paystack ever moves these, this fails here rather than in production.
    expect(typeof real.customer?.customer_code).toBe('string');
    expect(real.customer?.customer_code).toMatch(/^CUS_/);
    expect(typeof real.metadata).toBe('object');
    expect((real.metadata as { tenant_id?: string }).tenant_id).toBe('ten_TESTBIND001');
    expect((real.metadata as { plan?: string }).plan).toBe('team');
  });

  test('as delivered — a checkout nobody completed grants nothing', () => {
    // Real status from a real abandoned checkout, not a value we invented.
    expect(real.status).toBe('abandoned');
    expect(planFromPaystackEvent({ event: 'charge.success', data: real })).toEqual({ action: 'ignore' });
  });

  test('the same payload, paid, binds the tenant that opened it', () => {
    expect(planFromPaystackEvent({
      event: 'charge.success',
      data: { ...real, status: 'success' },
    })).toEqual({
      action: 'bind',
      customer: 'CUS_h9pkh7z1diewhts',
      tenantId: 'ten_TESTBIND001',
      plan: 'team',
    });
  });

  test('the amount was charged in the currency it was told, unconverted', () => {
    // R899.00 as 89900 minor units. Had the USD catalogue price been passed
    // through, this would read 4900 — the Team plan for a fifteenth of it.
    expect(real.currency).toBe('ZAR');
    expect(real.amount).toBe(89900);
  });
});

import { createHmac } from 'node:crypto';
import { Storage } from './storage';
import { TenantStore } from './tenancy';
import { verifyPaystackSignature, planFromPaystackEvent, type PaystackEvent } from './paystack';

const SECRET = 'sk_test_0123456789abcdef0123456789abcdef01234567';
const sign = (payload: string, secret = SECRET) =>
  createHmac('sha512', secret).update(payload, 'utf8').digest('hex');

describe('paystack signature', () => {
  test('accepts a correctly signed body', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    expect(verifyPaystackSignature(body, sign(body), SECRET).valid).toBe(true);
  });

  test('refuses an unsigned, a wrong and a foreign-key signature', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    expect(verifyPaystackSignature(body, '', SECRET).valid).toBe(false);
    expect(verifyPaystackSignature(body, 'deadbeef', SECRET).valid).toBe(false);
    expect(verifyPaystackSignature(body, sign(body, 'sk_test_someone_else'), SECRET).valid).toBe(false);
  });

  test('refuses when no key is configured, rather than accepting anything', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    expect(verifyPaystackSignature(body, sign(body), '').valid).toBe(false);
  });

  test('a body re-serialised rather than passed raw does not verify', () => {
    // The reason the handler reads req.rawBody. Same object, different bytes.
    const raw = '{"event":"charge.success","data":{"status":"success"}}';
    const reserialised = JSON.stringify(JSON.parse(raw), null, 2);
    expect(verifyPaystackSignature(raw, sign(raw), SECRET).valid).toBe(true);
    expect(verifyPaystackSignature(reserialised, sign(raw), SECRET).valid).toBe(false);
  });

  test('never puts the secret key in the reason it returns', () => {
    const body = '{}';
    const reason = verifyPaystackSignature(body, 'nope', SECRET).reason ?? '';
    expect(reason).not.toContain(SECRET);
    expect(verifyPaystackSignature(body, 'nope', '').reason ?? '').not.toContain(SECRET);
  });
});

describe('paystack events', () => {
  type Meta = NonNullable<PaystackEvent['data']>['metadata'];
  const charge = (metadata: Meta, customer = 'CUS_1'): PaystackEvent => ({
    event: 'charge.success',
    data: { status: 'success', customer: { customer_code: customer }, metadata },
  });

  test('a successful charge binds the customer to the tenant that paid', () => {
    expect(planFromPaystackEvent(charge({ tenant_id: 'ten_abc', plan: 'team' }))).toEqual({
      action: 'bind', customer: 'CUS_1', tenantId: 'ten_abc', plan: 'team',
    });
  });

  test('metadata arriving as a JSON string is read the same way', () => {
    // Hosted payment surfaces send it stringified. Losing this would disable
    // binding for exactly the flow a first customer uses.
    expect(planFromPaystackEvent(charge(JSON.stringify({ tenant_id: 'ten_abc', plan: 'team' })))).toEqual({
      action: 'bind', customer: 'CUS_1', tenantId: 'ten_abc', plan: 'team',
    });
  });

  test('unparseable metadata binds nothing rather than throwing', () => {
    expect(planFromPaystackEvent(charge('{not json'))).toEqual({ action: 'ignore' });
  });

  test('a charge that did not succeed grants nothing', () => {
    expect(planFromPaystackEvent({
      event: 'charge.success',
      data: { status: 'failed', customer: { customer_code: 'CUS_1' }, metadata: { tenant_id: 'ten_abc', plan: 'team' } },
    })).toEqual({ action: 'ignore' });
  });

  test('a charge with no tenant reference binds nothing', () => {
    expect(planFromPaystackEvent(charge({ plan: 'team' })).action).toBe('ignore');
    expect(planFromPaystackEvent(charge({ tenant_id: '  ', plan: 'team' })).action).toBe('ignore');
  });

  test('an unrecognised tier binds without granting one', () => {
    const out = planFromPaystackEvent(charge({ tenant_id: 'ten_abc', plan: 'platinum' }));
    expect(out.action).toBe('bind');
    expect(out.plan).toBeUndefined();
  });

  test("plan_code is never trusted as a tier", () => {
    // Paystack's own catalogue id. Mapping it needs a hand-kept table, and a
    // table that drifts grants the wrong plan silently.
    expect(planFromPaystackEvent({
      event: 'subscription.create',
      data: { customer: { customer_code: 'CUS_1' }, plan: { plan_code: 'PLN_business', name: 'Business' } },
    }).action).toBe('ignore');
  });

  test('a subscription change sets the tier from our own metadata', () => {
    expect(planFromPaystackEvent({
      event: 'subscription.create',
      data: { customer: { customer_code: 'CUS_1' }, metadata: { plan: 'business' } },
    })).toEqual({ action: 'set-plan', plan: 'business', customer: 'CUS_1' });
  });

  test('disable downgrades and keeps the data', () => {
    expect(planFromPaystackEvent({
      event: 'subscription.disable',
      data: { customer: { customer_code: 'CUS_1' } },
    })).toEqual({ action: 'set-plan', plan: 'free', customer: 'CUS_1' });
  });

  test('not_renew changes nothing, because the period is already paid for', () => {
    expect(planFromPaystackEvent({
      event: 'subscription.not_renew',
      data: { customer: { customer_code: 'CUS_1' } },
    })).toEqual({ action: 'ignore' });
  });

  test('a failed invoice suspends rather than downgrading', () => {
    expect(planFromPaystackEvent({
      event: 'invoice.payment_failed',
      data: { customer: { customer_code: 'CUS_1' } },
    })).toEqual({ action: 'suspend', customer: 'CUS_1' });
  });

  test('an unknown event is ignored', () => {
    expect(planFromPaystackEvent({ event: 'transfer.success', data: {} }).action).toBe('ignore');
    expect(planFromPaystackEvent({}).action).toBe('ignore');
  });
});

describe('paystack binding against the real signup shape', () => {
  test('binds a tenant created the way POST /signup creates one', () => {
    const tenants = new TenantStore(new Storage(':memory:'));
    const t = tenants.create('Local Buyer', 'free', 'signup:buyer@example.co.za');

    const outcome = planFromPaystackEvent({
      event: 'charge.success',
      data: {
        status: 'success',
        customer: { customer_code: 'CUS_ZA1' },
        metadata: { tenant_id: t.id, plan: 'team' },
      },
    });
    expect(outcome.action).toBe('bind');

    const bound = tenants.bindExternalRef(outcome.tenantId as string, outcome.customer as string);
    expect(bound.ok).toBe(true);
    expect(tenants.byExternalRef('CUS_ZA1')?.id).toBe(t.id);

    // And a later event for that customer now resolves to the right tenant.
    const later = planFromPaystackEvent({
      event: 'invoice.payment_failed',
      data: { customer: { customer_code: 'CUS_ZA1' } },
    });
    expect(tenants.byExternalRef(later.customer as string)?.id).toBe(t.id);
  });
});

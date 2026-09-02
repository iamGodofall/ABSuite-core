/**
 * PayPal subscription events -> entitlement decisions.
 *
 * The assertions that matter are the refusals. A mapper that returns a plan for
 * everything is trivially "working"; what makes this one safe is that an
 * unrecognised plan id, a PayPal catalogue id, and an unknown event type all
 * come back as `ignore` rather than as a guess.
 */
import { planFromPayPalEvent, planFromStripeEvent, readPayPalCustomId, PLANS } from './billing';
import { Storage } from './storage';
import { TenantStore } from './tenancy';

const sub = (over: Record<string, unknown> = {}) => ({
  event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
  resource: { id: 'I-SUB123', custom_id: 'business', status: 'ACTIVE', ...over },
});

describe('planFromPayPalEvent', () => {
  test('an activation sets the plan named in custom_id', () => {
    expect(planFromPayPalEvent(sub())).toEqual({
      action: 'set-plan', plan: 'business', customer: 'I-SUB123',
    });
  });

  test('keys the customer on the SUBSCRIPTION id, not the payer', () => {
    // One payer may hold several subscriptions; keying on payer_id would let a
    // second purchase silently overwrite the first one's tier.
    const verdict = planFromPayPalEvent(sub({ subscriber: { payer_id: 'PAYER-9' } }));
    expect(verdict.customer).toBe('I-SUB123');
    expect(verdict.customer).not.toBe('PAYER-9');
  });

  test('REFUSAL — an unrecognised custom_id is ignored, never guessed', () => {
    expect(planFromPayPalEvent(sub({ custom_id: 'platinum' })).action).toBe('ignore');
    expect(planFromPayPalEvent(sub({ custom_id: '' })).action).toBe('ignore');
    expect(planFromPayPalEvent(sub({ custom_id: undefined })).action).toBe('ignore');
  });

  test("REFUSAL — PayPal's own plan_id is never mapped to a tier", () => {
    // P-5ML... is a PayPal catalogue id. Honouring it would need a hand-kept
    // lookup table, which is the class of fabrication this repo refuses.
    const verdict = planFromPayPalEvent({
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      resource: { id: 'I-SUB123', status: 'ACTIVE' },
    } as Parameters<typeof planFromPayPalEvent>[0]);
    expect(verdict.action).toBe('ignore');
  });

  test('REFUSAL — an unknown event type is ignored', () => {
    expect(planFromPayPalEvent({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }).action).toBe('ignore');
    expect(planFromPayPalEvent({}).action).toBe('ignore');
  });

  test('REFUSAL — APPROVED does not grant the tier, because nobody has paid', () => {
    // PayPal's own SubscriptionStatus: APPROVAL_PENDING, APPROVED, ACTIVE,
    // SUSPENDED, CANCELLED, EXPIRED. The first two mean the subscriber agreed
    // and billing has not started — an approval can still fail at the first
    // charge. Granting here hands the paid tier to anyone who starts a checkout
    // and walks away.
    expect(planFromPayPalEvent(sub({ status: 'APPROVED' })).action).toBe('ignore');
    expect(planFromPayPalEvent(sub({ status: 'APPROVAL_PENDING' })).action).toBe('ignore');
  });

  test('REFUSAL — an unrecognised status fails closed', () => {
    expect(planFromPayPalEvent(sub({ status: 'SOMETHING_NEW' })).action).toBe('ignore');
    expect(planFromPayPalEvent(sub({ status: undefined })).action).toBe('ignore');
  });

  test('REFUSAL — CREATED grants nothing; it is APPROVAL_PENDING', () => {
    // Registered on the live sandbox webhook, so it WILL arrive. A created
    // subscription exists, is unapproved and is unpaid — granting here is the
    // APPROVED fault one step earlier. ACTIVATED always follows.
    expect(planFromPayPalEvent({ ...sub(), event_type: 'BILLING.SUBSCRIPTION.CREATED' }).action)
      .toBe('ignore');
  });

  test('every event registered on the real webhook is handled deliberately', () => {
    // Taken from the sandbox webhook's own "Events Tracked" column, so this
    // list is PayPal's rather than mine. None may throw, and none may grant a
    // tier except on an ACTIVE status.
    const registered = [
      'BILLING.SUBSCRIPTION.ACTIVATED',
      'BILLING.SUBSCRIPTION.CANCELLED',
      'BILLING.SUBSCRIPTION.CREATED',
      'BILLING.SUBSCRIPTION.EXPIRED',
      'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      'BILLING.SUBSCRIPTION.RE-ACTIVATED',
      'BILLING.SUBSCRIPTION.SUSPENDED',
      'BILLING.SUBSCRIPTION.UPDATED',
    ];
    for (const event_type of registered) {
      const verdict = planFromPayPalEvent({ ...sub({ status: 'APPROVAL_PENDING' }), event_type });
      expect(['set-plan', 'suspend', 'ignore']).toContain(verdict.action);
      // Nothing unpaid may reach a paid tier.
      expect(verdict.plan === 'team' || verdict.plan === 'business').toBe(false);
    }
  });

  test('a cancellation DOWNGRADES rather than deleting', () => {
    expect(planFromPayPalEvent({ ...sub(), event_type: 'BILLING.SUBSCRIPTION.CANCELLED' })).toEqual({
      action: 'set-plan', plan: 'free', customer: 'I-SUB123',
    });
  });

  test('an expiry downgrades to free', () => {
    expect(planFromPayPalEvent({ ...sub(), event_type: 'BILLING.SUBSCRIPTION.EXPIRED' }).plan).toBe('free');
  });

  test('a suspension suspends and does NOT change the plan', () => {
    const verdict = planFromPayPalEvent({ ...sub(), event_type: 'BILLING.SUBSCRIPTION.SUSPENDED' });
    expect(verdict.action).toBe('suspend');
    // A billing problem is recoverable. Downgrading here would lose the tier
    // they are still paying to hold once the payment clears.
    expect(verdict.plan).toBeUndefined();
  });

  test('a failed payment suspends', () => {
    expect(planFromPayPalEvent({ ...sub(), event_type: 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' }).action)
      .toBe('suspend');
  });

  test('a status of CANCELLED on an UPDATED event downgrades', () => {
    const verdict = planFromPayPalEvent(sub({ status: 'CANCELLED' }));
    expect(verdict).toEqual({ action: 'set-plan', plan: 'free', customer: 'I-SUB123' });
  });

  test('every real plan id round-trips through custom_id', () => {
    for (const id of Object.keys(PLANS)) {
      expect(planFromPayPalEvent(sub({ custom_id: id, status: 'ACTIVE' })).plan).toBe(id);
    }
  });

  test('both providers answer in the same shape, so one path can consume them', () => {
    const paypal = planFromPayPalEvent(sub());
    const stripe = planFromStripeEvent({
      type: 'customer.subscription.created',
      data: { object: { metadata: { plan: 'business' }, status: 'active', customer: 'cus_1' } },
    });
    expect(Object.keys(paypal).sort()).toEqual(Object.keys(stripe).sort());
    expect(paypal.plan).toBe(stripe.plan);
  });
});

describe('paypal binds the tenant that opened the checkout', () => {
  test('custom_id carrying a tenant binds and sets the tier', () => {
    expect(planFromPayPalEvent(sub({ custom_id: 'ten_abc:business' }))).toEqual({
      action: 'bind', customer: 'I-SUB123', tenantId: 'ten_abc', plan: 'business',
    });
  });

  test('a plan-only custom_id keeps working exactly as it did', () => {
    // Every subscription created before binding existed carries this shape.
    expect(planFromPayPalEvent(sub({ custom_id: 'business' }))).toEqual({
      action: 'set-plan', plan: 'business', customer: 'I-SUB123',
    });
  });

  test('a tenant with an unrecognised tier binds without granting one', () => {
    const out = planFromPayPalEvent(sub({ custom_id: 'ten_abc:platinum' }));
    expect(out.action).toBe('bind');
    expect(out.plan).toBeUndefined();
    expect(out.tenantId).toBe('ten_abc');
  });

  test('a subscription that is not ACTIVE binds nothing', () => {
    // APPROVED means agreed and not yet paying. Binding there would hand the
    // tier to anyone who begins a checkout and abandons it.
    expect(planFromPayPalEvent(sub({ custom_id: 'ten_abc:business', status: 'APPROVED' })).action).toBe('ignore');
    expect(planFromPayPalEvent(sub({ custom_id: 'ten_abc:business', status: 'SUSPENDED' })).action).toBe('suspend');
  });

  test('readPayPalCustomId splits on the first colon only', () => {
    expect(readPayPalCustomId('ten_abc:business')).toEqual({ tenantId: 'ten_abc', plan: 'business' });
    expect(readPayPalCustomId('business')).toEqual({ tenantId: '', plan: 'business' });
    expect(readPayPalCustomId('  ten_abc : team ')).toEqual({ tenantId: 'ten_abc', plan: 'team' });
    expect(readPayPalCustomId(undefined)).toEqual({ tenantId: '', plan: '' });
  });

  test('binds a tenant created the way POST /signup creates one', () => {
    const tenants = new TenantStore(new Storage(':memory:'));
    const t = tenants.create('Acme', 'free', 'signup:acme@example.com');

    const outcome = planFromPayPalEvent(sub({ custom_id: `${t.id}:team` }));
    expect(outcome.action).toBe('bind');

    const bound = tenants.bindExternalRef(outcome.tenantId as string, outcome.customer as string);
    expect(bound.ok).toBe(true);
    expect(tenants.byExternalRef('I-SUB123')?.id).toBe(t.id);

    // A second subscription cannot steal the tenant.
    const other = planFromPayPalEvent(sub({ id: 'I-SUB999', custom_id: `${t.id}:business` }));
    expect(tenants.bindExternalRef(other.tenantId as string, other.customer as string).ok).toBe(false);
    expect(tenants.get(t.id)?.externalRef).toBe('I-SUB123');
  });
});

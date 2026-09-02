/**
 * Paystack, the third processor — and the first one that settles locally.
 *
 * ## Why a third one at all
 *
 * Stripe and PayPal are already here and neither is a good answer for the
 * market this is being sold into first. Stripe does not onboard South African
 * businesses for payouts; PayPal does, through a Singapore entity, in USD, with
 * a conversion at the end. Paystack takes ZAR, NGN, GHS and KES cards and
 * settles into a local bank account in the local currency, which is the
 * difference between a customer in Johannesburg or Lagos being able to pay with
 * the card in their pocket and being asked to have a PayPal account.
 *
 * ## THE SHAPES BELOW ARE FROM PAYSTACK'S PUBLISHED WEBHOOK DOCUMENTATION AND
 * ## HAVE NOT BEEN SEEN FROM A LIVE ACCOUNT.
 *
 * Every other verification path in this package was written against something
 * that could be exercised. This one could not be, from where it was written, so
 * it is stated rather than implied: the signature algorithm, the event names
 * and the field paths are what Paystack documents, and the first live delivery
 * is the thing that confirms them. Treat this as Near rather than Built until a
 * real event has been through it, and read `/billing/paystack/webhook`'s
 * response — which names what it did — rather than assuming silence is success.
 *
 * It fails closed in the meantime. An event whose shape does not match is
 * ignored, never guessed at, so the failure mode of being wrong here is that
 * nothing happens rather than that the wrong tenant is upgraded.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isPlanId, type PlanId } from './billing';

/**
 * Verify a Paystack webhook.
 *
 * ## The credential here is the SECRET KEY, and that is unusual
 *
 * Stripe issues a webhook signing secret that is distinct from the API key, so
 * a leaked verifier cannot spend money. Paystack signs with `sk_live_…` — the
 * same credential that authorises charges and transfers. There is no separate
 * webhook secret to use instead.
 *
 * Two consequences, and neither is optional. It must never be written to a log,
 * an error message or an audit record, which is why nothing below ever puts it
 * in the returned `reason`. And it belongs in a secret store rather than an env
 * file committed anywhere, on the same footing as a database password.
 *
 * ## SHA-512, over the RAW body
 *
 * Paystack hashes the exact bytes it sent. A body that has been parsed and
 * re-serialised will not match — key order, whitespace and number formatting
 * all move — so the caller passes `req.rawBody`, captured by the `verify` hook
 * on the JSON parser, and never `JSON.stringify(req.body)`.
 */
export function verifyPaystackSignature(
  payload: string,
  signatureHeader: string,
  secretKey: string
): { valid: boolean; reason?: string } {
  if (!secretKey) return { valid: false, reason: 'No Paystack secret key configured' };
  if (!signatureHeader) return { valid: false, reason: 'Missing signature header' };

  const expected = createHmac('sha512', secretKey).update(payload, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8');

  // Compared for length first because timingSafeEqual throws on a mismatch, and
  // a thrown verifier is an unverified request that reached the handler.
  if (a.length !== b.length) return { valid: false, reason: 'Signature mismatch' };
  if (!timingSafeEqual(a, b)) return { valid: false, reason: 'Signature mismatch' };

  return { valid: true };
}

export interface PaystackEvent {
  event?: string;
  data?: {
    status?: string;
    customer?: { customer_code?: string };
    plan?: { plan_code?: string; name?: string };
    subscription_code?: string;
    metadata?: { tenant_id?: string; plan?: string } | string;
  };
}

/**
 * Read the metadata Paystack echoes back.
 *
 * It arrives as an object from the API and as a JSON STRING from some of the
 * hosted payment surfaces, which is a difference nothing warns about and which
 * would silently disable binding for exactly the flow a first customer uses. A
 * string that will not parse is treated as absent rather than thrown, because a
 * malformed metadata field is a reason to bind nothing, not a reason to reject
 * a payment that has already happened.
 */
function readMetadata(raw: PaystackEvent['data']): { tenantId: string; plan: string } {
  let value: { tenant_id?: string; plan?: string } | undefined;

  if (typeof raw?.metadata === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw.metadata);
      if (parsed && typeof parsed === 'object') value = parsed as { tenant_id?: string; plan?: string };
    } catch {
      value = undefined;
    }
  } else {
    value = raw?.metadata;
  }

  return {
    tenantId: String(value?.tenant_id ?? '').trim(),
    plan: String(value?.plan ?? '').trim(),
  };
}

/**
 * Map a Paystack event onto the account change it implies.
 *
 * ## `customer_code` is the handle, and this DIFFERS from the PayPal path
 *
 * PayPal keys on the subscription id, because one payer there may hold several
 * subscriptions and keying on the payer would let a second purchase overwrite
 * the first one's tier. Paystack is keyed on `customer_code` instead, for a
 * reason worth stating rather than leaving as an inconsistency: it is the only
 * identifier present on ALL of the events that matter here — the successful
 * charge that carries our metadata, the subscription lifecycle events, and the
 * failed invoice. `subscription_code` is absent from the first of those, which
 * is the one binding depends on.
 *
 * The cost of that choice is that a customer who buys twice binds once. That is
 * correct for what is being sold: a tenant is an organisation account holding
 * one plan, not a basket.
 *
 * ## `plan_code` IS NOT TRUSTED, exactly as `plan_id` is not on the PayPal path
 *
 * `PLN_…` is Paystack's own catalogue identifier. Mapping it onto a tier needs
 * a table kept in step by hand, and a table that drifts grants the wrong plan
 * silently. The tier comes from metadata this service set itself, or it does
 * not come at all.
 */
export function planFromPaystackEvent(event: PaystackEvent): {
  action: 'set-plan' | 'suspend' | 'bind' | 'ignore';
  plan?: PlanId;
  customer?: string;
  tenantId?: string;
} {
  const data = event.data;
  const customer = data?.customer?.customer_code;
  const { tenantId, plan: requested } = readMetadata(data);

  switch (event.event) {
    /*
     * The binding moment, and the only event carrying both identifiers: the
     * customer Paystack has just created and the tenant that opened the
     * checkout, echoed back in metadata.
     *
     * Gated on `status === 'success'` even though the event is named for it.
     * The name is a claim about the event; the field is a claim about the
     * money, and only the second one is worth granting a tier on.
     */
    case 'charge.success': {
      if (data?.status && data.status !== 'success') return { action: 'ignore' };
      if (!customer || !tenantId) return { action: 'ignore' };
      return {
        action: 'bind',
        customer,
        tenantId,
        ...(isPlanId(requested) ? { plan: requested } : {}),
      };
    }

    /*
     * A subscription that already exists changing tier. Binding does not happen
     * here — by this point the charge that created it has already bound, and an
     * event without metadata would otherwise read as a tenant with no plan.
     */
    case 'subscription.create':
      if (!customer || !isPlanId(requested)) return { action: 'ignore' };
      return { action: 'set-plan', plan: requested, customer };

    /*
     * `disable` is the end of the arrangement: back to free, data kept, exactly
     * as both other processors do.
     */
    case 'subscription.disable':
      return { action: 'set-plan', plan: 'free', ...(customer ? { customer } : {}) };

    /*
     * `not_renew` IS NOT AN ENDING and must not downgrade.
     *
     * It says the subscription will not renew at the end of the period it has
     * already been paid for. Acting on it takes away access the customer bought
     * and has not yet used up, days or weeks early, and `subscription.disable`
     * arrives at the actual end to do the job properly.
     */
    case 'subscription.not_renew':
      return { action: 'ignore' };

    /*
     * A failed charge suspends rather than downgrades: it is recoverable, the
     * data stays, and access resumes when they pay. Same rule as the other two.
     */
    case 'invoice.payment_failed':
      return { action: 'suspend', ...(customer ? { customer } : {}) };

    default:
      return { action: 'ignore' };
  }
}

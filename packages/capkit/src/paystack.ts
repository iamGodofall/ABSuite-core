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
 * ## WHAT HAS BEEN SEEN FROM A LIVE ACCOUNT, AND WHAT HAS NOT
 *
 * This was first written against Paystack's documentation alone, and said so.
 * A test-mode key then made most of it checkable, so the claim is narrowed
 * rather than left where it was.
 *
 * VERIFIED against a real transaction on a live test account: metadata sent to
 * `/transaction/initialize` comes back as an OBJECT carrying exactly the keys
 * it was given; the customer identifier lives at `data.customer.customer_code`
 * (`CUS_…`); `data.status` is the string this gates on, and reads `abandoned`
 * for a checkout nobody completed — so the gate refuses one, which is the
 * behaviour that matters; and an amount is charged in the currency it is told,
 * unconverted. `paystack.fixture.test.ts` pins that captured payload.
 *
 * STILL UNVERIFIED, because it needs a public URL Paystack can reach: the
 * webhook ENVELOPE — that a delivery wraps that same `data` as
 * `{ event, data }` — and the HMAC-SHA512 signature over the raw body. Those
 * are documented and consistent with what was seen, which is an argument
 * rather than evidence. The first real delivery settles them.
 *
 * It fails closed in the meantime. An event whose shape does not match is
 * ignored, never guessed at, so the failure mode of being wrong here is that
 * nothing happens rather than that the wrong tenant is upgraded.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isPlanId, PLANS, type PlanId } from './billing';
import { guardedFetch } from './guarded-fetch';
import { type AddressRange } from './outbound';

/** The one host this ever talks to. Every hop is checked against it. */
export const PAYSTACK_API_HOST = 'api.paystack.co';

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
    /** Present on a charge. Read by nothing here — kept so a captured payload types. */
    currency?: string;
    amount?: number;
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

/**
 * Open a checkout, which is the half that makes the binding above possible.
 *
 * ## WITHOUT THIS, NOTHING SETS THE METADATA THE WEBHOOK READS
 *
 * `planFromPaystackEvent` binds on `metadata.tenant_id`, and metadata is set
 * when a transaction is INITIALISED — not by the hosted payment page, which has
 * no idea which tenant is looking at it. A webhook handler with nothing
 * creating its events is the same fault this whole path was written to fix, one
 * step earlier, so the two ship together.
 *
 * ## The amount is never converted, and that is the important rule here
 *
 * `PLANS` holds prices in US cents. Paystack takes the smallest unit of
 * whatever currency it is told, so handing 4900 to a ZAR charge bills R49
 * instead of $49 — the Team plan for about a fifteenth of its price, silently,
 * on every sale. There is no exchange rate in this repository and inventing one
 * would be a fabrication of exactly the kind the plan-code rule refuses.
 *
 * So: USD uses the catalogue price. Any other currency REQUIRES an explicit
 * amount from the caller, in that currency's smallest unit, and is refused
 * without one. An operator selling in rands states the rand price.
 */
export async function initialisePaystackCheckout(options: {
  secretKey: string;
  email: string;
  tenantId: string;
  plan: PlanId;
  /** Smallest unit of `currency`. Required for anything but USD. */
  amount?: number;
  currency?: string;
  callbackUrl?: string;
  refuse: AddressRange[];
  timeoutMs?: number;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const currency = (options.currency ?? 'USD').toUpperCase();
  const catalogue = PLANS[options.plan];

  if (!catalogue) throw new Error(`Unknown plan: ${options.plan}`);
  if (catalogue.priceCents <= 0) {
    throw new Error(`${options.plan} is not a plan anyone pays for; there is nothing to charge.`);
  }

  const amount = options.amount ?? (currency === 'USD' ? catalogue.priceCents : undefined);
  if (amount === undefined) {
    throw new Error(
      `Refusing to charge in ${currency} without an explicit amount. The catalogue price is in US ` +
      `cents and this repository holds no exchange rate, so converting it would be a guess. Pass ` +
      `the ${currency} price in its smallest unit.`
    );
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amount must be a positive whole number of the currency\'s smallest unit');
  }

  const response = await guardedFetch(
    `https://${PAYSTACK_API_HOST}/transaction/initialize`,
    {
      method: 'POST',
      headers: {
        // Paystack's secret key. Never logged, never echoed to a caller.
        authorization: `Bearer ${options.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: options.email,
        amount,
        currency,
        ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
        /*
         * The whole point. `tenant_id` is what charge.success carries back and
         * what the binding reads; `plan` is the tier, stated by us rather than
         * read from Paystack's own catalogue.
         */
        metadata: { tenant_id: options.tenantId, plan: options.plan },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    },
    { refuse: options.refuse, only: [PAYSTACK_API_HOST], verb: 'open a checkout with' }
  );

  const body = (await response.json().catch(() => null)) as
    | { status?: boolean; message?: string; data?: { authorization_url?: string; reference?: string } }
    | null;

  if (!response.ok || body?.status !== true || !body?.data?.authorization_url) {
    /*
     * Paystack's own message, and nothing of ours. A failure here is most often
     * a key for the wrong mode or a currency the account cannot accept, and
     * both are things the operator has to read to fix.
     */
    throw new Error(`Paystack refused the checkout: ${body?.message ?? `HTTP ${response.status}`}`);
  }

  return {
    authorizationUrl: body.data.authorization_url,
    reference: String(body.data.reference ?? ''),
  };
}

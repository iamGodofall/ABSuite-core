/**
 * PayPal webhook signature verification.
 *
 * ## Why this is local rather than a call to PayPal
 *
 * PayPal offers two ways to verify: POST the event back to
 * `/v1/notifications/verify-webhook-signature` and let them decide, or check
 * the signature yourself. Their own documentation calls the local check the
 * preferred method, and it is the right one here for a reason beyond latency:
 * the callback makes every inbound webhook depend on an outbound request, so a
 * PayPal API outage stops entitlements moving even though the events are
 * arriving and are perfectly valid. Verification that fails when the network
 * does is a availability problem wearing a security feature.
 *
 * ## Nothing in this file touches the network
 *
 * The certificate arrives as a parameter. Fetching it is the caller's job,
 * which keeps every function here pure and testable against known vectors, and
 * keeps `fetch` out of a module whose whole purpose is to decide whether to
 * trust something. `isPayPalCertUrl` is exported so the caller can refuse a
 * hostile URL BEFORE making that request — see its own note, because that is
 * the sharpest edge in the whole flow.
 */
import { createVerify, X509Certificate } from 'node:crypto';
import { crc32 } from 'node:zlib';

/** Headers PayPal sends alongside a webhook. Lower-cased, as Node delivers them. */
export interface PayPalWebhookHeaders {
  'paypal-transmission-id'?: string;
  'paypal-transmission-time'?: string;
  'paypal-transmission-sig'?: string;
  'paypal-cert-url'?: string;
  'paypal-auth-algo'?: string;
}

/**
 * The string PayPal signed.
 *
 * `transmissionId|transmissionTime|webhookId|crc32(body)` — and the body is the
 * RAW bytes as received. Parsing the JSON and re-serialising it changes key
 * order and whitespace, which changes the checksum, which fails every
 * signature. That is the single most common way this integration is got wrong,
 * so the parameter is typed as a string or Buffer and never as an object.
 *
 * `webhookId` is the id of the webhook YOU created in PayPal's dashboard. It is
 * not in the request; it is the shared fact that stops a valid signature for
 * somebody else's webhook being replayed at yours.
 */
export function payPalSignatureBase(
  headers: PayPalWebhookHeaders,
  webhookId: string,
  rawBody: string | Buffer
): string {
  const id = headers['paypal-transmission-id'] ?? '';
  const time = headers['paypal-transmission-time'] ?? '';
  // crc32 returns a signed 32-bit value in some runtimes; `>>> 0` makes it the
  // unsigned decimal PayPal expects.
  const checksum = crc32(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody) >>> 0;
  return `${id}|${time}|${webhookId}|${checksum}`;
}

/**
 * Is this a URL we are willing to fetch a signing certificate from?
 *
 * THE CERT URL COMES FROM A HEADER, WHICH MEANS IT COMES FROM WHOEVER SENT THE
 * REQUEST. An attacker posts a forged event, points `paypal-cert-url` at a
 * certificate they generated, signs their payload with the matching private
 * key, and every cryptographic check passes perfectly — because it is being
 * asked "is this signed by the key in that file?" rather than "is this signed
 * by PayPal?". The signature is not what establishes trust here; the HOST is.
 *
 * It is also an SSRF: an unvalidated fetch of an attacker-chosen URL from
 * inside the network is exactly the fault `check-outbound-guard.mjs` was
 * written after finding four times.
 *
 * So: https only, and the host must be `paypal.com` or a subdomain of it.
 * `endsWith('.paypal.com')` is checked against the parsed hostname rather than
 * the raw string, because `https://paypal.com.evil.com/x` and
 * `https://evil.com/?a=paypal.com` both contain the text and neither is PayPal.
 */
export function isPayPalCertUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'paypal.com' || host.endsWith('.paypal.com');
}

export interface PayPalVerdict {
  valid: boolean;
  /** Why it failed. Absent when valid. */
  reason?: string;
}

/**
 * Verify a webhook against the certificate PayPal signed it with.
 *
 * `certPem` is the PEM the caller fetched from `paypal-cert-url` — AFTER
 * `isPayPalCertUrl` said yes about that URL. This function cannot check where
 * the certificate came from, so it does not pretend to: a valid result here
 * means "signed by the key in this certificate", and only the host check makes
 * that mean "signed by PayPal".
 *
 * Fails closed on everything: a missing header, an unreadable certificate, an
 * algorithm we do not recognise. There is no path that returns valid on an
 * absence.
 */
export function verifyPayPalWebhook(
  rawBody: string | Buffer,
  headers: PayPalWebhookHeaders,
  webhookId: string,
  certPem: string
): PayPalVerdict {
  if (!webhookId) return { valid: false, reason: 'No webhook id configured' };

  const signature = headers['paypal-transmission-sig'];
  if (!signature) return { valid: false, reason: 'Missing paypal-transmission-sig' };
  if (!headers['paypal-transmission-id']) return { valid: false, reason: 'Missing paypal-transmission-id' };
  if (!headers['paypal-transmission-time']) return { valid: false, reason: 'Missing paypal-transmission-time' };

  /*
   * The algorithm is named in a header, and a header is not a decision. Taking
   * it as the algorithm to verify with would let a caller name a weak one —
   * the same shape as JWT's `alg: none`. PayPal signs with SHA256withRSA, so
   * anything else is refused rather than honoured.
   */
  const algo = (headers['paypal-auth-algo'] ?? 'SHA256withRSA').toUpperCase();
  if (algo !== 'SHA256WITHRSA') {
    return { valid: false, reason: `Unsupported signature algorithm: ${headers['paypal-auth-algo']}` };
  }

  let publicKey;
  try {
    publicKey = new X509Certificate(certPem).publicKey;
  } catch {
    return { valid: false, reason: 'Certificate could not be read' };
  }

  const base = payPalSignatureBase(headers, webhookId, rawBody);

  try {
    const verifier = createVerify('sha256');
    verifier.update(base, 'utf8');
    verifier.end();
    return verifier.verify(publicKey, signature, 'base64')
      ? { valid: true }
      : { valid: false, reason: 'Signature does not match' };
  } catch {
    // A malformed base64 signature throws rather than returning false.
    return { valid: false, reason: 'Signature could not be checked' };
  }
}

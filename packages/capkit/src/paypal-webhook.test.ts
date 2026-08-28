/**
 * PayPal webhook signature verification.
 *
 * Signatures here are REAL: a keypair is generated, the signature base is built
 * by the module under test, and the payload is signed with node crypto. A test
 * that stubs the verifier proves only that the stub was called.
 *
 * The assertions that matter are the refusals, and one of them is not about
 * cryptography at all. `isPayPalCertUrl` is the only thing standing between a
 * forged event and a perfect signature check: an attacker who chooses the
 * certificate can satisfy every cryptographic assertion in this file.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import {
  payPalSignatureBase,
  isPayPalCertUrl,
  verifyPayPalWebhook,
  type PayPalWebhookHeaders,
} from './paypal-webhook';

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDFTCCAf2gAwIBAgIUD8OxVuLL0JeaaagINsFyLfKrpIEwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPdGVzdC5wYXlwYWwuY29tMB4XDTI2MDgyODEwMzMyNFoX
DTM2MDgyNTEwMzMyNFowGjEYMBYGA1UEAwwPdGVzdC5wYXlwYWwuY29tMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoSr/oePZWQQcsCM4rMAJlefUTxb2
0RMCWZQOCFgF0GR2/Hd/GKyTYBtuAd/vQNmDGpzIADJt0fQ5teuzXoBXweSu7dpb
i3doU/6VA6QlL97TOL7dW4I+Q4xSwstON7NWepp+5wQxZ0XR1dIQsKJh69Ri6LAE
6B51JMMNcAgSYa4fv1FLqjUj4pHdpvWjfTiMfyUnM9mm1iwRnEpBRxrMidrXLTLJ
1z+ZwmSj5XEQGY19pAAid/HI5W8HdcH/f2Lkn2tKbyy0XVoZp9wUQC0cwxEWKft0
hkqDJui9tKeP6tAFXhb2TtNYxKmC6/etwqebQTfQHfxeQ1JtsAErxDv+cQIDAQAB
o1MwUTAdBgNVHQ4EFgQUPzS6dbJeIrzTaWRphmDgLFJCdN0wHwYDVR0jBBgwFoAU
PzS6dbJeIrzTaWRphmDgLFJCdN0wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0B
AQsFAAOCAQEAGtMRoRoAOgr+Rf02FzgkFpaBQIMy1A63Ei/MI4DcJeZqlOvygaG5
ZotrWRVGrBeevGEZkmtwq4exJP9XIH8WHYCr3wWZ+S0/DrS24YyGQDUEaDQ8L5c9
cnd56qj5hhWxSainQpWrFtNuW/NqDCC85rr8qCv/K8I7Ypk3SlLDy07z1A3rOv92
DCI1DLzYZ2NLyslMcgaZdcLY//8avSGsNxgdfkcRFY4v8/hw8cdsyl1ap2QVNCgU
B3n6771Ow/cSvrEs4za4CIto1261kQ6RXs4F364GIAZ+TY9ho5Sd3rFxydCuy2Q4
mckTFsTWhRnKudGiHaesqE2gXI5VO6xycg==
-----END CERTIFICATE-----`;
const KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQChKv+h49lZBByw
IziswAmV59RPFvbREwJZlA4IWAXQZHb8d38YrJNgG24B3+9A2YManMgAMm3R9Dm1
67NegFfB5K7t2luLd2hT/pUDpCUv3tM4vt1bgj5DjFLCy043s1Z6mn7nBDFnRdHV
0hCwomHr1GLosAToHnUkww1wCBJhrh+/UUuqNSPikd2m9aN9OIx/JScz2abWLBGc
SkFHGsyJ2tctMsnXP5nCZKPlcRAZjX2kACJ38cjlbwd1wf9/YuSfa0pvLLRdWhmn
3BRALRzDERYp+3SGSoMm6L20p4/q0AVeFvZO01jEqYLr963Cp5tBN9Ad/F5DUm2w
ASvEO/5xAgMBAAECggEACUqjn6Kb4oXNRGeLbWr9Qnvk+0UaKEL3ZQQXOQQfta9z
eRB6+27iAjqJAY+pySw6r26WTNI1DznyywB4zO8+Rl3kqq7NJ06HhvKLucC29u10
PpApmwx4gkfVP6JQv8vvJbT0sWUS/UUcf1f6GvM82cenuiPnuVAdz2d1X13/w7Ga
imX0tUow+bEN8PBdxY54t23pn8nJEBD7DjaK9C37mzYw9Zmyd53uyPLith/HBrKU
aj/G2rscSSoOEMFs8GzDnMZyqQ9XxcYrGqai8m0bv09jmWO5GXfbFgNWtHn+bdyk
vr4PLcBgC1wtUzTLo677xiOMcWDtLbb+ev/+uS+oRwKBgQDiazSGnF1/GQOYvhKZ
zkhxOYC1lNXBdb5poPDuVNYV3ASfYX3hWxRmPAe6s4G4yyGEE1JCpYMoc+Wbj2k6
7/bw+WPS5ukve9A0kLH6ruCD/W62LAYoXXDOmoJ8OKS1PgNB2O5hAgagXBcee+C3
WiJJYaty2HI7VXxkhIjCuTpDpwKBgQC2OWrBdb7F6ERoKA+6gL8FBWiH61x9S1AW
Fa3DUSu7r8Eia2N9HnTS980I/655ttUVNtKXNwD2rWxI4Fgf3uYCrkjSQZMKkx9k
SUl/cnCOavD4dN/D/gS9YsaRnGDBhTuLEvoYRvElWZN9sP93+m4rssfjfj1FWkz5
TwXzG/zQJwKBgHCvnFe2cM31vBWD26wSv3kifk1hArWjDR5zDBYBwP7mHqLYGZdU
BiYPkGU6O8Cl0Et0dkdXKpyyeb7fNCcyELvD0wu/AqUwQOI4dWvnJzRpqHUgGfxy
7NbWjUSXyFmvwF1AQvuiz3t1+cehLajzQgc1hefFk6y2Eg/Q6mPHXhkXAoGAfK3y
fmX63tyaGY33nQtEJ8JYkE8YnF3wcPvqRW5/ds69XbiOfOhe1I5aSqLulTbkurwl
APPQg/eK1J4zjbLsO79V8g6N9jlNzEdcs4fwvXEsaUNGa4qdYZt4895EUYTAhdq5
Je08R+rvQJvfYA8IXHvZyqzwbUhozFgmYP2wUBcCgYEAnX9Q/q3UB3U2tbG4DCod
t+M05/2UnjIeGUB7ygBIp3Cc9JJKb+aMlQzYUbLv7Srs4uRCLNv7opxNVHW8pWYY
x18YZ/M1cEYpNVIjClJz6BtiThMo63TWBmq00/4XucxLt7ngGhXOmdC9QVRa6tHO
i9KJ0AARKsgeiheBomHBpY8=
-----END PRIVATE KEY-----`;

const WEBHOOK_ID = 'WH-TEST-123';

const BODY = JSON.stringify({
  event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
  resource: { id: 'I-SUB123', custom_id: 'business', status: 'ACTIVE' },
});

const baseHeaders = (): PayPalWebhookHeaders => ({
  'paypal-transmission-id': 'trans-1',
  'paypal-transmission-time': '2026-08-28T10:00:00Z',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-abc',
  'paypal-auth-algo': 'SHA256withRSA',
});

/** Sign exactly what the module says PayPal signs. */
const signed = (body: string | Buffer, headers: PayPalWebhookHeaders, webhookId = WEBHOOK_ID) => {
  const signer = createSign('sha256');
  signer.update(payPalSignatureBase(headers, webhookId, body), 'utf8');
  signer.end();
  return signer.sign(KEY_PEM, 'base64');
};

describe('payPalSignatureBase', () => {
  test('is id|time|webhookId|crc32(body)', () => {
    const base = payPalSignatureBase(baseHeaders(), WEBHOOK_ID, 'abc');
    // 891568578 is crc32('abc'), checked against node:zlib independently.
    expect(base).toBe('trans-1|2026-08-28T10:00:00Z|WH-TEST-123|891568578');
  });

  test('a string body and the same bytes as a Buffer agree', () => {
    expect(payPalSignatureBase(baseHeaders(), WEBHOOK_ID, BODY))
      .toBe(payPalSignatureBase(baseHeaders(), WEBHOOK_ID, Buffer.from(BODY, 'utf8')));
  });

  test('re-serialising the JSON changes the base — which is why raw bytes are required', () => {
    // The single most common way this integration is got wrong.
    const reserialised = JSON.stringify(JSON.parse(BODY.replace('"event_type"', '"event_type" ')));
    expect(payPalSignatureBase(baseHeaders(), WEBHOOK_ID, BODY))
      .not.toBe(payPalSignatureBase(baseHeaders(), WEBHOOK_ID, reserialised + ' '));
  });
});

describe('verifyPayPalWebhook', () => {
  test('a genuinely signed event verifies', () => {
    const headers = { ...baseHeaders(), 'paypal-transmission-sig': signed(BODY, baseHeaders()) };
    expect(verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, CERT_PEM)).toEqual({ valid: true });
  });

  test('REFUSAL — one altered byte in the body fails', () => {
    const headers = { ...baseHeaders(), 'paypal-transmission-sig': signed(BODY, baseHeaders()) };
    const tampered = BODY.replace('"business"', '"enterprise"');
    const verdict = verifyPayPalWebhook(tampered, headers, WEBHOOK_ID, CERT_PEM);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('Signature does not match');
  });

  test('REFUSAL — a signature for another webhook id does not verify here', () => {
    // Replay of a real, valid PayPal signature aimed at somebody else's webhook.
    const headers = { ...baseHeaders(), 'paypal-transmission-sig': signed(BODY, baseHeaders(), 'WH-SOMEONE-ELSE') };
    expect(verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, CERT_PEM).valid).toBe(false);
  });

  test('REFUSAL — signed by a different key', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = createSign('sha256');
    signer.update(payPalSignatureBase(baseHeaders(), WEBHOOK_ID, BODY), 'utf8');
    signer.end();
    const sig = signer.sign(other.privateKey, 'base64');
    expect(verifyPayPalWebhook(BODY, { ...baseHeaders(), 'paypal-transmission-sig': sig }, WEBHOOK_ID, CERT_PEM).valid)
      .toBe(false);
  });

  test('REFUSAL — algorithm confusion is not honoured', () => {
    // The algorithm is named in a header, and a header is not a decision.
    // Same family as JWT alg:none.
    const headers = {
      ...baseHeaders(),
      'paypal-auth-algo': 'none',
      'paypal-transmission-sig': signed(BODY, baseHeaders()),
    };
    const verdict = verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, CERT_PEM);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('Unsupported signature algorithm');
  });

  test('REFUSAL — every missing header fails closed', () => {
    const good = { ...baseHeaders(), 'paypal-transmission-sig': signed(BODY, baseHeaders()) };
    for (const drop of ['paypal-transmission-sig', 'paypal-transmission-id', 'paypal-transmission-time'] as const) {
      const headers = { ...good };
      delete headers[drop];
      expect(verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, CERT_PEM).valid).toBe(false);
    }
  });

  test('REFUSAL — no configured webhook id refuses rather than passing', () => {
    const headers = { ...baseHeaders(), 'paypal-transmission-sig': signed(BODY, baseHeaders()) };
    expect(verifyPayPalWebhook(BODY, headers, '', CERT_PEM)).toEqual({
      valid: false, reason: 'No webhook id configured',
    });
  });

  test('REFUSAL — an unreadable certificate is not a pass', () => {
    const headers = { ...baseHeaders(), 'paypal-transmission-sig': signed(BODY, baseHeaders()) };
    expect(verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, 'not a certificate').reason)
      .toBe('Certificate could not be read');
  });

  test('REFUSAL — a malformed signature is caught, not thrown', () => {
    const headers = { ...baseHeaders(), 'paypal-transmission-sig': '!!!not base64!!!' };
    expect(() => verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, CERT_PEM)).not.toThrow();
    expect(verifyPayPalWebhook(BODY, headers, WEBHOOK_ID, CERT_PEM).valid).toBe(false);
  });
});

describe('isPayPalCertUrl — the check that makes the signature mean anything', () => {
  test('accepts PayPal hosts', () => {
    for (const url of [
      'https://api.paypal.com/v1/notifications/certs/CERT-1',
      'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      'https://paypal.com/certs/x',
    ]) {
      expect(isPayPalCertUrl(url)).toBe(true);
    }
  });

  test('REFUSAL — a lookalike host that merely CONTAINS the string', () => {
    // Each of these would let an attacker supply their own certificate, sign a
    // forged event with the matching key, and pass every crypto check above.
    for (const url of [
      'https://paypal.com.evil.com/cert.pem',
      'https://evilpaypal.com/cert.pem',
      'https://evil.com/?host=api.paypal.com',
      'https://evil.com/api.paypal.com/cert.pem',
      'https://notpaypal.com/cert.pem',
    ]) {
      expect(isPayPalCertUrl(url)).toBe(false);
    }
  });

  test('REFUSAL — plain http, and non-URLs', () => {
    expect(isPayPalCertUrl('http://api.paypal.com/cert.pem')).toBe(false);
    expect(isPayPalCertUrl('file:///etc/passwd')).toBe(false);
    expect(isPayPalCertUrl('')).toBe(false);
    expect(isPayPalCertUrl('api.paypal.com')).toBe(false);
  });

  test('case in the host does not defeat it', () => {
    expect(isPayPalCertUrl('https://API.PayPal.COM/certs/x')).toBe(true);
    expect(isPayPalCertUrl('https://PAYPAL.COM.EVIL.COM/x')).toBe(false);
  });
});

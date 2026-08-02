#!/usr/bin/env node
/**
 * The notary, as a service.
 *
 * Runs on its own, holds its own key, and depends on nothing else in this
 * repository — which is the requirement rather than a nicety. A notary deployed
 * alongside the system it witnesses, signing with a key the same operator holds,
 * would be a second signature from the same party and would prove nothing.
 *
 *     CAPKIT_NOTARY_PRIVATE_KEY   Ed25519 PKCS#8 PEM. Without it, a key is
 *                                 generated per process and every receipt this
 *                                 notary has ever issued becomes unverifiable on
 *                                 restart. It says so, loudly, at boot.
 *     NOTARY_KEY_ID               Names the key in each receipt.
 *     PORT                        Defaults to 8086.
 *
 * Witnessing is deliberately unauthenticated. Anyone may submit any hash: a
 * receipt is worth exactly as much as the chain that later matches it, so there
 * is nothing to gain by witnessing a value nobody can produce a chain for. Making
 * this endpoint require a credential would mean a notary could refuse to witness
 * somebody — which is precisely the power a disinterested party must not have.
 */
import express from 'express';
import { Notary, auditAgainstReceipts, NotaryError, type Receipt } from './notary';

const PORT = Number(process.env.NOTARY_PORT || process.env.PORT || 8086);

const notary = new Notary(
  process.env.CAPKIT_NOTARY_PRIVATE_KEY,
  process.env.NOTARY_KEY_ID || 'absuite-notary'
);

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // A notary that could not be read cross-origin would be useless to the browser
  // verifier, which is the shortest path from "interesting claim" to "I checked".
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return next();
});

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    witnessed: notary.witnessed,
    keyId: notary.keyId,
    // Reported rather than hidden. An operator relying on a notary needs to know
    // its receipts will not survive a restart.
    ephemeralKey: notary.ephemeral,
  });
});

/**
 * The notary's public half. Deliberately unauthenticated.
 *
 * The entire argument is that a receipt can be checked by somebody who trusts
 * neither the operator nor the notary. A public key behind a credential would
 * defeat that in one line.
 */
app.get('/notary/public-key', (_req, res) => {
  res.status(200).json({
    keyId: notary.keyId,
    algorithm: 'Ed25519',
    publicKey: notary.publicKeyPem,
    ephemeral: notary.ephemeral,
  });
});

/** Witness a chain head. Sends back a signed statement that it was seen, now. */
app.post('/witness', (req, res) => {
  try {
    const { chainId, headHash, claimedLength } = req.body ?? {};
    const receipt = notary.witness({
      chainId,
      headHash,
      ...(claimedLength !== undefined ? { claimedLength: Number(claimedLength) } : {}),
    });
    return res.status(201).json({
      receipt,
      means:
        'This notary saw that value at that time. It says nothing about whether the chain is valid, ' +
        'whether the records are true, or who submitted it — it never sees a record. Its worth is that ' +
        'the chain you present later must still contain this head.',
    });
  } catch (error) {
    const notaryError = error as NotaryError;
    return fail(res, 400, notaryError.code ?? 'INVALID_REQUEST', notaryError.message);
  }
});

/** Every receipt this notary has issued for a chain. Public, and meant to be. */
app.get('/receipts', (req, res) => {
  const chainId = String(req.query.chainId ?? '').trim();
  if (!chainId) return fail(res, 400, 'INVALID_REQUEST', 'chainId is required.');

  const receipts = notary.receiptsFor(chainId);
  return res.status(200).json({
    chainId,
    receipts,
    // Named rather than implied: an empty list is not evidence of anything.
    meaning: receipts.length === 0
      ? 'This notary has witnessed nothing for that chain. That is not a finding about the chain — it may never have been submitted here.'
      : `This notary witnessed ${receipts.length} head(s) for that chain. Any chain claiming to be it must still contain every one of them.`,
  });
});

/**
 * Check a chain against what this notary witnessed.
 *
 * Offered as a convenience only. The audit is a pure function over public data —
 * the receipts and the notary's public key — so anybody can run it themselves
 * without asking, and an auditor who cares should.
 */
app.post('/audit', (req, res) => {
  const { chainId, hashes, receipts } = req.body ?? {};
  const id = String(chainId ?? '').trim();

  if (!id) return fail(res, 400, 'INVALID_REQUEST', 'chainId is required.');
  if (!Array.isArray(hashes)) {
    return fail(res, 400, 'INVALID_REQUEST', 'hashes must be the chain\'s record hashes, in order.');
  }

  const supplied: Receipt[] = Array.isArray(receipts) && receipts.length > 0
    ? (receipts as Receipt[])
    : notary.receiptsFor(id);

  return res.status(200).json({
    ...auditAgainstReceipts(id, hashes.map(String), supplied, notary.publicKeyPem),
    unverifiable: [
      { field: 'validity', because: 'A notary never sees a record, so it cannot say a chain was valid — only whether this is the same chain it saw.' },
      { field: 'submitter', because: 'Witnessing is open. A receipt does not identify who presented the head.' },
      { field: 'time', because: 'seenAt is this notary\'s clock. It is a claim by the notary, checkable only against other notaries.' },
    ],
  });
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

if (require.main === module) {
  if (notary.ephemeral) {
    console.warn('[notary] CAPKIT_NOTARY_PRIVATE_KEY is not set — a key was generated for this process.');
    console.warn('[notary] Every receipt issued will stop verifying when this process restarts, and');
    console.warn('[notary] receipts already handed out will look valid until somebody checks them.');
    console.warn('[notary] Generate one with Notary.generate() and set it before witnessing anything real.');
  }
  app.listen(PORT, () => {
    console.log(`[notary] listening on :${PORT} (key ${notary.keyId})`);
  });
}

export { app, notary };

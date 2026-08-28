/**
 * A signed audit export — the records, in a file, verifiable without ABSuite.
 *
 * ## Why this is the product rather than a feature
 *
 * Everything in this repository already proves something to an operator holding
 * the database. That is the easy half. The claim ABSuite actually makes is to a
 * HOSTILE AUDITOR — somebody with no reason to trust the person handing them
 * the file, and no access to the running system.
 *
 * So an export that only ABSuite can check is a report, not evidence. This
 * bundle carries every field a chain walk needs — the hashes, the links, the
 * signatures, the key id — and `verifyAuditExport` re-walks it from the bundle
 * ALONE: no database, no network, no server. An auditor can re-implement that
 * function from the format below and never run our code at all, which is the
 * only version of "verifiable" worth selling.
 *
 * ## What the bundle's own key does and does not prove
 *
 * The public key travels inside the bundle for convenience, and on its own that
 * proves very little: whoever forged a bundle could forge a key to match it. It
 * is the same shape as PayPal's certificate URL — the signature is not what
 * establishes trust, the PROVENANCE OF THE KEY is.
 *
 * So `verifyAuditExport` takes an optional `expectedPublicKeyPem`. Without it
 * the answer is "these records are internally consistent and signed by the key
 * in this file". With it, the answer is "…and that key is the one you already
 * trust", which is the claim an audit actually needs. The result says which of
 * the two it is rather than letting a reader assume the stronger one.
 */
import {
  verifyTrace,
  verifySignature,
  retentionStatement,
  GENESIS_HASH,
  type ExecutionTrace,
  type RetentionAnchor,
} from './trace';

export const AUDIT_EXPORT_FORMAT = 'absuite.audit-export.v1';

export interface AuditExport {
  format: typeof AUDIT_EXPORT_FORMAT;
  exportedAt: string;
  /** The key the records are signed with. See the note above on what this proves. */
  publicKeyPem: string;
  keyId?: string;
  /**
   * Present when retention removed older records. Without it a swept ledger
   * exports as a chain whose oldest record links to nothing, which is
   * indistinguishable from one somebody trimmed.
   */
  retainedFrom?: RetentionAnchor;
  /**
   * Receipts from an outside notary, oldest first, EXACTLY as the notary
   * returned them.
   *
   * This is what turns the bundle from a self-consistent story into evidence.
   * The records prove nobody edited them after they were written; the receipts
   * prove somebody with no stake in the answer saw this chain at a series of
   * times — which is the one thing a chain cannot establish about itself,
   * because everything inside a deployment is signed by the same party.
   *
   * Absent when nobody witnesses this instance. An unwitnessed chain is
   * UNWITNESSED, never suspicious.
   */
  receipts?: unknown[];
  count: number;
  /**
   * In chain order, oldest first. The ORDER IS THE CHAIN: each record names its
   * predecessor's hash, so the sequence is proved by cryptography rather than
   * asserted by a number somebody could renumber.
   */
  records: ExecutionTrace[];
}

export function buildAuditExport(input: {
  records: ExecutionTrace[];
  publicKeyPem: string;
  keyId?: string;
  retainedFrom?: RetentionAnchor;
  receipts?: unknown[];
  now?: Date;
}): AuditExport {
  /*
   * The caller supplies them in chain order. They are NOT re-sorted here: the
   * only ordering that means anything is the hash linkage, and sorting by some
   * other key would let a wrong order look tidy on its way to a verifier that
   * would then reject it.
   */
  const records = [...input.records];
  return {
    format: AUDIT_EXPORT_FORMAT,
    exportedAt: (input.now ?? new Date()).toISOString(),
    publicKeyPem: input.publicKeyPem,
    ...(input.keyId ? { keyId: input.keyId } : {}),
    ...(input.retainedFrom ? { retainedFrom: input.retainedFrom } : {}),
    ...(input.receipts && input.receipts.length > 0 ? { receipts: input.receipts } : {}),
    count: records.length,
    records,
  };
}

export interface AuditExportVerdict {
  valid: boolean;
  /** How many records were walked. */
  checked: number;
  /** Position in the file, 1-based — not a database sequence number. */
  brokenAt?: number;
  brokenId?: string;
  reason?: string;
  /**
   * `trusted` when the caller supplied the key and it matched; `self-asserted`
   * when the bundle vouched for itself. Never absent, so a reader cannot mistake
   * the weaker claim for the stronger one.
   */
  keyProvenance: 'trusted' | 'self-asserted';
  /** What the pass did and did not establish, in words. */
  scope: string;
}

/**
 * Re-walk an exported chain using nothing but the bundle.
 *
 * Fails closed on everything: a format it does not know, a missing key, a
 * record out of order, a broken link, a bad signature.
 */
export function verifyAuditExport(
  bundle: AuditExport,
  expectedPublicKeyPem?: string
): AuditExportVerdict {
  const provenance: 'trusted' | 'self-asserted' = expectedPublicKeyPem ? 'trusted' : 'self-asserted';

  const fail = (reason: string, extra: Partial<AuditExportVerdict> = {}): AuditExportVerdict => ({
    valid: false,
    checked: 0,
    reason,
    keyProvenance: provenance,
    scope: 'The bundle was rejected before the chain could be walked.',
    ...extra,
  });

  if (bundle?.format !== AUDIT_EXPORT_FORMAT) {
    // A future format is refused rather than read optimistically — reading an
    // unknown shape and reporting valid is how a verifier lies.
    return fail(`Unsupported export format: ${bundle?.format}`);
  }
  if (!bundle.publicKeyPem) return fail('The export carries no public key');
  if (!Array.isArray(bundle.records)) return fail('The export carries no records');

  if (expectedPublicKeyPem && normalisePem(expectedPublicKeyPem) !== normalisePem(bundle.publicKeyPem)) {
    return fail('The export is signed by a different key than the one supplied');
  }

  if (bundle.count !== bundle.records.length) {
    return fail(`The export says it holds ${bundle.count} records and holds ${bundle.records.length}`);
  }

  /*
   * Where the chain is allowed to start. A bundle with a retention anchor
   * resumes from the hash the anchor names; one without must start at genesis.
   * Taking the first record's own prevHash as the starting point would make
   * every truncation verify perfectly, which is the whole failure this is for.
   */
  /*
   * AN ANCHOR IS HONOURED ONLY IF IT IS SIGNED BY THE SAME KEY AS THE RECORDS.
   *
   * Without this the anchor is the hole the whole format is meant to close: an
   * attacker drops the oldest records, writes an anchor naming whatever hash
   * the surviving front record expects, and the chain walks perfectly. The
   * records would all be genuine and correctly signed; only the claim about
   * what came BEFORE them would be invented.
   *
   * A test asserted exactly that and passed — this check is what the test was
   * really asking for, and documenting the gap instead of closing it would have
   * shipped a verifier that blesses truncation.
   */
  if (bundle.retainedFrom) {
    const anchor = bundle.retainedFrom;
    const statement = retentionStatement(anchor.seq, anchor.hash, anchor.removed, anchor.policyDays);
    if (!verifySignature(statement, anchor.signature ?? '', bundle.publicKeyPem)) {
      return fail('The retention anchor is not signed by the key that signed the records');
    }
  }

  let expectedPrev = bundle.retainedFrom?.hash ?? GENESIS_HASH;
  let checked = 0;

  for (const trace of bundle.records) {
    /*
     * A removed record, a reordered pair and an inserted one all break the
     * link, so this single comparison covers what a sequence check would have
     * — and covers it with a hash instead of a number a forger could simply
     * renumber to match.
     */
    if (trace.prevHash !== expectedPrev) {
      return fail('A record does not link to its predecessor', {
        checked, brokenAt: checked + 1, brokenId: trace.id,
      });
    }

    const verdict = verifyTrace(trace, bundle.publicKeyPem);
    if (!verdict.valid) {
      return fail(verdict.reason ?? 'A record failed verification', {
        checked, brokenAt: checked + 1, brokenId: trace.id,
      });
    }

    expectedPrev = trace.hash;
    checked += 1;
  }

  return {
    valid: true,
    checked,
    keyProvenance: provenance,
    scope: [
      provenance === 'trusted'
        ? `${checked} record(s) form an unbroken chain, each signed by the key you supplied.`
        : `${checked} record(s) form an unbroken chain, each signed by the key INSIDE this file. ` +
          'That is internal consistency, not provenance — anyone able to forge the records could forge the key with them. ' +
          'Supply the public key you already trust to make this an audit rather than a self-assessment.',
      /*
       * The gap is reported whatever the key provenance. It was in the trusted
       * branch alone, which meant the reader most in need of the warning — the
       * one with no key to check against — was the one not told records were
       * missing.
       */
      bundle.retainedFrom
        ? `${bundle.retainedFrom.removed} earlier record(s) were removed under a ${bundle.retainedFrom.policyDays}-day retention policy and are not in this file; the signed anchor accounting for them was checked.`
        : 'The chain begins at genesis, so nothing precedes it.',
      /*
       * NOT verified here, and it says so. A receipt is signed by the NOTARY's
       * key, which this bundle does not carry and should not — the whole point
       * of an outside witness is that its key comes from outside. Checking them
       * needs the notary's public key and `auditAgainstReceipts`, which is a
       * separate act by a separate party.
       *
       * Claiming to have checked them would be the exact failure this format
       * exists to prevent: a verifier vouching for evidence it cannot test.
       */
      bundle.receipts && bundle.receipts.length > 0
        ? `${bundle.receipts.length} notary receipt(s) are included and were NOT checked here — they are signed by the notary's key, not this one. Audit them with the notary's public key to establish when this chain was seen from outside.`
        : 'No outside witness is included: this file establishes internal consistency only.',
    ].join(' '),
  };
}

/** Whitespace and line endings differ between platforms; the key does not. */
function normalisePem(pem: string): string {
  return pem.replace(/\s+/g, '');
}

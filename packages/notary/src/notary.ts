/**
 * A disinterested witness to a chain head.
 *
 * ## The gap this closes
 *
 * A hash chain proves nobody edited a record *after it was written*. It does not
 * prove anything about *when* it was written, and the operator being audited
 * holds the signing key — so in principle they could produce a perfectly valid
 * chain today and claim it was written last year. Every record would verify.
 * Every link would hold. The whole thing could still be a reconstruction.
 *
 * Nothing inside a single deployment can close that, because everything inside
 * it is signed by the same party. It needs somebody else.
 *
 * A notary is the smallest possible somebody else. It receives a chain head —
 * thirty-two bytes of hash and nothing more — and returns a receipt saying *I
 * saw this value at this time*, signed with its own key. That is the entire
 * service.
 *
 * ## What makes it worth running
 *
 * A single receipt is a timestamp. A *series* of receipts is something much
 * stronger, and it is the reason this is the first honest step toward the
 * Collective Intelligence layer rather than a wait for it.
 *
 * Because a chain is append-only, every head a notary has ever witnessed must
 * still appear in that chain, at the same position, forever. If an operator
 * rewrites history — drops a record, alters one, re-signs the lot — the new
 * chain will not contain the head the notary saw. `auditAgainstReceipts()` finds
 * that, and it finds it using evidence held by a party with no stake in the
 * answer.
 *
 * ## What it must never claim
 *
 * The notary never sees a record. It cannot verify a chain, and it does not try.
 * A receipt says one thing:
 *
 *     this value existed at this time, and I had no interest in it
 *
 * It does **not** say the chain was valid, that the records were true, or that
 * the submitter is who they say they are. Anyone may submit any hash. A receipt
 * for a hash is worth exactly as much as the chain that later matches it, which
 * is why the audit function — not the receipt — is where the value is.
 *
 * ## What it stores
 *
 * A hash, a chain identifier, and a timestamp. It cannot read a payload because
 * it is never sent one, and that is a property rather than a policy: a notary
 * that had to be trusted with contents would not be adoptable by anyone who
 * needed one.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/** The receipt form this build writes. Versioned for the same reason records are. */
export const RECEIPT_VERSION = 1;

export const SUPPORTED_RECEIPT_VERSIONS: readonly number[] = [1];

export interface Receipt {
  /** Which chain this head belongs to, as the submitter names it. */
  chainId: string;
  /** The head hash witnessed. Sixty-four lowercase hex characters. */
  headHash: string;
  /**
   * How many records the submitter said the chain held.
   *
   * Recorded because it makes an audit far sharper — a head at length 900 must
   * appear at position 900 — and reported as *claimed* everywhere it surfaces,
   * because the notary has no way to check it.
   */
  claimedLength?: number;
  /** When this notary saw it. The notary's clock, and it says so. */
  seenAt: string;
  receiptVersion: number;
  notaryKeyId: string;
  /** Ed25519 over the canonical form, base64. */
  signature: string;
}

export class NotaryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'NotaryError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The canonical form of a receipt — the bytes that get signed.
 *
 * Fixed order, version first so the marker is inside the signature, exactly as
 * the record protocol does it. The same reasoning applies: a version marker
 * outside the signature lets anyone change how a receipt is verified by editing
 * one integer.
 */
export function canonicalReceipt(receipt: Omit<Receipt, 'signature'>): string {
  if (!SUPPORTED_RECEIPT_VERSIONS.includes(receipt.receiptVersion)) {
    throw new NotaryError(
      `This build understands receipt form v${SUPPORTED_RECEIPT_VERSIONS.join(', v')} and cannot read v${receipt.receiptVersion}. ` +
        'That is a statement about this build, not about the receipt.',
      'UNSUPPORTED_VERSION'
    );
  }
  return JSON.stringify([
    receipt.receiptVersion,
    receipt.chainId,
    receipt.headHash,
    receipt.claimedLength ?? null,
    receipt.seenAt,
    receipt.notaryKeyId,
  ]);
}

/** Verify a receipt against a notary's published public key. */
export function verifyReceipt(receipt: Receipt, notaryPublicKeyPem: string): boolean {
  try {
    const { signature, ...unsigned } = receipt;
    return cryptoVerify(
      null,
      Buffer.from(canonicalReceipt(unsigned), 'utf8'),
      createPublicKey(notaryPublicKeyPem),
      Buffer.from(signature, 'base64')
    );
  } catch {
    return false;
  }
}

/** Somewhere to keep receipts. Deliberately tiny — a hash and a timestamp. */
export interface ReceiptStore {
  append(receipt: Receipt): void;
  forChain(chainId: string): Receipt[];
  count(): number;
}

/** The default store. Adequate for a notary, which writes 32 bytes per call. */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly receipts: Receipt[] = [];

  append(receipt: Receipt): void {
    this.receipts.push(receipt);
  }

  forChain(chainId: string): Receipt[] {
    return this.receipts
      .filter(receipt => receipt.chainId === chainId)
      .sort((a, b) => a.seenAt.localeCompare(b.seenAt));
  }

  count(): number {
    return this.receipts.length;
  }
}

export class Notary {
  private readonly privateKey: KeyObject;
  readonly publicKeyPem: string;
  readonly keyId: string;
  readonly ephemeral: boolean;

  constructor(
    privateKeyPem?: string,
    keyId = 'absuite-notary',
    private readonly store: ReceiptStore = new InMemoryReceiptStore()
  ) {
    const configured = (privateKeyPem || '').trim();
    if (configured) {
      this.privateKey = createPrivateKey(configured);
      this.ephemeral = false;
    } else {
      // Said out loud rather than defaulted quietly: a notary whose key changes
      // on restart invalidates every receipt it has ever issued, which is worse
      // than not running one, because the receipts still look valid until
      // somebody checks them against the new key.
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
      this.ephemeral = true;
    }
    this.publicKeyPem = createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.keyId = keyId;
  }

  static generate(): { privateKeyPem: string; publicKeyPem: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  }

  /**
   * Witness a chain head.
   *
   * The only thing this establishes is that the value was presented at this
   * time. It is deliberately not called `certify` or `attest` — those words
   * imply an opinion about the thing, and the notary has none.
   */
  witness(input: { chainId: string; headHash: string; claimedLength?: number }): Receipt {
    const chainId = String(input.chainId ?? '').trim();
    if (!chainId) {
      throw new NotaryError(
        'chainId is required. A receipt that does not say which chain it witnessed cannot be used in an audit later.',
        'INVALID_REQUEST'
      );
    }

    const headHash = String(input.headHash ?? '').trim().toLowerCase();
    if (!HEX64.test(headHash)) {
      throw new NotaryError(
        'headHash must be sixty-four lowercase hex characters — a SHA-256 digest. ' +
          'The notary is sent a hash and never a record, which is why it cannot read what it witnesses.',
        'INVALID_REQUEST'
      );
    }

    if (input.claimedLength !== undefined) {
      if (!Number.isInteger(input.claimedLength) || input.claimedLength < 1) {
        throw new NotaryError('claimedLength must be a positive integer when supplied.', 'INVALID_REQUEST');
      }
    }

    const unsigned: Omit<Receipt, 'signature'> = {
      chainId,
      headHash,
      ...(input.claimedLength !== undefined ? { claimedLength: input.claimedLength } : {}),
      seenAt: new Date().toISOString(),
      receiptVersion: RECEIPT_VERSION,
      notaryKeyId: this.keyId,
    };

    const receipt: Receipt = {
      ...unsigned,
      signature: cryptoSign(null, Buffer.from(canonicalReceipt(unsigned), 'utf8'), this.privateKey).toString('base64'),
    };

    this.store.append(receipt);
    return receipt;
  }

  receiptsFor(chainId: string): Receipt[] {
    return this.store.forChain(chainId);
  }

  get witnessed(): number {
    return this.store.count();
  }
}

/* ── The audit, which is where the value actually is ─────────────────────── */

export interface AuditFinding {
  receipt: Receipt;
  /**
   * PRESENT — the witnessed head is in the chain, where it should be.
   * MISSING — it is not in the chain at all. History was rewritten.
   * MISPLACED — present, but not at the position its claimed length implies.
   * UNVERIFIABLE — the receipt itself does not verify against the notary key.
   */
  state: 'PRESENT' | 'MISSING' | 'MISPLACED' | 'UNVERIFIABLE';
  finding: string;
  /** Where the head actually sits in the chain, one-based. */
  foundAt?: number;
}

export interface AuditResult {
  chainId: string;
  receipts: number;
  present: number;
  findings: AuditFinding[];
  /** True only when every receipt was verified and every head was found in place. */
  consistent: boolean;
  basis: string;
}

/**
 * Check a chain against what a notary witnessed.
 *
 * This is the point of the whole service. A chain is append-only, so every head
 * a notary ever saw must still be in it, at the same position, forever. An
 * operator who quietly rewrote history produces a chain that verifies perfectly
 * against itself and fails here — because the evidence it fails against is held
 * by somebody who has no stake in the answer.
 *
 * `hashes` is the ordered list of record hashes. The auditor supplies them; this
 * function does not verify the chain itself, which is `verifyChain`'s job. The
 * two are complementary and both are needed: one proves internal consistency,
 * the other proves the internally consistent thing is the same one that existed
 * last March.
 */
export function auditAgainstReceipts(
  chainId: string,
  hashes: string[],
  receipts: Receipt[],
  notaryPublicKeyPem: string
): AuditResult {
  const position = new Map<string, number>();
  hashes.forEach((hash, index) => {
    if (!position.has(hash)) position.set(hash, index + 1);
  });

  const findings: AuditFinding[] = receipts.map(receipt => {
    if (!verifyReceipt(receipt, notaryPublicKeyPem)) {
      return {
        receipt,
        state: 'UNVERIFIABLE',
        finding:
          'This receipt does not verify against the notary key supplied. Either it was not issued by that ' +
          'notary, or it has been altered. Nothing is being claimed about the chain here — the witness itself is in question.',
      };
    }

    const foundAt = position.get(receipt.headHash);

    if (foundAt === undefined) {
      return {
        receipt,
        state: 'MISSING',
        finding:
          `The notary witnessed head ${receipt.headHash.slice(0, 12)}… at ${receipt.seenAt}, and it does not appear ` +
          'anywhere in this chain. A chain is append-only, so a head that existed cannot stop existing. This chain is ' +
          'not a continuation of the one that was witnessed.',
      };
    }

    if (receipt.claimedLength !== undefined && foundAt !== receipt.claimedLength) {
      return {
        receipt,
        state: 'MISPLACED',
        foundAt,
        finding:
          `The head is present but sits at position ${foundAt}, and at the time it was witnessed the submitter said ` +
          `the chain held ${receipt.claimedLength} record(s). Records were inserted or removed before it. Note that the ` +
          'length was a claim the notary could not check, so this is a discrepancy to investigate rather than a proof of either figure.',
      };
    }

    return {
      receipt,
      state: 'PRESENT',
      foundAt,
      finding: `Witnessed at ${receipt.seenAt} and still present at position ${foundAt}.`,
    };
  });

  const present = findings.filter(finding => finding.state === 'PRESENT').length;

  return {
    chainId,
    receipts: receipts.length,
    present,
    findings,
    consistent: receipts.length > 0 && present === receipts.length,
    basis:
      receipts.length === 0
        ? 'No receipts were supplied, so nothing external corroborates this chain. That is not a finding against it — ' +
          'it means the only evidence available is the chain\'s own, which the operator controls.'
        : `${present} of ${receipts.length} witnessed head(s) are still in this chain, in place. A notary attests that a ` +
          'value existed at a time and nothing more — it never sees a record, so it cannot say the chain was ever valid. ' +
          'What it can show is whether the chain in front of you is the same one it saw.',
  };
}

/** A chain identifier that will not collide, for a deployment that needs one. */
export function suggestChainId(): string {
  return `chain_${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 16)}`;
}

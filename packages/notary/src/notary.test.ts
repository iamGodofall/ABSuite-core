import { createHash } from 'node:crypto';
import {
  Notary,
  NotaryError,
  verifyReceipt,
  auditAgainstReceipts,
  canonicalReceipt,
  suggestChainId,
  RECEIPT_VERSION,
} from './notary';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A stand-in chain: an ordered list of record hashes. The notary never sees more. */
const chainOf = (n: number, salt = '') =>
  Array.from({ length: n }, (_, i) => sha256(`${salt}record-${i}`));

const freshNotary = () => {
  const { privateKeyPem, publicKeyPem } = Notary.generate();
  return { notary: new Notary(privateKeyPem, 'notary-test'), publicKeyPem };
};

describe('witnessing a head', () => {
  test('returns a signed receipt that verifies against the published key', () => {
    const { notary, publicKeyPem } = freshNotary();
    const head = sha256('head');

    const receipt = notary.witness({ chainId: 'chain_a', headHash: head, claimedLength: 12 });

    expect(receipt.headHash).toBe(head);
    expect(receipt.claimedLength).toBe(12);
    expect(receipt.receiptVersion).toBe(RECEIPT_VERSION);
    expect(receipt.notaryKeyId).toBe('notary-test');
    expect(verifyReceipt(receipt, publicKeyPem)).toBe(true);
  });

  test('a receipt altered in any field stops verifying', () => {
    const { notary, publicKeyPem } = freshNotary();
    const receipt = notary.witness({ chainId: 'chain_a', headHash: sha256('head'), claimedLength: 3 });

    // Each of these is something an operator would gain by changing.
    expect(verifyReceipt({ ...receipt, headHash: sha256('other') }, publicKeyPem)).toBe(false);
    expect(verifyReceipt({ ...receipt, seenAt: '2020-01-01T00:00:00.000Z' }, publicKeyPem)).toBe(false);
    expect(verifyReceipt({ ...receipt, chainId: 'chain_b' }, publicKeyPem)).toBe(false);
    expect(verifyReceipt({ ...receipt, claimedLength: 999 }, publicKeyPem)).toBe(false);
  });

  test('a different notary cannot vouch for this receipt', () => {
    const { notary } = freshNotary();
    const other = freshNotary();
    const receipt = notary.witness({ chainId: 'chain_a', headHash: sha256('head') });

    expect(verifyReceipt(receipt, other.publicKeyPem)).toBe(false);
  });

  test('the version marker is inside the signature', () => {
    const { notary, publicKeyPem } = freshNotary();
    const receipt = notary.witness({ chainId: 'chain_a', headHash: sha256('head') });

    // Same reasoning as the record protocol: a marker outside the signature lets
    // anyone change how a receipt is verified by editing one integer.
    expect(JSON.parse(canonicalReceipt(receipt))[0]).toBe(RECEIPT_VERSION);
    expect(verifyReceipt({ ...receipt, receiptVersion: 2 }, publicKeyPem)).toBe(false);
  });

  test('it refuses anything that is not a SHA-256 digest', () => {
    const { notary } = freshNotary();

    // A notary that accepted arbitrary strings could be handed a payload, and
    // the property that it cannot read what it witnesses would stop being true.
    expect(() => notary.witness({ chainId: 'c', headHash: 'not-a-hash' })).toThrow(/sixty-four lowercase hex/);
    expect(() => notary.witness({ chainId: 'c', headHash: sha256('x').toUpperCase() })).not.toThrow();
    expect(() => notary.witness({ chainId: '', headHash: sha256('x') })).toThrow(/chainId is required/);
    expect(() => notary.witness({ chainId: 'c', headHash: sha256('x'), claimedLength: 0 })).toThrow(/positive integer/);
  });

  test('an ephemeral key is flagged, because it invalidates every receipt on restart', () => {
    expect(new Notary().ephemeral).toBe(true);
    expect(new Notary(Notary.generate().privateKeyPem).ephemeral).toBe(false);
  });

  test('it stores a hash and a timestamp, and cannot hold a payload', () => {
    const { notary } = freshNotary();
    notary.witness({ chainId: 'chain_a', headHash: sha256('head') });

    const stored = JSON.stringify(notary.receiptsFor('chain_a'));
    expect(Object.keys(notary.receiptsFor('chain_a')[0]!).sort()).toEqual(
      ['chainId', 'headHash', 'notaryKeyId', 'receiptVersion', 'seenAt', 'signature'].sort()
    );
    expect(stored).not.toContain('payload');
  });
});

describe('the audit — what the notary is actually for', () => {
  /**
   * The scenario this whole package exists for.
   *
   * An operator runs honestly for a while, has heads witnessed, and later
   * decides one record is inconvenient. They remove it and re-sign the chain.
   * The result verifies perfectly against itself: every hash recomputes, every
   * link holds, every signature is theirs. Nothing inside the deployment can
   * object, because the operator holds every key inside it.
   *
   * The notary's receipt can.
   */
  test('a rewritten chain is caught, and the witnessed head is named', () => {
    const { notary, publicKeyPem } = freshNotary();
    const original = chainOf(5);

    const receipt = notary.witness({
      chainId: 'chain_a',
      headHash: original[4]!,
      claimedLength: 5,
    });

    // History is rewritten: one record removed, everything after it re-signed.
    // A completely different, internally perfect chain.
    const rewritten = chainOf(4, 'rewritten-');

    const audit = auditAgainstReceipts('chain_a', rewritten, [receipt], publicKeyPem);

    expect(audit.consistent).toBe(false);
    expect(audit.findings[0]!.state).toBe('MISSING');
    expect(audit.findings[0]!.finding).toMatch(/does not appear anywhere in this chain/);
    expect(audit.findings[0]!.finding).toMatch(/not a continuation of the one that was witnessed/);
  });

  test('an honest chain that only grew passes', () => {
    const { notary, publicKeyPem } = freshNotary();
    const early = chainOf(3);

    const first = notary.witness({ chainId: 'chain_a', headHash: early[2]!, claimedLength: 3 });

    // Two more records appended. Append-only means the witnessed head is still
    // there, at the same position.
    const later = [...early, sha256('record-3'), sha256('record-4')];
    const second = notary.witness({ chainId: 'chain_a', headHash: later[4]!, claimedLength: 5 });

    const audit = auditAgainstReceipts('chain_a', later, [first, second], publicKeyPem);

    expect(audit.consistent).toBe(true);
    expect(audit.present).toBe(2);
    expect(audit.findings.map(f => f.foundAt)).toEqual([3, 5]);
  });

  test('an insertion before a witnessed head is MISPLACED, not MISSING', () => {
    const { notary, publicKeyPem } = freshNotary();
    const original = chainOf(4);
    const receipt = notary.witness({ chainId: 'chain_a', headHash: original[3]!, claimedLength: 4 });

    // The head is still present — but two records were slipped in ahead of it.
    const tampered = [sha256('inserted-a'), sha256('inserted-b'), ...original];
    const audit = auditAgainstReceipts('chain_a', tampered, [receipt], publicKeyPem);

    expect(audit.findings[0]!.state).toBe('MISPLACED');
    expect(audit.findings[0]!.foundAt).toBe(6);
    // And it says the length was a claim, because the notary could not check it.
    expect(audit.findings[0]!.finding).toMatch(/a claim the notary could not check/);
    expect(audit.consistent).toBe(false);
  });

  test('a forged receipt is UNVERIFIABLE, and makes no claim about the chain', () => {
    const { notary, publicKeyPem } = freshNotary();
    const chain = chainOf(3);
    const real = notary.witness({ chainId: 'chain_a', headHash: chain[2]!, claimedLength: 3 });

    // Somebody manufactures a receipt for a head that is genuinely in the chain.
    const forged = { ...real, headHash: chain[0]!, seenAt: '2020-01-01T00:00:00.000Z' };
    const audit = auditAgainstReceipts('chain_a', chain, [forged], publicKeyPem);

    expect(audit.findings[0]!.state).toBe('UNVERIFIABLE');
    // The finding is about the witness, not the chain. Those must not be confused.
    expect(audit.findings[0]!.finding).toMatch(/the witness itself is in question/);
    expect(audit.findings[0]!.finding).toMatch(/Nothing is being claimed about the chain/);
  });

  test('no receipts is not a finding against the chain', () => {
    const { publicKeyPem } = freshNotary();
    const audit = auditAgainstReceipts('chain_a', chainOf(3), [], publicKeyPem);

    // An unwitnessed chain is not a suspicious chain. It is an unwitnessed one,
    // and reporting it as inconsistent would punish anyone who has not started.
    expect(audit.consistent).toBe(false);
    expect(audit.present).toBe(0);
    expect(audit.basis).toMatch(/not a finding against it/);
    expect(audit.basis).toMatch(/the only evidence available is the chain's own/);
  });

  test('every audit states the limit of what a notary can show', () => {
    const { notary, publicKeyPem } = freshNotary();
    const chain = chainOf(2);
    const receipt = notary.witness({ chainId: 'chain_a', headHash: chain[1]!, claimedLength: 2 });

    const audit = auditAgainstReceipts('chain_a', chain, [receipt], publicKeyPem);

    // The notary never sees a record, so it can never say a chain was valid.
    expect(audit.basis).toMatch(/it never sees a record/);
    expect(audit.basis).toMatch(/cannot say the chain was ever valid/);
    // And no score, anywhere, in keeping with the rest of the product.
    expect(JSON.stringify(audit)).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(JSON.stringify(audit)).not.toMatch(/\bscore\b|\bgrade\b|\brating\b/i);
  });
});

describe('receipts are per chain', () => {
  test('one chain cannot borrow another chain\'s witness', () => {
    const { notary, publicKeyPem } = freshNotary();
    const a = chainOf(3, 'a-');
    const b = chainOf(3, 'b-');

    notary.witness({ chainId: 'chain_a', headHash: a[2]!, claimedLength: 3 });
    notary.witness({ chainId: 'chain_b', headHash: b[2]!, claimedLength: 3 });

    expect(notary.receiptsFor('chain_a')).toHaveLength(1);
    expect(notary.receiptsFor('chain_b')).toHaveLength(1);
    expect(notary.witnessed).toBe(2);

    // Presenting chain B with chain A's receipts fails, which is the point of
    // recording a chainId at all.
    const audit = auditAgainstReceipts('chain_a', b, notary.receiptsFor('chain_a'), publicKeyPem);
    expect(audit.findings[0]!.state).toBe('MISSING');
  });

  test('suggested chain ids do not collide', () => {
    const ids = new Set(Array.from({ length: 200 }, () => suggestChainId()));
    expect(ids.size).toBe(200);
  });

  test('receipts come back in the order they were witnessed', async () => {
    const { notary } = freshNotary();
    for (let i = 0; i < 3; i += 1) {
      notary.witness({ chainId: 'chain_a', headHash: sha256(`h${i}`), claimedLength: i + 1 });
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    const seen = notary.receiptsFor('chain_a').map(receipt => receipt.claimedLength);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('a receipt form this build cannot read', () => {
  test('is refused rather than reported as invalid', () => {
    const { notary, publicKeyPem } = freshNotary();
    const receipt = notary.witness({ chainId: 'chain_a', headHash: sha256('head') });

    // The same rule the record protocol applies at §4.5: "I cannot read this"
    // and "this failed" are different statements.
    expect(() => canonicalReceipt({ ...receipt, receiptVersion: 99 })).toThrow(NotaryError);
    expect(() => canonicalReceipt({ ...receipt, receiptVersion: 99 })).toThrow(
      /a statement about this build, not about the receipt/
    );
    // verifyReceipt swallows it into `false` rather than throwing at a caller.
    expect(verifyReceipt({ ...receipt, receiptVersion: 99 }, publicKeyPem)).toBe(false);
  });
});

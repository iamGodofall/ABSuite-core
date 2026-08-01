import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { Storage } from './storage';
import { IdentityRegistry } from './identity';
import {
  ApprovalRegistry,
  ApprovalError,
  approvalActionHash,
  approvalStatement,
  verifyApprovalSignature,
  MAX_APPROVAL_TTL_MS,
  type Approval,
  type ApprovalAction,
} from './approval';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const anAction = (overrides: Partial<ApprovalAction> = {}): ApprovalAction => ({
  subject: 'agent_refunds',
  module: 'finance',
  action: 'refund',
  inputHash: sha256('{"amount":1000}'),
  ...overrides,
});

const aRequest = (registry: ApprovalRegistry, overrides: Record<string, unknown> = {}) =>
  registry.request({
    action: anAction(),
    context: 'Refund £10.00 to customer 4471 for a duplicate charge.',
    policyRef: 'finance.refunds.max-10000',
    policyVersion: '3',
    requestedBy: 'agent_refunds',
    ...overrides,
  });

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign: (message: string) =>
      cryptoSign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
  };
}

let registry: ApprovalRegistry;
let identities: IdentityRegistry;

beforeEach(() => {
  const storage = new Storage(':memory:');
  identities = new IdentityRegistry(storage);
  registry = new ApprovalRegistry(storage, identities);
});

describe('what a request must carry', () => {
  test('a request opens pending, bound to a hash of what will run', () => {
    const approval = aRequest(registry);

    expect(approval.state).toBe('PENDING');
    expect(approval.assurance).toBe('ASSERTED');
    expect(approval.actionHash).toBe(approvalActionHash(anAction()));
    expect(approval.contextHash).toBe(sha256('Refund £10.00 to customer 4471 for a duplicate charge.'));
  });

  test('the four fields it hashes are the four a completed trace carries', () => {
    // The whole design rests on this: "was this approved?" is answerable from
    // the execution record alone, with no approval id written onto the trace.
    const approval = aRequest(registry);
    const fromTheRecord = approvalActionHash({
      subject: 'agent_refunds',
      module: 'finance',
      action: 'refund',
      inputHash: sha256('{"amount":1000}'),
    });

    expect(fromTheRecord).toBe(approval.actionHash);
  });

  test('an approval for one payload does not cover another', () => {
    // The failure mode this exists to prevent: approve £10, present it for
    // £10,000. One byte of the input differs and the hash no longer matches.
    const ten = approvalActionHash(anAction({ inputHash: sha256('{"amount":1000}') }));
    const tenThousand = approvalActionHash(anAction({ inputHash: sha256('{"amount":1000000}') }));

    expect(ten).not.toBe(tenThousand);
  });

  test('it refuses a request that cannot be matched back to an execution', () => {
    expect(() => aRequest(registry, { action: { ...anAction(), inputHash: 'not-a-hash' } }))
      .toThrow(/sixty-four hex characters/);
    expect(() => aRequest(registry, { action: { ...anAction(), module: '' } }))
      .toThrow(/action\.module is required/);
    expect(() => aRequest(registry, { context: '' }))
      .toThrow(/decision made from a hash is not a decision anybody can defend/);
    expect(() => aRequest(registry, { policyVersion: '' }))
      .toThrow(/policyRef and policyVersion are required/);
    expect(() => aRequest(registry, { requestedBy: '' }))
      .toThrow(/who is asking/);
  });

  test('an approval cannot be requested with an expiry that outlives its circumstances', () => {
    expect(() => aRequest(registry, { ttlMs: MAX_APPROVAL_TTL_MS + 1 }))
      .toThrow(/standing permission is a capability token's job/);
    expect(() => aRequest(registry, { ttlMs: 0 })).toThrow(/positive number/);
  });
});

describe('the rules that are refused rather than warned about', () => {
  test('the requester may not decide their own request', () => {
    const approval = aRequest(registry);

    expect(() => registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'agent_refunds', basis: 'looks fine to me',
    })).toThrow(ApprovalError);
    expect(() => registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'agent_refunds', basis: 'looks fine to me',
    })).toThrow(/separation of duties/);

    // And nothing was written — the request is still open for a real approver.
    expect(registry.get(approval.id)!.state).toBe('PENDING');
  });

  test('a decision without a stated basis is refused', () => {
    const approval = aRequest(registry);
    expect(() => registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: '  ' }))
      .toThrow(/what this decision rests on/);
    expect(() => registry.decide(approval.id, { decision: 'GRANTED', decidedBy: '', basis: 'fine' }))
      .toThrow(/cannot be reviewed, revoked or defended/);
  });

  test('a decision is made once', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'REFUSED', decidedBy: 'alice', basis: 'over the limit' });

    expect(() => registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'bob', basis: 'on reflection' }))
      .toThrow(/already refused/);
  });

  test('one approval, one execution', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'duplicate confirmed' });

    expect(registry.consume(approval.id, 'exec_1').state).toBe('CONSUMED');
    expect(() => registry.consume(approval.id, 'exec_2')).toThrow(/already spent on exec_1/);
    // The line this defends: reusable approval is an authority, not an approval.
    expect(() => registry.consume(approval.id, 'exec_2')).toThrow(/capability tokens with scopes and revocation/);
  });

  test('a refused approval cannot be spent', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'REFUSED', decidedBy: 'alice', basis: 'no evidence of duplicate' });
    expect(() => registry.consume(approval.id, 'exec_1')).toThrow(/is refused, not granted/);
  });

  test('a granted approval cannot be withdrawn, so the record keeps that it was granted', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' });
    expect(() => registry.withdraw(approval.id, 'alice', 'changed my mind')).toThrow(/stays in the record/);
  });
});

describe('a signed decision', () => {
  test('verifies against the approver\'s enrolled key, and is kept', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });

    const approval = aRequest(registry);
    const statement = approvalStatement({
      id: approval.id,
      actionHash: approval.actionHash,
      contextHash: approval.contextHash,
      decision: 'GRANTED',
      decidedBy: 'alice',
    });

    const decided = registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'duplicate confirmed against the ledger',
      signature: alice.sign(statement),
    });

    expect(decided.assurance).toBe('PROVEN');
    // Pure function, no registry: what an auditor runs.
    expect(verifyApprovalSignature(decided, alice.publicKeyPem)).toBe(true);
    expect(registry.verify(approval.id)).toEqual({
      checked: true, valid: true, because: expect.stringContaining('verifies against the key currently enrolled'),
    });
  });

  test('a signature over a different context does not verify — the summary is bound', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });
    const approval = aRequest(registry);

    // Alice signs a statement about a summary she was never shown. Binding the
    // context hash is what stops "refund £10" sitting above a £10,000 payload.
    const wrong = approvalStatement({
      id: approval.id,
      actionHash: approval.actionHash,
      contextHash: sha256('Refund £10,000.00 to customer 4471.'),
      decision: 'GRANTED',
      decidedBy: 'alice',
    });

    expect(() => registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: alice.sign(wrong),
    })).toThrow(/does not verify against the key enrolled for alice/);
  });

  test('a signature that does not check writes nothing at all', () => {
    const alice = keypair();
    const mallory = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });
    const approval = aRequest(registry);

    const statement = approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });

    expect(() => registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: mallory.sign(statement),
    })).toThrow(/Nothing was recorded/);

    // The point of the message: a stored decision carrying a signature that does
    // not check reads as stronger evidence than one carrying none.
    expect(registry.get(approval.id)!.state).toBe('PENDING');
    expect(registry.get(approval.id)!.signature).toBeUndefined();
  });

  test('a signature from somebody not enrolled is refused, not downgraded', () => {
    const alice = keypair();
    const approval = aRequest(registry);
    const statement = approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });

    expect(() => registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: alice.sign(statement),
    })).toThrow(/not enrolled, so there is no key to check it against/);
  });

  test('a suspended approver cannot sign a decision', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });
    identities.suspend('alice', 'left the company');

    const approval = aRequest(registry);
    const statement = approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });

    expect(() => registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: alice.sign(statement),
    })).toThrow(/suspended approver's signature must not carry a decision/);
  });

  test('a signature for GRANTED cannot be presented as a refusal', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });
    const approval = aRequest(registry);

    const grantStatement = approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });

    expect(() => registry.decide(approval.id, {
      decision: 'REFUSED', decidedBy: 'alice', basis: 'over the limit', signature: alice.sign(grantStatement),
    })).toThrow(/does not verify/);
  });

  test('a signature for one request cannot be moved to another', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });

    const first = aRequest(registry);
    const second = aRequest(registry, { action: anAction({ inputHash: sha256('{"amount":9000}') }) });

    const forFirst = approvalStatement({
      id: first.id, actionHash: first.actionHash, contextHash: first.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });

    expect(() => registry.decide(second.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: alice.sign(forFirst),
    })).toThrow(/does not verify/);
  });

  test('the statement version is inside the signature', () => {
    const approval = aRequest(registry);
    const parsed = JSON.parse(approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    }));
    expect(parsed[0]).toBe(1);
  });

  test('an unsigned approval never claims to be proven', () => {
    const approval = aRequest(registry);
    const decided = registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed by phone',
    });

    expect(decided.assurance).toBe('ASSERTED');
    expect(verifyApprovalSignature(decided, keypair().publicKeyPem)).toBe(false);
    expect(registry.verify(approval.id)).toEqual({
      checked: false, because: expect.stringContaining('attributed by name'),
    });
  });
});

describe('a rotated key is not tampering', () => {
  test('a signature that stops verifying after rotation says so in those words', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });

    const approval = aRequest(registry);
    const statement = approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });
    registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: alice.sign(statement),
    });

    // Alice rotates. The approval is exactly as sound as it was a second ago.
    const replacement = keypair();
    identities.rotate('alice', replacement.publicKeyPem);

    const result = registry.verify(approval.id);
    expect(result.valid).toBe(false);
    expect(result.because).toMatch(/key rotation since the decision was made/);
    expect(result.because).toMatch(/not evidence of tampering/);

    // And it still verifies for anyone holding the key that actually signed it.
    expect(verifyApprovalSignature(registry.get(approval.id)!, alice.publicKeyPem)).toBe(true);
  });
});

describe('attest — was this execution approved before it ran', () => {
  test('nothing requested is ABSENT, and says why the record is silent', () => {
    const attestation = registry.attest(anAction());
    expect(attestation.state).toBe('ABSENT');
    expect(attestation.notAnsweredBecause).toMatch(/Nothing in the approval record refers to this/);
  });

  test('an open request is UNKNOWN, and carries the step that settles it', () => {
    const approval = aRequest(registry);
    const attestation = registry.attest(anAction());

    expect(attestation.state).toBe('UNKNOWN');
    expect(attestation.resolvedBy).toContain(approval.id);
    expect(attestation.resolvedBy).toMatch(/lapses at/);
  });

  test('granted and in force is DEMONSTRATED, naming who and on what basis', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'ledger shows a duplicate charge' });

    const attestation = registry.attest(anAction());
    expect(attestation.state).toBe('DEMONSTRATED');
    expect(attestation.assurance).toBe('ASSERTED');
    expect(attestation.finding).toMatch(/alice, attributed by name only/);
    expect(attestation.finding).toMatch(/ledger shows a duplicate charge/);
    expect(attestation.finding).toMatch(/Requested by agent_refunds, who did not decide it/);
  });

  test('refused is FAILED', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'REFUSED', decidedBy: 'alice', basis: 'no duplicate found' });

    const attestation = registry.attest(anAction());
    expect(attestation.state).toBe('FAILED');
    expect(attestation.finding).toMatch(/Refused by alice/);
  });

  test('withdrawn is FAILED, not absent', () => {
    const approval = aRequest(registry);
    registry.withdraw(approval.id, 'agent_refunds', 'customer cancelled the dispute');

    const attestation = registry.attest(anAction());
    expect(attestation.state).toBe('FAILED');
    expect(attestation.approvalState).toBe('WITHDRAWN');
  });

  test('an approval spent on another execution does not cover this one', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' });
    registry.consume(approval.id, 'exec_first');

    expect(registry.attest(anAction(), 'exec_first').state).toBe('DEMONSTRATED');

    const stolen = registry.attest(anAction(), 'exec_second');
    expect(stolen.state).toBe('FAILED');
    expect(stolen.finding).toMatch(/spent on execution exec_first, not this one/);
    expect(stolen.finding).toMatch(/running on somebody else's/);
  });

  test('a lapsed request is FAILED, not still pending', () => {
    const approval = registry.request({
      action: anAction(),
      context: 'Refund £10.00.',
      policyRef: 'finance.refunds.max-10000',
      policyVersion: '3',
      requestedBy: 'agent_refunds',
      ttlMs: 20,
    });

    // Expiry is derived at read time, so it does not depend on a sweeper having
    // run. A stored expiry that needs a background job stops working silently.
    return new Promise<void>(resolve => setTimeout(() => {
      expect(registry.get(approval.id)!.state).toBe('EXPIRED');
      expect(registry.pending()).toHaveLength(0);

      const attestation = registry.attest(anAction());
      expect(attestation.state).toBe('FAILED');
      expect(attestation.finding).toMatch(/lapsed at .* without a decision/);

      expect(() => registry.decide(approval.id, {
        decision: 'GRANTED', decidedBy: 'alice', basis: 'late',
      })).toThrow(/already been told to stop waiting/);

      resolve();
    }, 40));
  });

  test('a granted approval wins over an older refusal for the same action', () => {
    const first = aRequest(registry);
    registry.decide(first.id, { decision: 'REFUSED', decidedBy: 'alice', basis: 'needs a manager' });

    const second = aRequest(registry);
    registry.decide(second.id, { decision: 'GRANTED', decidedBy: 'manager_bob', basis: 'escalated and confirmed' });

    const attestation = registry.attest(anAction());
    expect(attestation.state).toBe('DEMONSTRATED');
    expect(attestation.approvalId).toBe(second.id);
  });

  test('every attestation states what it cannot tell you, and scores nothing', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' });
    const attestation = registry.attest(anAction());

    expect(attestation.limits.join(' ')).toMatch(/does not say the decision was right/);
    expect(attestation.limits.join(' ')).toMatch(/reported as ASSERTED/);
    expect(JSON.stringify(attestation)).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(JSON.stringify(attestation)).not.toMatch(/\bscore\b|\bgrade\b|\brating\b/i);
  });

  test('it can be asked by hash alone, so no approval data is needed to ask', () => {
    const approval = aRequest(registry);
    registry.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' });

    expect(registry.attest(approvalActionHash(anAction())).state).toBe('DEMONSTRATED');
  });
});

describe('the queue a person actually works', () => {
  test('pending lists open requests oldest first, and excludes lapsed ones', async () => {
    const first = aRequest(registry);
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = aRequest(registry, { action: anAction({ inputHash: sha256('b') }) });
    const third = registry.request({
      action: anAction({ inputHash: sha256('c') }),
      context: 'Something short-lived.',
      policyRef: 'p', policyVersion: '1', requestedBy: 'agent_refunds', ttlMs: 20,
    });

    expect(registry.pending().map(a => a.id)).toEqual([first.id, second.id, third.id]);

    await new Promise(resolve => setTimeout(resolve, 40));
    expect(registry.pending().map(a => a.id)).toEqual([first.id, second.id]);
  });

  test('an approval keeps what the approver was shown', () => {
    const approval = aRequest(registry);
    const stored = registry.get(approval.id)!;

    expect(stored.context).toBe('Refund £10.00 to customer 4471 for a duplicate charge.');
    expect(stored.policyRef).toBe('finance.refunds.max-10000');
    expect(stored.policyVersion).toBe('3');
  });

  test('an unknown id is a clean error, not a crash', () => {
    expect(registry.get('apr_nope')).toBeUndefined();
    expect(() => registry.consume('apr_nope', 'exec_1')).toThrow(/No approval apr_nope/);
    expect(registry.verify('apr_nope')).toEqual({ checked: false, because: 'No approval apr_nope.' });
  });
});

describe('it works without an identity registry at all', () => {
  test('every decision is ASSERTED, and a signature is refused rather than trusted', () => {
    const bare = new ApprovalRegistry(new Storage(':memory:'));
    const approval = bare.request({
      action: anAction(), context: 'Refund £10.00.',
      policyRef: 'p', policyVersion: '1', requestedBy: 'agent_refunds',
    });

    const decided = bare.decide(approval.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' });
    expect(decided.assurance).toBe('ASSERTED');

    const other = bare.request({
      action: anAction({ inputHash: sha256('z') }), context: 'Another.',
      policyRef: 'p', policyVersion: '1', requestedBy: 'agent_refunds',
    });
    expect(() => bare.decide(other.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: 'AAAA',
    })).toThrow(/not enrolled/);
  });
});

describe('verifyApprovalSignature as an auditor runs it', () => {
  test('it refuses to vouch for a record that was never decided', () => {
    const pending = { state: 'PENDING', signature: 'AAAA', decidedBy: 'alice' } as unknown as Approval;
    expect(verifyApprovalSignature(pending, keypair().publicKeyPem)).toBe(false);
  });

  test('a consumed approval still verifies under the statement it was granted with', () => {
    const alice = keypair();
    identities.enrol({ subject: 'alice', publicKeyPem: alice.publicKeyPem, kind: 'human' });

    const approval = aRequest(registry);
    const statement = approvalStatement({
      id: approval.id, actionHash: approval.actionHash, contextHash: approval.contextHash,
      decision: 'GRANTED', decidedBy: 'alice',
    });
    registry.decide(approval.id, {
      decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed', signature: alice.sign(statement),
    });
    registry.consume(approval.id, 'exec_1');

    // Spending an approval must not destroy the evidence that it was granted.
    expect(verifyApprovalSignature(registry.get(approval.id)!, alice.publicKeyPem)).toBe(true);
  });
});

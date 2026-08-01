/**
 * Layer 5 — Governance. The half of it that was missing.
 *
 * A trace could already record `decision: 'REQUIRES_APPROVAL'`. Nothing in the
 * system could act on it. There was no way to request an approval, grant one,
 * refuse one, expire one, or — the part that matters — for an execution to show
 * afterwards that it was approved *before* it ran. The constitution promised
 * "policies, obligations, approvals and the workflows humans use to run all of
 * it", and three of those four existed.
 *
 * This is the fourth.
 *
 * ## An approval is bound to a hash, not to a request
 *
 * The failure mode this exists to prevent is the one every approval system has:
 * somebody approves a $10 refund and the approval is presented for a $10,000
 * one. So a grant here covers `actionHash` — a digest of the subject, module,
 * action and **input hash** of the thing to be done.
 *
 * Every one of those four fields is also on the completed trace. That is the
 * whole design: the question *"was this execution approved?"* is answerable from
 * the execution record alone, by recomputing the hash. There is no approval id
 * on the trace to be filled in afterwards, because a link the operator writes
 * later is a link the operator can write later. The binding is intrinsic.
 *
 * It also means an approval covers exactly the input that was actually
 * processed. Change one byte of the payload and the hash no longer matches, and
 * the approval does not travel with it.
 *
 * ## The approver signs, and the signature is kept
 *
 * An approval recorded as `decidedBy: "alice"` is a string the operator typed.
 * When the approver holds an enrolled Ed25519 key (Layer 1), they sign a
 * statement naming the request, the action hash, the summary they were shown and
 * their decision. That signature is stored, and `verifyApprovalSignature()` is a
 * pure function — an auditor checks it with the approver's public key and needs
 * to trust neither ABSuite nor the operator.
 *
 * A name-only approval is still recorded, and reported as `ASSERTED` rather than
 * `PROVEN`. Refusing to record it would push approvals back into email, which is
 * worse. Silently presenting it as equivalent would be the lie this project is
 * built to not tell.
 *
 * ## Rules that are refused rather than warned about
 *
 * - **The requester may not decide.** Separation of duties is the first finding
 *   in every governance audit ever conducted.
 * - **A decision needs a basis.** "Approved" with no stated reason cannot be
 *   reviewed later, which makes the record decorative.
 * - **Approvals expire.** A grant with no expiry is a standing permission
 *   wearing an approval's clothes.
 * - **One approval, one execution.** A reusable approval is an *authority*, and
 *   authority is Layer 2's job — capability tokens, with scopes and revocation.
 *   Blurring the two is how an approval quietly becomes a permanent grant.
 */
import { createHash, createPublicKey, randomUUID, verify as cryptoVerify } from 'node:crypto';
import type { Storage } from './storage';
import type { Determination } from './determination';

/** The statement form the approver signs. Inside the signature, as always. */
export const APPROVAL_STATEMENT_VERSION = 1;

/** How long a request stands before it lapses, when the caller names nothing. */
export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * An upper bound on any TTL a caller may ask for.
 *
 * Thirty days, because the alternative is an approval requested with a ten-year
 * expiry, which is a standing permission that nobody ever reviews and that no
 * audit will read as an approval.
 */
export const MAX_APPROVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What is to be done — the four fields a completed trace also carries.
 *
 * Kept to exactly those four so the hash can be recomputed from the record
 * afterwards by somebody holding no approval data at all.
 */
export interface ApprovalAction {
  subject: string;
  module: string;
  action: string;
  /** The hash of the input that will be processed. The binding to the payload. */
  inputHash: string;
}

/** Stored states. `EXPIRED` is not among them — see `effectiveState`. */
export type ApprovalStoredState = 'PENDING' | 'GRANTED' | 'REFUSED' | 'WITHDRAWN' | 'CONSUMED';

/** What a reader sees, including the one state that is derived from the clock. */
export type ApprovalState = ApprovalStoredState | 'EXPIRED';

/** Whether the decision rests on a signature or on a name somebody typed. */
export type ApprovalAssurance = 'PROVEN' | 'ASSERTED';

export interface Approval {
  id: string;
  actionHash: string;
  action: ApprovalAction;
  /** What the approver was shown, in words. Bound into the signed statement. */
  context: string;
  contextHash: string;
  policyRef: string;
  policyVersion: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  state: ApprovalState;
  decidedBy?: string;
  decidedAt?: string;
  basis?: string;
  /** Base64 Ed25519 over `approvalStatement()`, when the approver signed. */
  signature?: string;
  /** The subject whose enrolled key the signature was checked against. */
  signedBy?: string;
  assurance: ApprovalAssurance;
  consumedBy?: string;
  consumedAt?: string;
}

export class ApprovalError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/**
 * The digest a grant covers.
 *
 * Recomputable from a completed execution record, which is the point. Fields are
 * positional rather than keyed so the serialisation cannot shift under a rename,
 * and the version marker leads so a future form cannot be mistaken for this one.
 */
export function approvalActionHash(action: ApprovalAction): string {
  return createHash('sha256')
    .update(JSON.stringify([
      APPROVAL_STATEMENT_VERSION,
      action.subject,
      action.module,
      action.action,
      action.inputHash,
    ]))
    .digest('hex');
}

/**
 * What the approver signs.
 *
 * It names the request, what is to be done, **what they were shown**, and the
 * decision. Binding the context hash is what stops a summary reading "refund
 * £10" while the payload says something else: an auditor recomputes the hash of
 * the stored summary and knows it is the text that was in front of the person.
 *
 * No timestamp. The approver would have to know the server's clock to sign one,
 * and a request leaves `PENDING` exactly once, so there is nothing to replay
 * into.
 */
export function approvalStatement(input: {
  id: string;
  actionHash: string;
  contextHash: string;
  decision: 'GRANTED' | 'REFUSED';
  decidedBy: string;
}): string {
  return JSON.stringify([
    APPROVAL_STATEMENT_VERSION,
    input.id,
    input.actionHash,
    input.contextHash,
    input.decision,
    input.decidedBy,
  ]);
}

/**
 * Check an approval's signature against a public key.
 *
 * Pure, exported, and dependent on nothing — an auditor holding the approval
 * record and the approver's public key can run this without ABSuite, which is
 * the same property `/executions/public-key` gives the chain.
 */
export function verifyApprovalSignature(approval: Approval, publicKeyPem: string): boolean {
  if (!approval.signature) return false;
  if (approval.state !== 'GRANTED' && approval.state !== 'REFUSED' && approval.state !== 'CONSUMED') return false;
  if (!approval.decidedBy) return false;

  // A consumed approval was granted; the statement it was signed under says so.
  const decision = approval.state === 'REFUSED' ? 'REFUSED' : 'GRANTED';
  const statement = approvalStatement({
    id: approval.id,
    actionHash: approval.actionHash,
    contextHash: approval.contextHash,
    decision,
    decidedBy: approval.decidedBy,
  });

  try {
    return cryptoVerify(
      null,
      Buffer.from(statement, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(approval.signature, 'base64')
    );
  } catch {
    return false;
  }
}

export interface ApprovalAttestation {
  state: Determination;
  /** The approval's own state, which carries more detail than four words can. */
  approvalState?: ApprovalState;
  approvalId?: string;
  assurance?: ApprovalAssurance;
  finding: string;
  resolvedBy?: string;
  notAnsweredBecause?: string;
  limits: string[];
}

/** The minimum an identity registry must offer for a signature to be checkable. */
interface KeyLookup {
  get(subject: string): { publicKeyPem: string; status: string } | undefined;
}

function hashContext(context: string): string {
  return createHash('sha256').update(context).digest('hex');
}

function normaliseAction(input: unknown): ApprovalAction {
  if (!input || typeof input !== 'object') {
    throw new ApprovalError('action is required — what is being approved.', 'INVALID_REQUEST');
  }
  const { subject, module, action, inputHash } = input as Record<string, unknown>;

  const required = (value: unknown, name: string): string => {
    const text = String(value ?? '').trim();
    if (!text) {
      throw new ApprovalError(
        `action.${name} is required. All four fields are on the execution record too, and an approval missing one cannot be matched back to what ran.`,
        'INVALID_REQUEST'
      );
    }
    return text;
  };

  const hash = required(inputHash, 'inputHash');
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new ApprovalError(
      'action.inputHash must be a SHA-256 digest — sixty-four hex characters. The approval binds to the payload through it, so an approximation of it approves nothing.',
      'INVALID_REQUEST'
    );
  }

  return {
    subject: required(subject, 'subject'),
    module: required(module, 'module'),
    action: required(action, 'action'),
    inputHash: hash.toLowerCase(),
  };
}

/**
 * Requests, decisions, and the proof that one preceded the other.
 *
 * The registry never makes a decision. It records that a person made one, who
 * they were, what they were shown and what they said — the same discipline
 * `ModelRegistry.approve` holds to, for the same reason: a system that implied
 * it had judged would be claiming something nothing here supports.
 */
export class ApprovalRegistry {
  /**
   * @param identities Optional. When present, a decision may be signed and
   *   checked against an enrolled key, and an approval reaches `PROVEN`. Without
   *   it every decision is `ASSERTED`, and says so.
   */
  constructor(
    private readonly storage: Storage,
    private readonly identities?: KeyLookup
  ) {}

  /**
   * Open a request. The execution has not run and must not.
   *
   * `context` is required because an approver deciding from four hashes is not
   * reviewing anything. It is the requester's summary — stated as such — and its
   * hash is inside the signature, so what the approver read is fixed.
   */
  request(input: {
    action: unknown;
    context: string;
    policyRef: string;
    policyVersion: string;
    requestedBy: string;
    ttlMs?: number;
  }): Approval {
    const action = normaliseAction(input.action);

    const context = String(input.context ?? '').trim();
    if (!context) {
      throw new ApprovalError(
        'context is required — what the approver is being asked to allow, in words. A decision made from a hash is not a decision anybody can defend.',
        'INVALID_REQUEST'
      );
    }

    const policyRef = String(input.policyRef ?? '').trim();
    const policyVersion = String(input.policyVersion ?? '').trim();
    if (!policyRef || !policyVersion) {
      throw new ApprovalError(
        'policyRef and policyVersion are required. An approval exists because a rule demanded one; without naming the rule and its version the request cannot be replayed.',
        'INVALID_REQUEST'
      );
    }

    const requestedBy = String(input.requestedBy ?? '').trim();
    if (!requestedBy) {
      throw new ApprovalError('requestedBy is required — who is asking.', 'INVALID_REQUEST');
    }

    const ttl = input.ttlMs === undefined ? DEFAULT_APPROVAL_TTL_MS : Number(input.ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new ApprovalError('ttlMs must be a positive number of milliseconds.', 'INVALID_REQUEST');
    }
    if (ttl > MAX_APPROVAL_TTL_MS) {
      throw new ApprovalError(
        `ttlMs may not exceed ${MAX_APPROVAL_TTL_MS}ms (30 days). An approval that outlives the circumstances it was granted under is a standing permission, and standing permission is a capability token's job.`,
        'INVALID_REQUEST'
      );
    }

    const now = Date.now();
    const approval: Approval = {
      id: `apr_${randomUUID().replace(/-/g, '')}`,
      actionHash: approvalActionHash(action),
      action,
      context,
      contextHash: hashContext(context),
      policyRef,
      policyVersion,
      requestedBy,
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      state: 'PENDING',
      assurance: 'ASSERTED',
    };

    this.storage.run(
      `INSERT INTO approvals (id, action_hash, action, context, context_hash, policy_ref, policy_version,
        requested_by, requested_at, expires_at, state) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      approval.id, approval.actionHash, JSON.stringify(action), context, approval.contextHash,
      policyRef, policyVersion, requestedBy, approval.requestedAt, approval.expiresAt, 'PENDING'
    );

    return approval;
  }

  /**
   * Grant or refuse.
   *
   * A signature is optional and strictly better. When one is supplied it is
   * checked against the decider's enrolled key before anything is written — a
   * decision recorded with a signature that does not verify would be worse than
   * one with no signature at all, because it looks stronger.
   */
  decide(
    id: string,
    input: {
      decision: 'GRANTED' | 'REFUSED';
      decidedBy: string;
      basis: string;
      /** Base64 Ed25519 over `approvalStatement()`, signed by `decidedBy`. */
      signature?: string;
    }
  ): Approval {
    const approval = this.require(id);

    if (approval.state === 'EXPIRED') {
      throw new ApprovalError(
        `That request lapsed at ${approval.expiresAt}. Deciding it now would date the decision to a moment the requester had already been told to stop waiting for.`,
        'APPROVAL_EXPIRED'
      );
    }
    if (approval.state !== 'PENDING') {
      throw new ApprovalError(
        `That request is already ${approval.state.toLowerCase()}. A decision is made once; changing it afterwards is a new request, so that both are in the record.`,
        'APPROVAL_DECIDED'
      );
    }

    const decision = input.decision;
    if (decision !== 'GRANTED' && decision !== 'REFUSED') {
      throw new ApprovalError('decision must be GRANTED or REFUSED.', 'INVALID_REQUEST');
    }

    const decidedBy = String(input.decidedBy ?? '').trim();
    if (!decidedBy) {
      throw new ApprovalError(
        'decidedBy is required. An approval with nobody behind it cannot be reviewed, revoked or defended.',
        'INVALID_REQUEST'
      );
    }
    if (decidedBy === approval.requestedBy) {
      throw new ApprovalError(
        `${decidedBy} requested this. The requester may not decide it — separation of duties is the first thing any audit checks, and an approval that fails it is worth less than no approval, because it looks like one.`,
        'SELF_APPROVAL'
      );
    }

    const basis = String(input.basis ?? '').trim();
    if (!basis) {
      throw new ApprovalError(
        'basis is required — what this decision rests on. Recorded reasoning is the only part of an approval that helps anybody six months later.',
        'INVALID_REQUEST'
      );
    }

    let assurance: ApprovalAssurance = 'ASSERTED';
    let signature: string | undefined;

    if (input.signature) {
      const identity = this.identities?.get(decidedBy);
      if (!identity) {
        throw new ApprovalError(
          `A signature was supplied but ${decidedBy} is not enrolled, so there is no key to check it against. Enrol the approver, or decide without a signature and accept that the decision is attributed by name only.`,
          'APPROVER_UNKNOWN'
        );
      }
      if (identity.status !== 'active') {
        throw new ApprovalError(
          `${decidedBy} is ${identity.status}. A suspended approver's signature must not carry a decision.`,
          'APPROVER_SUSPENDED'
        );
      }

      const statement = approvalStatement({
        id: approval.id,
        actionHash: approval.actionHash,
        contextHash: approval.contextHash,
        decision,
        decidedBy,
      });

      const ok = (() => {
        try {
          return cryptoVerify(
            null,
            Buffer.from(statement, 'utf8'),
            createPublicKey(identity.publicKeyPem),
            Buffer.from(String(input.signature), 'base64')
          );
        } catch {
          return false;
        }
      })();

      if (!ok) {
        throw new ApprovalError(
          `That signature does not verify against the key enrolled for ${decidedBy}. Nothing was recorded — a decision stored with a signature that does not check would read as stronger evidence than one with no signature at all.`,
          'SIGNATURE_INVALID'
        );
      }

      signature = String(input.signature);
      assurance = 'PROVEN';
    }

    const decidedAt = new Date().toISOString();
    this.storage.run(
      'UPDATE approvals SET state = ?, decided_by = ?, decided_at = ?, basis = ?, signature = ?, signed_by = ? WHERE id = ?',
      decision, decidedBy, decidedAt, basis, signature ?? null, signature ? decidedBy : null, id
    );

    return {
      ...approval,
      state: decision,
      decidedBy,
      decidedAt,
      basis,
      ...(signature ? { signature, signedBy: decidedBy } : {}),
      assurance,
    };
  }

  /**
   * Withdraw a request that should no longer be decided.
   *
   * Only from `PENDING`. A granted approval is not withdrawn — it is spent,
   * refused before it was granted, or left to expire. Allowing a grant to be
   * retracted would let an operator remove the evidence that they had once
   * allowed something.
   */
  withdraw(id: string, by: string, reason: string): Approval {
    const approval = this.require(id);
    if (approval.state !== 'PENDING') {
      throw new ApprovalError(
        `Only a pending request can be withdrawn; this one is ${approval.state.toLowerCase()}. A decision already made stays in the record.`,
        'APPROVAL_DECIDED'
      );
    }
    const who = String(by ?? '').trim();
    const why = String(reason ?? '').trim();
    if (!who || !why) throw new ApprovalError('Withdrawing takes who and why.', 'INVALID_REQUEST');

    const at = new Date().toISOString();
    this.storage.run(
      'UPDATE approvals SET state = ?, decided_by = ?, decided_at = ?, basis = ? WHERE id = ?',
      'WITHDRAWN', who, at, why, id
    );
    return { ...approval, state: 'WITHDRAWN', decidedBy: who, decidedAt: at, basis: why };
  }

  /**
   * Spend a granted approval on one execution, and refuse to spend it twice.
   *
   * Called with the trace id at the moment the action runs. The second call
   * fails, which is the difference between an approval and a permission.
   */
  consume(id: string, traceId: string): Approval {
    const approval = this.require(id);
    const trace = String(traceId ?? '').trim();
    if (!trace) throw new ApprovalError('traceId is required — what is being run under this approval.', 'INVALID_REQUEST');

    if (approval.state === 'CONSUMED') {
      throw new ApprovalError(
        `That approval was already spent on ${approval.consumedBy}. One approval, one execution — a reusable one is an authority, and authorities are capability tokens with scopes and revocation.`,
        'APPROVAL_CONSUMED'
      );
    }
    if (approval.state === 'EXPIRED') {
      throw new ApprovalError(
        `That approval lapsed at ${approval.expiresAt}. It was granted for circumstances that are no longer current.`,
        'APPROVAL_EXPIRED'
      );
    }
    if (approval.state !== 'GRANTED') {
      throw new ApprovalError(
        `That approval is ${approval.state.toLowerCase()}, not granted.`,
        'APPROVAL_NOT_GRANTED'
      );
    }

    const at = new Date().toISOString();
    this.storage.run(
      'UPDATE approvals SET state = ?, consumed_by = ?, consumed_at = ? WHERE id = ?',
      'CONSUMED', trace, at, id
    );
    return { ...approval, state: 'CONSUMED', consumedBy: trace, consumedAt: at };
  }

  get(id: string): Approval | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM approvals WHERE id = ?', String(id ?? ''));
    return row ? this.rowToApproval(row) : undefined;
  }

  /** Every approval touching an action, newest first. Usually zero or one. */
  forAction(actionHash: string): Approval[] {
    return this.storage
      .all<Record<string, unknown>>(
        'SELECT * FROM approvals WHERE action_hash = ? ORDER BY requested_at DESC',
        String(actionHash ?? '')
      )
      .map(row => this.rowToApproval(row));
  }

  /** What a person needs to look at. Expired requests are not pending. */
  pending(): Approval[] {
    return this.storage
      .all<Record<string, unknown>>(
        'SELECT * FROM approvals WHERE state = ? ORDER BY requested_at ASC',
        'PENDING'
      )
      .map(row => this.rowToApproval(row))
      .filter(approval => approval.state === 'PENDING');
  }

  list(limit = 100): Approval[] {
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM approvals ORDER BY requested_at DESC LIMIT ?', Math.max(1, Math.min(1000, limit)))
      .map(row => this.rowToApproval(row));
  }

  /**
   * Was this execution approved before it ran?
   *
   * Answered from the four fields the trace already carries, so the caller needs
   * no approval id and the operator has no field to fill in afterwards.
   *
   * - `ABSENT`       — nothing was ever requested for this action.
   * - `UNKNOWN`      — a request is open. Nobody has decided.
   * - `FAILED`       — refused, withdrawn, lapsed, or spent on something else.
   * - `DEMONSTRATED` — granted, in force, and spent on this execution if named.
   */
  attest(action: ApprovalAction | string, traceId?: string): ApprovalAttestation {
    const actionHash = typeof action === 'string' ? action : approvalActionHash(action);
    const limits = [
      'This says an approval exists and holds. It does not say the decision was right — that is a judgement, and it is not ABSuite\'s.',
      'A decision recorded without a signature is attributed by the name the operator supplied, and is reported as ASSERTED for that reason.',
    ];

    const all = this.forAction(actionHash);
    if (all.length === 0) {
      return {
        state: 'ABSENT',
        finding: 'No approval was ever requested for this action. Either the governing rule did not demand one, or the action ran without asking.',
        notAnsweredBecause: 'Nothing in the approval record refers to this subject, module, action and input hash.',
        limits,
      };
    }

    // A granted or consumed approval is the answer when one exists; anything
    // else is only interesting once nothing has been granted.
    const rank: Record<ApprovalState, number> = {
      CONSUMED: 0, GRANTED: 1, PENDING: 2, REFUSED: 3, WITHDRAWN: 4, EXPIRED: 5,
    };
    const approval = [...all].sort((a, b) => rank[a.state] - rank[b.state])[0]!;
    const base = {
      approvalState: approval.state,
      approvalId: approval.id,
      assurance: approval.assurance,
      limits,
    };

    if (approval.state === 'PENDING') {
      return {
        ...base,
        state: 'UNKNOWN',
        finding: `${approval.requestedBy} requested approval at ${approval.requestedAt} under policy ${approval.policyRef} (v${approval.policyVersion}). Nobody has decided yet.`,
        resolvedBy: `Grant or refuse ${approval.id}. It lapses at ${approval.expiresAt}.`,
      };
    }

    if (approval.state === 'GRANTED' || approval.state === 'CONSUMED') {
      const spentElsewhere =
        approval.state === 'CONSUMED' && traceId && approval.consumedBy && approval.consumedBy !== traceId;

      if (spentElsewhere) {
        return {
          ...base,
          state: 'FAILED',
          finding: `This action was approved, but that approval was spent on execution ${approval.consumedBy}, not this one. An approval covers one execution; this one is running on somebody else's.`,
        };
      }

      const how = approval.assurance === 'PROVEN'
        ? `${approval.decidedBy}, who signed the decision with their enrolled key`
        : `${approval.decidedBy}, attributed by name only`;

      return {
        ...base,
        state: 'DEMONSTRATED',
        finding:
          `Approved by ${how}, at ${approval.decidedAt}, under policy ${approval.policyRef} (v${approval.policyVersion}). ` +
          `Requested by ${approval.requestedBy}, who did not decide it. Basis: ${approval.basis}. ` +
          (approval.state === 'CONSUMED'
            ? `Spent on execution ${approval.consumedBy}.`
            : 'Granted and not yet spent.'),
      };
    }

    if (approval.state === 'EXPIRED') {
      return {
        ...base,
        state: 'FAILED',
        finding: `Approval was requested by ${approval.requestedBy} at ${approval.requestedAt} and lapsed at ${approval.expiresAt} without a decision. An action running on this has an unanswered request behind it, not an approval.`,
      };
    }

    return {
      ...base,
      state: 'FAILED',
      finding: approval.state === 'REFUSED'
        ? `Refused by ${approval.decidedBy} at ${approval.decidedAt}. Basis: ${approval.basis}.`
        : `Withdrawn by ${approval.decidedBy} at ${approval.decidedAt}. Basis: ${approval.basis}.`,
    };
  }

  /**
   * Re-check a stored signature against the enrolled key, now.
   *
   * Separate from `attest` on purpose. `attest` reports what the record says;
   * this re-derives it. They can disagree — after a key rotation the signature
   * stops verifying while the approval remains exactly as sound as it was, which
   * is the same distinction the chain draws between `contentIntact` and
   * `signatureValid`, and it must never read as tampering.
   */
  verify(id: string): { checked: boolean; valid?: boolean; because: string } {
    const approval = this.get(id);
    if (!approval) return { checked: false, because: `No approval ${id}.` };
    if (!approval.signature || !approval.signedBy) {
      return { checked: false, because: 'This decision carries no signature, so there is nothing to check. It is attributed by name.' };
    }
    const identity = this.identities?.get(approval.signedBy);
    if (!identity) {
      return {
        checked: false,
        because: `${approval.signedBy} is no longer enrolled, so the key to check this against is not held here. The signature is still in the record and anyone holding that public key can verify it.`,
      };
    }
    const valid = verifyApprovalSignature(approval, identity.publicKeyPem);
    return {
      checked: true,
      valid,
      because: valid
        ? `The decision verifies against the key currently enrolled for ${approval.signedBy}.`
        : `The decision does not verify against the key currently enrolled for ${approval.signedBy}. The most common cause is a key rotation since the decision was made, and that is not evidence of tampering — the approval itself is unchanged.`,
    };
  }

  private require(id: string): Approval {
    const approval = this.get(id);
    if (!approval) throw new ApprovalError(`No approval ${id}.`, 'NOT_FOUND');
    return approval;
  }

  /**
   * `EXPIRED` is derived here rather than swept by a job.
   *
   * A stored expiry that depends on a background task having run is an expiry
   * that silently stops working the day the task dies, and every read in between
   * reports a lapsed approval as live.
   */
  private rowToApproval(row: Record<string, unknown>): Approval {
    const stored = String(row.state) as ApprovalStoredState;
    const expiresAt = String(row.expires_at);
    const lapsed = stored === 'PENDING' && expiresAt < new Date().toISOString();

    return {
      id: String(row.id),
      actionHash: String(row.action_hash),
      action: JSON.parse(String(row.action)) as ApprovalAction,
      context: String(row.context),
      contextHash: String(row.context_hash),
      policyRef: String(row.policy_ref),
      policyVersion: String(row.policy_version),
      requestedBy: String(row.requested_by),
      requestedAt: String(row.requested_at),
      expiresAt,
      state: lapsed ? 'EXPIRED' : stored,
      ...(row.decided_by ? { decidedBy: String(row.decided_by) } : {}),
      ...(row.decided_at ? { decidedAt: String(row.decided_at) } : {}),
      ...(row.basis ? { basis: String(row.basis) } : {}),
      ...(row.signature ? { signature: String(row.signature) } : {}),
      ...(row.signed_by ? { signedBy: String(row.signed_by) } : {}),
      assurance: row.signature ? 'PROVEN' : 'ASSERTED',
      ...(row.consumed_by ? { consumedBy: String(row.consumed_by) } : {}),
      ...(row.consumed_at ? { consumedAt: String(row.consumed_at) } : {}),
    };
  }
}

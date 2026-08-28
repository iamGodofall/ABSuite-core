/**
 * Verifiable execution traces.
 *
 * This is what makes the claim "every action is permitted, traceable and
 * *provable*" literally true. Every real action produces a record of what
 * authorised it, what ran, and what came back — hash-chained so history cannot
 * be rewritten, and signed with Ed25519 so a third party can verify it holding
 * only a public key.
 *
 * Ed25519 rather than HMAC is the deliberate choice: an auditor who can verify
 * your records must not also be able to forge them. A shared secret cannot
 * make that distinction; an asymmetric signature can.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Storage } from './storage';

export type ExecutionOutcome = 'success' | 'failure';

export interface ExecutionStep {
  seq: number;
  name: string;
  at: string;
  detail?: string;
}

/**
 * Which rule permitted an action — as distinct from which capability carried it.
 *
 * A scope answers "was this allowed?". It cannot answer "should it have been?",
 * because a capability is the *result* of a governing decision, not the decision
 * itself. Recording the rule, its version and the specific conditions that were
 * checked is what closes that gap.
 *
 * ABSuite records the decision. It does not make it, and it never asserts the
 * decision was correct — only which rule produced it, so that a person can ask
 * whether that rule should have existed.
 */
export interface GovernanceRecord {
  /** Stable identifier of the rule, e.g. "finance.refunds.max-10000". */
  policyRef: string;
  /** The exact version evaluated. A rule without a version cannot be replayed. */
  policyVersion: string;
  decision: 'PERMITTED' | 'DENIED' | 'REQUIRES_APPROVAL';
  /** The specific conditions checked, in the evaluator's own words. */
  evidence: string[];
  /** Who or what evaluated the rule, when it is not ABSuite. */
  evaluatedBy?: string;
}

/**
 * What an action cost, and who says so.
 *
 * ABSuite meters nothing. It does not watch a GPU, hold a billing account, or
 * know what a provider charges. So a cost here is not a measurement — it is a
 * *claim*, made by whoever recorded the execution, signed into the record so
 * that the claim can be attributed later and cannot be quietly revised.
 *
 * That is the entire value on offer, and it is narrower and more useful than a
 * dashboard of gauges: not "what is the cluster spending", which somebody else's
 * product already answers, but **which governed action consumed this, under
 * which authorization, producing which outcome** — with a record that proves the
 * figure has not moved since it was written.
 *
 * `source` is required for that reason. A number with no author is a rumour.
 */
export interface CostRecord {
  /**
   * Integer minor units of `currency` — 1420 is $14.20.
   *
   * Money is never a float here. `0.1 + 0.2` is the oldest bug in accounting
   * software, and a spend figure that drifts in the eleventh decimal is a spend
   * figure an auditor is entitled to reject.
   */
  amount: number;
  /** ISO-4217 alphabetic code, uppercase. A number without one is not a cost. */
  currency: string;
  /** Who asserted the figure — a provider, a meter, a finance system, a person. */
  source: string;
  /** What was metered, when the caller knows: "tokens", "gpu-seconds", "calls". */
  unit?: string;
  /** How many of `unit`. Present only with a unit; neither implies the other's value. */
  quantity?: number;
}

export interface ExecutionTrace {
  id: string;
  tenantId?: string;
  /** Subject of the capability token that authorised this execution. */
  subject: string;
  /** Token id, so a trace can be tied to a specific issued credential. */
  jti?: string;
  scope: string[];
  module: string;
  action: string;
  inputHash: string;
  outputHash?: string;
  outcome: ExecutionOutcome;
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  steps: ExecutionStep[];
  /** The rule that permitted this, when the caller recorded one. */
  governance?: GovernanceRecord;
  /** What it cost, when the caller recorded a figure. Signed with the rest. */
  cost?: CostRecord;
  /**
   * Canonical form this record was written with. Absent means v1.
   *
   * Never written for v1, so records that predate versioning hash exactly as
   * they always did.
   */
  canonicalVersion?: number;
  /** Hash of the preceding trace, linking the log into a chain. */
  prevHash: string;
  hash: string;
  signature?: string;
  keyId?: string;
}

export const GENESIS_HASH = '0'.repeat(64);

/** Stable hash of arbitrary input, used so payloads never need storing. */
export function hashPayload(value: unknown): string {
  const canonical = value === undefined ? 'undefined' : JSON.stringify(value, canonicalReplacer);
  return createHash('sha256').update(canonical ?? 'null').digest('hex');
}

/**
 * Sort object keys so two structurally equal payloads hash identically
 * regardless of the order their fields happened to be built in.
 */
function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = (value as Record<string, unknown>)[key];
    }
    return sorted;
  }
  return value;
}

/**
 * The canonical form this build writes.
 *
 * A canonical form is a contract with history, not an implementation detail.
 * The moment anyone records evidence with it, every future version of ABSuite
 * owes those records a verification — because evidence that expires when the
 * software changes was never evidence.
 *
 * So versions are additive and permanent. v1 is frozen: the sixteen fields
 * below, plus governance appended only when present. Nothing may be reordered,
 * removed or defaulted into it, ever.
 */
export const CANONICAL_VERSION = 2;

/** Every form this build can verify. Old versions are never dropped. */
export const SUPPORTED_CANONICAL_VERSIONS: readonly number[] = [1, 2];

/**
 * The smallest form that can express a record.
 *
 * A record is written in the oldest canonical form capable of carrying its
 * fields, not in the newest form this build knows. That distinction matters to
 * everyone already running ABSuite: upgrading the library must not silently
 * start writing records their existing auditors, verifiers and archived copies
 * of capkit can no longer read.
 *
 * So a record with no cost is still v1 — byte-identical to what this build
 * wrote yesterday — and only a record that actually uses v2's one new field
 * asks for a v2 verifier. Nobody pays for a feature they did not use.
 */
export function minimumCanonicalVersion(trace: { cost?: CostRecord }): number {
  return trace.cost ? 2 : 1;
}

/**
 * Which canonical form a record was written with.
 *
 * v1 records carry no marker — absence *is* v1, which is what lets records
 * written before versioning existed stay byte-identical. From v2 onward the
 * version number must be the first element of the canonical form itself, so it
 * is signed: an unsigned version marker would let anyone change how a record is
 * verified by editing one number.
 */
export function canonicalVersionOf(trace: { canonicalVersion?: number }): number {
  return trace.canonicalVersion ?? 1;
}

/** Thrown when asked to canonicalise a form this build does not know. */
export class UnsupportedCanonicalVersion extends Error {
  constructor(readonly version: number) {
    super(
      `This build writes canonical form v${CANONICAL_VERSION} and can verify ` +
        `v${SUPPORTED_CANONICAL_VERSIONS.join(', v')}. It cannot check a record written as v${version}.`
    );
    this.name = 'UnsupportedCanonicalVersion';
  }
}

/**
 * Thrown when a record's declared form cannot express the record's own fields.
 *
 * Distinct from `UnsupportedCanonicalVersion` on purpose. That one means "this
 * build is too old to read you". This one means "you are internally
 * inconsistent" — and a reader must never confuse the two, because the first is
 * fixed by upgrading and the second by whoever wrote the record.
 */
export class MalformedCanonicalRecord extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedCanonicalRecord';
  }
}

/**
 * Canonical form of a trace, in a fixed field order.
 *
 * `hash` and `signature` are excluded — they are derived from this, so
 * including them would be circular.
 *
 * Dispatches on the record's own version. A record from the future is refused
 * rather than canonicalised with the wrong rules, because verifying it under v1
 * would produce a hash mismatch and report a perfectly good record as tampered.
 */
export function canonicalTrace(trace: Omit<ExecutionTrace, 'hash' | 'signature'>): string {
  const version = canonicalVersionOf(trace);
  if (!SUPPORTED_CANONICAL_VERSIONS.includes(version)) {
    throw new UnsupportedCanonicalVersion(version);
  }
  return version === 1 ? canonicalV1(trace) : canonicalV2(trace);
}

/** v1 — frozen January 2026. Never edit this function. */
function canonicalV1(trace: Omit<ExecutionTrace, 'hash' | 'signature'>): string {
  // A form must refuse what it cannot express. v1 has no slot for cost, so
  // canonicalising a costed record as v1 would leave the figure outside the
  // hash — signed nowhere, removable by anyone, and still displayed as evidence.
  // Silently dropping a field is the worst available outcome; this is the whole
  // reason a version marker exists.
  if (trace.cost) {
    throw new MalformedCanonicalRecord(
      'This record carries a cost but declares canonical form v1, which has no slot for one. ' +
        'Hashing it as v1 would leave the figure outside the signature. A costed record must declare v2.'
    );
  }

  const fields: unknown[] = [
    trace.id,
    trace.tenantId ?? null,
    trace.subject,
    trace.jti ?? null,
    [...trace.scope].sort(),
    trace.module,
    trace.action,
    trace.inputHash,
    trace.outputHash ?? null,
    trace.outcome,
    trace.error ?? null,
    trace.startedAt,
    trace.completedAt ?? null,
    trace.durationMs ?? null,
    trace.steps.map(step => [step.seq, step.name, step.at, step.detail ?? null]),
    trace.prevHash,
  ];

  // Governance is appended only when it exists, which is what makes this change
  // safe to ship against chains that already have records in them. A `null`
  // placeholder would alter the canonical form of every trace ever written and
  // break verification for all of them — the whole log would report as tampered
  // because we added a field.
  //
  // Stripping governance from a record that has it still fails: the array loses
  // an element, the canonical string changes, the hash no longer matches. The
  // two lengths cannot collide, so this is unambiguous in both directions.
  if (trace.governance) {
    fields.push([
      trace.governance.policyRef,
      trace.governance.policyVersion,
      trace.governance.decision,
      [...trace.governance.evidence],
      trace.governance.evaluatedBy ?? null,
    ]);
  }

  return JSON.stringify(fields);
}

/**
 * v2 — adds cost. Frozen on the day the first v2 record was signed.
 *
 * Two things changed from v1, and both are deliberate.
 *
 * The version number is the **first element**, so it is inside the hash and
 * therefore inside the signature. An unsigned version marker would let anyone
 * change how a record is verified by editing one integer, which is the same as
 * having no marker at all.
 *
 * Every slot is **always present**, `null` when empty — no conditional appends.
 * v1 grew governance by appending it only when it existed, which was the only
 * safe move against records already in the wild but leaves the array length
 * carrying meaning. With optional fields at two slots that stops being
 * unambiguous, so v2 fixes the shape at nineteen elements and never varies it.
 */
function canonicalV2(trace: Omit<ExecutionTrace, 'hash' | 'signature'>): string {
  return JSON.stringify([
    2,
    trace.id,
    trace.tenantId ?? null,
    trace.subject,
    trace.jti ?? null,
    [...trace.scope].sort(),
    trace.module,
    trace.action,
    trace.inputHash,
    trace.outputHash ?? null,
    trace.outcome,
    trace.error ?? null,
    trace.startedAt,
    trace.completedAt ?? null,
    trace.durationMs ?? null,
    trace.steps.map(step => [step.seq, step.name, step.at, step.detail ?? null]),
    trace.prevHash,
    trace.governance
      ? [
          trace.governance.policyRef,
          trace.governance.policyVersion,
          trace.governance.decision,
          [...trace.governance.evidence],
          trace.governance.evaluatedBy ?? null,
        ]
      : null,
    trace.cost
      ? [
          trace.cost.amount,
          trace.cost.currency,
          trace.cost.source,
          trace.cost.unit ?? null,
          trace.cost.quantity ?? null,
        ]
      : null,
  ]);
}

export function hashTrace(trace: Omit<ExecutionTrace, 'hash' | 'signature'>): string {
  return createHash('sha256').update(canonicalTrace(trace)).digest('hex');
}

/**
 * Ed25519 signing key.
 *
 * In production the private key comes from configuration. Without one we
 * generate an ephemeral pair and say so loudly — signatures would otherwise
 * silently stop verifying after a restart, which is worse than not signing.
 */
/**
 * A signed note that this instance walked the chain to `seq` and found `hash`.
 *
 * Not a security boundary — see the table comment in storage.ts. It shortens a
 * re-verification; it does not stand in for one.
 */
export interface ChainCheckpoint {
  seq: number;
  hash: string;
  verifiedAt: string;
  keyId?: string;
  signature: string;
}

/**
 * A signed note that records up to `seq` were removed under a retention policy,
 * and that the surviving chain legitimately resumes from `hash`.
 *
 * Retention and truncation delete records in exactly the same way; the only
 * thing that separates them is whether the deletion was authorised, and an
 * anchor is what authorisation looks like when it has to survive in the same
 * file as the gap it explains. Without one, a chain whose oldest record links
 * to a predecessor that is gone is indistinguishable from a chain somebody
 * trimmed — so `verifyChain` calls that BROKEN, and should.
 */
export interface RetentionAnchor {
  /** The highest sequence number removed. The surviving chain starts after it. */
  seq: number;
  /** The hash of the record at `seq` — what the oldest survivor must link to. */
  hash: string;
  /** How many records this sweep removed. */
  removed: number;
  /** The retention window applied, in days. */
  policyDays: number;
  prunedAt: string;
  keyId?: string;
  signature: string;
}

export class SigningKey {
  private readonly privateKey: KeyObject;
  readonly publicKeyPem: string;
  readonly keyId: string;
  readonly ephemeral: boolean;

  constructor(privateKeyPem?: string, keyId = 'absuite-trace-key') {
    const configured = (privateKeyPem || '').trim();

    if (configured) {
      this.privateKey = createPrivateKey(configured);
      this.ephemeral = false;
    } else {
      this.privateKey = generateKeyPairSync('ed25519').privateKey;
      this.ephemeral = true;
    }

    this.publicKeyPem = createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
    this.keyId = keyId;
  }

  sign(hashHex: string): string {
    return cryptoSign(null, Buffer.from(hashHex, 'utf8'), this.privateKey).toString('base64');
  }

  /** Generate a fresh keypair, for `absuite keygen` style bootstrapping. */
  static generate(): { privateKeyPem: string; publicKeyPem: string } {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  }

  /**
   * Generate a keypair and the `SigningKey` that uses it, in one call.
   *
   * `generate()` returns PEMs, which then have to be fed back through the
   * constructor — a small step, but one every newcomer trips over on their
   * first attempt. This returns both: the key you sign with, and the PEMs you
   * store (the public one to hand to auditors, the private one to your secret
   * manager).
   */
  static createPair(keyId?: string): { key: SigningKey; privateKeyPem: string; publicKeyPem: string } {
    const { privateKeyPem, publicKeyPem } = SigningKey.generate();
    return { key: new SigningKey(privateKeyPem, keyId), privateKeyPem, publicKeyPem };
  }
}

/** Thrown when a cost cannot be recorded as stated. Carries a sentence, not a code. */
export class InvalidCost extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCost';
  }
}

/**
 * Check a cost claim before it is signed into a record that cannot be edited.
 *
 * Everything here is refused rather than repaired. A cost is about to become
 * permanent evidence, and the moment this function starts guessing — rounding a
 * float, defaulting a currency, inferring a source — the record stops being a
 * statement the caller made and becomes one this library made up on their
 * behalf. Every rejection below names what was wrong and what to send instead.
 */
export function normaliseCost(value: unknown): CostRecord {
  if (!value || typeof value !== 'object') {
    throw new InvalidCost('cost must be an object with amount, currency and source.');
  }
  const { amount, currency, source, unit, quantity } = value as Record<string, unknown>;

  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new InvalidCost('cost.amount must be a finite number of minor units — 1420 for $14.20.');
  }
  if (!Number.isInteger(amount)) {
    // Not rounded for them. Whoever holds the invoice decides how a fraction of
    // a cent becomes a cent; a library that picks silently is inventing money.
    throw new InvalidCost(
      `cost.amount must be an integer number of minor units, and ${amount} is not. ` +
        'Money is never stored as a float here. Round it yourself, so the rounding is your decision and not this library\'s.'
    );
  }
  if (amount < 0) {
    // A refund is a thing that happened, so it is its own execution with its own
    // authorization. Folding it into a negative here would let spend be reduced
    // by rewriting history rather than by recording an event.
    throw new InvalidCost('cost.amount cannot be negative. A credit or refund is its own execution, not a negative one.');
  }

  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidCost(
      `cost.currency must be a three-letter ISO-4217 code in upper case, such as USD or ZAR. Received ${JSON.stringify(currency)}. ` +
        'An amount with no currency cannot be added to anything.'
    );
  }

  if (typeof source !== 'string' || source.trim() === '') {
    throw new InvalidCost(
      'cost.source is required: name who asserted this figure — a provider, a meter, a finance system. ' +
        'ABSuite measures nothing, so an unattributed number would be a rumour carrying a signature.'
    );
  }

  const hasUnit = unit !== undefined && unit !== null;
  const hasQuantity = quantity !== undefined && quantity !== null;
  if (hasUnit !== hasQuantity) {
    throw new InvalidCost('cost.unit and cost.quantity travel together: a quantity of nothing, or a unit of no amount, states nothing.');
  }
  if (hasUnit && (typeof unit !== 'string' || unit.trim() === '')) {
    throw new InvalidCost('cost.unit must name what was metered, such as "tokens" or "gpu-seconds".');
  }
  if (hasQuantity && (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0)) {
    throw new InvalidCost('cost.quantity must be a finite, non-negative number.');
  }

  return {
    amount,
    currency,
    source: source.trim(),
    ...(hasUnit ? { unit: (unit as string).trim(), quantity: quantity as number } : {}),
  };
}

export function verifySignature(hashHex: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(hashHex, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

export interface TraceVerdict {
  valid: boolean;
  reason?: string;
  /**
   * `null` when the content could not be checked at all — same convention as
   * `signatureValid`. `false` is a claim that the content does not match its
   * hash, and making that claim without having checked is exactly the false
   * accusation this verdict exists to avoid.
   */
  contentIntact: boolean | null;
  signatureValid: boolean | null;
  /**
   * False when this build cannot check the record at all — a canonical form it
   * does not know.
   *
   * "I could not check this" and "this failed the check" are different
   * statements, and collapsing them is how an old verifier meeting a newer
   * record ends up accusing it of tampering. The only correct response to a
   * record from the future is to say so and upgrade.
   */
  checkable?: boolean;
}

/**
 * Verify a single trace.
 *
 * Content is always checked. The signature is only checked when a public key
 * is supplied, so an operator can confirm integrity without key material while
 * an auditor gets full proof.
 */
export function verifyTrace(trace: ExecutionTrace, publicKeyPem?: string): TraceVerdict {
  const { hash, signature, ...unhashed } = trace;

  let recomputed: string;
  try {
    recomputed = hashTrace(unhashed);
  } catch (error) {
    if (error instanceof UnsupportedCanonicalVersion) {
      // Not tampering. Not valid either. A third answer, and the only honest one.
      return {
        valid: false,
        checkable: false,
        reason: `${error.message} This is not evidence of tampering — it is a record this build is too old to read.`,
        contentIntact: null,
        signatureValid: null,
      };
    }
    if (error instanceof MalformedCanonicalRecord) {
      // Also not tampering, and also not a verdict on the content — this record
      // never had a well-defined hash to check against. Saying "invalid" without
      // saying why would send someone looking for an intruder.
      return { valid: false, checkable: false, reason: error.message, contentIntact: null, signatureValid: null };
    }
    throw error;
  }
  const contentIntact = recomputed === hash;

  if (!contentIntact) {
    return { valid: false, reason: 'Trace content does not match its hash', contentIntact: false, signatureValid: null };
  }

  if (!publicKeyPem) {
    return { valid: true, contentIntact: true, signatureValid: null };
  }

  if (!signature) {
    return { valid: false, reason: 'Trace is not signed', contentIntact: true, signatureValid: false };
  }

  const signatureValid = verifySignature(hash, signature, publicKeyPem);
  return signatureValid
    ? { valid: true, contentIntact: true, signatureValid: true }
    : {
        valid: false,
        // We already know the content matches its hash, so this is not an edit —
        // it is a different key. Saying only "signature does not verify" sends
        // an operator hunting for tampering after a routine key rotation, or
        // after a dev server restarted with an ephemeral key. Name the actual
        // cause; an alarm that cries tampering at every rotation gets muted, and
        // then the real one is missed too.
        reason:
          'Signature does not verify against the supplied key. The content still matches its hash, so this record was not edited — it was signed by a different key (a rotation, or a server that started with an ephemeral one).',
        contentIntact: true,
        signatureValid: false,
      };
}

/**
 * Everything about an execution except the parts the store derives: its id,
 * its place in the chain, its hash and its signature.
 */
type ExecutionBody = Omit<
  ExecutionTrace,
  'id' | 'inputHash' | 'outputHash' | 'startedAt' | 'steps' | 'prevHash' | 'hash' | 'signature' | 'keyId'
> & {
  /** Supplied only when the caller already owns an id. Otherwise generated. */
  id?: string;
  /** Defaults to now. Pass it explicitly when recording something historical. */
  startedAt?: string;
  /** Defaults to `[]`. A trace without steps is still a valid attestation. */
  steps?: ExecutionStep[];
};

/**
 * Either the payload — which is hashed here and immediately discarded — or a
 * hash you computed yourself. Never both: two sources for one field is how
 * records end up disagreeing with reality.
 */
type InputSource = { input: unknown; inputHash?: never } | { inputHash: string; input?: never };
type OutputSource = { output: unknown; outputHash?: never } | { outputHash?: string; output?: never };

export type RecordExecutionInput = ExecutionBody & InputSource & OutputSource;

/** Records executions, chains them, signs them, and reads them back. */
export class TraceStore {
  constructor(private readonly storage: Storage, private readonly signingKey?: SigningKey) {}

  private headHashAndSeq(): { hash: string; seq: number } {
    const row = this.storage.get<{ hash: string; seq: number }>(
      'SELECT hash, seq FROM executions ORDER BY seq DESC LIMIT 1'
    );
    if (row) return { hash: row.hash, seq: Number(row.seq) };

    /*
     * No records — but "none yet" and "all of them aged out" are different
     * chains, and only one of them starts at genesis. Resuming from the anchor
     * keeps sequence numbers monotonic and keeps the next record linking to the
     * last one that ever existed, so a sweep that empties the table does not
     * silently fork a second chain sharing the first one's sequence numbers.
     *
     * Read unsigned on purpose: this is the write path choosing where to append,
     * not the read path deciding what to believe. Appending after a forged
     * anchor still produces records that verify; honouring one when *reading*
     * is what would let a truncation pass, and that path checks the signature.
     */
    const anchor = this.storage.get<{ hash: string; seq: number }>(
      'SELECT hash, seq FROM retention_anchors ORDER BY seq DESC LIMIT 1'
    );
    if (anchor) return { hash: anchor.hash, seq: Number(anchor.seq) };

    return { hash: GENESIS_HASH, seq: 0 };
  }

  get headHash(): string {
    return this.headHashAndSeq().hash;
  }

  /**
   * Persist a completed execution.
   *
   * Chaining and insertion happen in one transaction so two concurrent
   * executions cannot both link to the same predecessor and fork the chain.
   *
   * Pass `input`/`output` and the payloads are hashed here and dropped; pass
   * `inputHash`/`outputHash` if you hashed them yourself. `startedAt` defaults
   * to now and `steps` to `[]`, so the shortest honest record is:
   *
   * ```ts
   * traces.record({ subject, scope, module, action, input, output, outcome: 'success' });
   * ```
   */
  record(request: RecordExecutionInput): ExecutionTrace {
    const input = request as ExecutionBody & {
      input?: unknown;
      inputHash?: string;
      output?: unknown;
      outputHash?: string;
    };

    const hasInputHash = typeof input.inputHash === 'string';
    if (!hasInputHash && !('input' in input)) {
      throw new Error('record() needs either `input` (hashed here) or `inputHash` (hashed by you)');
    }

    const inputHash = hasInputHash ? input.inputHash! : hashPayload(input.input);
    const outputHash = typeof input.outputHash === 'string'
      ? input.outputHash
      : 'output' in input ? hashPayload(input.output) : undefined;

    const startedAt = input.startedAt ?? new Date().toISOString();

    // Two timestamps already state the duration; deriving it is arithmetic on
    // supplied facts, not an assumption. An explicit durationMs always wins,
    // because the caller measured it and we did not.
    const durationMs = input.durationMs !== undefined
      ? input.durationMs
      : elapsedBetween(startedAt, input.completedAt);

    // Validated before anything is chained, so a rejected cost cannot leave a
    // half-written record or advance the chain head.
    const cost = input.cost === undefined || input.cost === null ? undefined : normaliseCost(input.cost);
    const canonicalVersion = minimumCanonicalVersion({ ...(cost ? { cost } : {}) });

    return this.storage.transaction(() => {
      const { hash: prevHash, seq } = this.headHashAndSeq();

      const unhashed: Omit<ExecutionTrace, 'hash' | 'signature'> = {
        id: input.id ?? `exec_${randomUUID().replace(/-/g, '')}`,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        subject: input.subject,
        ...(input.jti ? { jti: input.jti } : {}),
        scope: input.scope,
        module: input.module,
        action: input.action,
        inputHash,
        ...(outputHash ? { outputHash } : {}),
        outcome: input.outcome,
        ...(input.error ? { error: input.error } : {}),
        startedAt,
        ...(input.completedAt ? { completedAt: input.completedAt } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        steps: input.steps ?? [],
        // Included before hashing, so the governing rule is signed along with
        // everything else. A policy reference nobody could verify would be a
        // claim about authority with no more standing than a log line.
        ...(input.governance ? { governance: input.governance } : {}),
        // Signed with everything else. A cost outside the signature would be a
        // spend figure anyone could revise after the fact, which is precisely
        // the number nobody would then be able to rely on.
        ...(cost ? { cost } : {}),
        // Omitted at v1: absence *is* v1, which keeps every record written
        // before versioning existed byte-identical. Written only when this
        // record actually needs a newer form to express itself.
        ...(canonicalVersion > 1 ? { canonicalVersion } : {}),
        prevHash,
      };

      const hash = hashTrace(unhashed);
      const signature = this.signingKey?.sign(hash);

      const trace: ExecutionTrace = {
        ...unhashed,
        hash,
        ...(signature ? { signature } : {}),
        ...(this.signingKey ? { keyId: this.signingKey.keyId } : {}),
      };

      this.storage.run(
        // Cost is stored once, as the signed JSON, and never also as a numeric
        // column. A denormalised total would be faster to sum and free to edit —
        // and an operator who changed it would move every figure this product
        // reports while the chain still verified perfectly. Aggregation reads
        // the evidence itself or it is not evidence.
        `INSERT INTO executions (id, seq, tenant_id, subject, jti, scope, module, action, input_hash, output_hash, outcome, error, started_at, completed_at, duration_ms, steps, governance, cost, canonical_version, prev_hash, hash, signature, key_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        trace.id, seq + 1, trace.tenantId ?? null, trace.subject, trace.jti ?? null,
        JSON.stringify(trace.scope), trace.module, trace.action, trace.inputHash,
        trace.outputHash ?? null, trace.outcome, trace.error ?? null,
        trace.startedAt, trace.completedAt ?? null, trace.durationMs ?? null,
        JSON.stringify(trace.steps), trace.governance ? JSON.stringify(trace.governance) : null,
        trace.cost ? JSON.stringify(trace.cost) : null,
        trace.canonicalVersion ?? null, trace.prevHash, trace.hash,
        trace.signature ?? null, trace.keyId ?? null
      );

      return trace;
    });
  }

  get(id: string): ExecutionTrace | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM executions WHERE id = ?', id);
    return row ? rowToTrace(row) : undefined;
  }

  list(options: { limit?: number; tenantId?: string; subject?: string; outcome?: string } = {}): ExecutionTrace[] {
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 500);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.tenantId) { clauses.push('tenant_id = ?'); params.push(options.tenantId); }
    if (options.subject) { clauses.push('subject = ?'); params.push(options.subject); }
    if (options.outcome) { clauses.push('outcome = ?'); params.push(options.outcome); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.storage
      .all<Record<string, unknown>>(`SELECT * FROM executions ${where} ORDER BY seq DESC LIMIT ?`, ...params, limit)
      .map(rowToTrace);
  }

  /**
   * Aggregate counts over everything held.
   *
   * Every field here is a `COUNT` over records that exist. Nothing is sampled,
   * projected or annualised, and a count of zero is returned as zero rather
   * than hidden — an empty system reporting an empty system is the correct
   * answer, and the only one a control plane is allowed to give.
   *
   * Deliberately absent: anything we do not store. There is no "active agents"
   * figure because a subject that acted once is not an agent that is running,
   * and no "incidents" count because an incident is a judgement nobody here has
   * made. Those would have to be invented, and this is the one product that
   * cannot afford an invented number.
   */
  stats(windowHours = 24): {
    total: number;
    subjects: number;
    modules: number;
    actions: number;
    failures: number;
    windowHours: number;
    inWindow: number;
    failuresInWindow: number;
    oldest?: string;
    newest?: string;
    withoutScope: number;
    withoutCost: number;
    cost: { currency: string; amount: number; executions: number }[];
  } {
    const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
    const one = <T>(sql: string, ...params: unknown[]): T =>
      (this.storage.get<Record<string, unknown>>(sql, ...params)?.value as T);

    return {
      total: one<number>('SELECT COUNT(*) AS value FROM executions') ?? 0,
      subjects: one<number>('SELECT COUNT(DISTINCT subject) AS value FROM executions') ?? 0,
      modules: one<number>('SELECT COUNT(DISTINCT module) AS value FROM executions') ?? 0,
      actions: one<number>('SELECT COUNT(DISTINCT action) AS value FROM executions') ?? 0,
      failures: one<number>("SELECT COUNT(*) AS value FROM executions WHERE outcome = 'failure'") ?? 0,
      windowHours,
      inWindow: one<number>('SELECT COUNT(*) AS value FROM executions WHERE started_at >= ?', since) ?? 0,
      failuresInWindow:
        one<number>("SELECT COUNT(*) AS value FROM executions WHERE outcome = 'failure' AND started_at >= ?", since) ?? 0,
      oldest: one<string>('SELECT MIN(started_at) AS value FROM executions') ?? undefined,
      newest: one<string>('SELECT MAX(started_at) AS value FROM executions') ?? undefined,
      // An action recorded with no scope cannot be shown to have been permitted.
      // Counting them is the difference between "nothing is wrong" and "nobody
      // checked".
      withoutScope:
        one<number>("SELECT COUNT(*) AS value FROM executions WHERE scope IS NULL OR scope = '' OR scope = '[]'") ?? 0,
      // The same reasoning as withoutScope, applied to money. A spend total is
      // only as meaningful as the share of the log it covers, so the two are
      // returned together and neither is available without the other.
      withoutCost: one<number>('SELECT COUNT(*) AS value FROM executions WHERE cost IS NULL') ?? 0,
      cost: this.costTotals(),
    };
  }

  /** Signed spend, one total per currency. Never converted, never combined. */
  private costTotals(): { currency: string; amount: number; executions: number }[] {
    const totals = new Map<string, { amount: number; executions: number }>();

    for (const row of this.storage.all<Record<string, unknown>>('SELECT cost FROM executions WHERE cost IS NOT NULL')) {
      const cost = safeParse<CostRecord | null>(row.cost, null);
      if (!cost || !Number.isInteger(cost.amount) || typeof cost.currency !== 'string') continue;
      const bucket = totals.get(cost.currency) ?? { amount: 0, executions: 0 };
      bucket.amount += cost.amount;
      bucket.executions += 1;
      totals.set(cost.currency, bucket);
    }

    return [...totals.entries()]
      .map(([currency, bucket]) => ({ currency, ...bucket }))
      .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
  }

  /**
   * Spend, attributed to the agent that caused it.
   *
   * This is the question a compute dashboard cannot answer and a governance log
   * can: not *what did the cluster cost*, but **which agent spent it, under
   * which scope, and how much of the bill can be attributed at all**.
   *
   * Three rules hold here, and each exists because the obvious shortcut is a lie:
   *
   * **Currencies are never merged.** Totals come back one per currency, because
   * nothing in a record states an exchange rate, and a converted figure would be
   * a number ABSuite invented at read time from a rate nobody signed.
   *
   * **Coverage is reported beside every total.** `priced` and `unpriced` are the
   * point of this call, not a footnote: a spend figure covering 12 of 4,000
   * executions is not a small figure, it is an unknown one. Anything that shows
   * the total without the coverage is showing a number that reads as complete.
   *
   * **Nothing is projected.** No monthly run rate, no annualisation, no
   * forecast. Those are all this record multiplied by an assumption.
   */
  costBySubject(): {
    subject: string;
    executions: number;
    priced: number;
    unpriced: number;
    lastSeen: string;
    currencies: { currency: string; amount: number; executions: number }[];
    sources: string[];
  }[] {
    const rows = this.storage.all<Record<string, unknown>>(
      'SELECT subject, cost, started_at FROM executions'
    );

    type Entry = {
      executions: number;
      priced: number;
      lastSeen: string;
      currencies: Map<string, { amount: number; executions: number }>;
      sources: Set<string>;
    };
    const bySubject = new Map<string, Entry>();

    for (const row of rows) {
      const subject = String(row.subject);
      const entry = bySubject.get(subject) ?? {
        executions: 0, priced: 0, lastSeen: '', currencies: new Map(), sources: new Set<string>(),
      };

      entry.executions += 1;
      const startedAt = String(row.started_at ?? '');
      if (startedAt > entry.lastSeen) entry.lastSeen = startedAt;

      const cost = row.cost ? safeParse<CostRecord | null>(row.cost, null) : null;
      // A cost that will not parse, or that lost a field, is counted as
      // unpriced rather than as zero. Zero is a claim that it was free.
      if (cost && Number.isInteger(cost.amount) && typeof cost.currency === 'string') {
        entry.priced += 1;
        const bucket = entry.currencies.get(cost.currency) ?? { amount: 0, executions: 0 };
        bucket.amount += cost.amount;
        bucket.executions += 1;
        entry.currencies.set(cost.currency, bucket);
        if (cost.source) entry.sources.add(cost.source);
      }

      bySubject.set(subject, entry);
    }

    return [...bySubject.entries()]
      .map(([subject, entry]) => ({
        subject,
        executions: entry.executions,
        priced: entry.priced,
        unpriced: entry.executions - entry.priced,
        lastSeen: entry.lastSeen,
        currencies: [...entry.currencies.entries()]
          .map(([currency, bucket]) => ({ currency, ...bucket }))
          .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency)),
        sources: [...entry.sources].sort(),
      }))
      // Ordered by the largest single-currency total a subject carries. Sorting
      // by a summed total would require adding currencies together, which is the
      // one thing this method refuses to do — even invisibly, even just to sort.
      .sort((a, b) => (b.currencies[0]?.amount ?? -1) - (a.currencies[0]?.amount ?? -1) || a.subject.localeCompare(b.subject));
  }

  /**
   * Records a person should look at, with the reason attached.
   *
   * Not "incidents". An incident is a judgement about what something means, and
   * ABSuite does not make those — it is the witness. This is the narrower and
   * defensible claim: here is what is unproven, failed, or unauthorised on its
   * face, and here is the field that says so. What it means is the reader's
   * call.
   *
   * Ordering is newest-first rather than by severity, because severity is
   * itself a judgement. Nothing here is scored.
   */
  needingAttention(limit = 50): {
    trace: ExecutionTrace;
    reasons: { reason: string; from: string }[];
  }[] {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const rows = this.storage.all<Record<string, unknown>>(
      `SELECT * FROM executions
        WHERE outcome = 'failure' OR scope IS NULL OR scope = '' OR scope = '[]'
        ORDER BY seq DESC LIMIT ?`,
      capped
    );

    return rows.map(row => {
      const trace = rowToTrace(row);
      const reasons: { reason: string; from: string }[] = [];

      if (trace.outcome === 'failure') {
        reasons.push({
          reason: trace.error ? `It failed: ${trace.error}` : 'It failed, and no error was recorded against it.',
          from: 'outcome, error',
        });
      }
      if (!trace.scope || trace.scope.length === 0) {
        reasons.push({
          reason: 'No scope was recorded, so this action cannot be shown to have been permitted.',
          from: 'scope',
        });
      }
      if (!trace.signature) {
        reasons.push({ reason: 'The record carries no signature, so its authorship is unproven.', from: 'signature' });
      }

      return { trace, reasons };
    });
  }

  /**
   * What authority has actually been exercised, per subject.
   *
   * Derived entirely from records of things that happened — not from tokens that
   * were issued. A token nobody used grants nothing observable, and a list of
   * issued tokens would describe intent rather than behaviour. This answers
   * "what has this agent actually done, and under what scope", which is the
   * question an access review is trying to ask.
   */
  authorityInventory(): {
    subject: string;
    total: number;
    lastSeen: string;
    scopes: { scope: string; count: number }[];
    unscoped: number;
  }[] {
    const rows = this.storage.all<Record<string, unknown>>(
      'SELECT subject, scope, COUNT(*) AS uses, MAX(started_at) AS last_seen FROM executions GROUP BY subject, scope'
    );

    const bySubject = new Map<string, { total: number; lastSeen: string; scopes: Map<string, number>; unscoped: number }>();

    for (const row of rows) {
      const subject = String(row.subject);
      const uses = Number(row.uses) || 0;
      const lastSeen = String(row.last_seen ?? '');
      const entry = bySubject.get(subject) ?? { total: 0, lastSeen: '', scopes: new Map(), unscoped: 0 };

      entry.total += uses;
      if (lastSeen > entry.lastSeen) entry.lastSeen = lastSeen;

      let scopes: string[] = [];
      try {
        scopes = JSON.parse(String(row.scope ?? '[]')) as string[];
      } catch {
        // A row whose scope will not parse is not "unrestricted" — it is
        // unreadable, and counting it as unscoped is the honest reading.
        scopes = [];
      }

      if (scopes.length === 0) entry.unscoped += uses;
      for (const scope of scopes) entry.scopes.set(scope, (entry.scopes.get(scope) ?? 0) + uses);

      bySubject.set(subject, entry);
    }

    return [...bySubject.entries()]
      .map(([subject, entry]) => ({
        subject,
        total: entry.total,
        lastSeen: entry.lastSeen,
        unscoped: entry.unscoped,
        scopes: [...entry.scopes.entries()]
          .map(([scope, count]) => ({ scope, count }))
          .sort((a, b) => b.count - a.count || a.scope.localeCompare(b.scope)),
      }))
      .sort((a, b) => b.total - a.total || a.subject.localeCompare(b.subject));
  }

  /**
   * Record a signed note that the chain verified to its current head.
   *
   * Returns the checkpoint, or `undefined` when the chain does not currently
   * verify — a checkpoint is only ever written after a **full walk from
   * genesis**, because a checkpoint taken on a chain nobody verified is a
   * signed statement that nothing was checked.
   *
   * Requires a signing key. Without one there is nothing to bind the note to
   * this instance, and an unsigned checkpoint is a row anybody can write.
   */
  checkpoint(publicKeyPem?: string): ChainCheckpoint | undefined {
    if (!this.signingKey) return undefined;

    const result = this.verifyChain(publicKeyPem);
    if (!result.valid) return undefined;

    const seq = Number(
      this.storage.get<{ n: number }>('SELECT COALESCE(MAX(seq), 0) AS n FROM executions')?.n ?? 0
    );
    if (seq === 0) return undefined;

    const checkpoint: ChainCheckpoint = {
      seq,
      hash: result.headHash,
      verifiedAt: new Date().toISOString(),
      keyId: this.signingKey.keyId,
      signature: this.signingKey.sign(checkpointStatement(seq, result.headHash)),
    };

    this.storage.run(
      `INSERT INTO chain_checkpoints (seq, hash, verified_at, key_id, signature)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(seq) DO UPDATE SET hash = excluded.hash, verified_at = excluded.verified_at,
                                      key_id = excluded.key_id, signature = excluded.signature`,
      checkpoint.seq, checkpoint.hash, checkpoint.verifiedAt, checkpoint.keyId, checkpoint.signature
    );

    return checkpoint;
  }

  /**
   * The most recent checkpoint whose signature holds, or `undefined`.
   *
   * A checkpoint that does not verify is ignored rather than reported as a
   * problem: it means the key rotated, or the row was edited, and in both cases
   * the correct behaviour is the same — fall back to walking from genesis.
   * Refusing to verify at all because a *cache* is stale would be the wrong
   * failure.
   */
  latestCheckpoint(publicKeyPem?: string): ChainCheckpoint | undefined {
    const rows = this.storage.all<Record<string, unknown>>(
      'SELECT seq, hash, verified_at, key_id, signature FROM chain_checkpoints ORDER BY seq DESC'
    );

    for (const row of rows) {
      const candidate: ChainCheckpoint = {
        seq: Number(row.seq),
        hash: String(row.hash),
        verifiedAt: String(row.verified_at),
        ...(row.key_id ? { keyId: String(row.key_id) } : {}),
        signature: String(row.signature),
      };
      if (!publicKeyPem) return candidate;
      if (verifySignature(checkpointStatement(candidate.seq, candidate.hash), candidate.signature, publicKeyPem)) {
        return candidate;
      }
    }
    return undefined;
  }

  /**
   * The newest retention anchor whose signature verifies.
   *
   * `publicKeyPem` is required to get one back. That is deliberately unlike
   * `latestCheckpoint`, which returns an unverified row when no key is offered:
   * a checkpoint that cannot be verified costs a slower walk, while an anchor
   * that cannot be verified would excuse a gap on nobody's authority. The safe
   * default for the first is "use it anyway"; for the second it is "do not".
   */
  latestRetentionAnchor(publicKeyPem?: string): RetentionAnchor | undefined {
    if (!publicKeyPem) return undefined;

    const rows = this.storage.all<Record<string, unknown>>(
      'SELECT seq, hash, removed, policy_days, pruned_at, key_id, signature FROM retention_anchors ORDER BY seq DESC'
    );

    for (const row of rows) {
      const candidate: RetentionAnchor = {
        seq: Number(row.seq),
        hash: String(row.hash),
        removed: Number(row.removed),
        policyDays: Number(row.policy_days),
        prunedAt: String(row.pruned_at),
        ...(row.key_id ? { keyId: String(row.key_id) } : {}),
        signature: String(row.signature),
      };
      if (
        verifySignature(
          retentionStatement(candidate.seq, candidate.hash, candidate.removed, candidate.policyDays),
          candidate.signature,
          publicKeyPem
        )
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  /**
   * Remove records older than `retentionDays`, leaving a signed anchor in their
   * place so the surviving chain still verifies.
   *
   * ## Why this is not a DELETE
   *
   * Every record links to its predecessor by hash. Delete the predecessor and
   * the oldest survivor points at nothing the walk can produce, so `verifyChain`
   * reports BROKEN — the product's central claim failing on its own retention
   * feature. The anchor is what lets the walk resume: it carries the hash the
   * oldest survivor must link to, and it is signed, because otherwise anybody
   * who could truncate the ledger could also write the note excusing it.
   *
   * ## What it will not do
   *
   * The most recent record is never removed, whatever its age. A ledger whose
   * every record has aged out still has a head that new records link to, and
   * keeping one costs a row. Retention is about bounding growth, not about
   * reaching zero.
   *
   * Returns what was actually taken. `removed: 0` is the ordinary answer on a
   * young instance and is not a failure.
   */
  pruneToRetention(options: { retentionDays: number; now?: Date }): {
    removed: number;
    anchor?: RetentionAnchor;
    oldestKept?: string;
  } {
    const { retentionDays } = options;

    /*
     * No signing key, no sweep — and this is a refusal rather than a fallback.
     *
     * An unsigned anchor would be honoured by nobody, so the records would be
     * gone and the chain would read as truncated from then on, permanently and
     * with no way back. Declining to prune costs disk; pruning without the
     * means to explain it costs the ledger's only claim.
     */
    if (!this.signingKey) return { removed: 0 };

    // -1 is the unlimited sentinel used throughout `Plan['limits']`.
    if (retentionDays < 0) return { removed: 0 };
    if (!Number.isFinite(retentionDays)) return { removed: 0 };

    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();

    const head = this.storage.get<{ seq: number }>(
      'SELECT seq FROM executions ORDER BY seq DESC LIMIT 1'
    );
    if (!head) return { removed: 0 };

    /*
     * The boundary is chosen by sequence, not by timestamp, and the two can
     * disagree: `started_at` is when the caller says the work began, so a
     * record written late can carry an earlier time than one already in the
     * chain. Pruning "everything older than X" by timestamp would punch holes
     * in the middle of the chain rather than trimming its tail, and a hole is
     * exactly what no anchor can explain — an anchor says where the chain
     * resumes, and a chain cannot resume in two places.
     *
     * So: find the highest sequence at or below which EVERY record is expired,
     * and cut there. A record inserted out of order simply holds the boundary
     * back until it too has aged, which is the conservative direction.
     */
    const firstKept = this.storage.get<{ seq: number }>(
      'SELECT seq FROM executions WHERE started_at >= ? ORDER BY seq ASC LIMIT 1',
      cutoff
    );

    const boundary = firstKept
      ? Number(firstKept.seq) - 1
      : Number(head.seq) - 1; // everything expired: keep the head regardless.

    const cut = Math.min(boundary, Number(head.seq) - 1);
    if (cut < 1) return { removed: 0 };

    const boundaryRow = this.storage.get<{ hash: string }>(
      'SELECT hash FROM executions WHERE seq = ?',
      cut
    );
    if (!boundaryRow) return { removed: 0 };

    const removed = Number(
      this.storage.get<{ n: number }>('SELECT COUNT(*) AS n FROM executions WHERE seq <= ?', cut)?.n ?? 0
    );
    if (removed === 0) return { removed: 0 };

    const anchor: RetentionAnchor = {
      seq: cut,
      hash: boundaryRow.hash,
      removed,
      policyDays: retentionDays,
      prunedAt: now.toISOString(),
      ...(this.signingKey.keyId ? { keyId: this.signingKey.keyId } : {}),
      signature: this.signingKey.sign(retentionStatement(cut, boundaryRow.hash, removed, retentionDays)),
    };

    /*
     * Anchor first, then delete. The reverse order has a window in which the
     * records are gone and nothing explains why — and a crash inside that
     * window leaves a ledger that reads as tampered with, permanently. Writing
     * an anchor for records that still exist is harmless: the walk finds them
     * and the anchor is simply not needed yet.
     */
    this.storage.run(
      `INSERT INTO retention_anchors (seq, hash, removed, policy_days, pruned_at, key_id, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(seq) DO UPDATE SET hash = excluded.hash, removed = excluded.removed,
                                      policy_days = excluded.policy_days, pruned_at = excluded.pruned_at,
                                      key_id = excluded.key_id, signature = excluded.signature`,
      anchor.seq, anchor.hash, anchor.removed, anchor.policyDays, anchor.prunedAt,
      anchor.keyId ?? null, anchor.signature
    );

    this.storage.run('DELETE FROM executions WHERE seq <= ?', cut);

    const oldestKept = this.storage.get<{ started_at: string }>(
      'SELECT started_at FROM executions ORDER BY seq ASC LIMIT 1'
    )?.started_at;

    return { removed, anchor, ...(oldestKept ? { oldestKept } : {}) };
  }

  /**
   * Walk the chain and report the first record that fails.
   *
   * `brokenAt` is the sequence number of the offending record — the evidence an
   * auditor needs, rather than a bare boolean.
   *
   * ## Resuming from a checkpoint
   *
   * `{ from: 'checkpoint' }` starts at the last signed checkpoint instead of at
   * genesis. Measured on this machine, a signed walk costs ~161µs per record —
   * 3.2 seconds at twenty thousand records, paid in full by the watch on every
   * sweep. Resuming turns that into the cost of what arrived since.
   *
   * **It is a weaker claim, and the result says so rather than looking
   * identical.** A resumed pass returns `verifiedFrom` and a `scope` sentence;
   * a full pass returns neither. The reason is that a checkpoint lives in the
   * same file as the records it vouches for: anybody able to edit an execution
   * can edit a checkpoint, so trusting one means trusting exactly what
   * verification exists to test.
   *
   * Which is why the default is unchanged, and why every existing caller keeps
   * walking from genesis without being asked.
   */
  verifyChain(publicKeyPem?: string, options: { from?: 'genesis' | 'checkpoint' } = {}): {
    valid: boolean;
    checked: number;
    brokenAt?: number;
    brokenId?: string;
    reason?: string;
    /** False when the walk stopped at a record this build cannot read. */
    checkable?: boolean;
    /** Present only on a resumed pass. Its absence means the walk began at genesis. */
    verifiedFrom?: { seq: number; hash: string; verifiedAt: string };
    /**
     * Present when a signed retention anchor explained a gap at the tail.
     *
     * Distinct from `verifiedFrom`, and the difference is the whole point: a
     * checkpoint means records were *not re-examined* and could be; an anchor
     * means records are *gone* and cannot be. Reporting both as "resumed" would
     * merge a shortcut with a deletion.
     */
    retainedFrom?: { seq: number; hash: string; removed: number; policyDays: number; prunedAt: string };
    /** What this pass did and did not re-examine. Present only when resumed. */
    scope?: string;
    /**
     * Whether the offending record's content still matches its hash. `null`
     * when it could not be checked.
     *
     * `true` with `valid: false` means nothing was edited and the signature was
     * checked against the wrong key — a rotation, not an intrusion. A reader who
     * cannot tell those apart eventually treats both as noise.
     */
    contentIntact?: boolean | null;
    headHash: string;
  } {
    /*
     * A cheap sanity check, and it is worth being exact about what it is not.
     *
     * It catches truncation, a rollback, or a checkpoint carried into a
     * different chain — cases where the record at that sequence no longer holds
     * the hash the checkpoint named. It does **not** detect tampering before
     * the checkpoint: editing a record at seq 3 leaves the stored hash at seq
     * 10 untouched, so the anchor still matches and the walk still starts
     * after it.
     *
     * That is not a hole to be closed. Detecting it would mean re-walking,
     * which is precisely what resuming exists to avoid. Skipping the walk is
     * the feature; not seeing what you skipped is what the feature means — so
     * the mitigation is the `scope` sentence below, and the fact that the
     * default never resumes.
     */
    const resume = options.from === 'checkpoint' ? this.latestCheckpoint(publicKeyPem) : undefined;
    const anchor = resume
      ? this.storage.get<{ hash: string }>('SELECT hash FROM executions WHERE seq = ?', resume.seq)
      : undefined;
    const usable = resume && anchor?.hash === resume.hash ? resume : undefined;

    const rows = usable
      ? this.storage.all<Record<string, unknown>>('SELECT * FROM executions WHERE seq > ? ORDER BY seq ASC', usable.seq)
      : this.storage.all<Record<string, unknown>>('SELECT * FROM executions ORDER BY seq ASC');

    /*
     * A walk from genesis over a swept ledger starts after the records that
     * retention removed, so the oldest survivor links to something the walk
     * never produces. A signed anchor is what says that gap was authorised and
     * names the hash the chain resumes from.
     *
     * Only consulted when the walk would otherwise begin at genesis, and only
     * when it actually explains this ledger — the anchor must sit immediately
     * below the oldest surviving record. An anchor at seq 40 over a ledger
     * whose oldest survivor is seq impossible-to-reconcile is not evidence of
     * anything, and honouring it would let one stale anchor excuse every future
     * truncation.
     */
    const retention = usable ? undefined : this.latestRetentionAnchor(publicKeyPem);
    const oldestSeq = rows.length > 0 ? Number(rows[0]!.seq) : undefined;
    const swept = retention && oldestSeq !== undefined && retention.seq === oldestSeq - 1 ? retention : undefined;

    let expectedPrev = usable ? usable.hash : swept ? swept.hash : GENESIS_HASH;

    const resumed = usable
      ? {
          verifiedFrom: { seq: usable.seq, hash: usable.hash, verifiedAt: usable.verifiedAt },
          scope:
            `Records after ${usable.seq} were walked now. Records up to ${usable.seq} were not re-examined — ` +
            `this rests on a checkpoint taken at ${usable.verifiedAt}, which lives in the same file as the records ` +
            `it vouches for. For a claim that does not, walk from genesis.`,
        }
      : swept
        ? {
            retainedFrom: {
              seq: swept.seq,
              hash: swept.hash,
              removed: swept.removed,
              policyDays: swept.policyDays,
              prunedAt: swept.prunedAt,
            },
            scope:
              `Every surviving record was walked. ${swept.removed} record(s) up to ${swept.seq} were removed on ` +
              `${swept.prunedAt} under a ${swept.policyDays}-day retention policy and cannot be re-examined — they ` +
              `are gone, not unchecked. What this pass shows is that the records still held link unbroken to the ` +
              `signed anchor left in their place.`,
          }
        : {};

    for (const row of rows) {
      const trace = rowToTrace(row);
      const seq = Number(row.seq);

      if (trace.prevHash !== expectedPrev) {
        return { valid: false, checked: seq, brokenAt: seq, brokenId: trace.id, reason: 'Trace does not link to its predecessor', headHash: this.headHash, ...resumed };
      }

      const verdict = verifyTrace(trace, publicKeyPem);
      if (!verdict.valid) {
        return {
          valid: false,
          checked: seq,
          brokenAt: seq,
          brokenId: trace.id,
          reason: verdict.reason ?? 'Verification failed',
          contentIntact: verdict.contentIntact,
          // A record this build cannot read stops the walk without accusing it.
          // "Upgrade to verify the rest" and "your log was tampered with" must
          // never arrive in the same words.
          ...(verdict.checkable === false ? { checkable: false } : {}),
          headHash: this.headHash,
          ...resumed,
        };
      }

      expectedPrev = trace.hash;
    }

    return { valid: true, checked: rows.length, headHash: this.headHash, ...resumed };
  }
}

/**
 * What a checkpoint signature covers.
 *
 * Both fields, joined by a separator that cannot occur in either — a hex hash
 * has no colon and a sequence number has no non-digits. Signing the hash alone
 * would let a checkpoint be replayed at a different sequence, which is the
 * classic way a "signed" cache stops meaning anything.
 */
function checkpointStatement(seq: number, hash: string): string {
  return `absuite.chain.checkpoint.v1:${seq}:${hash}`;
}

/**
 * The statement a retention anchor signs.
 *
 * Every field that changes what the anchor *permits* is inside the signature.
 * `seq` and `hash` say where the surviving chain must resume from; `removed`
 * and `policyDays` say how much was taken and under which rule. Signing the
 * hash alone would let an anchor be replayed at a different sequence — the same
 * hazard `checkpointStatement` guards, and the reason both carry the sequence.
 *
 * This one *is* a security boundary, which the checkpoint deliberately is not.
 * A checkpoint only shortens a walk that could be done in full; an anchor
 * vouches for records that no longer exist to be walked. Forging one is
 * therefore how you would make a truncation look lawful, so it takes the
 * signing key to write and the public key to honour.
 */
export function retentionStatement(seq: number, hash: string, removed: number, policyDays: number): string {
  return `absuite.chain.retention.v1:${seq}:${hash}:${removed}:${policyDays}`;
}

function rowToTrace(row: Record<string, unknown>): ExecutionTrace {
  return {
    id: String(row.id),
    ...(row.tenant_id ? { tenantId: String(row.tenant_id) } : {}),
    subject: String(row.subject),
    ...(row.jti ? { jti: String(row.jti) } : {}),
    scope: safeParse<string[]>(row.scope, []),
    module: String(row.module),
    action: String(row.action),
    inputHash: String(row.input_hash),
    ...(row.output_hash ? { outputHash: String(row.output_hash) } : {}),
    outcome: String(row.outcome) as ExecutionOutcome,
    ...(row.error ? { error: String(row.error) } : {}),
    startedAt: String(row.started_at),
    ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
    ...(row.duration_ms !== null && row.duration_ms !== undefined ? { durationMs: Number(row.duration_ms) } : {}),
    steps: safeParse<ExecutionStep[]>(row.steps, []),
    ...(row.governance ? { governance: safeParse<GovernanceRecord>(row.governance, undefined as never) } : {}),
    ...(row.cost ? { cost: safeParse<CostRecord>(row.cost, undefined as never) } : {}),
    ...(row.canonical_version ? { canonicalVersion: Number(row.canonical_version) } : {}),
    prevHash: String(row.prev_hash),
    hash: String(row.hash),
    ...(row.signature ? { signature: String(row.signature) } : {}),
    ...(row.key_id ? { keyId: String(row.key_id) } : {}),
  };
}

/**
 * Milliseconds between two ISO timestamps, or `undefined` if that cannot be
 * stated honestly — no end time, an unparseable one, or a clock that appears to
 * have run backwards. A negative duration is a symptom, not a measurement, so
 * it is omitted rather than recorded.
 */
function elapsedBetween(startedAt: string, completedAt?: string): number | undefined {
  if (!completedAt) return undefined;
  const from = Date.parse(startedAt);
  const to = Date.parse(completedAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return undefined;
  return to - from;
}

function safeParse<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

/**
 * Everything needed to re-run an execution and compare it to the record.
 *
 * Payloads are never stored — only their hashes — so a replay proves the
 * output matched without ABSuite retaining the customer's data.
 */
export function replayManifest(trace: ExecutionTrace) {
  return {
    id: trace.id,
    module: trace.module,
    action: trace.action,
    expectedInputHash: trace.inputHash,
    expectedOutputHash: trace.outputHash ?? null,
    recordedOutcome: trace.outcome,
    steps: trace.steps,
  };
}

/** Compare a re-run against the recorded trace. */
export function compareReplay(
  trace: ExecutionTrace,
  actual: { input: unknown; output: unknown }
): { inputMatches: boolean; outputMatches: boolean; deterministic: boolean } {
  const inputMatches = hashPayload(actual.input) === trace.inputHash;
  const outputMatches = trace.outputHash === undefined
    ? false
    : hashPayload(actual.output) === trace.outputHash;

  return { inputMatches, outputMatches, deterministic: inputMatches && outputMatches };
}

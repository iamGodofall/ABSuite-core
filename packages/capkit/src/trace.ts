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
 * Canonical form of a trace, in a fixed field order.
 *
 * `hash` and `signature` are excluded — they are derived from this, so
 * including them would be circular.
 */
export function canonicalTrace(trace: Omit<ExecutionTrace, 'hash' | 'signature'>): string {
  return JSON.stringify([
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
  contentIntact: boolean;
  signatureValid: boolean | null;
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
  const recomputed = hashTrace(unhashed);
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
    return { hash: row?.hash ?? GENESIS_HASH, seq: Number(row?.seq ?? 0) };
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
        `INSERT INTO executions (id, seq, tenant_id, subject, jti, scope, module, action, input_hash, output_hash, outcome, error, started_at, completed_at, duration_ms, steps, prev_hash, hash, signature, key_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        trace.id, seq + 1, trace.tenantId ?? null, trace.subject, trace.jti ?? null,
        JSON.stringify(trace.scope), trace.module, trace.action, trace.inputHash,
        trace.outputHash ?? null, trace.outcome, trace.error ?? null,
        trace.startedAt, trace.completedAt ?? null, trace.durationMs ?? null,
        JSON.stringify(trace.steps), trace.prevHash, trace.hash,
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
    };
  }

  /**
   * Walk the whole chain and report the first record that fails.
   *
   * `brokenAt` is the sequence number of the offending record — the evidence an
   * auditor needs, rather than a bare boolean.
   */
  verifyChain(publicKeyPem?: string): {
    valid: boolean;
    checked: number;
    brokenAt?: number;
    brokenId?: string;
    reason?: string;
    /**
     * Whether the offending record's content still matches its hash.
     *
     * `true` with `valid: false` means nothing was edited and the signature was
     * checked against the wrong key — a rotation, not an intrusion. A reader who
     * cannot tell those apart eventually treats both as noise.
     */
    contentIntact?: boolean;
    headHash: string;
  } {
    const rows = this.storage.all<Record<string, unknown>>('SELECT * FROM executions ORDER BY seq ASC');
    let expectedPrev = GENESIS_HASH;

    for (const row of rows) {
      const trace = rowToTrace(row);
      const seq = Number(row.seq);

      if (trace.prevHash !== expectedPrev) {
        return { valid: false, checked: seq, brokenAt: seq, brokenId: trace.id, reason: 'Trace does not link to its predecessor', headHash: this.headHash };
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
          headHash: this.headHash,
        };
      }

      expectedPrev = trace.hash;
    }

    return { valid: true, checked: rows.length, headHash: this.headHash };
  }
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

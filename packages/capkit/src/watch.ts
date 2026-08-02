/**
 * Layer 6 — Autonomy. Something that actually watches.
 *
 * The constitution's promise is that "ABSuite's own agents watch the record
 * continuously and raise what a person should see", and what existed was a
 * library and a query. `GET /executions/attention` answers when somebody asks;
 * `InteractionMonitor` finds anomalies when somebody calls it. Neither watches,
 * and neither raises. A layer whose whole claim is *continuously* cannot be
 * satisfied by something that runs when a human remembers to look.
 *
 * This is the sweep. It runs on an interval, reads the record from where it left
 * off, and raises notices a person can work through and acknowledge.
 *
 * ## The property that makes it worth building
 *
 * A monitor's silence is ambiguous. An empty list of notices means "nothing was
 * found" or it means "nothing ran" — the container was restarted, the interval
 * was never started, the sweep threw on its first record three weeks ago — and
 * those look identical to anybody reading a dashboard. The second one is worse
 * than having no monitor at all, because an unwatched system that *looks*
 * watched is one nobody checks by hand either.
 *
 * So coverage is reported with every answer, and it is not optional:
 *
 *     everRun, lastSweepAt, lastSweepFailed, sweeps, highWaterSeq, unread
 *
 * `no open notices` never renders on its own here. It renders as *the last sweep
 * at 14:02 read to record 8,412 and raised nothing* — or as *this watch has
 * never run*, which is a different sentence and must never be shown as the
 * first one. It is the same rule the rest of the product holds to: an unchecked
 * claim must not read like a checked one.
 *
 * ## What it will not do
 *
 * It raises; it does not act, and it does not judge. A notice states what is in
 * the record and which field it came from. There is no severity ranking, no
 * incident, no recommended remediation, and no auto-suspension of anything —
 * every one of those is a decision, and the decision belongs to a person.
 *
 * Acknowledging is how a notice closes, and it takes a name and a reason,
 * because the interesting part of an alert's history is usually why somebody
 * decided it was fine.
 */
import { createHash } from 'node:crypto';
import type { Storage } from './storage';
import type { TraceStore, ExecutionTrace } from './trace';
import type { ApprovalRegistry } from './approval';

/**
 * What a sweep can raise. Deliberately few, and every one of them is a fact
 * about the record rather than an inference about the world.
 */
export type NoticeKind =
  /** The chain does not verify. Everything else is secondary to this. */
  | 'CHAIN_BROKEN'
  /** A policy demanded a person, and the approval record cannot show one. */
  | 'UNAPPROVED_EXECUTION'
  /** A policy answered no, and the execution succeeded regardless. */
  | 'DENIED_BUT_SUCCEEDED'
  /** An execution carries no scope at all — it ran, and nothing says it could. */
  | 'NO_RECORDED_AUTHORITY'
  /** An approval request lapsed with nobody deciding it. */
  | 'APPROVAL_LAPSED'
  /** Records are being signed with a key that dies with the process. */
  | 'EPHEMERAL_SIGNING_KEY';

export type NoticeState = 'OPEN' | 'ACKNOWLEDGED';

export interface Notice {
  id: string;
  kind: NoticeKind;
  /**
   * Stable across sweeps, so a standing problem is one notice seen many times
   * rather than a thousand notices. A monitor that re-raises is a monitor people
   * turn off.
   */
  key: string;
  state: NoticeState;
  /** What was found, in a sentence, naming the record it was found on. */
  finding: string;
  /** The field(s) it was read from, so a reader can check rather than believe. */
  from: string;
  executionId?: string;
  subject?: string;
  raisedAt: string;
  lastSeenAt: string;
  /** How many sweeps have seen it. One is not more urgent than forty. */
  seen: number;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  basis?: string;
}

/**
 * What this watch has actually done — carried with every answer it gives.
 *
 * Not a status page. The point is that a caller cannot read the notices without
 * also being told how much of the record they cover.
 */
export interface WatchCoverage {
  everRun: boolean;
  sweeps: number;
  lastSweepAt?: string;
  /** Records examined by the last sweep. Zero is a real and common answer. */
  lastSweepRead: number;
  /** How far into the chain this watch has read. Nothing above it is covered. */
  highWaterSeq: number;
  /** Records held that the watch has not yet reached. */
  behind: number;
  /** Set when the last sweep threw. A watch that fails quietly is not a watch. */
  lastSweepFailed?: string;
  /** What silence from this watch does and does not mean, in words. */
  because: string;
}

export interface SweepResult {
  read: number;
  raised: Notice[];
  reRaised: number;
  coverage: WatchCoverage;
}

const KEY_ROW = 'watch';

/** A short, stable id for a notice key. Content-addressed, never a counter. */
function noticeId(key: string): string {
  return `ntc_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

/**
 * The continuous half of Layer 6.
 *
 * Constructed with what it reads and started with `start()`. It holds no timer
 * unless started, so a test, a CLI or a one-shot audit can call `sweep()`
 * directly and get exactly the same findings — the interval is scheduling, not
 * behaviour.
 */
export class Watch {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly traces: TraceStore,
    private readonly approvals: ApprovalRegistry,
    private readonly options: {
      /** How often to sweep. Nothing here needs to be fast. */
      intervalMs?: number;
      /** Records per sweep, so a large backlog does not block the event loop. */
      batchSize?: number;
      /** Reported once, if the trace key does not survive a restart. */
      signingKeyEphemeral?: boolean;
      publicKeyPem?: string;
    } = {}
  ) {}

  /**
   * Begin sweeping.
   *
   * `unref()` so this never holds a process open. A watcher that keeps a
   * container alive after everything else has shut down turns an orderly deploy
   * into a timeout, and there is nothing here worth delaying a restart for.
   */
  start(): this {
    if (this.timer) return this;
    const every = Math.max(1_000, Number(this.options.intervalMs ?? 60_000));
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch (error) {
        // Recorded rather than thrown, and surfaced in coverage. An interval
        // callback that throws takes the process down in some runtimes and is
        // swallowed in others; neither is a thing a monitor should do.
        this.storage.run(
          'UPDATE watch_state SET last_sweep_failed = ? WHERE id = ?',
          (error as Error).message, KEY_ROW
        );
      }
    }, every);
    this.timer.unref?.();
    return this;
  }

  stop(): this {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    return this;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Read forward from the high-water mark and raise what is there.
   *
   * Idempotent by construction: notices are keyed by content, so sweeping the
   * same records twice updates `lastSeenAt` and `seen` and creates nothing.
   */
  sweep(): SweepResult {
    const state = this.state();
    const batch = Math.max(1, Math.min(5_000, Number(this.options.batchSize ?? 500)));
    const at = new Date().toISOString();

    const rows = this.storage.all<{ id: string; seq: number }>(
      'SELECT id, seq FROM executions WHERE seq > ? ORDER BY seq ASC LIMIT ?',
      state.highWaterSeq, batch
    );

    const raised: Notice[] = [];
    let reRaised = 0;
    const record = (notice: Omit<Notice, 'id' | 'state' | 'raisedAt' | 'lastSeenAt' | 'seen'>) => {
      const existing = this.raise(notice, at);
      if (existing.seen === 1) raised.push(existing);
      else reRaised += 1;
    };

    /*
     * Chain first. A broken chain makes every other finding provisional, and
     * reporting it after a list of individual records buries the one thing that
     * changes how the rest should be read.
     *
     * **This deliberately does not resume from a checkpoint**, and it is the
     * most obvious place somebody will try to. The sweep is the single most
     * expensive thing the watch does — a signed walk is ~161µs per record, so
     * 3.2 seconds at twenty thousand — and resuming would make it nearly free.
     *
     * It would also make the watch stop detecting tampering before the
     * checkpoint, which is the exact thing it exists to catch. A monitor that
     * skips the part of the record nobody else is looking at is not a faster
     * monitor; it is a monitor with a blind spot placed where an attacker would
     * choose to put one.
     *
     * If the full walk becomes too slow for the interval, raise the interval.
     * Do not lower the standard of the answer.
     */
    const chain = this.traces.verifyChain(this.options.publicKeyPem);
    if (chain.valid === false) {
      record({
        kind: 'CHAIN_BROKEN',
        key: `chain:${chain.brokenAt ?? 'unknown'}`,
        finding:
          `The execution chain does not verify${chain.brokenAt !== undefined ? ` at record ${chain.brokenAt}` : ''}. ` +
          `${chain.reason ?? ''} Until this is understood, every other finding below rests on records whose order is in question.`.trim(),
        from: 'verifyChain(): valid, brokenAt, reason',
      });
    }

    if (this.options.signingKeyEphemeral) {
      record({
        kind: 'EPHEMERAL_SIGNING_KEY',
        key: 'signing-key:ephemeral',
        finding:
          'Executions are being signed with a key generated for this process. Every record written since the last restart ' +
          'stops verifying at the next one, and it will keep looking valid until somebody checks. Set CAPKIT_TRACE_PRIVATE_KEY.',
        from: 'SigningKey.ephemeral',
      });
    }

    for (const row of rows) {
      const trace = this.traces.get(row.id);
      if (!trace) continue;
      for (const notice of this.examine(trace)) record(notice);
    }

    // Lapsed approvals are not on any execution — nothing ran, which is exactly
    // why nobody notices them. A request that expires unanswered is a person
    // having been asked and never replying, and it belongs in front of somebody.
    for (const approval of this.approvals.list(200)) {
      if (approval.state !== 'EXPIRED') continue;
      record({
        kind: 'APPROVAL_LAPSED',
        key: `approval:${approval.id}`,
        subject: approval.requestedBy,
        finding:
          `${approval.requestedBy} asked for approval at ${approval.requestedAt} under policy ${approval.policyRef} ` +
          `(v${approval.policyVersion}) and it lapsed at ${approval.expiresAt} with nobody deciding. Context: ${approval.context}`,
        from: 'approvals.state, expiresAt',
      });
    }

    const highWater = rows.length > 0 ? Number(rows[rows.length - 1]!.seq) : state.highWaterSeq;
    this.storage.run(
      `UPDATE watch_state SET sweeps = sweeps + 1, last_sweep_at = ?, last_sweep_read = ?,
        high_water_seq = ?, last_sweep_failed = NULL WHERE id = ?`,
      at, rows.length, highWater, KEY_ROW
    );

    return { read: rows.length, raised, reRaised, coverage: this.coverage() };
  }

  /**
   * Everything a sweep can find on one record.
   *
   * Read straight off the trace and the approval record. Nothing is inferred
   * about intent, and nothing is inferred about severity — a caller who wants to
   * rank these is welcome to, and the ranking is theirs.
   */
  private *examine(trace: ExecutionTrace): Generator<Omit<Notice, 'id' | 'state' | 'raisedAt' | 'lastSeenAt' | 'seen'>> {
    const governance = trace.governance;

    if (governance?.decision === 'DENIED' && trace.outcome === 'success') {
      yield {
        kind: 'DENIED_BUT_SUCCEEDED',
        key: `denied:${trace.id}`,
        executionId: trace.id,
        subject: trace.subject,
        finding:
          `Policy ${governance.policyRef} (v${governance.policyVersion}) evaluated to DENIED, and ${trace.subject} ` +
          `completed ${trace.module}.${trace.action} successfully anyway. Somebody built that check, and something went around it.`,
        from: 'governance.decision, outcome',
      };
    }

    if (governance?.decision === 'REQUIRES_APPROVAL') {
      const attestation = this.approvals.attest(
        { subject: trace.subject, module: trace.module, action: trace.action, inputHash: trace.inputHash },
        trace.id
      );
      if (attestation.state === 'FAILED' || attestation.state === 'ABSENT') {
        yield {
          kind: 'UNAPPROVED_EXECUTION',
          key: `unapproved:${trace.id}`,
          executionId: trace.id,
          subject: trace.subject,
          finding:
            `Policy ${governance.policyRef} (v${governance.policyVersion}) required a person to decide before ` +
            `${trace.module}.${trace.action} ran. ${attestation.finding}`,
          from: 'governance.decision, approval record',
        };
      }
    }

    if (!trace.scope || trace.scope.length === 0) {
      yield {
        kind: 'NO_RECORDED_AUTHORITY',
        key: `no-authority:${trace.id}`,
        executionId: trace.id,
        subject: trace.subject,
        finding:
          `${trace.subject} completed ${trace.module}.${trace.action} and the record carries no scope. ` +
          'That is not proof it was unauthorised — it is that nothing in the record says it was authorised.',
        from: 'scope',
      };
    }
  }

  /** Insert or touch. The key is the identity; the id is derived from it. */
  private raise(
    notice: Omit<Notice, 'id' | 'state' | 'raisedAt' | 'lastSeenAt' | 'seen'>,
    at: string
  ): Notice {
    const id = noticeId(notice.key);
    const existing = this.storage.get<Record<string, unknown>>('SELECT * FROM notices WHERE id = ?', id);

    if (existing) {
      this.storage.run('UPDATE notices SET last_seen_at = ?, seen = seen + 1 WHERE id = ?', at, id);
      return { ...this.rowToNotice(existing), lastSeenAt: at, seen: Number(existing.seen) + 1 };
    }

    this.storage.run(
      `INSERT INTO notices (id, kind, key, state, finding, source, execution_id, subject, raised_at, last_seen_at, seen)
       VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      id, notice.kind, notice.key, 'OPEN', notice.finding, notice.from,
      notice.executionId ?? null, notice.subject ?? null, at, at
    );

    return { ...notice, id, state: 'OPEN', raisedAt: at, lastSeenAt: at, seen: 1 };
  }

  /**
   * Close a notice, with a name and a reason.
   *
   * Not deletion. A notice that was raised and dismissed is part of the history
   * of the thing it was raised about, and the reason somebody gave is usually
   * the most useful sentence in the whole record six months later.
   */
  acknowledge(id: string, by: string, basis: string): Notice {
    const who = String(by ?? '').trim();
    const why = String(basis ?? '').trim();
    if (!who || !why) {
      throw new Error('Acknowledging a notice takes who and why. A cleared alert with no reason teaches nobody anything.');
    }
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM notices WHERE id = ?', String(id ?? ''));
    if (!row) throw new Error(`No notice ${id}.`);

    const at = new Date().toISOString();
    this.storage.run(
      'UPDATE notices SET state = ?, acknowledged_by = ?, acknowledged_at = ?, basis = ? WHERE id = ?',
      'ACKNOWLEDGED', who, at, why, id
    );
    return { ...this.rowToNotice(row), state: 'ACKNOWLEDGED', acknowledgedBy: who, acknowledgedAt: at, basis: why };
  }

  /**
   * Re-open a notice that a later sweep would raise again anyway.
   *
   * Deliberately absent. An acknowledged notice whose cause persists keeps
   * accruing `seen` on every sweep, which is visible without changing its state
   * — and silently re-opening something a person deliberately closed is how
   * monitoring systems lose the argument with the people using them.
   */

  notices(options: { state?: NoticeState; limit?: number } = {}): Notice[] {
    const limit = Math.max(1, Math.min(500, Number(options.limit ?? 100)));
    const rows = options.state
      ? this.storage.all<Record<string, unknown>>(
          'SELECT * FROM notices WHERE state = ? ORDER BY last_seen_at DESC LIMIT ?', options.state, limit)
      : this.storage.all<Record<string, unknown>>(
          'SELECT * FROM notices ORDER BY last_seen_at DESC LIMIT ?', limit);
    return rows.map(row => this.rowToNotice(row));
  }

  /**
   * How much of the record these notices actually cover.
   *
   * Every caller gets this. An empty list of notices is meaningless without it,
   * and the `because` sentence exists so that a UI cannot render the list
   * without also rendering what the list means.
   */
  coverage(): WatchCoverage {
    const state = this.state();
    const held = Number(
      this.storage.get<{ n: number }>('SELECT COUNT(*) AS n FROM executions')?.n ?? 0
    );
    const behind = Math.max(0, held - state.highWaterSeq);

    const because = !state.everRun
      ? 'This watch has never run. There are no notices because nothing has looked, which is not the same as nothing being wrong.'
      : state.lastSweepFailed
        ? `The last sweep failed: ${state.lastSweepFailed}. Findings below are from before that, and the record has moved on since.`
        : behind > 0
          ? `The last sweep read to record ${state.highWaterSeq}; ${behind} record(s) held have not been examined yet.`
          // Factual only. This sentence used to end "...an absence of notices
          // means this sweep found none, not that the system is well" — which
          // read as nonsense sitting directly above a list of notices, and
          // duplicated the caveat the empty state and `unverifiable` already
          // carry. Coverage says how far the sweep got; what an empty list means
          // is the empty list's job to say.
          : `The last sweep at ${state.lastSweepAt} read the record to its head at ${state.highWaterSeq}, examining ${state.lastSweepRead} new record(s).`;

    return {
      everRun: state.everRun,
      sweeps: state.sweeps,
      ...(state.lastSweepAt ? { lastSweepAt: state.lastSweepAt } : {}),
      lastSweepRead: state.lastSweepRead,
      highWaterSeq: state.highWaterSeq,
      behind,
      ...(state.lastSweepFailed ? { lastSweepFailed: state.lastSweepFailed } : {}),
      because,
    };
  }

  private state(): {
    everRun: boolean;
    sweeps: number;
    lastSweepAt?: string;
    lastSweepRead: number;
    highWaterSeq: number;
    lastSweepFailed?: string;
  } {
    let row = this.storage.get<Record<string, unknown>>('SELECT * FROM watch_state WHERE id = ?', KEY_ROW);
    if (!row) {
      this.storage.run('INSERT INTO watch_state (id, sweeps, high_water_seq, last_sweep_read) VALUES (?,0,0,0)', KEY_ROW);
      row = this.storage.get<Record<string, unknown>>('SELECT * FROM watch_state WHERE id = ?', KEY_ROW)!;
    }
    return {
      everRun: Number(row.sweeps) > 0,
      sweeps: Number(row.sweeps),
      ...(row.last_sweep_at ? { lastSweepAt: String(row.last_sweep_at) } : {}),
      lastSweepRead: Number(row.last_sweep_read ?? 0),
      highWaterSeq: Number(row.high_water_seq ?? 0),
      ...(row.last_sweep_failed ? { lastSweepFailed: String(row.last_sweep_failed) } : {}),
    };
  }

  private rowToNotice(row: Record<string, unknown>): Notice {
    return {
      id: String(row.id),
      kind: String(row.kind) as NoticeKind,
      key: String(row.key),
      state: String(row.state) as NoticeState,
      finding: String(row.finding),
      from: String(row.source),
      ...(row.execution_id ? { executionId: String(row.execution_id) } : {}),
      ...(row.subject ? { subject: String(row.subject) } : {}),
      raisedAt: String(row.raised_at),
      lastSeenAt: String(row.last_seen_at),
      seen: Number(row.seen),
      ...(row.acknowledged_by ? { acknowledgedBy: String(row.acknowledged_by) } : {}),
      ...(row.acknowledged_at ? { acknowledgedAt: String(row.acknowledged_at) } : {}),
      ...(row.basis ? { basis: String(row.basis) } : {}),
    };
  }
}

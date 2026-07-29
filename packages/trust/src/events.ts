/**
 * Trust events — the evidence everything else is computed from.
 *
 * The central design rule of this package: **a score is never an opinion.** It
 * is a pure function of recorded events, each of which points at a verifiable
 * artefact (an execution trace, an audit entry). That makes every score
 * explainable, reproducible and contestable, which is what separates auditable
 * governance from a black-box rating that quietly ruins someone's day.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '@absuitecore/capkit';

export type SubjectType = 'agent' | 'human' | 'system' | 'model';

/**
 * What can be observed. Deliberately closed: a new kind of evidence requires a
 * deliberate change here, so nothing can quietly start affecting scores.
 */
export type TrustEventKind =
  | 'execution_success'
  | 'execution_failure'
  | 'policy_violation'
  | 'authorisation_denied'
  | 'manual_override'
  | 'human_approval'
  | 'unsupported_claim'
  | 'contradiction'
  | 'peer_disagreement'
  | 'verification_passed'
  | 'verification_failed'
  | 'appeal_upheld';

export interface TrustEvent {
  id: string;
  subjectId: string;
  subjectType: SubjectType;
  kind: TrustEventKind;
  at: string;
  /** Points at the artefact that proves this happened. */
  evidenceRef?: string;
  note?: string;
  /** Set when an appeal succeeded; the event stops counting but is retained. */
  neutralised?: boolean;
  neutralisedReason?: string;
}

/**
 * How much each kind of evidence moves a score, and in which direction.
 *
 * Positive weights are small and negative weights larger: trust is slow to earn
 * and quick to lose, which matches how it actually behaves. These are constants
 * in code rather than tunable per deployment, because a score that can be
 * re-weighted at will is not evidence of anything.
 */
export const EVENT_WEIGHTS: Record<TrustEventKind, number> = {
  execution_success: 1,
  verification_passed: 2,
  human_approval: 2,

  execution_failure: -3,
  verification_failed: -6,
  unsupported_claim: -5,
  contradiction: -5,
  peer_disagreement: -2,
  authorisation_denied: -4,
  policy_violation: -10,
  manual_override: -1,

  // An upheld appeal actively repairs the record rather than merely stopping
  // the penalty — being wrongly penalised should not leave a permanent mark.
  appeal_upheld: 4,
};

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS trust_events (
     id            TEXT PRIMARY KEY,
     subject_id    TEXT NOT NULL,
     subject_type  TEXT NOT NULL,
     kind          TEXT NOT NULL,
     at            TEXT NOT NULL,
     evidence_ref  TEXT,
     note          TEXT,
     neutralised   INTEGER NOT NULL DEFAULT 0,
     neutralised_reason TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_events_subject ON trust_events (subject_id, at)`,

  `CREATE TABLE IF NOT EXISTS trust_appeals (
     id          TEXT PRIMARY KEY,
     event_id    TEXT NOT NULL,
     raised_by   TEXT NOT NULL,
     reason      TEXT NOT NULL,
     status      TEXT NOT NULL DEFAULT 'open',
     decided_by  TEXT,
     decision    TEXT,
     raised_at   TEXT NOT NULL,
     decided_at  TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_appeals_event ON trust_appeals (event_id)`,
];

export interface Appeal {
  id: string;
  eventId: string;
  raisedBy: string;
  reason: string;
  status: 'open' | 'upheld' | 'rejected';
  decidedBy?: string;
  decision?: string;
  raisedAt: string;
  decidedAt?: string;
}

export class TrustEventStore {
  constructor(private readonly storage: Storage) {
    for (const statement of MIGRATIONS) this.storage.run(statement);
  }

  record(event: Omit<TrustEvent, 'id' | 'at'> & { id?: string; at?: string }): TrustEvent {
    const complete: TrustEvent = {
      id: event.id ?? `tev_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      subjectId: event.subjectId,
      subjectType: event.subjectType,
      kind: event.kind,
      at: event.at ?? new Date().toISOString(),
      ...(event.evidenceRef ? { evidenceRef: event.evidenceRef } : {}),
      ...(event.note ? { note: event.note } : {}),
    };

    this.storage.run(
      `INSERT INTO trust_events (id, subject_id, subject_type, kind, at, evidence_ref, note, neutralised)
       VALUES (?,?,?,?,?,?,?,0)`,
      complete.id, complete.subjectId, complete.subjectType, complete.kind,
      complete.at, complete.evidenceRef ?? null, complete.note ?? null
    );

    return complete;
  }

  forSubject(subjectId: string, options: { since?: string; limit?: number } = {}): TrustEvent[] {
    const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 5000);
    const params: unknown[] = [subjectId];
    let sql = 'SELECT * FROM trust_events WHERE subject_id = ?';

    if (options.since) {
      sql += ' AND at >= ?';
      params.push(options.since);
    }
    sql += ' ORDER BY at DESC LIMIT ?';
    params.push(limit);

    return this.storage.all<Record<string, unknown>>(sql, ...params).map(toEvent);
  }

  get(id: string): TrustEvent | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM trust_events WHERE id = ?', id);
    return row ? toEvent(row) : undefined;
  }

  subjects(subjectType?: SubjectType): Array<{ subjectId: string; subjectType: SubjectType; events: number }> {
    const sql = subjectType
      ? 'SELECT subject_id, subject_type, COUNT(*) AS n FROM trust_events WHERE subject_type = ? GROUP BY subject_id'
      : 'SELECT subject_id, subject_type, COUNT(*) AS n FROM trust_events GROUP BY subject_id';

    const rows = subjectType
      ? this.storage.all<Record<string, unknown>>(sql, subjectType)
      : this.storage.all<Record<string, unknown>>(sql);

    return rows.map(r => ({
      subjectId: String(r.subject_id),
      subjectType: String(r.subject_type) as SubjectType,
      events: Number(r.n),
    }));
  }

  // ---- Appeals ----

  /**
   * Raise an appeal against an event.
   *
   * Contestability is not optional. A score someone cannot challenge is a
   * blacklist, and blacklists do not belong in a system that claims to produce
   * evidence.
   */
  appeal(eventId: string, raisedBy: string, reason: string): Appeal {
    if (!this.get(eventId)) throw new Error(`No such trust event: ${eventId}`);
    if (!reason.trim()) throw new Error('An appeal requires a reason');

    const appeal: Appeal = {
      id: `apl_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      eventId,
      raisedBy,
      reason: reason.trim(),
      status: 'open',
      raisedAt: new Date().toISOString(),
    };

    this.storage.run(
      `INSERT INTO trust_appeals (id, event_id, raised_by, reason, status, raised_at)
       VALUES (?,?,?,?,'open',?)`,
      appeal.id, appeal.eventId, appeal.raisedBy, appeal.reason, appeal.raisedAt
    );
    return appeal;
  }

  /**
   * Decide an appeal.
   *
   * Upholding it neutralises the original event and records a repairing event,
   * so the subject is not left worse off for having been wrongly penalised.
   * The original is never deleted — the record of what happened, including the
   * mistake, has to survive.
   */
  decideAppeal(appealId: string, decidedBy: string, upheld: boolean, decision: string): Appeal {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM trust_appeals WHERE id = ?', appealId);
    if (!row) throw new Error(`No such appeal: ${appealId}`);
    if (String(row.status) !== 'open') throw new Error('Appeal has already been decided');

    const decidedAt = new Date().toISOString();
    const status = upheld ? 'upheld' : 'rejected';

    this.storage.transaction(() => {
      this.storage.run(
        'UPDATE trust_appeals SET status = ?, decided_by = ?, decision = ?, decided_at = ? WHERE id = ?',
        status, decidedBy, decision, decidedAt, appealId
      );

      if (upheld) {
        this.storage.run(
          'UPDATE trust_events SET neutralised = 1, neutralised_reason = ? WHERE id = ?',
          decision, String(row.event_id)
        );

        const original = this.get(String(row.event_id));
        if (original) {
          this.record({
            subjectId: original.subjectId,
            subjectType: original.subjectType,
            kind: 'appeal_upheld',
            evidenceRef: appealId,
            note: `Appeal upheld: ${decision}`,
          });
        }
      }
    });

    return {
      id: appealId,
      eventId: String(row.event_id),
      raisedBy: String(row.raised_by),
      reason: String(row.reason),
      status,
      decidedBy,
      decision,
      raisedAt: String(row.raised_at),
      decidedAt,
    };
  }

  appealsFor(eventId: string): Appeal[] {
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM trust_appeals WHERE event_id = ? ORDER BY raised_at DESC', eventId)
      .map(r => ({
        id: String(r.id),
        eventId: String(r.event_id),
        raisedBy: String(r.raised_by),
        reason: String(r.reason),
        status: String(r.status) as Appeal['status'],
        ...(r.decided_by ? { decidedBy: String(r.decided_by) } : {}),
        ...(r.decision ? { decision: String(r.decision) } : {}),
        raisedAt: String(r.raised_at),
        ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
      }));
  }
}

function toEvent(row: Record<string, unknown>): TrustEvent {
  return {
    id: String(row.id),
    subjectId: String(row.subject_id),
    subjectType: String(row.subject_type) as SubjectType,
    kind: String(row.kind) as TrustEventKind,
    at: String(row.at),
    ...(row.evidence_ref ? { evidenceRef: String(row.evidence_ref) } : {}),
    ...(row.note ? { note: String(row.note) } : {}),
    ...(Number(row.neutralised) === 1 ? { neutralised: true } : {}),
    ...(row.neutralised_reason ? { neutralisedReason: String(row.neutralised_reason) } : {}),
  };
}

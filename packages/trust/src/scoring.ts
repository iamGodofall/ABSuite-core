/**
 * Trust scoring.
 *
 * A number that summarises a subject's recorded behaviour. Four properties are
 * enforced by construction rather than left to policy, because each addresses a
 * specific way scoring systems cause harm:
 *
 * 1. **Explainable.** Every score returns the events that produced it and each
 *    one's contribution. A score you cannot interrogate is not evidence.
 * 2. **Confidence-bounded.** A score from four events is reported as *unproven*,
 *    not as 62/100. Small samples read as precise measurement and are not.
 * 3. **Decaying.** Old events fade, so a subject is judged on recent behaviour
 *    and a past mistake does not follow them forever.
 * 4. **Advisory.** `gating` is false unless an operator opts in. Scores inform
 *    humans by default; they do not silently deny anyone access.
 *
 * Scoring *humans* is additionally gated behind an explicit flag, because it is
 * an employee-monitoring capability with obligations (GDPR Art. 22 among them)
 * that a deployment must consciously accept.
 */
import { EVENT_WEIGHTS, type SubjectType, type TrustEvent, type TrustEventStore } from './events';

export type TrustBand = 'unproven' | 'low' | 'moderate' | 'high';

export interface Contribution {
  eventId: string;
  kind: string;
  at: string;
  rawWeight: number;
  /** Weight after time decay — what actually moved the score. */
  effectiveWeight: number;
  evidenceRef?: string;
}

export interface TrustScore {
  subjectId: string;
  subjectType: SubjectType;
  /** 0-100. Meaningless on its own — always read with `confidence` and `band`. */
  score: number;
  /** 0-1, from sample size. Below 0.5 the score is reported as unproven. */
  confidence: number;
  band: TrustBand;
  eventCount: number;
  /** Events that were appealed successfully and no longer count. */
  neutralisedCount: number;
  contributions: Contribution[];
  computedAt: string;
  halfLifeDays: number;
  /** False unless explicitly enabled. Advisory scores must not deny access. */
  gating: boolean;
  /** Plain-language summary of why the score is what it is. */
  explanation: string;
}

export interface ScoringOptions {
  /** Days after which an event's weight halves. */
  halfLifeDays?: number;
  /** Events needed before confidence reaches 1. */
  confidenceSaturation?: number;
  /** Allow this score to be used to deny access. Off by default. */
  gating?: boolean;
  now?: Date;
}

const DEFAULT_HALF_LIFE_DAYS = 30;
const DEFAULT_SATURATION = 25;

/** Neutral starting point: an unknown subject is neither trusted nor suspect. */
export const BASELINE_SCORE = 50;

function decayFactor(event: TrustEvent, now: Date, halfLifeDays: number): number {
  const ageDays = (now.getTime() - Date.parse(event.at)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function bandFor(score: number, confidence: number): TrustBand {
  // Confidence gates the band before the score does. Refusing to place a
  // subject in a band on thin evidence is the whole point.
  if (confidence < 0.5) return 'unproven';
  if (score >= 75) return 'high';
  if (score >= 45) return 'moderate';
  return 'low';
}

/**
 * Compute a score from events.
 *
 * Pure — same events and clock produce the same score, which is what makes it
 * reproducible for an auditor.
 */
export function computeScore(
  subjectId: string,
  subjectType: SubjectType,
  events: readonly TrustEvent[],
  options: ScoringOptions = {}
): TrustScore {
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const saturation = options.confidenceSaturation ?? DEFAULT_SATURATION;
  const now = options.now ?? new Date();

  const counted = events.filter(e => !e.neutralised);
  const neutralisedCount = events.length - counted.length;

  const contributions: Contribution[] = counted.map(event => {
    const rawWeight = EVENT_WEIGHTS[event.kind] ?? 0;
    const effectiveWeight = rawWeight * decayFactor(event, now, halfLifeDays);
    return {
      eventId: event.id,
      kind: event.kind,
      at: event.at,
      rawWeight,
      effectiveWeight: Math.round(effectiveWeight * 100) / 100,
      ...(event.evidenceRef ? { evidenceRef: event.evidenceRef } : {}),
    };
  });

  const net = contributions.reduce((total, c) => total + c.effectiveWeight, 0);

  // Squash into 0-100 around the baseline. A bounded curve stops any single
  // event dominating and keeps the number interpretable at the extremes.
  const score = Math.round(
    Math.max(0, Math.min(100, BASELINE_SCORE + 50 * Math.tanh(net / 25)))
  );

  const confidence = Math.round(Math.min(1, counted.length / saturation) * 100) / 100;
  const band = bandFor(score, confidence);

  const negatives = contributions.filter(c => c.effectiveWeight < 0).length;
  const explanation = counted.length === 0
    ? 'No recorded events. This subject is unproven, not untrusted.'
    : confidence < 0.5
      ? `Only ${counted.length} recorded event(s) — too few to score reliably. Reported as unproven rather than as a number to act on.`
      : `Based on ${counted.length} recorded event(s), ${negatives} negative. Older events count less (${halfLifeDays}-day half-life).`;

  return {
    subjectId,
    subjectType,
    score,
    confidence,
    band,
    eventCount: counted.length,
    neutralisedCount,
    // Newest first, and only what a reader can actually digest.
    contributions: contributions.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50),
    computedAt: now.toISOString(),
    halfLifeDays,
    gating: options.gating ?? false,
    explanation,
  };
}

export interface TrustScorerOptions extends ScoringOptions {
  /**
   * Permit scoring of human subjects.
   *
   * Off by default. Scoring people is an employee-monitoring capability with
   * legal and ethical obligations; a deployment must opt in deliberately rather
   * than acquire it as a side effect of installing ABSuite.
   */
  scoreHumans?: boolean;
}

/**
 * A count of what was recorded about a subject. No score, no band, no verdict.
 *
 * This is the *only* thing ABSuite will report about a person by default, and
 * the distinction is not a technicality. "John has a trust score of 42" is a
 * conclusion a machine reached about a human being, and it will be used to deny
 * him things by people who never see how it was computed. "John: 1,042 actions
 * recorded, 2 policy violations, 1 manual override, 0 audit findings" is a set
 * of facts he can check, contest line by line, and explain.
 *
 * Facts, never conclusions. That is the difference between infrastructure and a
 * social credit system, and it is a line worth being unable to cross.
 */
export interface EvidenceRecord {
  subjectId: string;
  subjectType: SubjectType;
  /** Every recorded event kind and how many times it occurred. */
  counts: Record<string, number>;
  actionsRecorded: number;
  policyViolations: number;
  manualOverrides: number;
  auditFindings: number;
  /** Events neutralised by a successful appeal — no longer counted anywhere. */
  neutralised: number;
  firstRecorded?: string;
  lastRecorded?: string;
  /** States plainly that no judgement is being offered. */
  note: string;
}

const NO_JUDGEMENT =
  'These are recorded facts, not an assessment. No score, ranking or conclusion ' +
  'is offered or implied. Every line is contestable — see the underlying events.';

/**
 * Compile the facts recorded about a subject, with no judgement attached.
 *
 * Works for any subject type including humans, and needs no flag, because
 * counting what happened is not the same act as rating a person.
 */
export function evidenceRecord(
  subjectId: string,
  subjectType: SubjectType,
  events: readonly TrustEvent[]
): EvidenceRecord {
  const counts: Record<string, number> = {};
  let neutralised = 0;

  for (const event of events) {
    if (event.neutralised) {
      neutralised += 1;
      continue;
    }
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }

  const timestamps = events.map(e => e.at).sort();

  return {
    subjectId,
    subjectType,
    counts,
    actionsRecorded: events.length - neutralised,
    policyViolations: counts.policy_violation ?? 0,
    manualOverrides: counts.manual_override ?? 0,
    auditFindings: (counts.verification_failed ?? 0) + (counts.unsupported_claim ?? 0) + (counts.contradiction ?? 0),
    neutralised,
    ...(timestamps.length ? { firstRecorded: timestamps[0]!, lastRecorded: timestamps[timestamps.length - 1]! } : {}),
    note: NO_JUDGEMENT,
  };
}

export class TrustScorer {
  private readonly scoreHumans: boolean;

  constructor(private readonly events: TrustEventStore, private readonly options: TrustScorerOptions = {}) {
    this.scoreHumans = options.scoreHumans
      ?? ['1', 'true', 'yes'].includes((process.env.ABSUITE_TRUST_SCORE_HUMANS || '').toLowerCase());
  }

  get humansScorable(): boolean {
    return this.scoreHumans;
  }

  score(subjectId: string, subjectType: SubjectType): TrustScore {
    if (subjectType === 'human' && !this.scoreHumans) {
      throw new Error(
        'Scoring human subjects is disabled. Use evidenceRecord() instead — it reports what ' +
        'was recorded about the person as facts, with no score or conclusion, which is what ' +
        'almost every real use case actually needs. To override, set ABSUITE_TRUST_SCORE_HUMANS=true ' +
        'and review your obligations around automated decision-making first.'
      );
    }

    return computeScore(subjectId, subjectType, this.events.forSubject(subjectId), this.options);
  }

  /**
   * The facts recorded about a subject, with no judgement attached.
   *
   * Always available, for every subject type. Counting what happened is not the
   * same act as rating someone, so this needs no flag and has no off switch.
   */
  evidence(subjectId: string, subjectType: SubjectType): EvidenceRecord {
    return evidenceRecord(subjectId, subjectType, this.events.forSubject(subjectId));
  }

  /** Score every subject of a type, cheapest way to render a dashboard. */
  scoreAll(subjectType?: SubjectType): TrustScore[] {
    return this.events
      .subjects(subjectType)
      .filter(s => s.subjectType !== 'human' || this.scoreHumans)
      .map(s => this.score(s.subjectId, s.subjectType));
  }

  /**
   * Would this subject pass a threshold?
   *
   * Returns `allowed: true` when gating is disabled — advisory scores must
   * never deny access — and always says which mode produced the answer, so a
   * caller cannot mistake advice for enforcement.
   */
  check(subjectId: string, subjectType: SubjectType, threshold: number): {
    allowed: boolean;
    advisory: boolean;
    score: TrustScore;
    reason: string;
  } {
    const score = this.score(subjectId, subjectType);
    const gating = this.options.gating ?? false;

    if (!gating) {
      return {
        allowed: true,
        advisory: true,
        score,
        reason: `Advisory only. Score ${score.score}/${threshold} (${score.band}); gating is disabled so access is not affected.`,
      };
    }

    // Never gate on evidence too thin to support the judgement.
    if (score.confidence < 0.5) {
      return {
        allowed: true,
        advisory: false,
        score,
        reason: `Insufficient evidence to gate (${score.eventCount} events). Allowed rather than penalising an unproven subject.`,
      };
    }

    const allowed = score.score >= threshold;
    return {
      allowed,
      advisory: false,
      score,
      reason: allowed
        ? `Score ${score.score} meets the threshold of ${threshold}.`
        : `Score ${score.score} is below the threshold of ${threshold}. This decision is contestable — see the contributing events.`,
    };
  }
}

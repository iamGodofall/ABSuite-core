/**
 * Multi-AI arbitration — deciding what to do when agents disagree.
 *
 * **The failure mode this is built around.** The naive design is a vote: ask
 * five models, take the majority. That is worse than useless, for a reason that
 * is easy to miss — model errors are *correlated*. Models trained on
 * overlapping corpora, or three deployments of the same base model behind
 * different names, fail on the same inputs in the same direction. A 5-0
 * "consensus" among them is one opinion counted five times, and it arrives
 * wearing the costume of overwhelming agreement. Unanimity among correlated
 * participants is a weaker signal than a 2-1 split among independent ones, and
 * any arbitrator that cannot express that will confidently ratify a shared
 * hallucination.
 *
 * So this arbitrator does four things a vote does not:
 *
 * 1. **Discounts correlated agreement.** Participants declare a family (base
 *    model or provider). Agreement within one family counts once, not once per
 *    participant. Independence is the thing being measured, not headcount.
 * 2. **Weights by recorded behaviour**, not by confidence. A participant's
 *    trust score comes from verifiable events; self-reported confidence is
 *    accepted but capped, because a model's certainty is uncorrelated with its
 *    accuracy and is trivially gamed.
 * 3. **Escalates rather than guesses.** Thin evidence, a close split, or a
 *    consequential decision returns `escalate` with the disagreement laid out.
 *    Refusing to decide is a valid and often correct outcome.
 * 4. **Never auto-resolves an irreversible action.** Marking a dispute
 *    `irreversible` forces human sign-off regardless of how strong the
 *    consensus looks. Nothing here deletes anything on a majority vote.
 *
 * Every decision returns its full reasoning: who said what, which votes were
 * discounted and why, and what would have changed the outcome.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '@absuitecore/capkit';
import type { TrustScorer } from './scoring';

export type ArbitrationOutcome = 'resolved' | 'escalate' | 'no_consensus';

export interface Position {
  /** The agent taking this position. */
  agentId: string;
  /** The answer. Compared after normalisation, so formatting differences do not read as disagreement. */
  answer: string;
  /**
   * Model family or provider — `openai:gpt-4`, `anthropic:claude`, `local:llama`.
   *
   * The single most important field here. Participants sharing a family have
   * correlated failures, so their agreement is discounted to one voice.
   * Unset means "assumed independent", which is the optimistic reading and
   * should be filled in wherever it is known.
   */
  family?: string;
  /** The participant's own confidence, 0-1. Capped in weighting — models are poorly calibrated. */
  confidence?: number;
  /** Why. Recorded verbatim so a human reviewing the dispute can judge the argument itself. */
  rationale?: string;
  /** Signed execution trace backing this position. */
  traceRef?: string;
}

export interface Dispute {
  id: string;
  /** What was being decided, in plain language. */
  question: string;
  positions: Position[];
  /**
   * Whether acting on the outcome can be undone.
   *
   * Irreversible disputes always escalate. Deleting production data on a 3-2
   * vote among language models is not a system anyone should ship.
   */
  irreversible?: boolean;
  /** Free-form tag for routing (`billing`, `deploy`, `content`). */
  domain?: string;
  createdAt: string;
  outcome?: ArbitrationOutcome;
  resolvedAnswer?: string;
  resolvedAt?: string;
  /** Set once a human decides an escalated dispute. */
  decidedBy?: string;
}

export interface WeightedPosition {
  agentId: string;
  answer: string;
  family: string;
  /** Final weight after trust and correlation adjustments. */
  weight: number;
  /** Weight before correlation discounting — shows what was taken off, and why. */
  rawWeight: number;
  trustScore: number;
  trustBand: string;
  discounted: boolean;
  discountReason?: string;
}

export interface ArbitrationResult {
  disputeId: string;
  outcome: ArbitrationOutcome;
  /** Present only when `outcome` is `resolved`. */
  answer?: string;
  /** 0-1. How decisively the winning answer led, after discounting. */
  margin: number;
  /** Distinct model families that backed the winning answer. The real strength signal. */
  independentSupport: number;
  positions: WeightedPosition[];
  /** Each distinct answer and the weight behind it. */
  tally: Array<{ answer: string; weight: number; families: string[]; agents: string[] }>;
  /** Full reasoning, written to be read by the person who has to defend the decision. */
  reasoning: string[];
  /** Present when escalating: what a human needs to look at. */
  escalationBrief?: string;
  requiresHuman: boolean;
  arbitratedAt: string;
}

export interface ArbitrationOptions {
  /** Share of total weight the leader needs to win outright. */
  requiredMargin?: number;
  /** Distinct families required before a majority is treated as independent corroboration. */
  minIndependentSupport?: number;
  /** Ceiling on self-reported confidence's effect. Models are overconfident; this bounds the damage. */
  maxConfidenceInfluence?: number;
  /** Scorer used to weight participants by recorded behaviour. Optional — equal weights without it. */
  scorer?: TrustScorer;
  now?: Date;
}

const DEFAULT_REQUIRED_MARGIN = 0.6;
const DEFAULT_MIN_INDEPENDENT_SUPPORT = 2;
const DEFAULT_MAX_CONFIDENCE_INFLUENCE = 0.25;

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS trust_disputes (
     id           TEXT PRIMARY KEY,
     question     TEXT NOT NULL,
     positions    TEXT NOT NULL,
     irreversible INTEGER NOT NULL DEFAULT 0,
     domain       TEXT,
     created_at   TEXT NOT NULL,
     outcome      TEXT,
     resolved_answer TEXT,
     resolved_at  TEXT,
     decided_by   TEXT,
     reasoning    TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_disputes_created ON trust_disputes (created_at)`,
];

/**
 * Normalise an answer for comparison.
 *
 * Two agents saying "Yes." and "yes" agree; treating that as a split would
 * manufacture disagreement out of punctuation and escalate everything.
 */
export function normaliseAnswer(answer: string): string {
  return String(answer ?? '')
    .toLowerCase()
    .replace(/[\s]+/g, ' ')
    .replace(/[.,;:!?"'`]+/g, '')
    .trim();
}

/**
 * Arbitrate a dispute.
 *
 * Pure — the same positions and scores always produce the same result and the
 * same reasoning, which is what makes an arbitration decision auditable after
 * the fact rather than merely plausible at the time.
 */
export function arbitrate(dispute: Dispute, options: ArbitrationOptions = {}): ArbitrationResult {
  const requiredMargin = options.requiredMargin ?? DEFAULT_REQUIRED_MARGIN;
  const minIndependent = options.minIndependentSupport ?? DEFAULT_MIN_INDEPENDENT_SUPPORT;
  const confidenceInfluence = options.maxConfidenceInfluence ?? DEFAULT_MAX_CONFIDENCE_INFLUENCE;
  const now = options.now ?? new Date();

  const reasoning: string[] = [];

  if (dispute.positions.length === 0) {
    return {
      disputeId: dispute.id,
      outcome: 'no_consensus',
      margin: 0,
      independentSupport: 0,
      positions: [],
      tally: [],
      reasoning: ['No positions were submitted. There is nothing to arbitrate.'],
      requiresHuman: true,
      arbitratedAt: now.toISOString(),
    };
  }

  // 1. Weight each participant by recorded behaviour, not by assertion.
  const weighted: WeightedPosition[] = dispute.positions.map(position => {
    const family = position.family?.trim() || `independent:${position.agentId}`;

    let trustScore = 50;
    let trustBand = 'unproven';
    if (options.scorer) {
      try {
        const score = options.scorer.score(position.agentId, 'agent');
        trustBand = score.band;
        // An unproven participant is neither promoted nor punished — it sits at
        // the baseline, because thin evidence is not evidence of unreliability.
        trustScore = score.confidence < 0.5 ? 50 : score.score;
      } catch {
        // A subject that cannot be scored simply carries baseline weight.
      }
    }

    // Trust maps to 0.5-1.5 so a poor record halves influence without silencing
    // a participant entirely. Being wrong before is not grounds for exclusion.
    const trustWeight = 0.5 + trustScore / 100;

    const confidence = Math.max(0, Math.min(1, Number(position.confidence ?? 0.5)));
    const confidenceWeight = 1 + (confidence - 0.5) * 2 * confidenceInfluence;

    const rawWeight = Math.round(trustWeight * confidenceWeight * 1000) / 1000;

    return {
      agentId: position.agentId,
      answer: position.answer,
      family,
      weight: rawWeight,
      rawWeight,
      trustScore,
      trustBand,
      discounted: false,
    };
  });

  // 2. Discount correlated agreement. Within one answer, participants from the
  //    same family are one voice: the strongest keeps full weight, the rest are
  //    reduced sharply. This is the step that stops five wrappers around one
  //    base model from manufacturing a consensus.
  const byAnswerAndFamily = new Map<string, WeightedPosition[]>();
  for (const position of weighted) {
    const key = `${normaliseAnswer(position.answer)} ${position.family}`;
    if (!byAnswerAndFamily.has(key)) byAnswerAndFamily.set(key, []);
    byAnswerAndFamily.get(key)!.push(position);
  }

  for (const [, group] of byAnswerAndFamily) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.rawWeight - a.rawWeight);

    for (const position of group.slice(1)) {
      position.weight = Math.round(position.rawWeight * 0.2 * 1000) / 1000;
      position.discounted = true;
      position.discountReason =
        `Shares model family "${position.family}" with ${group[0]!.agentId}, which gave the same answer. ` +
        'Correlated participants fail together, so their agreement is counted once rather than twice.';
    }

    reasoning.push(
      `${group.length} participants from family "${group[0]!.family}" gave the same answer. ` +
      `Counted as one independent voice — agreement between correlated models is not corroboration.`
    );
  }

  // 3. Tally.
  const tally = new Map<string, { answer: string; weight: number; families: Set<string>; agents: string[] }>();
  for (const position of weighted) {
    const key = normaliseAnswer(position.answer);
    if (!tally.has(key)) {
      tally.set(key, { answer: position.answer, weight: 0, families: new Set(), agents: [] });
    }
    const entry = tally.get(key)!;
    entry.weight += position.weight;
    entry.families.add(position.family);
    entry.agents.push(position.agentId);
  }

  const ranked = [...tally.values()].sort((a, b) => b.weight - a.weight);
  const totalWeight = ranked.reduce((sum, entry) => sum + entry.weight, 0);
  const leader = ranked[0]!;
  const margin = totalWeight > 0 ? leader.weight / totalWeight : 0;
  const independentSupport = leader.families.size;

  const renderedTally = ranked.map(entry => ({
    answer: entry.answer,
    weight: Math.round(entry.weight * 1000) / 1000,
    families: [...entry.families],
    agents: entry.agents,
  }));

  const base = {
    disputeId: dispute.id,
    margin: Math.round(margin * 100) / 100,
    independentSupport,
    positions: weighted,
    tally: renderedTally,
    arbitratedAt: now.toISOString(),
  };

  // 4. Decide — or decline to.
  if (dispute.irreversible) {
    reasoning.push(
      'This dispute is marked irreversible. Escalating regardless of the tally: ' +
      'an action that cannot be undone must not be authorised by a vote among models.'
    );
    return {
      ...base,
      outcome: 'escalate',
      requiresHuman: true,
      reasoning,
      escalationBrief: brief(dispute, renderedTally, weighted, 'the action cannot be undone'),
    };
  }

  if (ranked.length === 1) {
    // Unanimity is only meaningful when the agreeing parties could have failed
    // independently. One family agreeing with itself proves nothing.
    if (independentSupport < minIndependent && weighted.length > 1) {
      reasoning.push(
        `All ${weighted.length} participants agreed, but they span only ${independentSupport} model ` +
        `family/families. Unanimity within a family is one opinion repeated, so this is not treated as settled.`
      );
      return {
        ...base,
        outcome: 'escalate',
        requiresHuman: true,
        reasoning,
        escalationBrief: brief(dispute, renderedTally, weighted, 'apparent unanimity comes from correlated participants'),
      };
    }

    reasoning.push(`All participants agree, spanning ${independentSupport} independent model family/families.`);
    return {
      ...base,
      outcome: 'resolved',
      answer: leader.answer,
      requiresHuman: false,
      reasoning,
    };
  }

  if (margin < requiredMargin) {
    reasoning.push(
      `Leading answer holds ${Math.round(margin * 100)}% of weight, short of the ${Math.round(requiredMargin * 100)}% ` +
      'needed to resolve. A narrow split is exactly the case where a machine decision is least defensible.'
    );
    return {
      ...base,
      outcome: 'no_consensus',
      requiresHuman: true,
      reasoning,
      escalationBrief: brief(dispute, renderedTally, weighted, 'the participants are close to evenly split'),
    };
  }

  // Independence must be *won*, not asserted. Without this, a participant
  // reporting maximum confidence against one reporting minimum can drag a
  // genuine one-against-one tie over the margin threshold on self-assessment
  // alone — and a model's confidence is both poorly calibrated and trivially
  // gamed by whoever writes its prompt.
  const runnerUp = ranked[1]!;
  if (leader.families.size <= runnerUp.families.size) {
    reasoning.push(
      `Leading answer clears the margin but is backed by ${leader.families.size} independent family/families ` +
      `against the runner-up's ${runnerUp.families.size}. Weight came from confidence or trust rather than from ` +
      'broader corroboration, which is not enough to settle a dispute.'
    );
    return {
      ...base,
      outcome: 'no_consensus',
      requiresHuman: true,
      reasoning,
      escalationBrief: brief(dispute, renderedTally, weighted, 'no answer has more independent support than another'),
    };
  }

  if (independentSupport < minIndependent) {
    reasoning.push(
      `Leading answer clears the margin (${Math.round(margin * 100)}%) but is backed by only ` +
      `${independentSupport} model family. Weight without independence is not corroboration.`
    );
    return {
      ...base,
      outcome: 'escalate',
      requiresHuman: true,
      reasoning,
      escalationBrief: brief(dispute, renderedTally, weighted, 'only one model family backs the leading answer'),
    };
  }

  reasoning.push(
    `Leading answer holds ${Math.round(margin * 100)}% of weight with ${independentSupport} independent ` +
    `families in support, clearing both thresholds.`
  );
  const dissent = ranked.slice(1);
  if (dissent.length) {
    reasoning.push(
      `Dissent recorded and retained: ${dissent.map(d => `${d.agents.join(', ')} said "${truncate(d.answer)}"`).join('; ')}. ` +
      'A resolved dispute does not make the minority position disappear.'
    );
  }

  return {
    ...base,
    outcome: 'resolved',
    answer: leader.answer,
    requiresHuman: false,
    reasoning,
  };
}

function truncate(text: string, max = 60): string {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/** Write the brief a human needs in order to decide in under a minute. */
function brief(
  dispute: Dispute,
  tally: ArbitrationResult['tally'],
  positions: readonly WeightedPosition[],
  because: string
): string {
  const lines = [
    `Question: ${dispute.question}`,
    `Escalated because ${because}.`,
    '',
    'Positions:',
  ];

  for (const entry of tally) {
    lines.push(`  "${truncate(entry.answer, 120)}" — weight ${entry.weight}, from ${entry.agents.join(', ')} (families: ${entry.families.join(', ')})`);
  }

  const discounted = positions.filter(p => p.discounted);
  if (discounted.length) {
    lines.push('', 'Discounted for correlation:');
    for (const position of discounted) lines.push(`  ${position.agentId}: ${position.discountReason}`);
  }

  const rationales = dispute.positions.filter(p => p.rationale?.trim());
  if (rationales.length) {
    lines.push('', 'Stated reasoning:');
    for (const position of rationales) lines.push(`  ${position.agentId}: ${position.rationale}`);
  }

  lines.push('', 'No action has been taken. This decision is yours.');
  return lines.join('\n');
}

export class ArbitrationStore {
  constructor(private readonly storage: Storage) {
    for (const statement of MIGRATIONS) this.storage.run(statement);
  }

  open(dispute: Omit<Dispute, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Dispute {
    if (!dispute.question?.trim()) throw new Error('A dispute requires a question');

    const complete: Dispute = {
      id: dispute.id ?? `dsp_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      question: dispute.question.trim(),
      positions: dispute.positions ?? [],
      ...(dispute.irreversible ? { irreversible: true } : {}),
      ...(dispute.domain ? { domain: dispute.domain } : {}),
      createdAt: dispute.createdAt ?? new Date().toISOString(),
    };

    this.storage.run(
      `INSERT INTO trust_disputes (id, question, positions, irreversible, domain, created_at)
       VALUES (?,?,?,?,?,?)`,
      complete.id, complete.question, JSON.stringify(complete.positions),
      complete.irreversible ? 1 : 0, complete.domain ?? null, complete.createdAt
    );

    return complete;
  }

  get(id: string): Dispute | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM trust_disputes WHERE id = ?', id);
    return row ? toDispute(row) : undefined;
  }

  /** Arbitrate a stored dispute and persist the outcome with its reasoning. */
  resolve(id: string, options: ArbitrationOptions = {}): ArbitrationResult {
    const dispute = this.get(id);
    if (!dispute) throw new Error(`No such dispute: ${id}`);

    const result = arbitrate(dispute, options);

    this.storage.run(
      'UPDATE trust_disputes SET outcome = ?, resolved_answer = ?, resolved_at = ?, reasoning = ? WHERE id = ?',
      result.outcome, result.answer ?? null, result.arbitratedAt, JSON.stringify(result.reasoning), id
    );

    return result;
  }

  /**
   * Record a human's decision on an escalated dispute.
   *
   * The machine's reasoning is kept alongside it. When a human overrules the
   * arbitrator, that disagreement is the most valuable record in the system —
   * it is how you find out the thresholds are wrong.
   */
  decide(id: string, decidedBy: string, answer: string): Dispute {
    const dispute = this.get(id);
    if (!dispute) throw new Error(`No such dispute: ${id}`);

    const resolvedAt = new Date().toISOString();
    this.storage.run(
      'UPDATE trust_disputes SET outcome = ?, resolved_answer = ?, resolved_at = ?, decided_by = ? WHERE id = ?',
      'resolved', answer, resolvedAt, decidedBy, id
    );

    return { ...dispute, outcome: 'resolved', resolvedAnswer: answer, resolvedAt, decidedBy };
  }

  list(limit = 50): Dispute[] {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM trust_disputes ORDER BY created_at DESC LIMIT ?', capped)
      .map(toDispute);
  }

  /** Disputes still waiting on a person. The queue that actually needs working. */
  pending(limit = 50): Dispute[] {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.storage
      .all<Record<string, unknown>>(
        `SELECT * FROM trust_disputes
         WHERE decided_by IS NULL AND (outcome IS NULL OR outcome IN ('escalate','no_consensus'))
         ORDER BY created_at ASC LIMIT ?`,
        capped
      )
      .map(toDispute);
  }
}

function toDispute(row: Record<string, unknown>): Dispute {
  return {
    id: String(row.id),
    question: String(row.question),
    positions: safeParse(row.positions),
    ...(Number(row.irreversible) === 1 ? { irreversible: true } : {}),
    ...(row.domain ? { domain: String(row.domain) } : {}),
    createdAt: String(row.created_at),
    ...(row.outcome ? { outcome: String(row.outcome) as ArbitrationOutcome } : {}),
    ...(row.resolved_answer ? { resolvedAnswer: String(row.resolved_answer) } : {}),
    ...(row.resolved_at ? { resolvedAt: String(row.resolved_at) } : {}),
    ...(row.decided_by ? { decidedBy: String(row.decided_by) } : {}),
  };
}

function safeParse(value: unknown): Position[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

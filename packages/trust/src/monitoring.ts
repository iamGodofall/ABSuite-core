/**
 * AI-to-AI monitoring — agents observing agents.
 *
 * The premise is straightforward: as soon as one agent's output becomes another
 * agent's input, a failure stops being local. A bad answer propagates, gets
 * elaborated on, and arrives at a human wearing three layers of confident
 * summary. Whoever ends up debugging that needs to know where it entered.
 *
 * **The trap this design avoids.** The obvious implementation is one agent
 * judging another's output quality — and that is circular: you are using an
 * unverified model to certify an unverified model, and the reviewer's mistakes
 * are invisible because nothing reviews the reviewer. So monitoring here never
 * asks "is this good?". It records *structural* facts that are true regardless
 * of anyone's judgement:
 *
 * - who invoked whom, and how deep the chain went
 * - where a claim first entered the chain, so blame lands on the origin rather
 *   than the last agent to repeat it
 * - whether observers agreed, recorded as disagreement rather than as a verdict
 * - loops, runaway fan-out and stalls, which are defects by definition
 *
 * A monitoring agent can attach an opinion, but it is stored as *that agent's
 * opinion*, weighted by its own trust score, and it never silently becomes
 * truth. Disagreement between observers is a first-class outcome — it is the
 * most useful thing this system produces, because it marks exactly where a
 * human should look.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '@absuite/capkit';

export type InteractionKind = 'invoke' | 'delegate' | 'review' | 'handoff' | 'respond';

export interface Interaction {
  id: string;
  /** Groups every interaction belonging to one top-level request. */
  chainId: string;
  sourceAgent: string;
  targetAgent: string;
  kind: InteractionKind;
  /** Hops from the chain's root. Depth is how a runaway is spotted early. */
  depth: number;
  at: string;
  /** Hash of the payload, never the payload — monitoring must not become a data lake. */
  payloadHash?: string;
  /** Signed execution trace backing this interaction, when there is one. */
  traceRef?: string;
  /** Set when this interaction introduced a claim not present in its inputs. */
  introducedClaim?: boolean;
  note?: string;
}

export type ObservationVerdict = 'ok' | 'concern' | 'violation';

export interface Observation {
  id: string;
  interactionId: string;
  /** The agent doing the observing. Its own trust score bounds this observation's weight. */
  observerAgent: string;
  verdict: ObservationVerdict;
  reason: string;
  /** 0-1, the observer's own stated confidence. Advisory input, never a decision. */
  confidence: number;
  at: string;
}

export type AnomalyKind = 'cycle' | 'excessive_depth' | 'fan_out' | 'stalled' | 'observer_disagreement';

export interface Anomaly {
  kind: AnomalyKind;
  severity: 'warning' | 'critical';
  chainId: string;
  detail: string;
  /** Agents involved, so this can be routed to whoever owns them. */
  agents: string[];
}

export interface ChainSummary {
  chainId: string;
  interactions: number;
  agents: string[];
  maxDepth: number;
  startedAt: string;
  lastAt: string;
  anomalies: Anomaly[];
  /** Agents that introduced claims, earliest first — where to start debugging. */
  claimOrigins: string[];
}

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS trust_interactions (
     id            TEXT PRIMARY KEY,
     chain_id      TEXT NOT NULL,
     source_agent  TEXT NOT NULL,
     target_agent  TEXT NOT NULL,
     kind          TEXT NOT NULL,
     depth         INTEGER NOT NULL DEFAULT 0,
     at            TEXT NOT NULL,
     payload_hash  TEXT,
     trace_ref     TEXT,
     introduced_claim INTEGER NOT NULL DEFAULT 0,
     note          TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_interactions_chain ON trust_interactions (chain_id, at)`,
  `CREATE INDEX IF NOT EXISTS idx_trust_interactions_agent ON trust_interactions (source_agent, at)`,

  `CREATE TABLE IF NOT EXISTS trust_observations (
     id             TEXT PRIMARY KEY,
     interaction_id TEXT NOT NULL,
     observer_agent TEXT NOT NULL,
     verdict        TEXT NOT NULL,
     reason         TEXT NOT NULL,
     confidence     REAL NOT NULL DEFAULT 0.5,
     at             TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_observations_interaction ON trust_observations (interaction_id)`,
];

export interface MonitorOptions {
  /** Chain depth beyond which something has almost certainly gone wrong. */
  maxDepth?: number;
  /** Calls from one agent within a chain before it looks like a runaway. */
  maxFanOut?: number;
  /** Silence after which an unfinished chain is treated as stalled. */
  stalledAfterMs?: number;
}

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_FAN_OUT = 40;
const DEFAULT_STALLED_AFTER_MS = 15 * 60 * 1000;

export class InteractionMonitor {
  private readonly maxDepth: number;
  private readonly maxFanOut: number;
  private readonly stalledAfterMs: number;

  constructor(private readonly storage: Storage, options: MonitorOptions = {}) {
    for (const statement of MIGRATIONS) this.storage.run(statement);
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxFanOut = options.maxFanOut ?? DEFAULT_MAX_FAN_OUT;
    this.stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
  }

  /**
   * Record one agent acting on another.
   *
   * Depth is derived from the chain rather than trusted from the caller — an
   * agent in a loop has every incentive to report depth 0 forever, and a
   * self-reported field would make the cycle check worthless.
   */
  record(interaction: Omit<Interaction, 'id' | 'at' | 'depth'> & { id?: string; at?: string; depth?: number }): Interaction {
    const priorDepth = this.storage.get<{ d: number }>(
      'SELECT MAX(depth) AS d FROM trust_interactions WHERE chain_id = ? AND target_agent = ?',
      interaction.chainId, interaction.sourceAgent
    );

    const derivedDepth = priorDepth?.d === null || priorDepth?.d === undefined ? 0 : Number(priorDepth.d) + 1;

    const complete: Interaction = {
      id: interaction.id ?? `int_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      chainId: interaction.chainId,
      sourceAgent: interaction.sourceAgent,
      targetAgent: interaction.targetAgent,
      kind: interaction.kind,
      depth: interaction.depth ?? derivedDepth,
      at: interaction.at ?? new Date().toISOString(),
      ...(interaction.payloadHash ? { payloadHash: interaction.payloadHash } : {}),
      ...(interaction.traceRef ? { traceRef: interaction.traceRef } : {}),
      ...(interaction.introducedClaim ? { introducedClaim: true } : {}),
      ...(interaction.note ? { note: interaction.note } : {}),
    };

    this.storage.run(
      `INSERT INTO trust_interactions
         (id, chain_id, source_agent, target_agent, kind, depth, at, payload_hash, trace_ref, introduced_claim, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      complete.id, complete.chainId, complete.sourceAgent, complete.targetAgent, complete.kind,
      complete.depth, complete.at, complete.payloadHash ?? null, complete.traceRef ?? null,
      complete.introducedClaim ? 1 : 0, complete.note ?? null
    );

    return complete;
  }

  /**
   * Attach an observer's opinion to an interaction.
   *
   * Stored as an opinion belonging to a named observer, never folded into the
   * interaction itself. That is what makes disagreement detectable instead of
   * whichever observer wrote last winning.
   */
  observe(observation: Omit<Observation, 'id' | 'at'> & { id?: string; at?: string }): Observation {
    if (!this.getInteraction(observation.interactionId)) {
      throw new Error(`No such interaction: ${observation.interactionId}`);
    }
    if (!observation.reason?.trim()) {
      throw new Error('An observation requires a reason — an unexplained verdict is not evidence');
    }

    const complete: Observation = {
      id: observation.id ?? `obs_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      interactionId: observation.interactionId,
      observerAgent: observation.observerAgent,
      verdict: observation.verdict,
      reason: observation.reason.trim(),
      confidence: Math.max(0, Math.min(1, Number(observation.confidence ?? 0.5))),
      at: observation.at ?? new Date().toISOString(),
    };

    this.storage.run(
      `INSERT INTO trust_observations (id, interaction_id, observer_agent, verdict, reason, confidence, at)
       VALUES (?,?,?,?,?,?,?)`,
      complete.id, complete.interactionId, complete.observerAgent, complete.verdict,
      complete.reason, complete.confidence, complete.at
    );

    return complete;
  }

  getInteraction(id: string): Interaction | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM trust_interactions WHERE id = ?', id);
    return row ? toInteraction(row) : undefined;
  }

  chain(chainId: string): Interaction[] {
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM trust_interactions WHERE chain_id = ? ORDER BY at ASC', chainId)
      .map(toInteraction);
  }

  observationsFor(interactionId: string): Observation[] {
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM trust_observations WHERE interaction_id = ? ORDER BY at ASC', interactionId)
      .map(toObservation);
  }

  chains(limit = 50): string[] {
    const capped = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.storage
      .all<{ chain_id: string }>(
        'SELECT chain_id, MAX(at) AS last_at FROM trust_interactions GROUP BY chain_id ORDER BY last_at DESC LIMIT ?',
        capped
      )
      .map(r => String(r.chain_id));
  }

  /**
   * Summarise a chain and everything structurally wrong with it.
   *
   * Every anomaly here is a fact about shape, not a judgement about quality —
   * which is why it can be trusted without trusting any agent involved.
   */
  summarise(chainId: string, now: Date = new Date()): ChainSummary | undefined {
    const interactions = this.chain(chainId);
    if (interactions.length === 0) return undefined;

    const agents = [...new Set(interactions.flatMap(i => [i.sourceAgent, i.targetAgent]))];
    const maxDepth = Math.max(...interactions.map(i => i.depth));
    const startedAt = interactions[0]!.at;
    const lastAt = interactions[interactions.length - 1]!.at;

    const anomalies: Anomaly[] = [];

    // A cycle: some agent was invoked by something it had already invoked.
    const edges = new Map<string, Set<string>>();
    for (const i of interactions) {
      if (!edges.has(i.sourceAgent)) edges.set(i.sourceAgent, new Set());
      edges.get(i.sourceAgent)!.add(i.targetAgent);
    }
    const cycle = findCycle(edges);
    if (cycle.length) {
      anomalies.push({
        kind: 'cycle',
        severity: 'critical',
        chainId,
        detail: `Agents call each other in a loop: ${cycle.join(' -> ')}. Loops burn budget indefinitely and amplify whatever error is circulating.`,
        agents: cycle,
      });
    }

    if (maxDepth > this.maxDepth) {
      anomalies.push({
        kind: 'excessive_depth',
        severity: 'warning',
        chainId,
        detail: `Chain reached depth ${maxDepth} (limit ${this.maxDepth}). By this many hops the original request is usually unrecognisable.`,
        agents,
      });
    }

    const outbound = new Map<string, number>();
    for (const i of interactions) outbound.set(i.sourceAgent, (outbound.get(i.sourceAgent) ?? 0) + 1);
    for (const [agent, count] of outbound) {
      if (count <= this.maxFanOut) continue;
      anomalies.push({
        kind: 'fan_out',
        severity: 'warning',
        chainId,
        detail: `${agent} made ${count} calls in one chain (limit ${this.maxFanOut}). Usually a retry storm or an unbounded loop.`,
        agents: [agent],
      });
    }

    const idleMs = now.getTime() - Date.parse(lastAt);
    const finished = interactions.some(i => i.kind === 'respond');
    if (!finished && Number.isFinite(idleMs) && idleMs > this.stalledAfterMs) {
      anomalies.push({
        kind: 'stalled',
        severity: 'warning',
        chainId,
        detail: `No activity for ${Math.round(idleMs / 60000)} minutes and no response was ever produced. Something is waiting on something that is not coming.`,
        agents,
      });
    }

    anomalies.push(...this.disagreements(interactions, chainId));

    return {
      chainId,
      interactions: interactions.length,
      agents,
      maxDepth,
      startedAt,
      lastAt,
      anomalies,
      claimOrigins: interactions.filter(i => i.introducedClaim).map(i => i.targetAgent),
    };
  }

  /**
   * Find interactions where observers reached different verdicts.
   *
   * Reported as disagreement, never resolved by majority. Two observers
   * splitting on the same evidence is precisely the case where a human should
   * decide, and quietly picking the more numerous side would throw away the
   * only signal that mattered.
   */
  private disagreements(interactions: readonly Interaction[], chainId: string): Anomaly[] {
    const anomalies: Anomaly[] = [];

    for (const interaction of interactions) {
      const observations = this.observationsFor(interaction.id);
      if (observations.length < 2) continue;

      const verdicts = new Set(observations.map(o => o.verdict));
      if (verdicts.size < 2) continue;

      anomalies.push({
        kind: 'observer_disagreement',
        severity: 'warning',
        chainId,
        detail:
          `Observers disagree about ${interaction.sourceAgent} -> ${interaction.targetAgent}: ` +
          observations.map(o => `${o.observerAgent} says ${o.verdict} (${o.reason})`).join('; ') +
          '. Unresolved by design — this needs a human, or arbitration.',
        agents: [...new Set(observations.map(o => o.observerAgent))],
      });
    }

    return anomalies;
  }

  /** Every anomaly across recent chains — what a dashboard actually renders. */
  scan(limit = 50, now: Date = new Date()): Anomaly[] {
    return this.chains(limit).flatMap(chainId => this.summarise(chainId, now)?.anomalies ?? []);
  }
}

/** Depth-first cycle detection over the call graph. Returns the cycle, or empty. */
function findCycle(edges: Map<string, Set<string>>): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const walk = (node: string): string[] => {
    const current = state.get(node);
    if (current === 'done') return [];
    if (current === 'visiting') {
      // Self-loops are real cycles too; slice from the first occurrence.
      return [...stack.slice(stack.indexOf(node)), node];
    }

    state.set(node, 'visiting');
    stack.push(node);

    for (const next of edges.get(node) ?? []) {
      const found = walk(next);
      if (found.length) return found;
    }

    stack.pop();
    state.set(node, 'done');
    return [];
  };

  for (const node of edges.keys()) {
    const found = walk(node);
    if (found.length) return found;
  }
  return [];
}

function toInteraction(row: Record<string, unknown>): Interaction {
  return {
    id: String(row.id),
    chainId: String(row.chain_id),
    sourceAgent: String(row.source_agent),
    targetAgent: String(row.target_agent),
    kind: String(row.kind) as InteractionKind,
    depth: Number(row.depth),
    at: String(row.at),
    ...(row.payload_hash ? { payloadHash: String(row.payload_hash) } : {}),
    ...(row.trace_ref ? { traceRef: String(row.trace_ref) } : {}),
    ...(Number(row.introduced_claim) === 1 ? { introducedClaim: true } : {}),
    ...(row.note ? { note: String(row.note) } : {}),
  };
}

function toObservation(row: Record<string, unknown>): Observation {
  return {
    id: String(row.id),
    interactionId: String(row.interaction_id),
    observerAgent: String(row.observer_agent),
    verdict: String(row.verdict) as ObservationVerdict,
    reason: String(row.reason),
    confidence: Number(row.confidence),
    at: String(row.at),
  };
}

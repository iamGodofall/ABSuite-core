/**
 * What one agent handed to another, and what that means when something breaks.
 *
 * This is the gap the rest of the system could not see. Every execution is
 * signed, chained, scoped and individually verifiable — and the failure that
 * actually matters in a multi-agent system happens *between* two of them:
 *
 *   Agent A writes a summary that is wrong.
 *   Agent B consumes it and produces a recommendation.
 *   Agent C acts on the recommendation and moves money.
 *
 * Three records. Three signatures. Three successes. Nothing in the log says
 * these were the same piece of work travelling, so the one question an
 * investigator has — *what else did that bad output touch?* — had no answer.
 *
 * The answer was already in the data and nobody had computed it. Every record
 * carries `inputHash` and `outputHash`. When B's input hash equals A's output
 * hash, B consumed **byte for byte** what A produced. That is not an assertion
 * in a log line anybody could write; it is content identity under SHA-256, and
 * it is as strong as the rest of the evidence here.
 *
 * ## What an edge does and does not claim
 *
 * It claims: *the content B consumed is exactly the content A produced, and B
 * started no earlier than A.*
 *
 * It does not claim causation, and the difference is not pedantry. Two agents
 * that independently read the same file produce the same input hash without one
 * feeding the other. So an edge is **evidence of flow, not proof of intent** —
 * strong, checkable, and the reader's to interpret. That is the same line this
 * project draws everywhere else: supply the finding, refuse the judgement.
 *
 * Ordering is required for exactly this reason. Without it the graph would
 * happily draw an arrow from an execution to one that finished before it.
 */
import type { Storage } from './storage';
import type { ExecutionTrace, ExecutionOutcome } from './trace';

/** One record's place in the flow, as far as the hashes can show. */
export interface LineageNode {
  id: string;
  seq: number;
  subject: string;
  module: string;
  action: string;
  outcome: ExecutionOutcome;
  startedAt: string;
}

export interface LineageEdge {
  /** The record that produced the content. */
  from: string;
  /** The record that consumed it. */
  to: string;
  /** The hash both sides share — the evidence for the edge. */
  hash: string;
}

export interface Lineage {
  record: LineageNode;
  /** What this record consumed, and who produced it. */
  upstream: LineageNode[];
  /** What consumed this record's output. */
  downstream: LineageNode[];
  /**
   * Whether anything upstream of this failed — transitively.
   *
   * The reason this exists: a successful action that consumed the output of a
   * failed one is the single most misleading row in any agent log. It reads
   * green.
   */
  inheritedFailures: LineageNode[];
  basis: string;
}

export class ProvenanceGraph {
  constructor(private readonly storage: Storage) {}

  private rows(): (LineageNode & { inputHash: string; outputHash?: string; completedAt?: string })[] {
    return this.storage
      .all<Record<string, unknown>>(
        'SELECT id, seq, subject, module, action, outcome, started_at, completed_at, input_hash, output_hash FROM executions ORDER BY seq ASC'
      )
      .map(row => ({
        id: String(row.id),
        seq: Number(row.seq),
        subject: String(row.subject),
        module: String(row.module),
        action: String(row.action),
        outcome: String(row.outcome) as ExecutionOutcome,
        startedAt: String(row.started_at),
        ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
        inputHash: String(row.input_hash),
        ...(row.output_hash ? { outputHash: String(row.output_hash) } : {}),
      }));
  }

  /**
   * Every edge the hashes support.
   *
   * An output may feed several consumers, and a consumer may match several
   * producers when identical content was produced more than once — both are
   * reported rather than resolved, because picking one would be a guess dressed
   * as a finding.
   */
  edges(): LineageEdge[] {
    const all = this.rows();
    const producers = new Map<string, typeof all>();

    for (const row of all) {
      if (!row.outputHash) continue;
      const list = producers.get(row.outputHash) ?? [];
      list.push(row);
      producers.set(row.outputHash, list);
    }

    const edges: LineageEdge[] = [];
    for (const consumer of all) {
      for (const producer of producers.get(consumer.inputHash) ?? []) {
        if (producer.id === consumer.id) continue;
        // Ordering, required. Without it the graph draws arrows from an
        // execution to one that had already finished before it began.
        const producedAt = producer.completedAt ?? producer.startedAt;
        if (consumer.startedAt < producedAt) continue;
        edges.push({ from: producer.id, to: consumer.id, hash: consumer.inputHash });
      }
    }
    return edges;
  }

  /** One record's immediate neighbours, plus any failure it inherited. */
  lineage(id: string): Lineage | undefined {
    const all = this.rows();
    const record = all.find(row => row.id === id);
    if (!record) return undefined;

    const byId = new Map(all.map(row => [row.id, row]));
    const edges = this.edges();
    const node = (row: (typeof all)[number]): LineageNode => ({
      id: row.id, seq: row.seq, subject: row.subject, module: row.module,
      action: row.action, outcome: row.outcome, startedAt: row.startedAt,
    });

    const upstream = edges.filter(e => e.to === id).map(e => byId.get(e.from)!).filter(Boolean);
    const downstream = edges.filter(e => e.from === id).map(e => byId.get(e.to)!).filter(Boolean);

    // Walk the whole ancestry, not just the parents. A failure three hops back
    // is exactly the one nobody finds by reading the record in front of them.
    const inherited: LineageNode[] = [];
    const seen = new Set<string>([id]);
    let frontier = upstream.map(row => row.id);
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const current of frontier) {
        if (seen.has(current)) continue;
        seen.add(current);
        const row = byId.get(current);
        if (!row) continue;
        if (row.outcome === 'failure') inherited.push(node(row));
        next.push(...edges.filter(e => e.to === current).map(e => e.from));
      }
      frontier = next;
    }

    return {
      record: node(record),
      upstream: upstream.map(node),
      downstream: downstream.map(node),
      inheritedFailures: inherited,
      basis:
        'An edge means the consumer\'s input hash equals the producer\'s output hash, and the consumer started no earlier. ' +
        'That shows the same content moved between them — it is not proof that one caused the other, since two agents reading the same source produce the same hash. Evidence of flow, not of intent.',
    };
  }

  /**
   * Everything downstream of a record, transitively.
   *
   * Written for the question asked after a bad output is discovered: *what else
   * touched this?* Answering it by reading a log is hours of work and is usually
   * wrong; answering it from content hashes is exact about what it covers.
   */
  blastRadius(id: string): { reached: LineageNode[]; depth: number; basis: string } {
    const all = this.rows();
    const byId = new Map(all.map(row => [row.id, row]));
    const edges = this.edges();

    const reached: LineageNode[] = [];
    const seen = new Set<string>([id]);
    let frontier = [id];
    let depth = 0;

    while (frontier.length > 0) {
      const next = edges.filter(e => frontier.includes(e.from)).map(e => e.to).filter(to => !seen.has(to));
      if (next.length === 0) break;
      depth += 1;
      for (const current of next) {
        seen.add(current);
        const row = byId.get(current);
        if (!row) continue;
        reached.push({
          id: row.id, seq: row.seq, subject: row.subject, module: row.module,
          action: row.action, outcome: row.outcome, startedAt: row.startedAt,
        });
      }
      frontier = next;
    }

    return {
      reached,
      depth,
      basis: reached.length === 0
        ? 'Nothing recorded consumed this record\'s output. That is not a guarantee nothing used it — only that nothing recorded here did.'
        : `${reached.length} recorded action(s) consumed this content, directly or through ${depth} step(s). Anything that used it without recording an execution is invisible to this, and no honest count can include it.`,
    };
  }

  /**
   * The whole picture, with the part nobody else prints.
   *
   * `unlinked` is the finding. A deployment where most records join nothing is
   * not a deployment with a tidy graph — it is one where agent-to-agent handoff
   * is not being recorded, and the graph covers a fraction of what happened.
   * Reporting the graph without the coverage would make a sparse one look clean.
   */
  summary(): {
    records: number;
    edges: number;
    linked: number;
    unlinked: number;
    failuresWithConsumers: { failure: LineageNode; consumed: number }[];
    meaning: string;
  } {
    const all = this.rows();
    const edges = this.edges();
    const touched = new Set<string>();
    for (const edge of edges) { touched.add(edge.from); touched.add(edge.to); }

    const failuresWithConsumers = all
      .filter(row => row.outcome === 'failure')
      .map(row => ({
        failure: {
          id: row.id, seq: row.seq, subject: row.subject, module: row.module,
          action: row.action, outcome: row.outcome, startedAt: row.startedAt,
        },
        consumed: this.blastRadius(row.id).reached.length,
      }))
      .filter(entry => entry.consumed > 0);

    const linked = touched.size;
    return {
      records: all.length,
      edges: edges.length,
      linked,
      unlinked: all.length - linked,
      failuresWithConsumers,
      meaning: all.length === 0
        ? 'Nothing has been recorded, so there is no flow to trace.'
        : edges.length === 0
          ? 'No record consumes another record\'s output. Either these agents genuinely do not hand work to each other, or the handoffs are happening outside what is recorded — and nothing here can tell those apart.'
          : `${linked} of ${all.length} records take part in a traced flow. The other ${all.length - linked} stand alone, which may be correct or may mean their handoffs go unrecorded.`,
    };
  }
}

/** Build a lineage view for a trace the caller already holds. */
export function lineageOf(graph: ProvenanceGraph, trace: ExecutionTrace): Lineage | undefined {
  return graph.lineage(trace.id);
}

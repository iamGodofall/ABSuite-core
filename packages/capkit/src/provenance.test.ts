import { Storage } from './storage';
import { TraceStore, SigningKey, hashPayload } from './trace';
import { ProvenanceGraph } from './provenance';

const fresh = () => {
  const storage = new Storage(':memory:');
  return { storage, traces: new TraceStore(storage, new SigningKey()), graph: new ProvenanceGraph(storage) };
};

/** A record that consumes `input` and produces `output`, at a stated time. */
const step = (
  traces: TraceStore,
  subject: string,
  input: unknown,
  output: unknown,
  at: string,
  outcome: 'success' | 'failure' = 'success'
) =>
  traces.record({
    subject, scope: ['x:y'], module: 'm', action: subject.split(':')[1] ?? 'act',
    input, output, outcome,
    startedAt: at,
    completedAt: new Date(Date.parse(at) + 1000).toISOString(),
  });

describe('one agent handing work to another', () => {
  test('an edge exists when the consumer read exactly what the producer wrote', () => {
    const { traces, graph } = fresh();
    const research = { query: 'supplier filings' };
    const findings = { results: 12, note: 'three suppliers late' };

    const a = step(traces, 'agent:research', research, findings, '2026-08-01T09:00:00.000Z');
    const b = step(traces, 'agent:summarise', findings, { summary: 'risk rising' }, '2026-08-01T09:05:00.000Z');

    const edges = graph.edges();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: a.id, to: b.id, hash: hashPayload(findings) });
  });

  test('no edge when the content differs, however similar the work looks', () => {
    const { traces, graph } = fresh();
    step(traces, 'agent:a', { q: 1 }, { r: 1 }, '2026-08-01T09:00:00.000Z');
    step(traces, 'agent:b', { q: 2 }, { r: 2 }, '2026-08-01T09:05:00.000Z');

    // Two agents doing the same kind of job are not a flow.
    expect(graph.edges()).toEqual([]);
  });

  test('an arrow is never drawn backwards in time', () => {
    const { traces, graph } = fresh();
    const payload = { shared: true };

    // The consumer ran first. Content identity alone would happily link these,
    // which is how a provenance graph starts inventing history.
    step(traces, 'agent:early', payload, { out: 1 }, '2026-08-01T09:00:00.000Z');
    step(traces, 'agent:late', { seed: 0 }, payload, '2026-08-01T10:00:00.000Z');

    expect(graph.edges()).toEqual([]);
  });

  test('one output feeding several consumers is several edges', () => {
    const { traces, graph } = fresh();
    const shared = { report: 'Q3' };
    const source = step(traces, 'agent:source', { in: 1 }, shared, '2026-08-01T09:00:00.000Z');
    const one = step(traces, 'agent:one', shared, { a: 1 }, '2026-08-01T09:10:00.000Z');
    const two = step(traces, 'agent:two', shared, { b: 2 }, '2026-08-01T09:20:00.000Z');

    const edges = graph.edges();
    expect(edges).toHaveLength(2);
    expect(edges.map(e => e.to).sort()).toEqual([one.id, two.id].sort());
    expect(edges.every(e => e.from === source.id)).toBe(true);
  });

  test('a record never links to itself', () => {
    const { traces, graph } = fresh();
    const same = { echo: true };
    step(traces, 'agent:echo', same, same, '2026-08-01T09:00:00.000Z');
    expect(graph.edges()).toEqual([]);
  });
});

describe('the failure that reads green', () => {
  /**
   * The reason this module exists.
   *
   * Agent A fails. Agent B consumes A's output and succeeds. Agent C consumes
   * B's and succeeds. Read individually, two of those three records are clean —
   * and the whole of the interesting problem is in the seam between them.
   */
  const chain = () => {
    const { traces, graph } = fresh();
    const bad = { summary: 'all suppliers solvent', confidence: 'high' };
    const derived = { recommendation: 'increase order' };

    const a = step(traces, 'agent:research', { q: 'solvency' }, bad, '2026-08-01T09:00:00.000Z', 'failure');
    const b = step(traces, 'agent:analyst', bad, derived, '2026-08-01T09:10:00.000Z');
    const c = step(traces, 'agent:buyer', derived, { ordered: true }, '2026-08-01T09:20:00.000Z');
    return { traces, graph, a, b, c };
  };

  test('a clean record names the failure it inherited, three hops back', () => {
    const { graph, a, c } = chain();
    const lineage = graph.lineage(c.id)!;

    expect(lineage.record.outcome).toBe('success');
    // Nothing about this record is wrong. Everything about its ancestry is.
    expect(lineage.inheritedFailures.map(f => f.id)).toEqual([a.id]);
  });

  test('blast radius answers what else touched a bad output', () => {
    const { graph, a, b, c } = chain();
    const blast = graph.blastRadius(a.id);

    expect(blast.reached.map(r => r.id)).toEqual([b.id, c.id]);
    expect(blast.depth).toBe(2);
    // The limit of the claim travels with it.
    expect(blast.basis).toMatch(/invisible to this/);
  });

  test('a record nothing consumed says so without claiming safety', () => {
    const { traces, graph } = fresh();
    const alone = step(traces, 'agent:alone', { a: 1 }, { b: 2 }, '2026-08-01T09:00:00.000Z');
    const blast = graph.blastRadius(alone.id);

    expect(blast.reached).toEqual([]);
    // "Nothing used it" and "nothing recorded used it" are different claims.
    expect(blast.basis).toMatch(/only that nothing recorded here did/);
  });

  test('the summary surfaces failures that had consumers', () => {
    const { graph, a } = chain();
    const summary = graph.summary();

    expect(summary.edges).toBe(2);
    expect(summary.failuresWithConsumers).toEqual([
      expect.objectContaining({ consumed: 2, failure: expect.objectContaining({ id: a.id }) }),
    ]);
  });
});

describe('coverage, reported beside the graph', () => {
  test('a sparse graph is named as sparse rather than shown as tidy', () => {
    const { traces, graph } = fresh();
    const shared = { x: 1 };
    step(traces, 'agent:a', { seed: 1 }, shared, '2026-08-01T09:00:00.000Z');
    step(traces, 'agent:b', shared, { y: 2 }, '2026-08-01T09:05:00.000Z');
    step(traces, 'agent:c', { unrelated: 1 }, { z: 3 }, '2026-08-01T09:10:00.000Z');

    const summary = graph.summary();
    expect(summary.records).toBe(3);
    expect(summary.linked).toBe(2);
    // The finding is the third record, not the two that joined.
    expect(summary.unlinked).toBe(1);
    expect(summary.meaning).toMatch(/stand alone/);
  });

  test('no edges at all is stated as an ambiguity, not as a clean bill', () => {
    const { traces, graph } = fresh();
    step(traces, 'agent:a', { a: 1 }, { b: 2 }, '2026-08-01T09:00:00.000Z');

    const summary = graph.summary();
    expect(summary.edges).toBe(0);
    expect(summary.meaning).toMatch(/nothing here can tell those apart/);
  });

  test('an empty store traces nothing and says so', () => {
    const { graph } = fresh();
    expect(graph.summary()).toMatchObject({ records: 0, edges: 0, linked: 0, unlinked: 0 });
    expect(graph.summary().meaning).toMatch(/no flow to trace/);
  });

  test('an unknown id has no lineage', () => {
    const { graph } = fresh();
    expect(graph.lineage('exec_nope')).toBeUndefined();
  });
});

describe('what an edge is allowed to claim', () => {
  test('every lineage carries the limit of its own evidence', () => {
    const { traces, graph } = fresh();
    const shared = { x: 1 };
    step(traces, 'agent:a', { seed: 1 }, shared, '2026-08-01T09:00:00.000Z');
    const b = step(traces, 'agent:b', shared, { y: 2 }, '2026-08-01T09:05:00.000Z');

    const lineage = graph.lineage(b.id)!;
    // Two agents reading the same file produce the same input hash without one
    // feeding the other. The report says so rather than letting a reader assume.
    expect(lineage.basis).toMatch(/not proof that one caused the other/);
    expect(lineage.basis).toMatch(/Evidence of flow, not of intent/);
  });
});

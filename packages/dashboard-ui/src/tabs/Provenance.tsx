/**
 * Provenance — what one agent handed to another.
 *
 * The failure that matters in a multi-agent system happens *between* two
 * records, and every other surface here shows one record at a time:
 *
 *   Agent A writes a summary that is wrong.
 *   Agent B consumes it and produces a recommendation.
 *   Agent C acts on the recommendation and moves money.
 *
 * Three records. Three signatures. Three successes. **Nothing on any other
 * screen says these were the same piece of work travelling**, so the one
 * question an investigator actually asks — *what else did that bad output
 * touch?* — had no answer in the interface at all.
 *
 * ## Why coverage is rendered first
 *
 * Same reason as the watch, and it is not a style choice. A graph with two
 * edges across four hundred records looks like a calm system. It is far more
 * likely to be one whose handoffs are going unrecorded — and drawing the edges
 * without that sentence beside them would let a reader conclude *calm* from
 * evidence that supports *blind*. The count and the caveat carry the same
 * weight, above the graph, on every load.
 *
 * ## What is deliberately not drawn
 *
 * No node-and-arrow canvas. A laid-out graph invents structure the data does
 * not have — position, clustering, hierarchy — and a reader takes all three as
 * findings. What exists is a set of edges, each backed by one shared hash, so
 * that is what is shown: the hash is on screen, and a reader can check any edge
 * against the records themselves.
 *
 * ## What an edge claims
 *
 * That B consumed byte for byte what A produced, and started no earlier. It
 * does **not** claim causation: two agents reading the same file produce the
 * same input hash without either feeding the other. That refusal is on the
 * surface rather than in a tooltip, because it is the difference between
 * evidence and an accusation.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';
import { cn } from '../utils';

interface LineageNode {
  id: string;
  seq: number;
  subject: string;
  module: string;
  action: string;
  outcome: 'success' | 'failure' | 'partial' | 'denied';
  startedAt: string;
}

interface LineageEdge {
  from: string;
  to: string;
  hash: string;
}

interface Coverage {
  records: number;
  linked: number;
  unlinked: number;
  meaning: string;
}

interface Unverifiable {
  field: string;
  because: string;
}

interface ProvenanceResponse {
  coverage: Coverage;
  edges: LineageEdge[];
  failuresWithConsumers: { failure: LineageNode; consumed: number }[];
  unverifiable: Unverifiable[];
}

interface LineageResponse {
  record: LineageNode;
  upstream: LineageNode[];
  downstream: LineageNode[];
  inheritedFailures: LineageNode[];
  basis: string;
  blastRadius?: { reached: LineageNode[]; because?: string };
}

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const short = (id: string) => (id.length > 14 ? `${id.slice(0, 12)}…` : id);

/** Outcome maps to the four words, not to a severity. */
const outcomeState = (outcome: LineageNode['outcome']) =>
  outcome === 'success' ? 'DEMONSTRATED' : outcome === 'failure' ? 'FAILED' : 'UNKNOWN';

/**
 * How much of the record the graph below covers.
 *
 * Rendered before the edges, deliberately — a reader who counts arrows first
 * has already decided the system is quiet by the time they reach the caveat.
 */
const CoverageLine = ({ coverage, edges }: { coverage: Coverage; edges: number }) => {
  const blind = coverage.records > 0 && edges === 0;
  const tone = coverage.records === 0 ? 'ABSENT' : blind ? 'UNKNOWN' : 'DEMONSTRATED';

  return (
    <div className="rounded-xl border border-border bg-bg-primary/40 p-3.5">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Badge state={tone}>{edges} traced handoff(s)</Badge>
        <Badge state={coverage.linked > 0 ? 'DEMONSTRATED' : 'UNKNOWN'}>
          {coverage.linked} of {coverage.records} in a flow
        </Badge>
        {coverage.unlinked > 0 && <Badge state="UNKNOWN">{coverage.unlinked} stand alone</Badge>}
      </div>
      <p className={cn('text-xs leading-relaxed', tone === 'DEMONSTRATED' ? 'text-text-muted' : 'text-amber-400')}>
        {coverage.meaning}
      </p>
    </div>
  );
};

/** One node, rendered the same way wherever it appears. */
const NodeLine = ({ node, onOpen }: { node: LineageNode; onOpen?: (id: string) => void }) => (
  <button
    type="button"
    onClick={onOpen ? () => onOpen(node.id) : undefined}
    disabled={!onOpen}
    className={cn(
      'w-full text-left rounded-lg border border-border bg-bg-primary/40 px-3 py-2 transition-all',
      onOpen ? 'hover:border-border-strong cursor-pointer' : 'cursor-default'
    )}
  >
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <span className="text-xs text-text-primary font-medium min-w-0 truncate">
        {node.subject} · {node.module}.{node.action}
      </span>
      <Badge state={outcomeState(node.outcome)}>{node.outcome}</Badge>
    </div>
    <p className="text-[11px] text-text-muted/70 mt-1 font-mono">
      #{node.seq} · {short(node.id)} · {node.startedAt}
    </p>
  </button>
);

/**
 * A failure whose output something else went on to consume.
 *
 * This is the row the whole surface exists for. It reads green everywhere else
 * in the product — three successful executions in a list, nothing to see — and
 * it is the shape of every multi-agent incident worth investigating.
 */
const InheritedFailure = ({
  entry,
  onOpen,
}: {
  entry: { failure: LineageNode; consumed: number };
  onOpen: (id: string) => void;
}) => (
  <li className="rounded-xl border border-red-500/30 bg-bg-primary/40 p-3.5">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <p className="text-sm text-text-primary leading-snug min-w-0">
        {entry.failure.subject} failed at {entry.failure.module}.{entry.failure.action}, and{' '}
        <span className="text-red-400 font-medium">
          {entry.consumed} later record{entry.consumed === 1 ? '' : 's'}
        </span>{' '}
        consumed what it produced.
      </p>
      <Badge state="FAILED">inherited</Badge>
    </div>
    <p className="text-[11px] text-text-muted/70 mt-2 font-mono">
      #{entry.failure.seq} · {short(entry.failure.id)} · {entry.failure.startedAt}
    </p>
    <button
      onClick={() => onOpen(entry.failure.id)}
      className="mt-2 px-3 py-1 rounded-full border border-border text-text-muted hover:text-text-primary text-[11px] font-medium transition-all"
    >
      Trace what it touched
    </button>
  </li>
);

/** One record's ancestry and descendants, opened from an edge or a failure. */
const LineagePanel = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const [data, setData] = useState<LineageResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    void (async () => {
      try {
        const res = await fetch(`/executions/${encodeURIComponent(id)}/lineage`, { headers: getAdminHeaders() });
        const body = (await res.json()) as LineageResponse & { error?: { message?: string } };
        if (!res.ok) throw new Error(body.error?.message ?? `Lineage unavailable (${res.status}).`);
        if (live) setData(body);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => { live = false; };
  }, [id]);

  return (
    <Panel
      title={`The flow around ${short(id)}`}
      subtitle="Upstream is what this consumed. Downstream is what consumed it. Both are derived from shared hashes, not from anything either agent claimed."
      actions={
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
        >
          Close
        </button>
      }
    >
      {error ? (
        <Problem
          title="That lineage could not be read"
          what={error}
          resolvedBy="Check that CapKit is reachable and your admin key is set."
        />
      ) : data === null ? (
        <Loading what="Tracing the flow…" />
      ) : (
        <div className="space-y-4">
          {data.inheritedFailures.length > 0 && (
            <div className="rounded-xl border border-red-500/30 bg-bg-primary/40 p-3.5">
              <Badge state="FAILED">
                {data.inheritedFailures.length} failure(s) upstream
              </Badge>
              <p className="text-xs text-text-muted mt-2 leading-relaxed">
                This record succeeded, and something it consumed did not. A success that ate a
                failure is the single most misleading row in an agent log, which is why it is stated
                here rather than left to be noticed.
              </p>
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-muted/70 mb-1.5">Upstream</p>
            {data.upstream.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nothing recorded produced what this consumed. Either it read from outside ABSuite, or
                the producer was never recorded — and nothing here can tell those apart.
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.upstream.map(node => <NodeLine key={node.id} node={node} />)}
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-muted/70 mb-1.5">This record</p>
            <NodeLine node={data.record} />
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-muted/70 mb-1.5">Downstream</p>
            {data.downstream.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nothing recorded consumed this record's output.
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.downstream.map(node => <NodeLine key={node.id} node={node} />)}
              </div>
            )}
          </div>

          <p className="text-[11px] text-text-muted/70 leading-relaxed border-t border-border/50 pt-3">
            {data.basis}
          </p>
        </div>
      )}
    </Panel>
  );
};

export const Provenance = () => {
  const [data, setData] = useState<ProvenanceResponse | null>(null);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/executions/provenance', { headers: getAdminHeaders() });
      const body = (await res.json()) as ProvenanceResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Provenance unavailable (${res.status}).`);
      setData(body);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <Panel
        title="What one agent handed to another"
        subtitle={
          'An edge means one record consumed byte for byte what another produced — content identity under SHA-256, not ' +
          'a claim either agent made about itself. It is evidence that work moved, and never proof that one caused the other.'
        }
        actions={
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
          >
            Refresh
          </button>
        }
        footnote={
          'Nothing here is ranked, and no edge is called a cause. Which handoff matters is a judgement about your ' +
          'system, and this surface does not have one.'
        }
      >
        {error ? (
          <Problem
            title="The flow could not be read"
            what={error}
            resolvedBy="Check that CapKit is reachable and your admin key is set."
          />
        ) : data === null ? (
          <Loading what="Deriving the flow from recorded hashes…" />
        ) : (
          <div className="space-y-4">
            <CoverageLine coverage={data.coverage} edges={data.edges.length} />

            {data.failuresWithConsumers.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-text-muted/70 mb-1.5">
                  Failures something else consumed
                </p>
                <ul className="space-y-2.5">
                  {data.failuresWithConsumers.map(entry => (
                    <InheritedFailure key={entry.failure.id} entry={entry} onOpen={setOpened} />
                  ))}
                </ul>
              </div>
            )}

            {data.edges.length === 0 ? (
              <Empty
                because={
                  data.coverage.records === 0
                    ? 'Nothing has been recorded, so there is no flow to trace.'
                    : 'No record consumes another record\'s output.'
                }
                resolvedBy={
                  data.coverage.records === 0
                    ? 'Record some executions. The graph is derived from hashes already on them — there is nothing extra to enable.'
                    : 'Either these agents genuinely do not hand work to each other, or the handoffs happen outside what is recorded. Nothing here can tell those apart, and an empty graph is not evidence of the first.'
                }
              />
            ) : (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-text-muted/70 mb-1.5">
                  Traced handoffs
                </p>
                <ul className="space-y-1.5">
                  {data.edges.map(edge => (
                    <li
                      key={`${edge.from}->${edge.to}`}
                      className="rounded-lg border border-border bg-bg-primary/40 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <button
                          onClick={() => setOpened(edge.from)}
                          className="font-mono text-text-primary hover:text-[#00F58C] transition-colors"
                        >
                          {short(edge.from)}
                        </button>
                        <span className="text-text-muted/60">produced what</span>
                        <button
                          onClick={() => setOpened(edge.to)}
                          className="font-mono text-text-primary hover:text-[#00F58C] transition-colors"
                        >
                          {short(edge.to)}
                        </button>
                        <span className="text-text-muted/60">consumed</span>
                      </div>
                      {/* The evidence, on screen. Any reader can check this against both records. */}
                      <p className="text-[10px] text-text-muted/60 mt-1 font-mono break-all">
                        sha256 {edge.hash}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.unverifiable.length > 0 && (
              <div className="border-t border-border/50 pt-3 space-y-1.5">
                {data.unverifiable.map(item => (
                  <p key={item.field} className="text-[11px] text-text-muted/70 leading-relaxed">
                    <span className="text-text-muted uppercase tracking-wider">{item.field}</span>
                    {' — '}
                    {item.because}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {opened && <LineagePanel id={opened} onClose={() => setOpened(null)} />}

      <Note>
        Every edge on this surface is one shared SHA-256 hash, printed beside it. None of it has to
        be taken on this panel's word — and the two things it can never tell you are whether one
        record caused another, and whether a handoff happened that nobody recorded.
      </Note>
    </div>
  );
};

export default Provenance;

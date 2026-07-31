/**
 * Layer 7 — Learn. What this system actually does, measured.
 *
 * This screen can only show numbers a benchmark produced on a stated machine.
 * There is no fallback, no illustrative figure and no rounded-up headline: when
 * nothing has been measured it says nothing has been measured and tells you the
 * command. A trust product that publishes an aspirational throughput number has
 * already lost the argument it exists to make.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '../utils';

interface Measurement {
  operation: string;
  description: string;
  iterations: number;
  warmupDiscarded: number;
  concurrency: number;
  failures: number;
  successRate: number;
  opsPerSecond: number;
  wallClockMs: number;
  errorSample?: string;
  latencyMs: { count: number; min: number; max: number; mean: number; stddev: number; p50: number; p90: number; p95: number; p99: number };
}

interface BenchEnvironment {
  node: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  memoryGb: number;
  commit?: string;
  measuredAt: string;
}

interface BenchReport {
  environment: BenchEnvironment;
  measurements: Measurement[];
  totalDurationMs: number;
  reproduce: string;
}

interface Delta {
  operation: string;
  baselineOpsPerSecond: number;
  currentOpsPerSecond: number;
  deltaPercent: number;
  significant: boolean;
  verdict: 'faster' | 'slower' | 'unchanged';
}

interface Regression {
  compared: boolean;
  reason?: string;
  comparison?: {
    comparable: boolean;
    reason?: string;
    baselineMeasuredAt?: string;
    deltas?: Delta[];
    regressions?: string[];
    incomparable?: { operation: string; reason: string }[];
  };
}

type BenchState =
  | { status: 'loading' }
  | { status: 'unmeasured'; howTo: string; reason: string }
  | { status: 'measured'; report: BenchReport; source: string }
  | { status: 'error'; message: string };

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** Plain English for what each operation is, above the number. */
const HEADLINE: Record<string, string> = {
  'trace.record': 'Executions signed and stored per second',
  'trace.verify': 'Records verified per second',
  'chain.verify': 'Full-chain verifications per second',
  'capability.issue': 'Capability tokens issued per second',
  'capability.validate': 'Capability checks per second',
  'explain.render': 'Explanations derived per second',
};

export const PerformanceTab = () => {
  const [state, setState] = useState<BenchState>({ status: 'loading' });
  const [regression, setRegression] = useState<Regression | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/bench/core');
      const data = await res.json();
      if (!res.ok) {
        setState({ status: 'error', message: data?.error ?? `Could not reach QuickBench (${res.status}).` });
        return;
      }
      if (!data.measured) {
        setState({
          status: 'unmeasured',
          howTo: data.howTo ?? 'pnpm bench:core',
          reason: data.reason ?? 'No benchmark has been run on this machine.',
        });
        return;
      }
      setState({ status: 'measured', report: data.report, source: data.source ?? 'unknown' });

      // The loop closes here: a measurement compared against the last one is a
      // signal; on its own it is only a number.
      try {
        const compared = await fetch('/bench/core/regression');
        setRegression(compared.ok ? ((await compared.json()) as Regression) : null);
      } catch {
        setRegression(null);
      }
    } catch (error) {
      setState({ status: 'error', message: (error as Error).message });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/bench/core', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({ iterations: 500, chainLength: 200 }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      // Parse the response separately from anything else, so a 404 that returns
      // the SPA's HTML is never reported as a benchmark failure.
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`The benchmark endpoint returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const err = data.error as { message?: string } | string | undefined;
        throw new Error((typeof err === 'string' ? err : err?.message) ?? `Benchmark failed (${res.status})`);
      }
      setState({ status: 'measured', report: data.report as BenchReport, source: 'this process' });
    } catch (error) {
      setState({ status: 'error', message: (error as Error).message });
    } finally {
      setRunning(false);
    }
  };

  const runButton = (
    <button
      onClick={() => void runNow()}
      disabled={running}
      className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50"
    >
      {running ? 'Measuring…' : 'Measure this machine now'}
    </button>
  );

  return (
    <div className="space-y-4">
      {/*
        * The preamble is gone.
        *
        * This component only ever renders inside the Learn layer, directly
        * below LearnLayer's own "Measured, or nothing" panel, which makes the
        * same argument in almost the same words. Two paragraphs saying one
        * thing is how a surface stops being read at all. The claim is kept
        * once, where it is first made.
        */}
      {state.status === 'loading' && (
        <div className="rounded-xl border border-border bg-bg-secondary p-6 text-sm text-text-muted">
          Loading the last measurement…
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4">
          <p className="text-sm font-semibold text-red-400 mb-1">Could not load performance data</p>
          {/* The run control is offered once, by LearnLayer above. Repeating it
              inside the failure notice put two buttons for one act on the same
              screen, which reads as two different acts. */}
          <p className="text-xs text-text-muted">{state.message}</p>
        </div>
      )}

      {state.status === 'unmeasured' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-semibold text-amber-400 mb-1">Not measured on this machine</p>
          <p className="text-xs text-text-muted mb-2 leading-relaxed">
            {state.reason} No throughput or latency figure will be shown until one has been.
          </p>
          <pre className="text-[11px] font-mono text-text-primary bg-bg-primary/60 border border-border rounded p-2 mb-3 overflow-x-auto">
            {state.howTo}
          </pre>
          {runButton}
        </div>
      )}

      {state.status === 'measured' && (
        <>
          <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">
                  Measured on
                </div>
                <div className="text-sm text-text-primary font-mono">
                  {state.report.environment.cpuModel}
                </div>
                <div className="text-xs text-text-muted font-mono mt-0.5">
                  {state.report.environment.cpuCount} vCPU · {state.report.environment.memoryGb} GB ·{' '}
                  {state.report.environment.platform}/{state.report.environment.arch} · Node {state.report.environment.node}
                  {state.report.environment.commit ? ` · commit ${state.report.environment.commit}` : ''}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {new Date(state.report.environment.measuredAt).toLocaleString()} · source: {state.source}
                </div>
              </div>
              {runButton}
            </div>
          </div>

          {regression && (
            <div className="rounded-xl border border-border bg-bg-secondary p-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">
                Against the previous run
              </div>

              {!regression.compared && (
                <p className="text-xs text-text-muted leading-relaxed">
                  {regression.comparison?.reason ?? regression.reason}
                </p>
              )}

              {regression.compared && regression.comparison?.deltas && (
                <>
                  <p className="text-xs text-text-muted mb-3 leading-relaxed">
                    Compared with the run of{' '}
                    {regression.comparison.baselineMeasuredAt
                      ? new Date(regression.comparison.baselineMeasuredAt).toLocaleString()
                      : 'an earlier date'}
                    , on this same machine. Significance is Welch's t-test — a change inside the run-to-run
                    spread is called noise rather than an improvement.
                  </p>

                  <ul className="space-y-1">
                    {regression.comparison.deltas.map(delta => (
                      <li key={delta.operation} className="flex items-baseline gap-2 text-[11px] font-mono">
                        <span className={cn('w-4 shrink-0',
                          delta.verdict === 'slower' ? 'text-amber-400'
                            : delta.verdict === 'faster' ? 'text-emerald-400' : 'text-text-muted')}>
                          {delta.verdict === 'slower' ? '▲' : delta.verdict === 'faster' ? '▼' : '·'}
                        </span>
                        <span className="text-text-primary w-44 shrink-0">{delta.operation}</span>
                        <span className={cn(
                          delta.verdict === 'slower' ? 'text-amber-400'
                            : delta.verdict === 'faster' ? 'text-emerald-400' : 'text-text-muted')}>
                          {delta.deltaPercent > 0 ? '+' : ''}{delta.deltaPercent}% mean latency
                        </span>
                        {!delta.significant && <span className="text-text-muted opacity-70">within noise</span>}
                      </li>
                    ))}
                  </ul>

                  {regression.comparison.incomparable && regression.comparison.incomparable.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {regression.comparison.incomparable.map(item => (
                        <li key={item.operation} className="text-[11px] text-text-muted leading-snug">
                          <span className="font-mono">{item.operation}</span> — not compared: the work changed
                          between runs, so a difference would say nothing about speed.
                        </li>
                      ))}
                    </ul>
                  )}

                  {regression.comparison.regressions && regression.comparison.regressions.length > 0 && (
                    <p className="text-[11px] text-amber-400 mt-2">
                      {regression.comparison.regressions.length} significant regression(s):{' '}
                      {regression.comparison.regressions.join(', ')}. That is a statement about two
                      measurements, not a diagnosis.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {state.report.measurements.map(m => (
              <div
                key={m.operation}
                className={cn(
                  'rounded-xl border p-4',
                  m.successRate === 1 ? 'border-border bg-bg-secondary' : 'border-amber-500/40 bg-amber-500/[0.06]'
                )}
              >
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">
                  {m.operation}
                </div>
                <div className="text-2xl font-bold text-text-primary">
                  {number(m.opsPerSecond)}
                  <span className="text-xs font-normal text-text-muted ml-1">/sec</span>
                </div>
                <div className="text-xs text-text-muted mb-3">{HEADLINE[m.operation] ?? m.description}</div>

                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  {([['p50', m.latencyMs.p50], ['p95', m.latencyMs.p95], ['p99', m.latencyMs.p99]] as const).map(([label, value]) => (
                    <div key={label} className="rounded border border-border bg-bg-primary/40 py-1.5">
                      <div className="text-[10px] font-mono text-text-muted">{label}</div>
                      <div className="text-xs font-mono text-text-primary">{value} ms</div>
                    </div>
                  ))}
                </div>

                <div className="text-[11px] text-text-muted font-mono">
                  {m.iterations.toLocaleString('en-US')} iterations
                  {m.warmupDiscarded > 0 ? ` · ${m.warmupDiscarded} warmup discarded` : ''}
                  {m.concurrency > 1 ? ` · concurrency ${m.concurrency}` : ''}
                </div>
                <div className={cn('text-[11px] font-mono mt-0.5', m.successRate === 1 ? 'text-emerald-500/80' : 'text-amber-400')}>
                  {(m.successRate * 100).toFixed(2)}% succeeded
                  {m.failures > 0 ? ` · ${m.failures} failed` : ''}
                </div>
                {m.errorSample && (
                  <p className="text-[11px] text-amber-400/80 mt-1 leading-snug">{m.errorSample}</p>
                )}

                <p className="text-[11px] text-text-muted mt-2 leading-snug opacity-80">{m.description}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">
              Check it yourself
            </div>
            <p className="text-xs text-text-muted mb-2 leading-relaxed">
              The whole suite took {(state.report.totalDurationMs / 1000).toFixed(1)}s. Run it on your own
              hardware and you should expect different numbers — that is the point of stating the machine.
            </p>
            <pre className="text-[11px] font-mono text-text-primary bg-bg-primary/60 border border-border rounded p-2 overflow-x-auto">
              {state.report.reproduce}
            </pre>
          </div>
        </>
      )}
    </div>
  );
};

export default PerformanceTab;

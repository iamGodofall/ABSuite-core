/**
 * Learn — what this system knows about itself, measured.
 *
 * The benchmark history had no interface: runs happened, baselines existed, and
 * regressions were detectable, all of it reachable only from a terminal. A loop
 * whose last stage is invisible is a pipeline.
 *
 * Nothing here is estimated. When no benchmark has run on this machine, this
 * screen shows the command rather than a chart of zeroes — a graph of nothing
 * is more misleading than an empty state, because a shape implies a
 * measurement.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

interface Measurement {
  operation: string; description: string; iterations: number;
  successRate: number; opsPerSecond: number;
  latencyMs: { p50: number; p95: number; p99: number; min: number; max: number };
}

interface Report {
  environment: { cpuModel: string; cpuCount: number; memoryGb: number; platform: string; arch: string; node: string; commit?: string; measuredAt: string };
  measurements: Measurement[];
  totalDurationMs: number;
  reproduce: string;
}

interface Delta {
  operation: string; deltaPercent: number; significant: boolean;
  verdict: 'faster' | 'slower' | 'unchanged';
}

const HEADLINE: Record<string, string> = {
  'trace.record': 'Executions signed and stored',
  'trace.verify': 'Records verified',
  'chain.verify': 'Full-chain verifications',
  'capability.issue': 'Capability tokens issued',
  'capability.validate': 'Capability checks',
  'explain.render': 'Explanations derived',
};

export const LearnLayer = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [unmeasured, setUnmeasured] = useState<{ reason: string; howTo: string } | null>(null);
  const [deltas, setDeltas] = useState<Delta[] | null>(null);
  const [comparedTo, setComparedTo] = useState<string | null>(null);
  const [notCompared, setNotCompared] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/bench/core');
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? `QuickBench did not answer (${res.status}).`); return; }
      if (!data.measured) { setUnmeasured({ reason: data.reason, howTo: data.howTo }); setReport(null); return; }
      setUnmeasured(null);
      setReport(data.report as Report);

      const cmp = await fetch('/bench/core/regression');
      if (cmp.ok) {
        const payload = await cmp.json();
        if (payload.compared && payload.comparison?.deltas) {
          setDeltas(payload.comparison.deltas as Delta[]);
          setComparedTo(payload.comparison.baselineMeasuredAt ?? null);
          setNotCompared('');
        } else {
          setDeltas(null);
          setNotCompared(payload.comparison?.reason ?? payload.reason ?? '');
        }
      }
    } catch { setError('QuickBench is unreachable, so nothing about performance can be stated.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const measureNow = async () => {
    setBusy(true); setError('');
    try {
      const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
      const res = await fetch('/bench/core', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'x-absuite-admin-key': key } : {}) },
        body: JSON.stringify({ iterations: 500, chainLength: 200 }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`The benchmark endpoint returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Benchmark failed (${res.status})`);
      }
      setReport(data.report as Report); setUnmeasured(null);
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const fastest = report ? Math.max(...report.measurements.map(m => m.opsPerSecond)) : 1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Measured, or nothing</h3>
            <p className="text-xs text-text-muted mt-1 max-w-3xl leading-relaxed">
              Every figure here came from a benchmark against the real signing, storage and verification
              paths — nothing stubbed, warmup discarded and stated, throughput taken from elapsed time
              rather than a mean. A number is only true of the machine beside it.
            </p>
          </div>
          <button
            onClick={() => void measureNow()} disabled={busy}
            className="px-4 py-2 rounded-lg bg-[#00FF88] hover:brightness-110 text-bg-primary font-semibold text-sm transition-all disabled:opacity-40"
          >
            {busy ? 'Measuring…' : 'Measure this machine'}
          </button>
        </div>
        {error && <p className="text-xs text-amber-400 mt-2">{error}</p>}
      </div>

      {unmeasured && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-semibold text-amber-400 mb-1">Not measured on this machine</p>
          <p className="text-xs text-text-muted mb-2 leading-relaxed">
            {unmeasured.reason} No throughput or latency figure is shown until one has been — a chart of
            zeroes would be worse than an empty screen, because a shape implies a measurement.
          </p>
          <pre className="text-[11px] font-mono text-text-primary bg-bg-primary/60 border border-border rounded p-2 overflow-x-auto">
            {unmeasured.howTo}
          </pre>
        </div>
      )}

      {report && (
        <>
          <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">Measured on</div>
            <div className="text-sm font-mono text-text-primary">{report.environment.cpuModel}</div>
            <div className="text-xs font-mono text-text-muted mt-0.5">
              {report.environment.cpuCount} vCPU · {report.environment.memoryGb} GB ·{' '}
              {report.environment.platform}/{report.environment.arch} · Node {report.environment.node}
              {report.environment.commit ? ` · ${report.environment.commit}` : ''}
            </div>
            <div className="text-xs text-text-muted mt-1">
              {new Date(report.environment.measuredAt).toLocaleString()} · whole suite{' '}
              {(report.totalDurationMs / 1000).toFixed(1)}s
            </div>
          </div>

          {/* Bars, because a rate compares to other rates. Width is the real
              ratio — no axis tricks, no log scale presented as linear. */}
          <div className="rounded-xl border border-border bg-bg-secondary p-4 space-y-3">
            {report.measurements.map((m, i) => {
              const delta = deltas?.find(d => d.operation === m.operation);
              return (
                <motion.div
                  key={m.operation}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.35 }}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <span className="text-xs font-mono text-text-primary">{m.operation}</span>
                    <span className="text-[11px] text-text-muted">{HEADLINE[m.operation] ?? ''}</span>
                    <span className="ml-auto text-sm font-bold text-[#00FF88] tabular-nums">
                      {m.opsPerSecond.toLocaleString('en-US')}
                      <span className="text-[10px] font-normal text-text-muted ml-1">/sec</span>
                    </span>
                  </div>

                  <div className="h-1.5 rounded-full bg-bg-primary overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(1.5, (m.opsPerSecond / fastest) * 100)}%` }}
                      transition={{ delay: i * 0.06 + 0.1, duration: 0.6, ease: 'easeOut' }}
                      className="h-full bg-gradient-to-r from-[#00D9FF] to-[#00FF88]"
                    />
                  </div>

                  <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                    <span className="text-[10px] font-mono text-text-muted">
                      p50 {m.latencyMs.p50} ms · p95 {m.latencyMs.p95} ms · p99 {m.latencyMs.p99} ms
                    </span>
                    <span className="text-[10px] font-mono text-text-muted/60">
                      {m.iterations.toLocaleString('en-US')} iterations
                    </span>
                    {delta && (
                      <span className={cn('text-[10px] font-mono ml-auto',
                        !delta.significant ? 'text-text-muted/60'
                          : delta.verdict === 'slower' ? 'text-amber-400' : 'text-[#00FF88]')}>
                        {delta.verdict === 'slower' ? '▲' : delta.verdict === 'faster' ? '▼' : '·'}{' '}
                        {delta.deltaPercent > 0 ? '+' : ''}{delta.deltaPercent}%
                        {!delta.significant && ' within noise'}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}

            <p className="text-[10px] text-text-muted/60 pt-2 border-t border-border leading-snug">
              Bar width is the real ratio between rates on this machine — no log scale drawn as linear,
              no truncated axis. Reproduce with <span className="font-mono">{report.reproduce}</span>.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-bg-secondary p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">
              Against the previous run
            </div>
            {deltas ? (
              <p className="text-xs text-text-muted leading-relaxed">
                Compared with the run of {comparedTo ? new Date(comparedTo).toLocaleString() : 'an earlier date'},
                on this same machine. Significance is Welch's t-test — a change inside the run-to-run
                spread is called noise rather than an improvement.
              </p>
            ) : (
              <p className="text-xs text-text-muted leading-relaxed">
                {notCompared || 'No comparison available yet.'}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default LearnLayer;

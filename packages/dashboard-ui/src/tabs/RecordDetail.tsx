/**
 * One record, whole.
 *
 * The record is the product, and until now it had no page — everything happened
 * in panels beside lists, and the replay engine, which is a headline capability,
 * lived inside a collapsed `<details>` that only existed after a selection. A
 * feature nobody can find is not shipped.
 *
 * This is the full life of a single execution: what it did, under what authority,
 * under what rule, whether it verifies, what it can and cannot prove, what a
 * replay says, and where it sits in the chain. Every panel names the field it
 * read, and every state is one of the four the rest of the system speaks.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import { formatMoney } from '../money';

type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

interface Trace {
  id: string;
  subject: string;
  jti?: string;
  scope?: string[];
  module: string;
  action: string;
  outcome: 'success' | 'failure';
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  steps?: { seq: number; name: string; at: string; detail?: string }[];
  governance?: { policyRef: string; policyVersion: string; decision: string; evidence: string[]; evaluatedBy?: string };
  cost?: { amount: number; currency: string; source: string; unit?: string; quantity?: number };
  prevHash: string;
  hash: string;
  signature?: string;
  keyId?: string;
  inputHash?: string;
  outputHash?: string;
}

interface Verdict {
  valid: boolean;
  reason?: string;
  contentIntact: boolean | null;
  signatureValid: boolean | null;
  determination?: Determination;
  statement?: string;
  resolvedBy?: string;
  integrity?: { determination: Determination; statement: string; resolvedBy?: string };
  authorship?: { determination: Determination; statement: string; resolvedBy?: string };
}

interface Conditions {
  overall: Determination;
  constrainedBy: string[];
  conclusion: string;
  conditions: {
    condition: string; answers: string; state: Determination;
    finding: string; from: string; resolvedBy?: string; notAnsweredBecause?: string;
  }[];
}

interface Explanation {
  headline: string; conclusion: string; warrantsReview: boolean;
  findings: { question: string; answer: string; from: string; status: string }[];
}

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const toneFor = (state?: Determination) =>
  state === 'DEMONSTRATED' ? 'text-emerald-400'
    : state === 'FAILED' ? 'text-red-400'
    : state === 'UNKNOWN' ? 'text-amber-400'
    : 'text-text-muted';

const markFor = (state?: Determination) =>
  state === 'DEMONSTRATED' ? '✓' : state === 'FAILED' ? '✗' : state === 'UNKNOWN' ? '?' : '·';

const Panel = ({ title, subtitle, children, accent }: {
  title: string; subtitle?: string; children: React.ReactNode; accent?: 'plain' | 'strong';
}) => (
  <section className={cn(
    'rounded-xl border p-4',
    accent === 'strong' ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-border bg-bg-secondary'
  )}>
    <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    {subtitle && <p className="text-xs text-text-muted mt-0.5 mb-3 leading-relaxed">{subtitle}</p>}
    {!subtitle && <div className="mb-3" />}
    {children}
  </section>
);

export const RecordDetail = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [edited, setEdited] = useState<Trace | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [conditions, setConditions] = useState<Conditions | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Replay
  const [replayInput, setReplayInput] = useState('');
  const [replayOutput, setReplayOutput] = useState('');
  const [replay, setReplay] = useState<{ inputMatches: boolean; outputMatches: boolean; deterministic: boolean } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [recordRes, condRes, explainRes] = await Promise.all([
        fetch(`/executions/${encodeURIComponent(id)}`, { headers: adminHeaders() }),
        fetch(`/executions/${encodeURIComponent(id)}/conditions`, { headers: adminHeaders() }),
        fetch(`/executions/${encodeURIComponent(id)}/explain`, { headers: adminHeaders() }),
      ]);

      if (!recordRes.ok) {
        throw new Error(
          recordRes.status === 403 || recordRes.status === 401
            ? 'Reading the execution log requires your admin key. Add it under Settings → Admin API key.'
            : `Could not load this record (${recordRes.status}).`
        );
      }

      const record = (await recordRes.json()) as Trace;
      setTrace(record);
      setEdited(record);
      if (condRes.ok) setConditions((await condRes.json()) as Conditions);
      if (explainRes.ok) setExplanation((await explainRes.json()) as Explanation);

      // Verify immediately. A record shown without its verdict is a record
      // presented as fine because nobody looked.
      const verifyRes = await fetch('/executions/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trace: record }),
      });
      if (verifyRes.ok) setVerdict((await verifyRes.json()) as Verdict);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const verifyEdited = async () => {
    if (!edited) return;
    setBusy(true);
    try {
      const res = await fetch('/executions/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trace: edited }),
      });
      setVerdict((await res.json()) as Verdict);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const tamper = () => {
    if (!edited) return;
    setEdited({ ...edited, outcome: edited.outcome === 'success' ? 'failure' : 'success' });
    setVerdict(null);
  };

  const resetTamper = () => { setEdited(trace); setVerdict(null); void load(); };

  const runReplay = async () => {
    setBusy(true); setError(''); setReplay(null);
    let payload: { input?: unknown; output?: unknown };
    try {
      const parse = (raw: string) => { const v = raw.trim(); return v ? JSON.parse(v) : undefined; };
      payload = { input: parse(replayInput), output: parse(replayOutput) };
    } catch {
      setError('That is not valid JSON. Check the input and output boxes.');
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`/executions/${encodeURIComponent(id)}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      // Parsed separately from the request payload, so a 404 returning the SPA's
      // HTML is never reported as the reader's JSON being malformed.
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Replay returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Replay failed (${res.status})`);
      }
      setReplay(data as never);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  if (error && !trace) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
        <p className="text-sm font-semibold text-amber-400 mb-1">Could not open this record</p>
        <p className="text-xs text-text-muted mb-3">{error}</p>
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-border text-text-muted hover:text-text-primary">
          Back
        </button>
      </div>
    );
  }

  if (!trace || !edited) {
    return <div className="rounded-xl border border-border bg-bg-secondary p-6 text-sm text-text-muted">Opening the record…</div>;
  }

  const tampered = edited.outcome !== trace.outcome;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-4">
      {/* ── Identity of the record ───────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button onClick={onClose} className="text-[11px] text-text-muted hover:text-text-primary mb-2">← back to the layer</button>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={cn('w-2.5 h-2.5 rounded-full', trace.outcome === 'success' ? 'bg-emerald-500' : 'bg-red-500')} />
              <h2 className="text-2xl font-bold text-text-primary font-mono">{trace.action}</h2>
              <span className="text-sm text-text-muted">{trace.subject}</span>
            </div>
            <p className="text-xs text-text-muted mt-1 font-mono">
              {trace.module} · {new Date(trace.startedAt).toLocaleString()}
              {trace.durationMs != null ? ` · ${trace.durationMs} ms` : ''}
            </p>
          </div>

          {verdict && (
            <div className={cn(
              'rounded-lg border px-4 py-2.5 text-right',
              verdict.determination === 'DEMONSTRATED' ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                : verdict.determination === 'FAILED' ? 'border-red-500/40 bg-red-500/[0.06]'
                : 'border-amber-500/40 bg-amber-500/[0.06]'
            )}>
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">Verification</div>
              <div className={cn('text-lg font-bold', toneFor(verdict.determination))}>{verdict.determination ?? '—'}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {verdict?.integrity && (
            <div className="rounded-lg border border-border bg-bg-primary/40 p-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">Integrity — has it changed?</div>
              <div className={cn('text-xs font-semibold', toneFor(verdict.integrity.determination))}>
                {markFor(verdict.integrity.determination)} {verdict.integrity.determination}
              </div>
              <p className="text-[11px] text-text-muted mt-1 leading-snug">{verdict.integrity.statement}</p>
              {verdict.integrity.resolvedBy && <p className="text-[11px] text-amber-400/90 mt-1">Resolved by: {verdict.integrity.resolvedBy}</p>}
            </div>
          )}
          {verdict?.authorship && (
            <div className="rounded-lg border border-border bg-bg-primary/40 p-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">Authorship — who wrote it?</div>
              <div className={cn('text-xs font-semibold', toneFor(verdict.authorship.determination))}>
                {markFor(verdict.authorship.determination)} {verdict.authorship.determination}
              </div>
              <p className="text-[11px] text-text-muted mt-1 leading-snug">{verdict.authorship.statement}</p>
              {verdict.authorship.resolvedBy && <p className="text-[11px] text-amber-400/90 mt-1">Resolved by: {verdict.authorship.resolvedBy}</p>}
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs text-amber-400">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Replay — first class, never a footnote ─────────────────────── */}
        <Panel
          title="Replay this execution"
          subtitle="Payloads are hashed and dropped, so ABSuite cannot show you what ran — that is the point. Paste what you believe was used and it will tell you whether it hashes to the record."
          accent="strong"
        >
          <textarea
            value={replayInput} onChange={e => setReplayInput(e.target.value)} spellCheck={false}
            placeholder='input, e.g. {"amount":2400}'
            className="w-full h-20 text-[11px] font-mono p-2 rounded bg-bg-primary border border-border text-text-primary mb-2"
          />
          <textarea
            value={replayOutput} onChange={e => setReplayOutput(e.target.value)} spellCheck={false}
            placeholder='output, e.g. {"refunded":true}'
            className="w-full h-14 text-[11px] font-mono p-2 rounded bg-bg-primary border border-border text-text-primary mb-2"
          />
          <button
            onClick={() => void runReplay()} disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50"
          >
            {busy ? 'Comparing…' : 'Compare against the record'}
          </button>

          {replay && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className={cn('mt-3 rounded-lg border p-3',
                replay.deterministic ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-amber-500/40 bg-amber-500/[0.06]')}
            >
              <div className={cn('font-bold text-sm mb-1.5', replay.deterministic ? 'text-emerald-400' : 'text-amber-400')}>
                {replay.deterministic ? 'Reproduced exactly' : 'Does not reproduce'}
              </div>
              <div className="space-y-0.5 font-mono text-[11px]">
                <div className={replay.inputMatches ? 'text-emerald-400' : 'text-amber-400'}>
                  {replay.inputMatches ? '✓' : '✗'} input hash {replay.inputMatches ? 'matches' : 'differs'}
                </div>
                <div className={replay.outputMatches ? 'text-emerald-400' : 'text-amber-400'}>
                  {replay.outputMatches ? '✓' : '✗'} output hash {replay.outputMatches ? 'matches' : 'differs'}
                </div>
              </div>
              {!replay.deterministic && (
                <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
                  A mismatch means the payload you supplied is not what was recorded. That is not proof of
                  tampering — the record is still signed and chained — it means these are not the same inputs.
                </p>
              )}
            </motion.div>
          )}
        </Panel>

        {/* ── Tamper — the most convincing thirty seconds we have ────────── */}
        <Panel
          title="Try to get away with it"
          subtitle="Edit this record in your browser, exactly as someone hiding a failure would, then verify it. The signature was never over the edited content."
        >
          <div className="rounded-lg border border-border bg-bg-primary/40 p-3 mb-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-text-muted">Outcome</span>
              <span className={cn('text-sm font-mono font-bold', tampered ? 'text-amber-400' : 'text-text-primary')}>
                {edited.outcome}{tampered && ' (edited)'}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-1.5">
              <span className="text-[11px] text-text-muted">Hash on the record</span>
              <span className="text-[10px] font-mono text-text-muted">{trace.hash.slice(0, 24)}…</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={tamper} disabled={busy}
              className="px-4 py-2 rounded-lg bg-bg-primary border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 font-semibold text-sm transition-all">
              Flip the outcome
            </button>
            <button onClick={() => void verifyEdited()} disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-bg-primary font-semibold text-sm transition-all disabled:opacity-50">
              {busy ? 'Verifying…' : 'Verify it now'}
            </button>
            {tampered && (
              <button onClick={resetTamper} className="px-3 py-1.5 rounded-lg text-text-muted hover:text-text-primary text-xs">Reset</button>
            )}
          </div>

          {tampered && !verdict && (
            <p className="text-[11px] text-amber-400 mt-3 leading-snug">
              The outcome has been changed in your browser. Nothing on the server moved. Verify it.
            </p>
          )}
        </Panel>
      </div>

      {/* ── The five conditions ─────────────────────────────────────────── */}
      {conditions && (
        <Panel
          title="What this record can and cannot prove"
          subtitle="Trust := f(Identity, Capability, Evidence, Governance, Time). f is undefined on purpose — these are the inputs; the judgement is yours."
        >
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
            {conditions.conditions.map(c => (
              <div key={c.condition} className={cn('rounded-lg border p-2.5',
                c.state === 'DEMONSTRATED' ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                  : c.state === 'FAILED' ? 'border-red-500/30 bg-red-500/[0.05]'
                  : c.state === 'UNKNOWN' ? 'border-amber-500/30 bg-amber-500/[0.05]'
                  : 'border-border bg-bg-primary/40')}>
                <div className="text-[10px] font-mono text-text-muted">{c.answers}</div>
                <div className="text-xs font-semibold text-text-primary mt-0.5">{c.condition}</div>
                <div className={cn('text-[10px] font-mono mt-1', toneFor(c.state))}>{markFor(c.state)} {c.state}</div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {conditions.conditions.filter(c => c.state !== 'DEMONSTRATED').map(c => (
              <div key={c.condition} className="text-[11px] leading-snug">
                <span className="font-semibold text-text-primary">{c.condition}: </span>
                <span className="text-text-muted">{c.finding}</span>
                {c.resolvedBy && <span className="text-amber-400/90"> Resolved by: {c.resolvedBy}</span>}
                {c.notAnsweredBecause && <span className="text-text-muted/80"> Not answered because: {c.notAnsweredBecause}</span>}
              </div>
            ))}
          </div>

          <p className={cn('text-[11px] mt-3 pt-2 border-t border-border', toneFor(conditions.overall))}>
            Strongest claim this record supports: <strong>{conditions.overall}</strong>
            {conditions.constrainedBy.length > 0 && ` — limited by ${conditions.constrainedBy.join(', ')}`}
          </p>
          <p className="text-[11px] text-text-muted mt-1 leading-snug">{conditions.conclusion}</p>
        </Panel>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Authority and the governing rule ──────────────────────────── */}
        <Panel title="Authority and the rule" subtitle="A capability answers whether it was allowed. The governing rule answers under what rule — and never whether the rule was right.">
          <dl className="text-xs space-y-1.5">
            <div className="flex gap-3">
              <dt className="text-text-muted w-28 shrink-0">Capability</dt>
              <dd className="text-text-primary font-mono break-all">
                {trace.scope && trace.scope.length > 0 ? trace.scope.join(', ') : <span className="text-amber-400">no scope recorded</span>}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-text-muted w-28 shrink-0">Token</dt>
              <dd className="text-text-primary font-mono">{trace.jti ?? '—'}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-text-muted w-28 shrink-0">Governing rule</dt>
              <dd className="text-text-primary font-mono break-all">
                {trace.governance
                  ? `${trace.governance.policyRef} v${trace.governance.policyVersion} → ${trace.governance.decision}`
                  : <span className="text-text-muted">none recorded</span>}
              </dd>
            </div>
            {/*
              Cost sits with authority rather than in a panel of its own, because
              the useful question is not "what did this cost" but "which governed
              action consumed it, under which authorization". Separating the two
              turns a governance record back into a billing line.
            */}
            <div className="flex gap-3">
              <dt className="text-text-muted w-28 shrink-0">Cost</dt>
              <dd className="text-text-primary font-mono tabular-nums">
                {trace.cost
                  ? formatMoney(trace.cost.amount, trace.cost.currency)
                  : <span className="text-text-muted">none recorded</span>}
              </dd>
            </div>
          </dl>

          {trace.cost && (
            <div className="mt-3 rounded-lg border border-border bg-bg-primary/40 p-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1.5">Where the figure came from</div>
              <p className="text-[11px] text-text-muted font-mono">· claimed by {trace.cost.source}</p>
              {trace.cost.unit && trace.cost.quantity !== undefined && (
                <p className="text-[11px] text-text-muted font-mono">
                  · {trace.cost.quantity.toLocaleString('en-US')} {trace.cost.unit}
                </p>
              )}
              <p className="text-[11px] text-text-muted/80 mt-2 leading-snug">
                ABSuite measured none of this. The figure is a claim recorded by the caller and signed with
                the rest of the record — so it is attributable, and changing it now breaks the chain.
              </p>
            </div>
          )}

          {trace.governance && (
            <div className="mt-3 rounded-lg border border-border bg-bg-primary/40 p-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1.5">Conditions the rule checked</div>
              <ul className="space-y-0.5">
                {trace.governance.evidence.map((item, i) => (
                  <li key={i} className="text-[11px] text-text-muted font-mono">· {item}</li>
                ))}
              </ul>
              <p className="text-[11px] text-text-muted/80 mt-2 leading-snug">
                This is the rule that permitted the action, not a statement that the decision was correct.
              </p>
            </div>
          )}
        </Panel>

        {/* ── Steps and chain position ──────────────────────────────────── */}
        <Panel title="What it did, and where it sits" subtitle="Every step in order, and the links that make rewriting history detectable.">
          {trace.steps && trace.steps.length > 0 ? (
            <ol className="relative border-l border-border ml-1.5 space-y-2 mb-4">
              {trace.steps.map(step => (
                <li key={step.seq} className="ml-4 relative">
                  <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-emerald-500/70" />
                  <div className="text-xs font-mono text-text-primary">{step.name}</div>
                  <div className="text-[10px] text-text-muted font-mono">
                    {new Date(step.at).toLocaleTimeString()}{step.detail ? ` · ${step.detail}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-text-muted mb-4">No steps were recorded on this execution.</p>
          )}

          <div className="rounded-lg border border-border bg-bg-primary/40 p-3 font-mono text-[10px] space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-text-muted w-16 shrink-0">previous</span>
              <span className="text-text-muted/70 break-all">{trace.prevHash.slice(0, 40)}…</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500/60 w-16 shrink-0">↓ links to</span>
              <span className="text-text-muted/40">—</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 w-16 shrink-0">this record</span>
              <span className="text-emerald-400/90 break-all">{trace.hash.slice(0, 40)}…</span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-text-muted w-16 shrink-0">signed by</span>
              <span className="text-text-muted/70">{trace.keyId ?? 'unsigned'}</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── The explanation ─────────────────────────────────────────────── */}
      {explanation && (
        <Panel title="Explained" subtitle="Derived from the fields above, deterministically. No language model was involved — run it twice and it reads identically, which is what lets you check the prose against the record.">
          <p className="text-sm font-semibold text-text-primary mb-3">{explanation.headline}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {explanation.findings.map((f, i) => (
              <div key={i} className="text-[11px] leading-snug rounded-lg border border-border bg-bg-primary/40 p-2.5">
                <div className={cn('font-medium',
                  f.status === 'attention' ? 'text-red-400' : f.status === 'unknown' ? 'text-amber-400' : 'text-emerald-400')}>
                  {f.question}
                </div>
                <div className="text-text-muted mt-0.5">{f.answer}</div>
                <div className="text-dim font-mono text-[10px] mt-1 opacity-70">from: {f.from}</div>
              </div>
            ))}
          </div>
          <p className={cn('text-[11px] mt-3 pt-2 border-t border-border',
            explanation.warrantsReview ? 'text-amber-400' : 'text-text-muted')}>
            {explanation.conclusion}
          </p>
        </Panel>
      )}
    </motion.div>
  );
};

export default RecordDetail;

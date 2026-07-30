/**
 * Arbitrate — disagreement made visible, and correlation discounted in the open.
 *
 * The engine has always discounted correlated voices: three models agreeing is
 * not three pieces of evidence when two share a family, because they fail
 * together. Nothing ever showed that happening, which is the one thing that
 * makes the idea land.
 *
 * So the discount is the visual. Each voice is drawn at its raw weight and then
 * at what it actually counted for, with the reason printed. A reader watches
 * agreement stop being worth what it looked like.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

interface Position {
  agentId: string; answer: string; family?: string;
  weight: number; rawWeight: number; discounted?: boolean; discountReason?: string;
}

interface Arbitration {
  outcome: string; answer?: string; margin: number;
  independentSupport: number; requiresHuman: boolean;
  reasoning: string[]; positions: Position[];
}

interface Chain { id?: string; chainId?: string; length?: number; agents?: string[]; status?: string }

const DEFAULT_PANEL = `[
  { "agentId": "gpt-4o",      "answer": "no",  "family": "openai:gpt-4",     "confidence": 0.90 },
  { "agentId": "gpt-4-turbo", "answer": "no",  "family": "openai:gpt-4",     "confidence": 0.88 },
  { "agentId": "gpt-3.5",     "answer": "no",  "family": "openai:gpt-3.5",   "confidence": 0.85 },
  { "agentId": "claude-opus", "answer": "yes", "family": "anthropic:claude", "confidence": 0.80 }
]`;

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

export const ArbitrateLayer = () => {
  const [question, setQuestion] = useState('Did the agent exceed its authority?');
  const [panel, setPanel] = useState(DEFAULT_PANEL);
  const [result, setResult] = useState<Arbitration | null>(null);
  const [anomalies, setAnomalies] = useState<{ kind: string; detail?: string }[] | null>(null);
  const [chains, setChains] = useState<Chain[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([
        fetch('/trust/anomalies', { headers: adminHeaders() }),
        fetch('/trust/chains', { headers: adminHeaders() }),
      ]);
      if (a.ok) setAnomalies(((await a.json()) as { anomalies: { kind: string; detail?: string }[] }).anomalies ?? []);
      if (c.ok) setChains(((await c.json()) as { chains: Chain[] }).chains ?? []);
    } catch { /* Trust may be down; the panels say so rather than inventing. */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const arbitrate = async () => {
    setBusy(true); setError(''); setResult(null);
    let parsed: unknown;
    try { parsed = JSON.parse(panel); }
    catch { setError('The panel must be valid JSON.'); setBusy(false); return; }

    try {
      const res = await fetch('/trust/arbitrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ question, positions: parsed }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Arbitration returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Arbitration failed (${res.status})`);
      }
      setResult(data as unknown as Arbitration);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const maxRaw = result ? Math.max(...result.positions.map(p => p.rawWeight), 0.01) : 1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary">Agreement between correlated voices is not corroboration</h3>
        <p className="text-xs text-text-muted mt-1 max-w-3xl leading-relaxed">
          Two models of the same family fail the same way, so their agreement counts once rather than
          twice. Every discount below is drawn — raw weight, then what it actually counted for — with
          the reason beside it. Confidence never decides the answer.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Put a question to a panel</h3>
          <input
            value={question} onChange={e => setQuestion(e.target.value)}
            className="w-full text-xs p-2 mb-2 rounded bg-bg-primary border border-border text-text-primary"
          />
          <textarea
            value={panel} onChange={e => setPanel(e.target.value)} spellCheck={false}
            className="w-full h-44 text-[11px] font-mono p-2 rounded bg-bg-primary border border-border text-text-primary mb-2"
          />
          <button
            onClick={() => void arbitrate()} disabled={busy}
            className="px-4 py-2 rounded-lg bg-[#00FF88] hover:brightness-110 text-bg-primary font-semibold text-sm transition-all disabled:opacity-40"
          >
            {busy ? 'Arbitrating…' : 'Arbitrate'}
          </button>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">How each voice counted</h3>

          {!result ? (
            <p className="text-sm text-text-muted">
              Run an arbitration to watch correlated agreement lose the weight it appeared to have.
            </p>
          ) : (
            <>
              <div className={cn('rounded-lg border p-3 mb-3',
                result.requiresHuman ? 'border-amber-500/40 bg-amber-500/[0.06]'
                  : result.outcome === 'resolved' ? 'border-[#00FF88]/40 bg-[#00FF88]/[0.05]' : 'border-border')}>
                <div className={cn('text-lg font-bold',
                  result.requiresHuman ? 'text-amber-400'
                    : result.outcome === 'resolved' ? 'text-[#00FF88]' : 'text-text-primary')}>
                  {result.outcome === 'resolved' ? `Answer: ${result.answer}`
                    : result.outcome === 'escalate' ? 'Escalated to a human' : 'No consensus'}
                </div>
                <div className="text-xs text-text-muted mt-1 font-mono">
                  {Math.round(result.margin * 100)}% of weight ·{' '}
                  {result.independentSupport} independent famil{result.independentSupport === 1 ? 'y' : 'ies'}
                </div>
              </div>

              <div className="space-y-2.5 mb-3">
                {result.positions.map((position, i) => (
                  <motion.div
                    key={position.agentId}
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07 }}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-xs font-mono text-text-primary">{position.agentId}</span>
                      <span className="text-[10px] font-mono text-text-muted">{position.answer}</span>
                      <span className="text-[10px] font-mono ml-auto">
                        {position.discounted ? (
                          <>
                            <s className="text-text-muted/50">{position.rawWeight.toFixed(2)}</s>{' '}
                            <span className="text-amber-400">{position.weight.toFixed(2)}</span>
                          </>
                        ) : (
                          <span className="text-[#00FF88]">{position.weight.toFixed(2)}</span>
                        )}
                      </span>
                    </div>

                    {/* Raw weight behind, counted weight in front. The gap is the discount. */}
                    <div className="relative h-1.5 rounded-full bg-bg-primary overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-text-muted/25"
                        style={{ width: `${(position.rawWeight / maxRaw) * 100}%` }}
                      />
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(position.weight / maxRaw) * 100}%` }}
                        transition={{ delay: i * 0.07 + 0.15, duration: 0.5 }}
                        className={cn('absolute inset-y-0 left-0',
                          position.discounted ? 'bg-amber-400' : 'bg-[#00FF88]')}
                      />
                    </div>

                    {position.discountReason && (
                      <p className="text-[10px] text-amber-400/80 mt-1 leading-snug">{position.discountReason}</p>
                    )}
                  </motion.div>
                ))}
              </div>

              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1.5">Reasoning</div>
              <ul className="space-y-1">
                {result.reasoning.map((line, i) => (
                  <li key={i} className="text-[11px] text-text-muted leading-snug flex gap-1.5">
                    <span className="text-[#00FF88]/60">·</span><span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-1">Chain anomalies</h3>
          <p className="text-xs text-text-muted mb-3">
            Cycles, runaways, stalls and observer disagreement across agent chains.
          </p>
          {anomalies === null ? (
            <p className="text-sm text-text-muted">Trust did not answer, so nothing can be stated.</p>
          ) : anomalies.length === 0 ? (
            <p className="text-sm text-text-muted">
              None detected. A real result — chains with no anomalies report none.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {anomalies.map((anomaly, i) => (
                <li key={i} className="rounded border border-amber-500/30 bg-amber-500/[0.04] p-2 text-xs">
                  <span className="font-mono text-amber-400">{anomaly.kind}</span>
                  {anomaly.detail && <span className="text-text-muted"> — {anomaly.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-1">Agent-to-agent chains</h3>
          <p className="text-xs text-text-muted mb-3">
            Where one agent's output became another's input. This is the shape autonomy actually takes.
          </p>
          {chains === null ? (
            <p className="text-sm text-text-muted">Trust did not answer, so nothing can be stated.</p>
          ) : chains.length === 0 ? (
            <p className="text-sm text-text-muted">
              No chains recorded. Agents on this instance have not handed work to one another — an
              accurate description of a single-agent deployment, not a missing feature.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {chains.map((chain, i) => (
                <li key={chain.chainId ?? chain.id ?? i} className="rounded border border-border bg-bg-primary/40 p-2">
                  <span className="text-xs font-mono text-text-primary">{chain.chainId ?? chain.id}</span>
                  {chain.agents && (
                    <span className="text-[11px] text-text-muted"> — {chain.agents.join(' → ')}</span>
                  )}
                  {chain.status && <span className="text-[10px] font-mono text-text-muted ml-2">{chain.status}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default ArbitrateLayer;

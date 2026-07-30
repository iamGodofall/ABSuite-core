/**
 * The chain, rendered as a chain.
 *
 * This is the most explicable idea in the product and it has been a sentence
 * since the beginning: every record carries the hash of the one before it, so
 * changing any record breaks every link after it, and anyone can check that
 * with nothing but a public key.
 *
 * One honesty constraint governs the whole component. **The sweep is a replay of
 * a real verification, not a simulation of one.** The server verifies the chain
 * in a single call — 1,000 records in about 170 ms — and the animation then
 * walks the result it actually returned, at a speed a person can follow. The
 * elapsed time is printed beside it, so nobody mistakes the pacing for the work.
 *
 * Animating first and asking the server afterwards would be theatre: the screen
 * would show verification "happening" before anything had been verified, and a
 * viewer would be watching a progress bar wearing a cryptographic costume.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

interface Link {
  id: string;
  subject: string;
  action: string;
  outcome: 'success' | 'failure';
  startedAt: string;
  prevHash: string;
  hash: string;
  governance?: { policyRef: string };
}

interface ChainResult {
  valid: boolean;
  checked: number;
  brokenAt?: number;
  brokenId?: string;
  reason?: string;
  contentIntact?: boolean | null;
  checkable?: boolean;
  headHash: string;
  determination?: string;
  statement?: string;
  resolvedBy?: string;
}

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

/** Milliseconds per link during the replay. Slow enough to read, not to bore. */
const SWEEP_MS = 110;

export const ChainView = ({ onOpenRecord }: { onOpenRecord?: (id: string) => void }) => {
  const [links, setLinks] = useState<Link[]>([]);
  const [result, setResult] = useState<ChainResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [sweptTo, setSweptTo] = useState<number>(-1);
  const [sweeping, setSweeping] = useState(false);
  const [error, setError] = useState('');
  const timers = useRef<number[]>([]);

  const clearTimers = () => { timers.current.forEach(t => window.clearTimeout(t)); timers.current = []; };
  useEffect(() => () => clearTimers(), []);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/executions?limit=40', { headers: adminHeaders() });
      if (!res.ok) {
        throw new Error(res.status === 401 || res.status === 403
          ? 'Reading the chain requires your admin key — Settings → Admin API key.'
          : `Could not load the chain (${res.status}).`);
      }
      const data = (await res.json()) as { executions: Link[] };
      // Oldest first: a chain reads forward, in the order it was written.
      setLinks([...(data.executions ?? [])].reverse());
    } catch (err) { setError((err as Error).message); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const verify = async () => {
    clearTimers();
    setSweeping(true); setSweptTo(-1); setResult(null); setElapsedMs(null); setError('');

    // The real work happens here, once, before anything moves.
    const startedAt = performance.now();
    let outcome: ChainResult;
    try {
      const res = await fetch('/executions-verify-chain', { headers: adminHeaders() });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`Chain verification returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Verification failed (${res.status})`);
      }
      outcome = data as unknown as ChainResult;
    } catch (err) {
      setError((err as Error).message); setSweeping(false); return;
    }
    const round = performance.now() - startedAt;

    setElapsedMs(round);
    setResult(outcome);

    // Now replay what actually came back, one link at a time.
    const stopAt = outcome.valid ? links.length : Math.max(0, (outcome.brokenAt ?? links.length) - 1);
    for (let i = 0; i <= stopAt; i++) {
      timers.current.push(window.setTimeout(() => {
        setSweptTo(i);
        if (i === stopAt) setSweeping(false);
      }, i * SWEEP_MS));
    }
    if (stopAt < 0) setSweeping(false);
  };

  const brokenIndex = result && !result.valid && result.brokenAt !== undefined ? result.brokenAt - 1 : -1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">The chain</h3>
            <p className="text-xs text-text-muted mt-1 max-w-2xl leading-relaxed">
              Every record carries the hash of the one before it. Change any record and every link after
              it breaks — which is why history here can be checked rather than trusted, by anyone
              holding nothing but the public key.
            </p>
          </div>
          <button
            onClick={() => void verify()} disabled={sweeping || links.length === 0}
            className="px-4 py-2 rounded-lg bg-[#00FF88] hover:brightness-110 text-bg-primary font-semibold text-sm transition-all disabled:opacity-40"
          >
            {sweeping ? 'Walking the chain…' : 'Verify the whole chain'}
          </button>
        </div>

        {result && elapsedMs !== null && (
          <div className={cn('mt-3 rounded-lg border p-3',
            result.valid ? 'border-[#00FF88]/40 bg-[#00FF88]/[0.05]'
              : result.checkable === false ? 'border-amber-500/40 bg-amber-500/[0.06]'
              : 'border-red-500/40 bg-red-500/[0.06]')}>
            <div className={cn('text-sm font-bold',
              result.valid ? 'text-[#00FF88]' : result.checkable === false ? 'text-amber-400' : 'text-red-400')}>
              {result.valid
                ? `Intact — ${result.checked.toLocaleString('en-US')} record(s) verified`
                : result.checkable === false
                  ? `Cannot be checked by this build at record #${result.brokenAt}`
                  : `Broken at record #${result.brokenAt}`}
            </div>
            {result.reason && <p className="text-[11px] text-text-muted mt-1 leading-snug">{result.reason}</p>}
            {result.resolvedBy && <p className="text-[11px] text-amber-400/90 mt-1">Resolved by: {result.resolvedBy}</p>}

            {/* The number that stops the animation being a lie. */}
            <p className="text-[10px] font-mono text-text-muted/70 mt-2">
              Verified in {elapsedMs < 1 ? '<1' : elapsedMs.toFixed(0)} ms. The walk below is that result
              replayed at {SWEEP_MS} ms per link so it can be followed — the work was already done.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-amber-400 mt-3">{error}</p>}
      </div>

      {/* ── The links ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        {links.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-6">
            No records held, so there is no chain to draw.
          </p>
        ) : (
          <div className="relative">
            {/* The spine. */}
            <div className="absolute left-[19px] top-3 bottom-3 w-px bg-border" />

            <ol className="space-y-1 relative">
              {links.map((link, index) => {
                const swept = sweptTo >= index;
                const isBroken = brokenIndex === index;
                const afterBreak = brokenIndex >= 0 && index > brokenIndex;

                return (
                  <li key={link.id} className="relative">
                    <button
                      type="button"
                      onClick={() => onOpenRecord?.(link.id)}
                      className="w-full text-left flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-bg-tertiary/40 transition-colors"
                    >
                      {/* The link itself. */}
                      <span className="relative shrink-0 w-6 flex justify-center pt-1">
                        <motion.span
                          animate={{
                            scale: swept && !isBroken ? [1, 1.5, 1] : 1,
                            opacity: afterBreak ? 0.3 : 1,
                          }}
                          transition={{ duration: 0.35 }}
                          className={cn('w-2.5 h-2.5 rounded-full border-2 block',
                            isBroken ? 'bg-red-500 border-red-400'
                              : swept ? 'bg-[#00FF88] border-[#00FF88]'
                              : 'bg-bg-primary border-border')}
                        />
                      </span>

                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2 flex-wrap">
                          <span className={cn('text-xs font-mono',
                            afterBreak ? 'text-text-muted/50' : 'text-text-primary')}>
                            {link.action}
                          </span>
                          <span className="text-[11px] text-text-muted">{link.subject}</span>
                          {link.governance && (
                            <span className="text-[10px] font-mono text-[#00D9FF]/60">
                              {link.governance.policyRef}
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-text-muted/50 ml-auto">
                            #{index + 1}
                          </span>
                        </span>

                        <span className="block text-[10px] font-mono text-text-muted/50 mt-0.5 truncate">
                          {link.prevHash.slice(0, 10)}… → {link.hash.slice(0, 10)}…
                        </span>

                        {isBroken && (
                          <motion.span
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="block text-[11px] text-red-400 mt-1 leading-snug"
                          >
                            The walk stops here. Everything after this is unchecked — not disproven,
                            unchecked.
                          </motion.span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {links.length > 0 && (
          <p className="text-[10px] text-text-muted/60 mt-3 pt-3 border-t border-border leading-snug">
            Showing the {links.length} most recent record(s), oldest first. A chain reads forward, in the
            order it was written.
          </p>
        )}
      </div>
    </div>
  );
};

export default ChainView;

/**
 * Who has been reading the evidence — and whether that record has been altered.
 *
 * CapKit has hash-chained every authorisation decision since the first commit.
 * Every token check, every allow, every deny, each entry sealed against the one
 * before it, surviving restarts in a JSONL mirror. It was reachable only by
 * curl.
 *
 * That omission was the sharpest one left in this console. A Trust Operations
 * Center that shows a tamper-evident log of what the agents did, while keeping
 * no visible record of who has been reading it, is asking for a trust it does
 * not extend. Watchers get watched here too, or the argument does not hold.
 *
 * The integrity claim is stated the way every other integrity claim in this
 * product is stated: intact, broken at a known link, or not checkable — never
 * a green tick standing in for all three.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

interface Entry {
  id: string;
  timestamp: string;
  subject: string;
  action: string;
  resource: string;
  result: 'allow' | 'deny';
  durationMs?: number;
  reason?: string;
  hash?: string;
  prevHash?: string;
}

interface Page { entries: Entry[]; total: number; limit: number; offset: number }
interface Integrity { valid: boolean; checked: number; brokenAt?: number; reason?: string; headHash?: string }

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const FILTERS = [
  { id: '', label: 'Everything' },
  { id: 'deny', label: 'Refusals only' },
  { id: 'allow', label: 'Grants only' },
] as const;

export const Audit = () => {
  const [page, setPage] = useState<Page | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [checkable, setCheckable] = useState(true);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (result) query.set('result', result);

      const [entriesRes, verifyRes] = await Promise.all([
        fetch(`/audit?${query.toString()}`, { headers: adminHeaders() }),
        fetch('/audit/verify', { headers: adminHeaders() }),
      ]);

      if (!entriesRes.ok) {
        throw new Error(entriesRes.status === 401 || entriesRes.status === 403
          ? 'Reading the audit log requires your admin key — Settings → Admin API key. The log is locked, not empty.'
          : `The audit log could not be read (${entriesRes.status}).`);
      }
      setPage((await entriesRes.json()) as Page);

      // A failed verification call means the chain was not checked. It does not
      // mean the chain is broken, and it must never be drawn as if it did.
      if (verifyRes.ok) { setIntegrity((await verifyRes.json()) as Integrity); setCheckable(true); }
      else { setIntegrity(null); setCheckable(false); }
    } catch (err) {
      setError((err as Error).message);
      setPage(null);
      setIntegrity(null);
      setCheckable(false);
    }
  }, [result]);

  useEffect(() => { void load(); }, [load]);

  const entries = page?.entries ?? [];
  const denials = entries.filter(entry => entry.result === 'deny');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary">Who asked this system for what</h3>
        <p className="text-xs text-text-muted mt-1 max-w-3xl leading-relaxed">
          Not the agents' record — this console's. Every authorisation decision CapKit has made,
          hash-chained so that altering one entry breaks every link after it. A system that keeps a
          tamper-evident log of what the agents did, and no visible record of who has been reading
          it, is asking for a trust it does not extend.
        </p>
      </div>

      {/* ── The integrity claim, in the four-state language ────────────────── */}
      <div className={cn('rounded-xl border p-4',
        !checkable ? 'border-amber-500/40 bg-amber-500/[0.06]'
          : integrity?.valid ? 'border-[#00FF88]/35 bg-[#00FF88]/[0.05]'
          : 'border-red-500/40 bg-red-500/[0.06]')}>
        {!checkable ? (
          <>
            <p className="text-sm font-semibold text-amber-400">Not checked</p>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              The verification endpoint did not answer, so nothing can be said about whether this log
              has been altered. Unknown is not the same as intact, and it is not the same as broken —
              this panel will not colour itself green to fill the gap.
            </p>
          </>
        ) : integrity?.valid ? (
          <>
            <p className="text-sm font-semibold text-[#00FF88]">
              Chain intact across {integrity.checked.toLocaleString('en-US')} entries
            </p>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              Each entry's hash was recomputed from its content and its predecessor's hash, and every
              link matched. This proves the log has not been edited since it was written. It does not
              prove the log is complete — an entry never written leaves no gap to find.
            </p>
            {integrity.headHash && (
              <p className="text-[10px] font-mono text-text-muted/60 mt-2 break-all">
                head {integrity.headHash}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-red-400">
              Chain broken{integrity?.brokenAt !== undefined ? ` at entry ${integrity.brokenAt}` : ''}
            </p>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              {integrity?.reason ?? 'A recomputed hash did not match the one stored.'} Everything
              before the break still verifies; everything after it is unproven, because each link
              depends on the one before.
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
          <p className="text-xs text-amber-400 leading-relaxed">{error}</p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-wrap">
          {FILTERS.map(filter => (
            <button
              key={filter.id}
              onClick={() => setResult(filter.id)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                result === filter.id
                  ? 'border-[#00FF88]/30 bg-[#00FF88]/10 text-[#00FF88]'
                  : 'border-border text-text-muted hover:text-text-primary')}
            >
              {filter.label}
            </button>
          ))}
          {page && (
            <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted/60">
              {entries.length} of {page.total.toLocaleString('en-US')} · {denials.length} refused
            </span>
          )}
        </div>

        {!page && !error ? (
          <p className="px-4 py-8 text-sm text-text-muted text-center">Reading the log…</p>
        ) : entries.length === 0 ? (
          <p className="px-4 py-8 text-sm text-text-muted text-center">
            {result
              ? 'Nothing matched that filter. That is an answer, not an error.'
              : 'The audit log is empty. Nothing has asked this system for anything yet.'}
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            {entries.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(index * 0.012, 0.3), duration: 0.25 }}
                className={cn('flex items-baseline gap-3 px-4 py-2 border-b border-border/40 last:border-b-0 flex-wrap',
                  entry.result === 'deny' && 'bg-red-500/[0.03]')}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 self-center',
                  entry.result === 'allow' ? 'bg-[#00FF88]' : 'bg-red-500')} />
                <span className={cn('text-[10px] font-mono uppercase w-12 shrink-0',
                  entry.result === 'allow' ? 'text-[#00FF88]/70' : 'text-red-400')}>
                  {entry.result}
                </span>
                <span className="text-xs font-mono text-text-primary">{entry.action}</span>
                <span className="text-[11px] text-text-muted">{entry.subject}</span>
                <span className="text-[10px] font-mono text-[#00D9FF]/60">{entry.resource}</span>
                {entry.reason && <span className="text-[10px] text-amber-400/80">{entry.reason}</span>}
                <span className="text-[10px] font-mono text-text-muted/50 ml-auto">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                {entry.hash && (
                  <span className="text-[10px] font-mono text-text-muted/30 w-full pl-[4.9rem]">
                    {entry.hash.slice(0, 16)}… ← {(entry.prevHash ?? '0'.repeat(64)).slice(0, 16)}…
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-text-muted/60 leading-snug px-1">
        Each row shows its own hash and the predecessor it was sealed against, so the chain above is
        something you can recompute rather than something you have to take on faith. Refusals are
        kept, not filtered out — a log that only records what was permitted is a log of half the
        decisions.
      </p>
    </div>
  );
};

export default Audit;

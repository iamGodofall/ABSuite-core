/**
 * "What happened? Ask ABSuite anything. Get verifiable answers."
 *
 * The framing is right and the implementation must not be a language model.
 * A natural-language box that guesses at intent would put an unauditable
 * system between a person and the evidence — the same mistake as generating an
 * explanation, one screen earlier, and with more room to be confidently wrong.
 *
 * So this is deterministic. Every command maps to an endpoint that already
 * exists, the grammar is small and printed on screen, and anything it does not
 * understand is refused with the list of what it does understand. It never
 * guesses, never "did you mean", and never returns an approximate answer.
 *
 * The suggestions matter as much as the parser: most people never discover
 * replay. Putting `replay <id>` in front of them as an example teaches a
 * capability that was previously reachable only by knowing it existed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils';

interface Hit {
  id: string;
  subject: string;
  action: string;
  outcome: 'success' | 'failure';
  startedAt: string;
  scope?: string[];
  governance?: { policyRef: string };
}

type Answer =
  | { kind: 'records'; heading: string; note: string; hits: Hit[] }
  | { kind: 'refused'; heading: string; note: string };

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

/** The whole grammar. Small on purpose, and printed for the reader. */
const COMMANDS = [
  { example: 'failed', describes: 'records that did not succeed' },
  { example: 'unscoped', describes: 'records with no recorded authority' },
  { example: 'governed', describes: 'records naming the rule that permitted them' },
  { example: 'agent:finance-7', describes: 'everything a subject did' },
  { example: 'refund', describes: 'an action by name' },
  { example: 'exec_1a2b…', describes: 'open one record by id' },
];

export const AskBar = ({ onOpenRecord }: { onOpenRecord?: (id: string) => void }) => {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const run = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (!term) { setAnswer(null); return; }

    setBusy(true); setOpen(true);
    try {
      const res = await fetch('/executions?limit=200', { headers: adminHeaders() });
      if (!res.ok) {
        setAnswer({
          kind: 'refused',
          heading: res.status === 401 || res.status === 403 ? 'Locked, not empty' : `Could not read the log (${res.status})`,
          note: res.status === 401 || res.status === 403
            ? 'Reading the execution log requires your admin key — Settings → Admin API key.'
            : 'CapKit did not answer, so nothing can be stated.',
        });
        return;
      }

      const all = ((await res.json()) as { executions: Hit[] }).executions ?? [];
      const lower = term.toLowerCase();

      // An id opens the record directly. No searching, no ranking.
      if (/^exec_[0-9a-f]+$/i.test(term)) {
        const match = all.find(record => record.id.toLowerCase().startsWith(lower));
        if (match) { onOpenRecord?.(match.id); setOpen(false); setQuery(''); return; }
        setAnswer({ kind: 'refused', heading: 'No record with that id', note: `Nothing among the ${all.length} most recent records has the id ${term}.` });
        return;
      }

      let hits: Hit[];
      let heading: string;

      if (lower === 'failed') {
        hits = all.filter(r => r.outcome === 'failure');
        heading = 'Records that did not succeed';
      } else if (lower === 'unscoped') {
        hits = all.filter(r => !r.scope || r.scope.length === 0);
        heading = 'Records with no recorded authority';
      } else if (lower === 'governed') {
        hits = all.filter(r => Boolean(r.governance));
        heading = 'Records naming the rule that permitted them';
      } else if (lower.startsWith('agent:') || lower.includes(':')) {
        hits = all.filter(r => r.subject.toLowerCase().includes(lower));
        heading = `Everything ${term} did`;
      } else {
        // Plain substring over fields the record actually holds. No fuzziness:
        // a near-match presented as a match is a small lie with a big reach.
        hits = all.filter(r =>
          r.action.toLowerCase().includes(lower) ||
          r.subject.toLowerCase().includes(lower) ||
          (r.governance?.policyRef ?? '').toLowerCase().includes(lower)
        );
        heading = `Records matching “${term}”`;
      }

      setAnswer({
        kind: 'records',
        heading,
        note: `${hits.length} of the ${all.length} most recent record(s) held. Exact matches only — nothing here is inferred, ranked or guessed at.`,
        hits: hits.slice(0, 12),
      });
    } catch {
      setAnswer({ kind: 'refused', heading: 'Nothing to report', note: 'CapKit is unreachable, so no answer can be given.' });
    } finally {
      setBusy(false);
    }
  }, [onOpenRecord]);

  return (
    <div ref={boxRef} className="relative flex-1 max-w-2xl">
      <form
        onSubmit={event => { event.preventDefault(); void run(query); }}
        className="flex items-center gap-2 bg-bg-primary border border-border rounded-xl px-3 py-2 focus-within:border-[#00FF88]/40 transition-colors"
      >
        <span className="text-[#00FF88]/60 font-mono text-xs shrink-0">?</span>
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="What happened? Ask for records — failed, unscoped, governed, an agent, an id…"
          className="bg-transparent text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none w-full"
        />
        {busy && <span className="text-[10px] font-mono text-text-muted shrink-0">reading…</span>}
      </form>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border bg-bg-secondary shadow-2xl z-50 overflow-hidden"
          >
            {!answer && (
              <div className="p-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">
                  What this understands
                </div>
                <div className="space-y-1">
                  {COMMANDS.map(command => (
                    <button
                      key={command.example}
                      onClick={() => { setQuery(command.example); void run(command.example); }}
                      className="w-full text-left flex items-baseline gap-3 px-2 py-1.5 rounded hover:bg-bg-tertiary/50 transition-colors"
                    >
                      <span className="text-xs font-mono text-[#00FF88]/90 shrink-0 w-32">{command.example}</span>
                      <span className="text-[11px] text-text-muted">{command.describes}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-text-muted/60 mt-3 pt-2 border-t border-border leading-snug">
                  Deterministic, not conversational. No model reads this — the grammar above is the whole
                  of it, and anything else is refused rather than guessed at.
                </p>
              </div>
            )}

            {answer?.kind === 'refused' && (
              <div className="p-4">
                <p className="text-sm font-semibold text-amber-400">{answer.heading}</p>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">{answer.note}</p>
              </div>
            )}

            {answer?.kind === 'records' && (
              <div>
                <div className="px-4 py-2.5 border-b border-border">
                  <p className="text-xs font-semibold text-text-primary">{answer.heading}</p>
                  <p className="text-[10px] text-text-muted mt-0.5">{answer.note}</p>
                </div>

                {answer.hits.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-text-muted">
                    Nothing matched. That is an answer, not an error.
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {answer.hits.map(hit => (
                      <button
                        key={hit.id}
                        onClick={() => { onOpenRecord?.(hit.id); setOpen(false); }}
                        className="w-full text-left px-4 py-2 border-b border-border/40 hover:bg-bg-tertiary/40 flex items-center gap-2.5 flex-wrap"
                      >
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                          hit.outcome === 'success' ? 'bg-[#00FF88]' : 'bg-red-500')} />
                        <span className="text-xs font-mono text-text-primary">{hit.action}</span>
                        <span className="text-[11px] text-text-muted">{hit.subject}</span>
                        {hit.governance && (
                          <span className="text-[10px] font-mono text-[#00D9FF]/60">{hit.governance.policyRef}</span>
                        )}
                        <span className="text-[10px] font-mono text-text-muted/50 ml-auto">
                          {new Date(hit.startedAt).toLocaleTimeString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AskBar;

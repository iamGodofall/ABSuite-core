/**
 * The command line. Press `/` and the room pauses.
 *
 * A search box is furniture: it sits there occupying a corner whether or not
 * anyone wants it, and it makes the interface look like a website with a filter
 * on it. This is summoned instead. The room dims, everything stops, and the
 * only thing on screen is the question.
 *
 * It is still deterministic. No model reads this — the grammar is small, it is
 * printed on screen, and anything outside it is refused rather than guessed at.
 * A natural-language box that guesses would put an unauditable system between a
 * person and the evidence, which is the mistake this product exists to argue
 * against.
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

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

/** The whole grammar, small on purpose and printed for the reader. */
const GRAMMAR = [
  { term: 'failed', means: 'records that did not succeed' },
  { term: 'unscoped', means: 'records with no recorded authority' },
  { term: 'governed', means: 'records naming the rule that permitted them' },
  { term: 'agent:…', means: 'everything one subject did' },
  { term: 'exec_…', means: 'open one record by id' },
];

export const CommandLine = ({ open, onClose, onOpenRecord }: {
  open: boolean;
  onClose: () => void;
  onOpenRecord?: (id: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [refusal, setRefusal] = useState('');
  const [held, setHeld] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery(''); setHits(null); setRefusal('');
      window.setTimeout(() => input.current?.focus(), 60);
    }
  }, [open]);

  const run = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (!term) { setHits(null); setRefusal(''); return; }
    setRefusal('');

    try {
      const res = await fetch('/executions?limit=200', { headers: adminHeaders() });
      if (!res.ok) {
        setHits(null);
        setRefusal(res.status === 401 || res.status === 403
          ? 'Locked, not empty. Reading the log needs your admin key.'
          : `The log could not be read (${res.status}). Nothing can be stated.`);
        return;
      }

      const all = ((await res.json()) as { executions: Hit[] }).executions ?? [];
      setHeld(all.length);
      const lower = term.toLowerCase();

      if (/^exec_[0-9a-f]+$/i.test(term)) {
        const match = all.find(record => record.id.toLowerCase().startsWith(lower));
        if (match) { onOpenRecord?.(match.id); onClose(); return; }
        setHits([]); setRefusal(`Nothing among the ${all.length} most recent records has that id.`);
        return;
      }

      const matched =
        lower === 'failed' ? all.filter(r => r.outcome === 'failure')
        : lower === 'unscoped' ? all.filter(r => !r.scope || r.scope.length === 0)
        : lower === 'governed' ? all.filter(r => Boolean(r.governance))
        : all.filter(r =>
            r.action.toLowerCase().includes(lower) ||
            r.subject.toLowerCase().includes(lower) ||
            (r.governance?.policyRef ?? '').toLowerCase().includes(lower));

      setHits(matched.slice(0, 14));
    } catch {
      setHits(null);
      setRefusal('CapKit is unreachable, so no answer can be given.');
    }
  }, [onClose, onOpenRecord]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-50 bg-[#05070A]/88 backdrop-blur-md flex flex-col items-center pt-[16vh] px-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-2xl"
            onClick={event => event.stopPropagation()}
          >
            <form onSubmit={event => { event.preventDefault(); void run(query); }}>
              <div className="flex items-baseline gap-3 border-b border-[#00F58C]/30 pb-3">
                <span className="text-[#00F58C] font-mono text-lg">?</span>
                <input
                  ref={input}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="What happened?"
                  className="flex-1 bg-transparent text-2xl text-text-primary placeholder:text-text-muted/40 focus:outline-none font-light"
                />
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/40">esc</span>
              </div>
            </form>

            {!hits && !refusal && (
              <div className="mt-5 space-y-1.5">
                {GRAMMAR.map(entry => (
                  <button
                    key={entry.term}
                    type="button"
                    onClick={() => { setQuery(entry.term); void run(entry.term); }}
                    className="w-full flex items-baseline gap-4 text-left py-1 group"
                  >
                    <span className="text-sm font-mono text-[#00F58C]/80 w-28 shrink-0 group-hover:text-[#00F58C]">
                      {entry.term}
                    </span>
                    <span className="text-xs text-text-muted">{entry.means}</span>
                  </button>
                ))}
                <p className="text-[10px] text-text-muted/50 pt-3 leading-snug">
                  Deterministic, not conversational. No model reads this — the grammar above is the
                  whole of it, and anything else is refused rather than guessed at.
                </p>
              </div>
            )}

            {refusal && <p className="mt-5 text-sm text-amber-400 leading-relaxed">{refusal}</p>}

            {hits && hits.length === 0 && !refusal && (
              <p className="mt-5 text-sm text-text-muted">Nothing matched. That is an answer, not an error.</p>
            )}

            {hits && hits.length > 0 && (
              <div className="mt-5">
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/60 mb-2">
                  {hits.length} of the {held} most recent · exact matches only, nothing inferred
                </p>
                <div className="max-h-[42vh] overflow-y-auto">
                  {hits.map(hit => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => { onOpenRecord?.(hit.id); onClose(); }}
                      className="w-full flex items-baseline gap-3 py-2 border-b border-[#00F58C]/8 text-left hover:bg-[#00F58C]/[0.04] px-2 -mx-2"
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 self-center',
                        hit.outcome === 'success' ? 'bg-[#00F58C]' : 'bg-red-500')} />
                      <span className="text-sm font-mono text-text-primary">{hit.action}</span>
                      <span className="text-xs text-text-muted">{hit.subject}</span>
                      <span className="ml-auto text-[10px] font-mono text-text-muted/50">
                        {new Date(hit.startedAt).toLocaleTimeString('en-GB', { hour12: false })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CommandLine;

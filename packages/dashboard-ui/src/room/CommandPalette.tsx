/**
 * The palette, which is how you reach everything that is not a cube face.
 *
 * Seven operations orbit the core and answer to the number keys. Everything
 * else — the standing views the operations act on, the console, the machine
 * room, replay — has no orbital node by design, because a room does not carry a
 * standing list of destinations. This is the deliberate way in.
 *
 * It did not work. This component took a `views` prop, documented in its own
 * signature as "every reachable view … this palette is the only way to them",
 * threaded from TAB_CONFIG through TrustOperationsCenter and into this file —
 * and then ignored it, rendering five hardcoded commands that all pointed at
 * layers the cube already reaches. Evidence, Agents, Policies, the unknown
 * queue, the console, the machine room and settings had no route at all.
 *
 * The data was plumbed the entire way and dropped at the last step, which is
 * the hardest kind of dead end to find: every file looks right on its own, the
 * prop is passed, the comment is accurate about intent, and nothing errors.
 *
 * The input was decorative in the same way — no value, no onChange, no
 * onKeyDown. You could type into it and press Enter, and nothing could happen,
 * because nothing was listening.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, CornerDownLeft } from 'lucide-react';

export interface PaletteView { id: string; label: string; question: string }

export function CommandPalette({ isOpen, onClose, onSelectLayer, views = [] }: {
  isOpen: boolean;
  onClose: () => void;
  onSelectLayer: (layer: string) => void;
  /** Reserved for opening a record directly from the palette. */
  onOpenRecord?: (id: string) => void;
  /** Every reachable view, from the one list that defines them. */
  views?: PaletteView[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setCursor(0);
    inputRef.current?.focus();
  }, [isOpen]);

  /*
   * Matched on label and on question, because people arrive holding either the
   * name of a thing or the thing they want to know. "unknown" finds the queue;
   * so does "cannot yet be shown".
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return views;
    return views.filter(view =>
      view.id.includes(q) ||
      view.label.toLowerCase().includes(q) ||
      view.question.toLowerCase().includes(q));
  }, [views, query]);

  useEffect(() => { setCursor(0); }, [query]);

  if (!isOpen) return null;

  const choose = (id: string) => { onSelectLayer(id); onClose(); };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor(c => Math.min(matches.length - 1, c + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (matches[cursor]) choose(matches[cursor].id); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto bg-ab-bg/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[540px] ab-panel border-ab-green/30 shadow-[0_0_50px_rgba(0,245,140,0.1)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="ab-panel-header mb-0">
            <span className="text-ab-green mr-2 font-bold">/</span> COMMAND PALETTE
          </div>
          <div className="text-[9px] font-mono text-ab-white/30 uppercase tracking-widest">ESC TO CLOSE</div>
        </div>

        <div className="relative mb-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="> where do you want to go?"
            aria-label="Search views"
            className="w-full bg-ab-bg border border-ab-green/20 rounded-sm px-4 py-4 text-sm font-mono text-ab-white placeholder:text-ab-white/30 focus:outline-none focus:border-ab-green/60 shadow-inner transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
            <div className="w-5 h-5 border border-ab-white/10 rounded flex items-center justify-center text-ab-white/40">
              <CornerDownLeft size={11} />
            </div>
          </div>
        </div>

        <div className="text-[8px] font-mono text-ab-white/40 uppercase tracking-widest mb-3">
          {query ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : `${views.length} views`}
        </div>

        <div className="flex flex-col gap-1 font-mono text-xs max-h-[320px] overflow-y-auto">
          {matches.length === 0 ? (
            <div className="text-ab-white/40 px-3 py-4 text-[11px]">
              Nothing here matches “{query}”. The palette lists the views this build
              has, and does not offer ones it does not.
            </div>
          ) : matches.map((view, i) => (
            <button
              key={view.id}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(view.id)}
              aria-label={`${view.label} — ${view.question}`}
              className={`flex justify-between items-center gap-4 text-left -mx-2 px-3 py-2 rounded transition-colors ${
                i === cursor ? 'bg-ab-green/10' : 'hover:bg-ab-green/5'
              }`}
            >
              <span className={`flex items-center gap-3 ${i === cursor ? 'text-ab-green' : 'text-ab-white/80'}`}>
                <Hash size={14} className="opacity-50 text-ab-green shrink-0" />
                {view.label}
              </span>
              <span className="text-ab-white/30 text-[10px] text-right">{view.question}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-ab-white/10 text-[9px] font-mono text-ab-white/30 flex gap-4">
          <span>↑↓ move</span>
          <span>↵ enter view</span>
          <span>1–7 operations, from anywhere</span>
        </div>
      </div>
    </div>
  );
}

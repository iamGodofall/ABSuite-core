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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, CornerDownLeft, ChevronUp, ChevronDown } from 'lucide-react';

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

  /*
   * Chevrons instead of a scrollbar.
   *
   * A scrollbar is a piece of browser furniture that reports a position nobody
   * asked about and looks like it belongs to a different application. What a
   * reader actually needs to know is simpler and binary: is there more above,
   * is there more below. So the bar is hidden and two chevrons answer exactly
   * those two questions — the up one sitting under the search field, the down
   * one under the list, each present only while it is true.
   */
  const listRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ above: false, below: false });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // A pixel of tolerance: sub-pixel layout otherwise leaves a chevron lit at
    // the very bottom of a list that has nothing more to show.
    setMore({
      above: el.scrollTop > 1,
      below: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  }, []);

  useEffect(() => { measure(); }, [measure, matches, isOpen]);

  /** Keep the cursor in view when the arrows walk past the visible edge. */
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
    measure();
  }, [cursor, measure]);

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
        /*
          * Wider, and rounded.
          *
          * At 540px the question column wrapped and the row scrolled sideways,
          * which is the one direction a list must never move. Widening is the
          * fix; a horizontal scrollbar is the symptom being nailed down.
          */
        className="w-[min(760px,92vw)] ab-panel !rounded-2xl border-ab-green/30 shadow-[0_0_50px_rgba(0,245,140,0.1)] flex flex-col"
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
            className="w-full bg-ab-bg border border-ab-green/20 rounded-full px-5 py-4 text-sm font-mono text-ab-white placeholder:text-ab-white/30 focus:outline-none focus:border-ab-green/60 shadow-inner transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
            <div className="w-5 h-5 border border-ab-white/10 rounded flex items-center justify-center text-ab-white/40">
              <CornerDownLeft size={11} />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2 h-4">
          <span className="text-[8px] font-mono text-ab-white/40 uppercase tracking-widest">
            {query ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : `${views.length} views`}
          </span>
          {more.above && (
            <ChevronUp size={14} className="text-ab-green/60" aria-hidden />
          )}
        </div>

        <div
          ref={listRef}
          onScroll={measure}
          className="flex flex-col gap-1 font-mono text-xs max-h-[340px] overflow-y-auto hidden-scrollbar overflow-x-hidden">
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
              className={`flex justify-between items-center gap-4 text-left w-full px-4 py-2.5 rounded-xl transition-colors ${
                i === cursor ? 'bg-ab-green/10' : 'hover:bg-ab-green/5'
              }`}
            >
              <span className={`flex items-center gap-3 shrink-0 ${i === cursor ? 'text-ab-green' : 'text-ab-white/80'}`}>
                <Hash size={14} className="opacity-50 text-ab-green shrink-0" />
                {view.label}
              </span>
              {/* min-w-0 lets this shrink; without it a flex child refuses to go
                  below its content width and pushes the whole row sideways. */}
              <span className="text-ab-white/30 text-[10px] text-right min-w-0 truncate">{view.question}</span>
            </button>
          ))}
        </div>

        <div className="h-4 flex items-center justify-center">
          {more.below && <ChevronDown size={14} className="text-ab-green/60" aria-hidden />}
        </div>

        <div className="mt-2 pt-3 border-t border-ab-white/10 text-[9px] font-mono text-ab-white/30 flex gap-4">
          <span>↑↓ move</span>
          <span>↵ enter view</span>
          <span>1–7 operations, from anywhere</span>
        </div>
      </div>
    </div>
  );
}

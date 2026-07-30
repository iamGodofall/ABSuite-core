/**
 * The Trust Environment.
 *
 * The cockpit before this kept the anatomy of a dashboard — left panel, right
 * panel, bottom panel, top bar. Hide the cube and what remained was navigation,
 * metrics, an activity feed, search, status cards and a footer. The cube was a
 * king sitting in the middle of parliament. This makes the cube the government.
 *
 * Eight things changed:
 *
 *   1. The visual language is unchanged. Green demonstrated, amber unresolved.
 *   2. The cube is roughly half the screen instead of a fifth.
 *   3. The permanent panels are gone. One continuous space.
 *   4. The cube is the navigation. You manipulate it; you do not click menus.
 *   5. Entering a layer zooms into it. There are no page transitions.
 *   6. Every station leads with state. The explanation appears on hover.
 *   7. Records travel the loop as they arrive, so the flow is real traffic.
 *   8. Nothing is a card. The screen is one place.
 *
 * The gestures:
 *
 *   drag up      → Observe        push in  (wheel up)   → Arbitrate
 *   drag right   → Verify         pull out (wheel down) → Act
 *   drag down    → Explain        double click          → Learn
 *   drag left    → Govern         escape                → back to the centre
 *
 * Clicking a station still works, and must: a gesture-only interface is one
 * that cannot be operated by keyboard, and locking someone out of the evidence
 * because they cannot drag is not a trade this product gets to make.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrustCube, type Integrity } from '../components/TrustCube';
import { cn } from '../utils';

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

export interface Station {
  id: string;
  label: string;
  /** What it does. Secondary — revealed on hover, never leading. */
  purpose: string;
  layer?: number;
  state: Determination;
  /** State first: the headline figure, then up to two supporting counts. */
  headline?: string;
  detail?: string[];
}

/** Where each station stands, and which gesture reaches it. */
const RING: Record<string, { x: number; y: number; gesture: string }> = {
  observe:   { x: 50, y: 7,  gesture: 'drag up' },
  verify:    { x: 88, y: 32, gesture: 'drag right' },
  govern:    { x: 12, y: 32, gesture: 'drag left' },
  explain:   { x: 50, y: 87, gesture: 'drag down' },
  arbitrate: { x: 85, y: 71, gesture: 'push in' },
  act:       { x: 15, y: 71, gesture: 'pull out' },
  // Learn is reached by double-clicking the core, so its position is free of
  // the four directions. It stands clear of the cube's silhouette rather than
  // on top of it.
  learn:     { x: 82, y: 13, gesture: 'double click the core' },
};

/** The order a record travels. Observe first, Learn last. */
const FLOW = ['observe', 'verify', 'explain', 'govern', 'arbitrate', 'act', 'learn'] as const;

const TONE: Record<Determination, { text: string; line: string; rgb: string }> = {
  DEMONSTRATED: { text: 'text-[#00FF88]', line: 'rgba(0,255,136,0.45)',  rgb: '0,255,136' },
  FAILED:       { text: 'text-red-400',   line: 'rgba(239,68,68,0.55)',  rgb: '239,68,68' },
  UNKNOWN:      { text: 'text-amber-400', line: 'rgba(245,158,11,0.45)', rgb: '245,158,11' },
  ABSENT:       { text: 'text-text-muted', line: 'rgba(120,140,130,0.16)', rgb: '120,140,130' },
};

/* ── A station ─────────────────────────────────────────────────────────────
   State first. The label is small, the figure is large, and the sentence
   explaining the layer's purpose only appears when someone asks for it by
   hovering. Mission Control does not explain what fuel is. */

const StationMark = ({ station, at, active, dimmed, onEnter }: {
  station: Station;
  at: { x: number; y: number; gesture: string };
  active: boolean;
  dimmed: boolean;
  onEnter: () => void;
}) => {
  const tone = TONE[station.state];

  return (
    <motion.button
      type="button"
      onClick={onEnter}
      aria-label={`${station.label} — ${station.purpose}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: dimmed ? 0.2 : 1, scale: active ? 1.08 : 1 }}
      whileHover={{ scale: 1.1, opacity: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="absolute -translate-x-1/2 -translate-y-1/2 group focus:outline-none w-[132px]"
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
    >
      <span className="flex flex-col items-center gap-0.5">
        <span className={cn('text-[10px] font-mono uppercase tracking-[0.28em]', tone.text)}>
          {station.label}
        </span>

        {/* The state, leading. */}
        <span className={cn('text-2xl font-bold tabular-nums leading-none',
          station.headline ? 'text-text-primary' : 'text-text-muted/40')}>
          {station.headline ?? '—'}
        </span>

        {station.detail && station.detail.length > 0 && (
          <span className="flex flex-col items-center gap-0 mt-0.5">
            {station.detail.map(line => (
              <span key={line} className={cn('text-[9px] font-mono uppercase tracking-[0.1em]', tone.text)}>
                {line}
              </span>
            ))}
          </span>
        )}

        {/* Secondary, and only when asked for. */}
        <span className="text-[9px] text-text-muted/70 leading-tight text-center mt-1 h-0 overflow-hidden opacity-0 group-hover:h-auto group-hover:opacity-100 transition-opacity duration-200">
          {station.purpose}
          <span className="block text-[8px] font-mono uppercase tracking-[0.16em] text-[#00D9FF]/60 mt-0.5">
            {at.gesture}
          </span>
        </span>
      </span>
    </motion.button>
  );
};

export const Environment = ({
  stations, vitals, active, onEnter, onLeave,
  connected, integrity, arrivals, verifying,
  ask, children,
}: {
  stations: Station[];
  /** The line of state that leads everything. */
  vitals: { label: string; value: string; state: Determination }[];
  active: string | null;
  onEnter: (id: string) => void;
  onLeave: () => void;
  connected: boolean;
  integrity: Integrity;
  arrivals: { id: string; outcome?: string }[];
  verifying: boolean;
  ask: React.ReactNode;
  children?: React.ReactNode;
}) => {
  const entered = active !== null;
  const activeStation = stations.find(station => station.id === active) ?? null;
  const field = useRef<HTMLDivElement>(null);

  /* ── Gestures ────────────────────────────────────────────────────────── */

  const drag = useRef<{ x: number; y: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const commit = useCallback((id: string) => {
    if (stations.some(station => station.id === id)) onEnter(id);
  }, [onEnter, stations]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (entered) return;
    drag.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current || entered) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { setHint(null); return; }
    setHint(Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'verify' : 'govern')
      : (dy < 0 ? 'observe' : 'explain'));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag.current || entered) { drag.current = null; return; }
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    setHint(null);

    const THRESHOLD = 56;
    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;

    if (Math.abs(dx) > Math.abs(dy)) commit(dx > 0 ? 'verify' : 'govern');
    else commit(dy < 0 ? 'observe' : 'explain');
  };

  /** Push in and pull out. Wheel, because depth is the natural axis for it. */
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    let settled = 0;
    const onWheel = (event: WheelEvent) => {
      if (entered) return;
      event.preventDefault();
      const now = Date.now();
      if (now - settled < 700) return;
      if (Math.abs(event.deltaY) < 24) return;
      settled = now;
      commit(event.deltaY < 0 ? 'arbitrate' : 'act');
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [commit, entered]);

  /** Escape climbs. In a room, back is up. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && entered) onLeave(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [entered, onLeave]);

  /* ── Records travelling the loop ──────────────────────────────────────── */

  /**
   * One traveller per record that genuinely arrived, moving Observe → Learn.
   *
   * There is no idle circulation. When nothing is happening the lines are
   * still, because a loop that always flows would be reporting traffic that
   * does not exist — the animated form of a fabricated number, and the exact
   * thing the constitutional line at the foot of this screen forbids.
   */
  const [travellers, setTravellers] = useState<{ id: string; failed: boolean }[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = arrivals.filter(record => !seen.current.has(record.id));
    if (fresh.length === 0) return;
    for (const record of fresh) seen.current.add(record.id);
    setTravellers(current => [...current, ...fresh.map(r => ({ id: r.id, failed: r.outcome === 'failure' }))]);
    const timer = window.setTimeout(() => {
      setTravellers(current => current.filter(t => !fresh.some(r => r.id === t.id)));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [arrivals]);

  const ringStations = stations.filter(station => RING[station.id]);
  const others = stations.filter(station => !RING[station.id]);

  return (
    <div className="fixed inset-0 bg-[#05070A] text-text-primary overflow-hidden hex-field select-none">
      {/* ── State, leading. Not a status bar — a line of vitals. ────────── */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-6 px-6 py-3 flex-wrap pointer-events-none">
        <span className="leading-none">
          <span className="text-base font-bold text-[#FFFFFF] tracking-tight">ABSuite</span>
          <span className="block text-[8px] font-mono uppercase tracking-[0.26em] text-text-muted mt-0.5">
            Trust Operations Center
          </span>
        </span>

        <span className="flex items-center gap-5 flex-wrap">
          {vitals.map(vital => (
            <span key={vital.label} className="leading-none">
              <span className="block text-[8px] font-mono uppercase tracking-[0.2em] text-text-muted/70">
                {vital.label}
              </span>
              <span className={cn('block text-[13px] font-mono font-semibold tabular-nums mt-0.5',
                TONE[vital.state].text)}>
                {vital.value}
              </span>
            </span>
          ))}
        </span>

        <span className="ml-auto pointer-events-auto w-full sm:w-auto sm:min-w-[300px] lg:min-w-[380px]">
          {ask}
        </span>
      </div>

      {/* ── The field. One continuous space. ─────────────────────────────── */}
      <motion.div
        ref={field}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { drag.current = null; setHint(null); }}
        onDoubleClick={() => !entered && commit('learn')}
        animate={{
          scale: entered ? 2.9 : 1,
          opacity: entered ? 0.1 : 1,
          filter: entered ? 'blur(3px)' : 'blur(0px)',
        }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className={cn('absolute inset-x-0 top-16 bottom-10',
          entered ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing')}
      >
        {/* Connection lines: every station wired back to the centre, each
            carrying its own determination. */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {ringStations.map(station => {
            const at = RING[station.id]!;
            return (
              <motion.line
                key={station.id}
                x1={50} y1={50} x2={at.x} y2={at.y}
                stroke={TONE[station.state].line}
                strokeWidth={0.12}
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            );
          })}
        </svg>

        {/* Records travelling the seven stations, one mark per real arrival. */}
        <AnimatePresence>
          {travellers.map(traveller => (
            <motion.span
              key={traveller.id}
              className="absolute w-[7px] h-[7px] rounded-full pointer-events-none z-10"
              style={{
                background: traveller.failed ? 'hsl(0 84% 62%)' : 'hsl(153 100% 50%)',
                boxShadow: `0 0 12px ${traveller.failed ? 'rgba(239,68,68,0.9)' : 'rgba(0,255,136,0.9)'}`,
                marginLeft: -3.5, marginTop: -3.5,
              }}
              initial={{ left: '50%', top: '6%', opacity: 0 }}
              animate={{
                left: FLOW.map(id => `${RING[id]!.x}%`),
                top: FLOW.map(id => `${RING[id]!.y}%`),
                opacity: [0, 1, 1, 1, 1, 1, 0],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 6.4, ease: 'linear', times: [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1] }}
            />
          ))}
        </AnimatePresence>

        {/* Orbits. */}
        <div className="ops-ring absolute" style={{ width: '58%', height: '78%', top: '11%', left: '21%' }} />
        <div className="ops-ring reverse absolute" style={{ width: '80%', height: '104%', top: '-2%', left: '10%' }} />

        {/* The reactor core. Roughly half the field. */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <TrustCube
            connected={connected}
            integrity={integrity}
            arrivals={arrivals}
            verifying={verifying}
            variant="centre"
            size={340}
          />
        </div>

        {ringStations.map(station => (
          <StationMark
            key={station.id}
            station={station}
            at={RING[station.id]!}
            active={hint === station.id}
            dimmed={hint !== null && hint !== station.id}
            onEnter={() => commit(station.id)}
          />
        ))}
      </motion.div>

      {/* ── The standing views. A thin line of words, not a rail of cards. */}
      {!entered && (
        <div className="absolute bottom-9 inset-x-0 z-20 flex items-center justify-center gap-5 flex-wrap px-6">
          {others.map(station => (
            <button
              key={station.id}
              type="button"
              onClick={() => commit(station.id)}
              className="group flex items-baseline gap-1.5 focus:outline-none"
            >
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted/60 group-hover:text-text-primary transition-colors">
                {station.label}
              </span>
              {station.headline && (
                <span className={cn('text-[10px] font-mono tabular-nums', TONE[station.state].text)}>
                  {station.headline}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── The sentence the whole product is built around. ──────────────── */}
      <p className="absolute bottom-3 inset-x-0 z-20 text-center text-[9px] font-mono uppercase tracking-[0.18em] text-[#00FF88]/45 px-6 pointer-events-none">
        Nothing may look more complete, more certain, or more authoritative than it actually is.
      </p>

      {/* ── Descent. The layer arrives from inside the cube. ─────────────── */}
      <AnimatePresence>
        {entered && (
          <motion.section
            key={active}
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-30 flex flex-col"
          >
            <header className="flex items-baseline gap-3 px-8 pt-5 pb-4 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={onLeave}
                className="text-[10px] font-mono uppercase tracking-[0.24em] text-text-muted hover:text-[#00FF88] transition-colors"
              >
                ← the centre
              </button>
              <span className="text-text-muted/25">/</span>
              <h1 className={cn('text-2xl font-bold', activeStation && TONE[activeStation.state].text)}>
                {activeStation?.label}
              </h1>
              {activeStation?.headline && (
                <span className="text-lg font-mono tabular-nums text-text-primary">{activeStation.headline}</span>
              )}
              <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/40">
                esc to return
              </span>
            </header>

            <div className="flex-1 overflow-y-auto px-8 pb-8">{children}</div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Environment;

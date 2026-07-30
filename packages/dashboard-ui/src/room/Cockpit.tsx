/**
 * The room, laid out as the design draws it.
 *
 * A cockpit rather than a dashboard: the cube is still the navigation — the
 * seven layers stand around it and you enter one by clicking it — and the
 * panels down either side are instruments, not pages. You never travel to an
 * instrument. It is simply readable from where you already are, which is the
 * difference between a wall of gauges and a sidebar.
 *
 * The design's figures were illustrative — 12.5K observations, 9.8K actions, a
 * 124-item queue, record #88371. None of them survive here. Every count is what
 * this instance holds, which on a fresh install means single digits and several
 * empty panels. A mockup can afford 12.5K; the product this is an interface for
 * cannot, and the layout is worth building precisely because it still reads
 * well when the honest numbers are small.
 */
import React, { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, Shield, MessageSquare, Landmark, Scale, Zap, TrendingUp,
  Activity, HelpCircle, Users, BookOpen, Boxes, Hexagon,
} from 'lucide-react';
import { TrustCube, type Integrity } from '../components/TrustCube';
import { cn } from '../utils';
import type { Determination } from './panels';

export type { Determination };

export interface RoomNode {
  id: string;
  label: string;
  question: string;
  layer?: number;
  state: Determination;
  /** The live figure this layer reports, already formatted. */
  reading?: string;
}

/** Icon and one-line purpose per layer, as the design labels them. */
const LAYER_META: Record<string, { icon: React.ComponentType<{ className?: string }>; purpose: string }> = {
  observe:   { icon: Eye,           purpose: 'Capture every action' },
  verify:    { icon: Shield,        purpose: 'Prove integrity cryptographically' },
  explain:   { icon: MessageSquare, purpose: 'Make it understandable' },
  govern:    { icon: Landmark,      purpose: 'Enforce rules & policies' },
  arbitrate: { icon: Scale,         purpose: 'Resolve with evidence' },
  act:       { icon: Zap,           purpose: 'Execute with confidence' },
  learn:     { icon: TrendingUp,    purpose: 'Improve with every cycle' },
  evidence:  { icon: Boxes,         purpose: 'What is held' },
  agents:    { icon: Users,         purpose: 'Who has acted' },
  policies:  { icon: BookOpen,      purpose: 'Rules and obligations' },
  unknowns:  { icon: HelpCircle,    purpose: 'What cannot be shown' },
  system:    { icon: Activity,      purpose: 'The stack underneath' },
  settings:  { icon: Hexagon,       purpose: 'Keys and configuration' },
};

/**
 * Fixed positions, as a percentage of the field.
 *
 * Learn at the top, then clockwise, matching the design. Positions never
 * reflow: a room you can learn is one where things stay where you left them.
 */
const RING: Record<string, { x: number; y: number }> = {
  learn:     { x: 50, y: 6 },
  arbitrate: { x: 79, y: 22 },
  govern:    { x: 88, y: 50 },
  explain:   { x: 79, y: 72 },
  verify:    { x: 50, y: 84 },
  observe:   { x: 21, y: 72 },
  act:       { x: 12, y: 22 },
};

const TONE: Record<Determination, { line: string; text: string; glow: string }> = {
  DEMONSTRATED: { line: 'border-[#00FF88]/45', text: 'text-[#00FF88]', glow: '0 0 22px -4px rgba(0,255,136,0.55)' },
  FAILED:       { line: 'border-red-500/55',   text: 'text-red-400',   glow: '0 0 22px -4px rgba(239,68,68,0.6)' },
  UNKNOWN:      { line: 'border-amber-500/50', text: 'text-amber-400', glow: '0 0 22px -4px rgba(245,158,11,0.5)' },
  ABSENT:       { line: 'border-border',       text: 'text-text-muted', glow: 'none' },
};

const LayerNode = ({ node, position, onEnter, dimmed }: {
  node: RoomNode;
  position: { x: number; y: number };
  onEnter: () => void;
  dimmed: boolean;
}) => {
  const meta = LAYER_META[node.id] ?? { icon: Hexagon, purpose: node.question };
  const Icon = meta.icon;
  const tone = TONE[node.state];

  return (
    <motion.button
      type="button"
      onClick={onEnter}
      title={node.question}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: dimmed ? 0.28 : 1, scale: 1 }}
      whileHover={{ scale: 1.07, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 group focus:outline-none w-[124px]"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      <span className={cn('text-[11px] font-mono uppercase tracking-[0.16em]', tone.text)}>
        {node.label}
      </span>
      <span className="text-[10px] text-text-muted leading-tight text-center px-1">
        {meta.purpose}
      </span>

      <span className="relative">
        {/* Hexagon frame, as the design draws it. */}
        <span
          className={cn('flex items-center justify-center w-[58px] h-[58px] border bg-[#0D1117]/85 transition-colors group-hover:bg-[#0D1117]',
            tone.line)}
          style={{
            clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
            boxShadow: tone.glow,
          }}
        >
          <Icon className={cn('w-6 h-6', tone.text)} />
        </span>

        {/* The count badge. Absent when the layer has no figure to report — an
            empty badge would imply zero, which is a different claim. */}
        {node.reading && (
          <span className={cn('absolute -bottom-1 -right-2 px-1.5 py-0.5 rounded-md border bg-[#05070A] text-[10px] font-mono tabular-nums',
            tone.line, tone.text)}>
            {node.reading}
          </span>
        )}
      </span>
    </motion.button>
  );
};

export const Cockpit = ({
  nodes, active, onEnter, onLeave,
  connected, integrity, arrivals, verifying,
  left, right, bottom, top, footer, children,
}: {
  nodes: RoomNode[];
  active: string | null;
  onEnter: (id: string) => void;
  onLeave: () => void;
  connected: boolean;
  integrity: Integrity;
  arrivals: { id: string; outcome?: string }[];
  verifying: boolean;
  left: React.ReactNode;
  right: React.ReactNode;
  bottom: React.ReactNode;
  top: React.ReactNode;
  footer: React.ReactNode;
  children?: React.ReactNode;
}) => {
  const entered = active !== null;
  const activeNode = nodes.find(node => node.id === active) ?? null;
  const ringNodes = nodes.filter(node => RING[node.id]);
  const outerNodes = nodes.filter(node => !RING[node.id]);

  /** Escape climbs one level. In a room, back is up. */
  const onKey = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && entered) onLeave();
  }, [entered, onLeave]);

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#05070A] text-text-primary flex flex-col hex-field">
      {top}

      <main className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)_320px] gap-3 px-3 pb-2 pt-2">
        {/* ── Left instruments ──────────────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col gap-3 min-h-0 overflow-y-auto pr-0.5">{left}</aside>

        {/* ── The room ──────────────────────────────────────────────────── */}
        <section className="relative min-h-0 flex flex-col gap-3">
          <div className="relative flex-1 min-h-0 pb-2">
            <motion.div
              className="absolute inset-0"
              animate={{ opacity: entered ? 0.28 : 1, scale: entered ? 0.94 : 1 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              style={{ pointerEvents: entered ? 'none' : 'auto' }}
            >
              {/* Orbits — structure, not activity. */}
              <div className="ops-ring absolute" style={{ width: '52%', height: '66%', top: '17%', left: '24%' }} />
              <div className="ops-ring reverse absolute" style={{ width: '74%', height: '92%', top: '4%', left: '13%' }} />

              {/* The centre. Clicking it returns you to the room. */}
              <button
                type="button"
                onClick={onLeave}
                aria-label="Return to the room"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 focus:outline-none"
              >
                <TrustCube
                  connected={connected}
                  integrity={integrity}
                  arrivals={arrivals}
                  verifying={verifying}
                  variant="centre"
                  size={168}
                />
              </button>

              {ringNodes.map(node => (
                <LayerNode
                  key={node.id}
                  node={node}
                  position={RING[node.id]!}
                  onEnter={() => onEnter(node.id)}
                  dimmed={entered && node.id !== active}
                />
              ))}
            </motion.div>
          </div>

          {/* The standing views: a rail, not a nav list — they are the things
              the layers act on, always visible rather than travelled to. */}
          <div className="flex items-center justify-center gap-2 flex-wrap shrink-0">
            {outerNodes.map(node => {
              const tone = TONE[node.state];
              const Icon = (LAYER_META[node.id] ?? { icon: Hexagon }).icon;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onEnter(node.id)}
                  title={node.question}
                  className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-[#0D1117]/70 hover:bg-[#0D1117] transition-colors',
                    tone.line, active === node.id && 'ring-1 ring-[#00FF88]/40')}
                >
                  <Icon className={cn('w-3.5 h-3.5', tone.text)} />
                  <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-secondary">
                    {node.label}
                  </span>
                  {node.reading && (
                    <span className={cn('text-[10px] font-mono tabular-nums', tone.text)}>{node.reading}</span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-center text-[10px] font-mono text-text-muted/50 shrink-0">
            click a layer to enter · esc to climb · the cube returns you here
          </p>

          <div className="shrink-0">{bottom}</div>
        </section>

        {/* ── Right instruments ─────────────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col gap-3 min-h-0 overflow-y-auto pl-0.5">{right}</aside>
      </main>

      {footer}

      {/* ── The descent ───────────────────────────────────────────────────
          Opens over the room rather than replacing it, so the room you came
          from is still visible behind. */}
      <AnimatePresence>
        {entered && (
          <motion.section
            key={active}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-16 bottom-8 left-1/2 -translate-x-1/2 w-[min(96vw,1400px)] z-30 rounded-2xl border border-[#00FF88]/20 bg-[#05070A]/97 backdrop-blur-xl flex flex-col overflow-hidden"
          >
            <header className="flex items-baseline gap-3 px-6 py-4 border-b border-[#00FF88]/12 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={onLeave}
                className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted hover:text-[#00FF88] transition-colors"
              >
                ← room
              </button>
              <span className="text-text-muted/30">/</span>
              <h1 className="text-lg font-bold text-text-primary">{activeNode?.label}</h1>
              <p className="text-xs text-text-muted">{activeNode?.question}</p>
              <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted/40">
                esc to climb
              </span>
            </header>

            {/* The only scrolling in the product: inside a thing you entered,
                never the way you move between things. */}
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Cockpit;

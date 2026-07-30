/**
 * The room.
 *
 * This replaces a sidebar, a page router and a scrolling column of cards. Those
 * four things are document navigation, and document navigation is what made
 * every previous version of this interface a dashboard no matter what was drawn
 * inside it. A cube in a dashboard is a dashboard with a cube in it.
 *
 * The model here is spatial. You do not move between pages — you descend:
 *
 *     room  →  layer  →  record
 *
 * At room depth the cube is the centre and the seven layers stand around it,
 * each carrying its own live determination. Entering a layer does not replace
 * the screen: the cube travels to the corner and stays, the ring stays legible,
 * and the layer opens in the space that is left. You can always see where you
 * are because you can still see the room you are standing in.
 *
 * Position is the argument. A 34px cube in a corner beside a wordmark is a logo
 * whatever a comment claims about it; a cube at the centre that you turn to
 * navigate is infrastructure. The difference is not styling — it is whether the
 * thing does any work.
 *
 * Nothing here invents. A node's colour is that layer's real determination, and
 * a layer with nothing to report renders dim rather than green.
 */
import React, { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrustCube, type Integrity } from '../components/TrustCube';
import { cn } from '../utils';

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

export interface RoomNode {
  id: string;
  label: string;
  question: string;
  /** 1–7 for the stack. Undefined for the standing views. */
  layer?: number;
  state: Determination;
  /** The live figure this node is reporting, if it has one. */
  reading?: string;
}

const NODE_TONE: Record<Determination, { ring: string; text: string; glow: string }> = {
  DEMONSTRATED: { ring: 'border-[#00FF88]/45', text: 'text-[#00FF88]', glow: 'shadow-[0_0_24px_-6px_rgba(0,255,136,0.5)]' },
  FAILED: { ring: 'border-red-500/55', text: 'text-red-400', glow: 'shadow-[0_0_24px_-6px_rgba(239,68,68,0.55)]' },
  UNKNOWN: { ring: 'border-amber-500/50', text: 'text-amber-400', glow: 'shadow-[0_0_24px_-6px_rgba(245,158,11,0.45)]' },
  ABSENT: { ring: 'border-border', text: 'text-text-muted', glow: '' },
};

/**
 * Where each node sits, as a fraction of the field.
 *
 * Laid out to match the arrangement in the philosophy: Learn at the top, then
 * clockwise, with Observe and Govern on the horizon line either side of the
 * cube. It is a room, so the positions are fixed — you learn where things are
 * and they stay there. A layout that reflows on every render is a page.
 */
const RING: Record<string, { x: number; y: number }> = {
  learn:     { x: 50, y: 8 },
  arbitrate: { x: 82, y: 26 },
  govern:    { x: 92, y: 52 },
  explain:   { x: 78, y: 79 },
  verify:    { x: 50, y: 92 },
  observe:   { x: 22, y: 79 },
  act:       { x: 8,  y: 52 },
};

/** The standing views orbit further out — the things the stages act on. */
const OUTER: Record<string, { x: number; y: number }> = {
  evidence: { x: 18, y: 26 },
  agents:   { x: 33, y: 12 },
  policies: { x: 67, y: 12 },
  unknowns: { x: 88, y: 88 },
  system:   { x: 12, y: 88 },
  settings: { x: 92, y: 8 },
};

const Node = ({ node, position, onEnter, dimmed, compact }: {
  node: RoomNode;
  position: { x: number; y: number };
  onEnter: () => void;
  dimmed: boolean;
  compact: boolean;
}) => {
  const tone = NODE_TONE[node.state];

  return (
    <motion.button
      type="button"
      onClick={onEnter}
      title={node.question}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: dimmed ? 0.32 : 1, scale: 1 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      whileHover={{ scale: 1.06, opacity: 1 }}
      className="absolute -translate-x-1/2 -translate-y-1/2 group focus:outline-none"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      <span
        className={cn(
          'flex flex-col items-center justify-center rounded-2xl border bg-bg-secondary/70 backdrop-blur-sm transition-colors',
          tone.ring, tone.glow,
          compact ? 'w-[86px] h-[54px] px-2' : 'w-[122px] h-[74px] px-3',
          'group-hover:bg-bg-secondary'
        )}
      >
        <span className={cn('font-mono uppercase tracking-[0.18em]',
          compact ? 'text-[8px]' : 'text-[9px]', tone.text)}>
          {node.layer !== undefined ? `${node.layer} · ` : ''}{node.label}
        </span>
        {node.reading && (
          <span className={cn('font-bold tabular-nums mt-0.5 text-text-primary',
            compact ? 'text-xs' : 'text-base')}>
            {node.reading}
          </span>
        )}
      </span>
    </motion.button>
  );
};

export const Room = ({
  nodes,
  active,
  onEnter,
  onLeave,
  connected,
  integrity,
  arrivals,
  verifying,
  children,
}: {
  nodes: RoomNode[];
  /** The node currently entered, or null when standing in the room. */
  active: string | null;
  onEnter: (id: string) => void;
  onLeave: () => void;
  connected: boolean;
  integrity: Integrity;
  arrivals: { id: string; outcome?: string }[];
  verifying: boolean;
  /** The entered layer's own surface. */
  children?: React.ReactNode;
}) => {
  const entered = active !== null;
  const activeNode = nodes.find(node => node.id === active) ?? null;

  /** Escape climbs one level. In a room, back is up. */
  const onKey = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && entered) onLeave();
  }, [entered, onLeave]);

  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  const positionOf = (node: RoomNode) =>
    RING[node.id] ?? OUTER[node.id] ?? { x: 50, y: 50 };

  return (
    <div className="relative w-full h-full overflow-hidden dot-grid-bg">
      {/* ── The field. Fixed positions, so the room stays learnable. ─────── */}
      <motion.div
        className="absolute inset-0"
        animate={{
          scale: entered ? 0.42 : 1,
          x: entered ? '-31%' : 0,
          y: entered ? '-31%' : 0,
          opacity: entered ? 0.5 : 1,
        }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        style={{ pointerEvents: entered ? 'none' : 'auto' }}
      >
        {/* Rings — structure, not activity. */}
        <div className="ops-ring absolute" style={{ width: '46%', height: '62%', top: '19%', left: '27%' }} />
        <div className="ops-ring reverse absolute" style={{ width: '66%', height: '84%', top: '8%', left: '17%' }} />

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
            size={196}
          />
        </button>

        <div className="absolute left-1/2 top-[calc(50%+165px)] -translate-x-1/2 text-center pointer-events-none">
          <div className="text-[9px] font-mono uppercase tracking-[0.4em] text-[#00D9FF]/70">
            Trust Operations Center
          </div>
          <div className="text-2xl font-bold text-[#FFFFFF] mt-1">ABSuite</div>
          <div className="text-[10px] text-text-muted italic mt-0.5">The Future Is Accountable.</div>
        </div>

        {nodes.map(node => (
          <Node
            key={node.id}
            node={node}
            position={positionOf(node)}
            onEnter={() => onEnter(node.id)}
            dimmed={entered && node.id !== active}
            compact={Boolean(OUTER[node.id])}
          />
        ))}
      </motion.div>

      {/* ── The descent. Opens in the space the room leaves. ─────────────── */}
      <AnimatePresence>
        {entered && (
          <motion.section
            key={active}
            initial={{ opacity: 0, scale: 0.97, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-14 bottom-0 right-0 w-full lg:w-[68%] xl:w-[72%] bg-bg-primary/94 backdrop-blur-md border-l border-t border-border flex flex-col"
          >
            <header className="flex items-baseline gap-3 px-7 py-5 border-b border-border shrink-0 flex-wrap">
              <button
                type="button"
                onClick={onLeave}
                className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted hover:text-[#00FF88] transition-colors"
              >
                ← room
              </button>
              <span className="text-text-muted/40">/</span>
              <h1 className="text-xl font-bold text-text-primary">{activeNode?.label}</h1>
              <p className="text-xs text-text-muted">{activeNode?.question}</p>
              <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/50">
                esc to climb
              </span>
            </header>

            {/* The one place scrolling is allowed: inside a thing you entered,
                never as the way you move between things. */}
            <div className="flex-1 overflow-y-auto px-7 py-6">
              {children}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Room;

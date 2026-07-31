/**
 * The seven, positioned over the scene.
 *
 * Two departures from the supplied version, both of them repairs.
 *
 * The figures were inline — metric: '482', metric: 'INTACT', metric:
 * '12 QUEUED' — invented values in a config array. Every one is now passed in
 * from what the instance actually holds, and a layer with nothing to report
 * shows nothing rather than a placeholder. An empty badge would imply zero,
 * which is a different claim from "not measured".
 *
 * The labels were placed by a per-layer ladder of hardcoded percentages —
 * top: verify||explain ? '20%' : govern ? '140%' : ..., left: ... ? '-150%'
 * — with no branch at all for Arbitrate, so its label fell back to `auto` and
 * landed on top of its own badge. Act collided the same way. That ladder is
 * gone. Each node declares which side of the ring it sits on, and the label
 * takes the outward side by flex direction, so nothing can overlap and a new
 * node cannot land on an unhandled branch.
 */
import { Eye, Shield, MessageSquare, Scale, Gavel, Zap, Brain } from 'lucide-react';
import type { TrustLayer } from './SceneCube';

/** What a layer reports, or nothing at all. */
export interface LayerReading {
  metric?: string;
  state: 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';
}

interface OrbitalNodesProps {
  activeLayer: TrustLayer;
  /** Where a drag has walked attention to. Entering it is one release away. */
  focusedLayer?: TrustLayer;
  onSelectLayer: (layer: TrustLayer) => void;
  readings: Record<string, LayerReading | undefined>;
}

/** Which way the label faces: outward from the centre of the ring. */
type Side = 'top' | 'right' | 'bottom' | 'left';

const LAYERS = [
  { id: 'observe',   label: 'OBSERVE',   num: '1', desc: 'Capture every action',              icon: Eye,           top: '12%', left: '50%', side: 'top'    },
  { id: 'verify',    label: 'VERIFY',    num: '2', desc: 'Prove integrity cryptographically', icon: Shield,        top: '26%', left: '80%', side: 'right'  },
  { id: 'explain',   label: 'EXPLAIN',   num: '3', desc: 'Make it understandable',            icon: MessageSquare, top: '58%', left: '87%', side: 'right'  },
  { id: 'govern',    label: 'GOVERN',    num: '4', desc: 'Enforce rules & protect integrity', icon: Scale,         top: '82%', left: '67%', side: 'bottom' },
  { id: 'arbitrate', label: 'ARBITRATE', num: '5', desc: 'Resolve with evidence',             icon: Gavel,         top: '82%', left: '33%', side: 'bottom' },
  { id: 'act',       label: 'ACT',       num: '6', desc: 'Execute with confidence',           icon: Zap,           top: '58%', left: '13%', side: 'left'   },
  { id: 'learn',     label: 'LEARN',     num: '7', desc: 'Improve with every cycle',          icon: Brain,         top: '26%', left: '20%', side: 'left'   },
] as const satisfies readonly { side: Side; [k: string]: unknown }[];

/** Determination decides the colour. Nothing else does. */
const STATE_COLOUR = {
  DEMONSTRATED: '#00F58C',
  FAILED: '#EF4444',
  UNKNOWN: '#F59E0B',
  ABSENT: '#6B7280',
} as const;

/** The label sits on the outward side; the hexagon keeps the ring. */
const ORIENT: Record<Side, string> = {
  top: 'flex-col-reverse',
  bottom: 'flex-col',
  left: 'flex-row-reverse',
  right: 'flex-row',
};

const ALIGN: Record<Side, string> = {
  top: 'text-center items-center',
  bottom: 'text-center items-center',
  left: 'text-right items-end',
  right: 'text-left items-start',
};

/**
 * The character motion each layer earns while it is demonstrating.
 *
 * Defined in globals.css and declared in check-motion-is-evidence. Applied
 * only on DEMONSTRATED — see the note there for why these were previously
 * inert.
 */
const LIVE_MOTION: Record<string, string> = {
  observe: 'node-live-observe',
  verify: 'node-live-verify',
  explain: 'node-live-explain',
  govern: '', // Governance holds still. A constraint that moves is not a constraint.
  arbitrate: 'node-live-arbitrate',
  act: 'node-live-act',
  learn: 'node-live-learn',
};

const hexagonClipPath = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

export function OrbitalNodes({ activeLayer, focusedLayer, onSelectLayer, readings }: OrbitalNodesProps) {
  // A record in transit requires records. When Observe is not demonstrating,
  // nothing is travelling the ring, so nothing is drawn travelling it.
  const evidenceMoving = readings.observe?.state === 'DEMONSTRATED';

  return (
    <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
      <div className="absolute inset-0">
        {evidenceMoving && (
          <div
            className="absolute w-2 h-2 rounded-full bg-ab-white z-50 pointer-events-none -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_#00F58C,0_0_20px_#00F58C]"
            style={{ animation: 'evidence-travel 10s linear infinite' }}
          />
        )}

        {LAYERS.map((layer) => {
          const reading = readings[layer.id];
          const state = reading?.state ?? 'UNKNOWN';
          const hex = STATE_COLOUR[state];

          // The state decides both the colour and whether anything moves.
          const motion =
            state === 'DEMONSTRATED' ? LIVE_MOTION[layer.id] ?? ''
            : state === 'UNKNOWN' ? 'node-unknown'
            : state === 'FAILED' ? 'node-failed'
            : 'node-absent';

          const isActive = activeLayer === layer.id;
          const isFocused = focusedLayer === layer.id;

          return (
            <div
              key={layer.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-pointer group"
              style={{ top: layer.top, left: layer.left }}
              onClick={() => onSelectLayer(layer.id as TrustLayer)}
              role="button"
              tabIndex={0}
              aria-label={`${layer.label} — ${reading?.metric ?? 'not measured'}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectLayer(layer.id as TrustLayer);
                }
              }}
            >
              <div className={`flex items-center gap-3 ${ORIENT[layer.side]}`}>
                {/* Node hexagon */}
                <div
                  className={`relative shrink-0 flex items-center justify-center w-16 h-16 transition-transform duration-300 group-hover:scale-110 ${motion} ${
                    isFocused ? 'scale-110' : ''
                  }`}
                  style={{
                    filter: isFocused
                      ? `drop-shadow(0 0 22px ${hex}) drop-shadow(0 0 8px ${hex})`
                      : `drop-shadow(0 0 10px ${hex}60)`,
                  }}
                >
                  {/* Where a drag has landed. Release enters this station. */}
                  {isFocused && (
                    <div
                      className="absolute -inset-3 rounded-full border transition-opacity duration-200"
                      style={{ borderColor: `${hex}66` }}
                    />
                  )}
                  {/* Outer glow */}
                  <div
                    className="absolute inset-0 backdrop-blur-sm"
                    style={{ clipPath: hexagonClipPath, background: `${hex}1A`, boxShadow: `inset 0 0 10px ${hex}33` }}
                  />
                  {/* 2px solid border, drawn as a filled hexagon with the ground inset */}
                  <div className="absolute inset-0" style={{ clipPath: hexagonClipPath, background: hex }}>
                    <div className="absolute inset-[2px] bg-ab-bg" style={{ clipPath: hexagonClipPath }} />
                  </div>
                  {/* Inner translucent fill */}
                  <div className="absolute inset-[3px] bg-white/5" style={{ clipPath: hexagonClipPath }} />

                  <layer.icon
                    size={22}
                    className="relative z-10 drop-shadow-[0_0_5px_currentColor]"
                    style={{ color: hex }}
                  />
                </div>

                {/*
                  * Identity, then state, then purpose.
                  *
                  * The reading comes before the sentence explaining what the
                  * layer is for. Mission Control leads with the number.
                  */}
                <div className={`flex flex-col w-36 pointer-events-none ${ALIGN[layer.side]}`}>
                  <div
                    className={`font-mono text-[11px] tracking-[0.2em] transition-colors ${
                      isActive ? 'text-ab-white' : 'text-ab-white/80'
                    } group-hover:text-ab-white`}
                  >
                    <span style={{ color: hex }}>{layer.num} •</span> {layer.label}
                  </div>

                  {reading?.metric && (
                    <div
                      className="mt-1.5 font-mono text-[9px] px-3 py-1 border bg-ab-bg/80 rounded-full tracking-widest whitespace-nowrap"
                      style={{ borderColor: hex, color: hex, boxShadow: `0 0 20px ${hex}4D` }}
                    >
                      {reading.metric}
                    </div>
                  )}

                  <div className="text-[9px] text-ab-white/50 mt-1.5 leading-snug">{layer.desc}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

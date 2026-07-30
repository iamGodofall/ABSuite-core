/**
 * Everything connects back to the cube.
 *
 * One line per layer, drawn from that layer's node to the centre. The line
 * carries the layer's own determination, so the picture of the system is the
 * state of the system: green where something is demonstrated, red where it
 * failed, amber where it is unresolved, dim where nothing was recorded.
 *
 * The lines draw themselves in on mount and whenever a determination changes,
 * which is the only thing that makes them move. They do not loop. A connector
 * that pulses forever says "activity" when there is none.
 */
import { motion } from 'framer-motion';

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

const STROKE: Record<Determination, string> = {
  DEMONSTRATED: 'hsl(153 100% 50% / 0.5)',
  FAILED: 'hsl(0 84% 62% / 0.6)',
  UNKNOWN: 'hsl(38 92% 55% / 0.5)',
  ABSENT: 'hsl(160 10% 60% / 0.18)',
};

export const CubeConnections = ({ nodes, radius = 168 }: {
  nodes: { name: string; state: Determination }[];
  radius?: number;
}) => {
  if (nodes.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="-250 -250 500 500"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {nodes.map((node, index) => {
        // Evenly spaced, starting at the top so Observe reads first.
        const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;

        return (
          <g key={node.name}>
            <motion.line
              x1={0} y1={0} x2={x} y2={y}
              stroke={STROKE[node.state]}
              strokeWidth={1}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.25 + index * 0.09, duration: 0.7, ease: 'easeOut' }}
            />
            <motion.circle
              cx={x} cy={y} r={3.2}
              fill={STROKE[node.state]}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.6 + index * 0.09, duration: 0.35 }}
            />
            <motion.text
              x={x * 1.16} y={y * 1.16 + 3}
              textAnchor="middle"
              className="text-[9px] font-mono uppercase"
              fill="hsl(160 12% 62% / 0.75)"
              style={{ letterSpacing: '0.14em' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75 + index * 0.09, duration: 0.4 }}
            >
              {node.name}
            </motion.text>
          </g>
        );
      })}
    </svg>
  );
};

export default CubeConnections;

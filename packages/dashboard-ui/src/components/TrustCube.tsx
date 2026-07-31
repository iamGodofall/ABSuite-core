/**
 * The cube. Not a logo — the visual representation of trust, and now part of
 * the shell rather than one tab.
 *
 * It was previously rendered inside the Operations view, which meant the
 * document's centerpiece section ("the cube is always present") was true of one
 * screen out of thirteen. It lives here now and the shell mounts it on every
 * view, small in the sidebar and large in the middle of Operations.
 *
 * Every motion it makes is caused by something that actually happened:
 *
 *   Rotation      — the cube does not spin. At rest it drifts at roughly 0.05
 *                   degrees per second, which is a full turn every two hours
 *                   and is not perceptible as motion — it reads as a satellite
 *                   holding station. It *orients*: when a record arrives or a
 *                   station is attended, it turns to face that station and
 *                   stops there. Movement means something happened. If nothing
 *                   happened, nothing moves.
 *   Face colour   — the chain's integrity, in the four-state language. Green is
 *                   verified intact, red is a broken link, amber is not
 *                   checked, dim is nothing recorded yet.
 *   Sweep         — drawn only while a chain-verification request is actually
 *                   in flight. It disappears the moment the response lands, so
 *                   its duration is the real cost of verifying, not a fixed
 *                   animation someone chose to look reassuring.
 *   Particles     — one per record that actually arrived, converging once and
 *                   then gone. A particle is a record. There is no ambient
 *                   particle field, because a particle with nothing behind it
 *                   is decoration wearing the costume of information.
 *
 * The approach angle of each particle is derived from the record's own id, so
 * the same record always converges from the same direction and nothing here
 * depends on randomness. (`check-no-fabrication` bans `Math.random` outright,
 * which is what surfaced this as a design question rather than a shortcut.)
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../utils';

export type Integrity = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

interface Particle { id: string; angle: number; failed: boolean }

/** A stable angle for a record, from its id. Same record, same approach. */
const angleFor = (id: string): number => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
};

const FACE_TONE: Record<Integrity, string> = {
  DEMONSTRATED: 'cube-intact',
  FAILED: 'cube-broken',
  UNKNOWN: 'cube-unchecked',
  ABSENT: 'cube-empty',
};

/**
 * Where the cube looks when it is attending to a station.
 *
 * Not arbitrary: each is the face that station's evidence would enter through,
 * and Verify is square-on because verification is the one act that requires the
 * thing to hold still while it is inspected.
 */
const FACING: Record<string, { x: number; y: number }> = {
  observe:   { x: -26, y: 0 },
  verify:    { x: 0,   y: 0 },
  explain:   { x: 26,  y: 0 },
  govern:    { x: 0,   y: -40 },
  arbitrate: { x: 14,  y: 40 },
  act:       { x: -14, y: -40 },
  learn:     { x: -20, y: 34 },
};

export const TrustCube = ({
  connected,
  integrity,
  arrivals = [],
  verifying = false,
  orientTo = null,
  variant = 'ambient',
  size,
}: {
  connected: boolean;
  integrity: Integrity;
  /** True only while a verification request is genuinely outstanding. */
  verifying?: boolean;
  /**
   * The station the cube should face, or null to hold its last orientation.
   *
   * Null does not mean "return to centre". A cube that snapped back whenever
   * attention lapsed would be moving because nothing happened, which is the one
   * thing this component must never do.
   */
  orientTo?: string | null;
  /** Ids of records that genuinely arrived, newest first. */
  arrivals?: { id: string; outcome?: string }[];
  variant?: 'ambient' | 'centre';
  size?: number;
}) => {
  const edge = size ?? (variant === 'centre' ? 130 : 34);
  const half = edge / 2;

  const [particles, setParticles] = useState<Particle[]>([]);
  const seen = useRef<Set<string>>(new Set());

  /**
   * The orientation the cube holds.
   *
   * It changes only when something asks it to — a station attended, a record
   * arriving. Between those it does not return, reset or wander. Holding a
   * position is itself a report: the last thing that happened is still the last
   * thing that happened.
   */
  const [facing, setFacing] = useState({ x: -22, y: 0 });
  useEffect(() => {
    if (!orientTo) return;
    const target = FACING[orientTo];
    if (target) setFacing(target);
  }, [orientTo]);

  // A record arriving turns the cube toward Observe, because that is where
  // evidence enters. Nothing else about the cube moves on its own.
  useEffect(() => {
    if (arrivals.some(record => !seen.current.has(record.id))) {
      setFacing(FACING.observe!);
    }
  }, [arrivals]);

  /**
   * Spawn one particle per record the shell has not already drawn.
   *
   * The ref matters: without it a re-render for any other reason would replay
   * the whole arrival list, and the cube would appear to receive traffic that
   * had not happened. Motion that repeats without a cause is the animated form
   * of a fabricated number.
   */
  useEffect(() => {
    const fresh = arrivals.filter(record => !seen.current.has(record.id));
    if (fresh.length === 0) return;

    for (const record of fresh) seen.current.add(record.id);

    setParticles(current => [
      ...current,
      ...fresh.map(record => ({
        id: record.id,
        angle: angleFor(record.id),
        failed: record.outcome === 'failure',
      })),
    ]);

    const timer = window.setTimeout(() => {
      setParticles(current => current.filter(particle => !fresh.some(record => record.id === particle.id)));
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [arrivals]);

  return (
    <div
      className={cn('trust-cube-scene relative shrink-0', variant === 'centre' && 'trust-cube-centre')}
      style={{ width: edge, height: edge }}
      aria-hidden="true"
    >
      {/* Outer: the resting drift. 0.05 degrees per second — a full turn every
          two hours, below the threshold of perceived motion. Paused entirely
          when the socket is down, because a disconnected system is not
          observing and must not look as though it is. */}
      <div
        className={cn('trust-cube-drift', !connected && 'is-still')}
        style={{ width: edge, height: edge }}
      >
        {/* Inner: the orientation, which changes only on an event. */}
        <div
          className={cn('trust-cube', FACE_TONE[integrity])}
          style={{
            width: edge,
            height: edge,
            transform: `rotateX(${facing.x}deg) rotateY(${facing.y}deg)`,
          }}
        >
          {[
          `translateZ(${half}px)`,
          `rotateY(180deg) translateZ(${half}px)`,
          `rotateY(90deg) translateZ(${half}px)`,
          `rotateY(-90deg) translateZ(${half}px)`,
          `rotateX(90deg) translateZ(${half}px)`,
          `rotateX(-90deg) translateZ(${half}px)`,
        ].map(transform => (
            <div key={transform} className="trust-cube-face" style={{ transform }} />
          ))}
        </div>
      </div>

      {/* Present exactly as long as the request is. */}
      {verifying && <span className="trust-sweep" />}

      {/* One mark per record that arrived. Each converges once, then is gone. */}
      {particles.map(particle => (
        <span
          key={particle.id}
          className={cn('trust-particle', particle.failed && 'is-failure')}
          style={{ ['--approach' as string]: `${particle.angle}deg` }}
        />
      ))}
    </div>
  );
};

export default TrustCube;

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
 *   Rotation      — turns only while the socket is connected. A dead connection
 *                   reads as stillness, not as a stale figure.
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

export const TrustCube = ({
  connected,
  integrity,
  arrivals = [],
  verifying = false,
  variant = 'ambient',
  size,
}: {
  connected: boolean;
  integrity: Integrity;
  /** True only while a verification request is genuinely outstanding. */
  verifying?: boolean;
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
      <div
        className={cn('trust-cube', FACE_TONE[integrity], !connected && 'is-still')}
        style={{ width: edge, height: edge }}
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

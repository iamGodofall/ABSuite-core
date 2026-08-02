/**
 * The masthead, as supplied.
 *
 * This file was deleted on the first port and replaced with a vitals row of my
 * own — which is the single clearest example of the thing that kept going
 * wrong: the supplied package was treated as a parts bin rather than as the
 * design. The layout here is the supplied one, restored: the brand block, the
 * live badge, and five metric columns at the right with their icons, their
 * spacing and their type.
 *
 * What is not restored is the supplied *values*. The original read
 * `6/6 RESPONDING`, `INTACT`, `482 (+18m)` and `NO VIOLATIONS` as literals in
 * the markup — a masthead that reports perfect health on a machine it has
 * never contacted. Every column now takes what the instance actually holds,
 * and a column with nothing behind it says so. That is the one thing in this
 * product that cannot be adopted from anywhere, because it is the product.
 */
import { Clock, ShieldCheck, Database, Star, Network } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Mark } from './Mark';

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

export interface Vital {
  label: string;
  value: string;
  tone: Determination;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}

const TONE: Record<Determination, string> = {
  DEMONSTRATED: 'text-ab-green',
  FAILED: 'text-ab-red',
  UNKNOWN: 'text-ab-amber',
  ABSENT: 'text-ab-gray',
};

export function TopBar({ connected, vitals }: { connected: boolean; vitals: Vital[] }) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="absolute top-0 inset-x-0 h-20 flex items-center justify-between px-8 z-20 pointer-events-none bg-gradient-to-b from-[#000000] to-transparent border-b border-ab-green/5 shadow-[0_4px_30px_rgba(0,245,140,0.03)]">

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          {/*
            The mark, unboxed.
            It sat inside a bordered square with a tinted fill — a container the
            mark never needed and the only hard-cornered element left in a shell
            that is otherwise all capsules and generous radii. A logo that has to
            be framed to read is a logo that is not carrying itself.
          */}
          <div className="w-10 h-10 flex items-center justify-center">
            <Mark size={28} />
          </div>
          <div>
            <h1 className="text-ab-white font-bold tracking-widest text-lg leading-none mb-1">ABSuite</h1>
            <p className="text-ab-white/50 text-[9px] font-mono uppercase tracking-[0.2em] leading-none">
              Trust Operations Center
            </p>
          </div>
        </div>

        {/*
          * The badge reports the socket, and only the socket.
          *
          * The supplied version was a permanent LIVE with a permanent pulse.
          * A connection indicator that cannot say "offline" is not an
          * indicator, and the pulse is a claim that traffic is arriving.
          */}
        <div
          className={`ml-2 px-3 py-1.5 border rounded-full flex items-center gap-2 backdrop-blur-md ${
            connected ? 'border-ab-green/20 bg-ab-green/5' : 'border-ab-red/25 bg-ab-red/5'
          }`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? 'bg-ab-green shadow-[0_0_8px_#00F58C] live-pulse' : 'bg-ab-red'
            }`}
          />
          <span className="text-[9px] font-mono text-ab-white/70 uppercase tracking-widest">
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {/*
          * docs/UI-PHILOSOPHY.md § Header requires this line. Set beside the
          * badge rather than under the wordmark, so the identity block keeps
          * the supplied two-line proportion.
          */}
        <span className="hidden 2xl:block text-[9px] font-mono uppercase tracking-[0.28em] text-ab-green/40">
          The Future Is Accountable.
        </span>
      </div>

      <div className="hidden xl:flex gap-12 text-[9px] font-mono tracking-widest uppercase">
        <div className="flex flex-col items-start gap-1">
          <span className="text-ab-white/40 flex items-center gap-1.5">
            <Clock size={10} className="text-ab-white/30" /> System clock
          </span>
          <span className="text-ab-white">{time.toISOString().split('T')[1].split('.')[0]} UTC</span>
        </div>

        {vitals.map(vital => (
          <div key={vital.label} className="flex flex-col items-start gap-1">
            <span className="text-ab-white/40 flex items-center gap-1.5">
              {vital.icon ? <vital.icon size={10} className="text-ab-white/30" /> : null}
              {vital.label}
            </span>
            <span className={TONE[vital.tone]}>{vital.value}</span>
          </div>
        ))}
      </div>
    </header>
  );
}

export const VITAL_ICONS = { Network, ShieldCheck, Database, Star };

/**
 * Replay — what happened, in the order it happened.
 *
 * The engine has been here since early on: `replayManifest` hands back the
 * hashes and steps a re-run must reproduce, and `compareReplay` says whether it
 * did. What it had for an interface was two textareas and a verdict, which is
 * the shape of a form and not the shape of a thing that happened.
 *
 * This is a transport over the execution log. Play, step, scrub, rewind — and
 * as the playhead moves, records enter the chain and the head hash advances.
 * Pull it back and the head hash *reverts to what it actually was*, which is
 * the one thing this product can show that a log viewer cannot: the chain is a
 * sequence of commitments, so there is a real answer to "what did the record
 * look like at 08:19".
 *
 * ── The honesty problem, and why the scrubber is not smooth ──────────────────
 *
 * The obvious build is a video player: a continuous playhead gliding along a
 * timeline. It would be a fabrication with a nice interface. A continuous
 * playhead asserts continuous knowledge, and this system does not have it — it
 * has instants. A trace records that a step happened at 08:14:04 and the next
 * at 08:14:07. What the agent was doing at 08:14:05 is not recorded, not
 * inferable, and not ours to draw.
 *
 * So the playhead **snaps to recorded instants** and never sits between them.
 * The interval between two instants is rendered as what it is: an elapsed gap
 * with nothing in it. That is a more interesting instrument than a smooth line,
 * because the gaps are where the questions are — a four-second pause between
 * `check_policy_limit` and `refuse` is a fact about the run.
 *
 * The second trap is speed. Playback advances one instant per beat at a pace
 * chosen for reading, which has nothing to do with how long the work took. If
 * the two were conflated the transport would be quietly asserting durations it
 * invented, so the elapsed figure beside each gap is always the real one, and
 * the beat is never described as time passing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Rewind } from 'lucide-react';
import { cn } from '../components/utils';

const adminHeaders = (): HeadersInit => {
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

interface Step { seq: number; name: string; at: string; detail?: string }
interface Trace {
  id: string; subject: string; scope: string[]; module: string; action: string;
  outcome: 'success' | 'failure'; startedAt?: string; steps?: Step[];
  inputHash: string; outputHash?: string; prevHash: string; hash: string; keyId?: string;
}

/**
 * One recorded moment.
 *
 * `kind` matters because a record entering the chain and a step inside one are
 * different events: only the first changes the head hash.
 */
interface Instant {
  at: number;
  kind: 'record' | 'step';
  trace: Trace;
  step?: Step;
}

/** Milliseconds per beat during playback. A reading pace, not a duration. */
const BEAT_MS = 900;

const shortHash = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

/**
 * A transport key, round and raised.
 *
 * These were flat rounded-md squares, which is the shape of a toolbar. A
 * transport is hardware — the one control in this interface a person expects to
 * have a physical answer, because they have pressed this exact arrangement of
 * keys on every tape machine and every player they have ever used. Round and
 * embossed says "press me" without a label, and the whole point of the row is
 * that it needs no explaining.
 *
 * The emboss is three shadows doing separate jobs: a hairline inset highlight
 * along the top edge where the light would catch, a darker inset along the
 * bottom for the far wall, and an outer drop shadow beneath the key to lift it
 * off the panel. Pressing swaps the inset pair and drops the key a pixel, so
 * the light lands where it would if the key had actually moved.
 *
 * `active:` handles the press. There is no perpetual animation here and there
 * should not be — a key that pulses on its own would be claiming something.
 */
function TransportKey({
  children, onClick, label, title, primary = false, lit = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  title?: string;
  /** The play key: larger, and the only one that carries colour at rest. */
  primary?: boolean;
  /** Currently running in this direction — the key stays depressed. */
  lit?: boolean;
}) {
  const size = primary ? 'w-14 h-14' : 'w-11 h-11';

  /*
   * Written as whole class names, on one line each, deliberately.
   *
   * The first version built these by concatenating two string literals to keep
   * the line short. Tailwind finds classes by scanning source text, so it saw
   * two fragments and no class, generated no rule, and the keys rendered
   * perfectly round and completely flat — with every element in the DOM looking
   * exactly as intended. A split class name is invisible in the source and
   * invisible in the output; the only way it surfaces is by reading the
   * computed style, which is how this one did.
   */
  const raised = 'shadow-[0_1px_0_rgba(0,0,0,0.7),0_5px_12px_-2px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-2px_2px_-1px_rgba(0,0,0,0.65)]';
  const pressed = 'shadow-[inset_0_2px_5px_rgba(0,0,0,0.75),inset_0_-1px_0_rgba(255,255,255,0.06)]';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={lit}
      title={title}
      className={cn(
        size,
        'rounded-full flex items-center justify-center shrink-0 select-none',
        'bg-gradient-to-b transition-[box-shadow,transform,border-color,color] duration-100',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ab-green/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        'active:translate-y-px',
        primary
          ? 'from-[#0e2a1e] to-[#04120c] border border-ab-green/40 text-ab-green'
          : 'from-[#141a17] to-[#070b09] border border-ab-white/10 text-text-muted hover:text-ab-white hover:border-ab-white/25',
        lit ? pressed : raised,
        lit ? 'text-ab-green' : '',
        !lit && 'active:shadow-[inset_0_2px_5px_rgba(0,0,0,0.75)]',
        primary && !lit && 'hover:shadow-[0_1px_0_rgba(0,0,0,0.7),0_6px_16px_-2px_rgba(0,245,140,0.28),inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-2px_2px_-1px_rgba(0,0,0,0.65)]',
      )}
    >
      {children}
    </button>
  );
}

const elapsed = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
};

export function Replay({ onOpenRecord, onWitness }: {
  onOpenRecord?: (id: string) => void;
  /**
   * Raised while the transport is running, so the room can stop observing.
   *
   * The room behind this surface is still drifting, still animating its seven
   * stations, still implying that things are arriving — while the person in
   * front of it is reading something that happened yesterday. Telling it to hold
   * still is what makes replay feel like remembering rather than a second live
   * feed running next to the first.
   */
  onWitness?: (witnessing: boolean) => void;
}) {
  const [traces, setTraces] = useState<Trace[] | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/executions?limit=200', { headers: adminHeaders() });
        if (!res.ok) {
          throw new Error(
            res.status === 401 || res.status === 403
              ? 'Reading the execution log requires your admin key. Add it under Settings → Admin API key.'
              : `Could not read the execution log (${res.status}).`,
          );
        }
        const body = await res.json();
        const list: Trace[] = Array.isArray(body) ? body : body.executions ?? body.records ?? [];
        if (live) setTraces(list);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    })();
    return () => { live = false; };
  }, []);

  /**
   * Every moment the log actually knows about, in order.
   *
   * Records without a startedAt contribute nothing but themselves; a record
   * with no steps is one instant, not an interpolated shape. Sorting by
   * timestamp rather than by sequence is deliberate — the chain order and the
   * clock order are different claims, and where they disagree the timeline
   * should show the clock while the head hash keeps following the chain.
   */
  const instants = useMemo<Instant[]>(() => {
    if (!traces) return [];
    const out: Instant[] = [];
    for (const trace of traces) {
      const started = Date.parse(trace.startedAt ?? '');
      if (!Number.isNaN(started)) out.push({ at: started, kind: 'record', trace });
      for (const step of trace.steps ?? []) {
        const at = Date.parse(step.at);
        if (!Number.isNaN(at)) out.push({ at, kind: 'step', trace, step });
      }
    }
    return out.sort((a, b) => a.at - b.at || (a.kind === 'record' ? -1 : 1));
  }, [traces]);

  const current = instants[index];
  const previous = index > 0 ? instants[index - 1] : undefined;
  const gap = current && previous ? current.at - previous.at : 0;

  /** The chain as it stood at the playhead: every record already committed. */
  const committed = useMemo(() => {
    if (!current) return [];
    return instants
      .slice(0, index + 1)
      .filter(i => i.kind === 'record')
      .map(i => i.trace);
  }, [instants, index, current]);

  const head = committed.length ? committed[committed.length - 1] : undefined;

  const step = useCallback((delta: 1 | -1) => {
    setIndex(i => Math.min(instants.length - 1, Math.max(0, i + delta)));
  }, [instants.length]);

  // Reported on every change, and cleared on unmount — leaving the room frozen
  // because somebody navigated away mid-playback would be a stuck instrument.
  useEffect(() => {
    onWitness?.(playing);
    return () => onWitness?.(false);
  }, [playing, onWitness]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setIndex(i => {
        const next = i + direction;
        if (next < 0 || next > instants.length - 1) { setPlaying(false); return i; }
        return next;
      });
    }, BEAT_MS);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, direction, instants.length]);

  if (error) {
    return (
      <div className="glass-card border border-ab-amber/30 p-5">
        <div className="text-sm font-semibold text-ab-amber mb-1">The log could not be read</div>
        <div className="text-xs text-text-muted">{error}</div>
      </div>
    );
  }

  if (!traces) {
    return <div className="glass-card p-5 text-xs text-text-muted font-mono">Reading the execution log…</div>;
  }

  if (instants.length === 0) {
    return (
      <div className="glass-card p-5">
        <div className="text-sm font-semibold mb-1">Nothing to replay</div>
        <div className="text-xs text-text-muted">
          {traces.length === 0
            ? 'No executions have been recorded. There is no timeline because nothing has happened yet, not because anything failed.'
            : `${traces.length} record(s) are held, and none carries a timestamp this timeline can place. A record without startedAt or steps is still evidence — it is simply not evidence about when.`}
        </div>
      </div>
    );
  }

  const first = instants[0].at;
  const span = Math.max(1, instants[instants.length - 1].at - first);

  return (
    <div className="space-y-4">
      {/* ── Transport ─────────────────────────────────────────────────────── */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-3 mb-5">
          <TransportKey
            onClick={() => { setDirection(-1); setPlaying(p => !(p && direction === -1)); }}
            label="Play backwards"
            title="Rewind — the head hash returns to what it was"
            lit={playing && direction === -1}
          >
            <Rewind className="w-4 h-4" />
          </TransportKey>

          <TransportKey onClick={() => step(-1)} label="Previous instant" title="Previous recorded instant">
            <SkipBack className="w-4 h-4" />
          </TransportKey>

          <TransportKey
            onClick={() => { setDirection(1); setPlaying(p => !p); }}
            label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play forwards, one instant per beat'}
            primary
            lit={playing && direction === 1}
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-px" />}
          </TransportKey>

          <TransportKey onClick={() => step(1)} label="Next instant" title="Next recorded instant">
            <SkipForward className="w-4 h-4" />
          </TransportKey>

          <div className="ml-auto text-right font-mono text-[11px] text-text-muted">
            <div>instant {index + 1} / {instants.length}</div>
            <div>{new Date(current.at).toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
          </div>
        </div>

        {/*
          * The track carries one mark per recorded instant, positioned by real
          * time. Uneven spacing is the point: it is what the run actually looked
          * like. A slider with evenly spaced stops would be a nicer control and
          * a worse instrument.
          */}
        <div className="relative h-12">
          <div className="absolute inset-x-0 top-5 h-px bg-ab-white/10" />
          {instants.map((moment, i) => {
            const left = ((moment.at - first) / span) * 100;
            const isRecord = moment.kind === 'record';
            const passed = i <= index;
            return (
              <button
                key={`${moment.trace.id}-${moment.kind}-${moment.step?.seq ?? 'r'}`}
                type="button"
                onClick={() => { setPlaying(false); setIndex(i); }}
                aria-label={`${isRecord ? 'Record' : 'Step'} at ${moment.at}`}
                className="absolute -translate-x-1/2 transition-colors"
                style={{ left: `${left}%`, top: isRecord ? 8 : 14 }}
              >
                <span
                  className={`block rounded-full ${isRecord ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5'} ${
                    i === index ? 'bg-ab-white ring-2 ring-ab-green'
                    : passed ? (isRecord ? 'bg-ab-green' : 'bg-ab-green/50')
                    : 'bg-ab-white/20'
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-text-muted/70">
          <span>{new Date(first).toISOString().slice(11, 19)}</span>
          <span>large marks are records entering the chain · small marks are steps within one</span>
          <span>{new Date(instants[instants.length - 1].at).toISOString().slice(11, 19)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── What is happening at the playhead ───────────────────────────── */}
        <div className="glass-card p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted mb-3">At this instant</div>

          {current.kind === 'record' ? (
            <>
              <div className="text-sm font-semibold">{current.trace.module} · {current.trace.action}</div>
              <div className="text-xs text-text-muted mt-1">
                {current.trace.subject} entered the chain
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold">{current.step?.name}</div>
              <div className="text-xs text-text-muted mt-1">
                step {current.step?.seq} of {current.trace.steps?.length} in {current.trace.action}
              </div>
              {current.step?.detail && <div className="text-xs mt-2">{current.step.detail}</div>}
            </>
          )}

          {/*
            * The gap, stated. This is the part a smooth scrubber would paint
            * over: between two recorded moments the log knows nothing, and
            * saying so is more useful than implying otherwise.
            */}
          {previous && (
            <div className="mt-4 pt-3 border-t border-ab-white/10">
              <div className="font-mono text-[11px] text-text-muted">
                {gap === 0
                  ? 'Same instant as the previous mark — recorded to the same second.'
                  : <>{elapsed(gap)} since the previous mark, with nothing recorded in between.</>}
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            {/* The same dot the record detail uses, so one outcome reads the
                same wherever it appears. */}
            <span className="flex items-center gap-2 text-[11px] font-mono text-text-muted">
              <span className={cn('w-2.5 h-2.5 rounded-full',
                current.trace.outcome === 'success' ? 'bg-emerald-500' : 'bg-red-500')} />
              {current.trace.outcome === 'success' ? 'succeeded' : 'failed'}
            </span>
            {onOpenRecord && (
              <button type="button" onClick={() => onOpenRecord(current.trace.id)}
                className="text-[11px] font-mono text-ab-green hover:underline">
                open this record →
              </button>
            )}
          </div>
        </div>

        {/* ── The chain, as it stood ──────────────────────────────────────── */}
        <div className="glass-card p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted mb-3">
            The chain at this instant
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-text-muted">Head hash</div>
              <div className="font-mono text-xs text-ab-green break-all">{shortHash(head?.hash)}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted">Links back to</div>
              <div className="font-mono text-xs text-text-muted break-all">{shortHash(head?.prevHash)}</div>
            </div>
            <div className="flex gap-6 pt-2 border-t border-ab-white/10">
              <div>
                <div className="text-[10px] text-text-muted">Records committed</div>
                <div className="font-mono text-lg">{committed.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">Still to come</div>
                <div className="font-mono text-lg text-text-muted">
                  {traces.length - committed.length}
                </div>
              </div>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-text-muted leading-relaxed">
            This is not a reconstruction. Each record committed a hash of the one
            before it, so the head shown here is the value the chain actually
            held at that point. Rewind and it returns to what it was, because it
            was that.
          </p>
        </div>
      </div>

      <p className="text-[11px] text-text-muted/80 leading-relaxed">
        The playhead moves between recorded instants and never sits between them:
        a trace knows that a step happened at one moment and the next at another,
        and nothing about the interval. Playback advances one instant per beat at
        a pace chosen for reading — the beat is not time passing, and the elapsed
        figure beside each gap is the real one.
      </p>
    </div>
  );
}

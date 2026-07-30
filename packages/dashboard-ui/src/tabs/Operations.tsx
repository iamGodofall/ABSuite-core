/**
 * Trust Operations Center.
 *
 * Not a dashboard. The screen someone walks past and asks "what is that?" — and
 * the answer is "that is where intelligence becomes accountable."
 *
 * The cube is the centrepiece and it is not a logo: it is the visual
 * representation of trust, and it turns only while the socket is connected, so
 * a dead connection reads as stillness rather than as a stale number. The seven
 * layers sit around it, each showing what it actually knows.
 *
 * **The rule that governs every pixel here: never fake data.** If there are
 * eight records, it says eight. If governance is absent on every record, it
 * says absent. A number that cannot be derived from something the system holds
 * does not appear at all — not as a zero, not as a dash with a promise. The
 * emotional goal is "I am looking at intelligence becoming accountable", and
 * one invented figure would make the whole thing a screensaver.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import type { LiveExecution } from '../hooks/useSocket';
import { TrustCube, type Integrity } from '../components/TrustCube';

type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

interface Layer {
  number: number; layer: string; description: string;
  status: 'Built' | 'Partly built' | 'Not built'; evidence: string;
}

interface Stats {
  total: number; subjects: number; modules: number; actions: number;
  failures: number; inWindow: number; failuresInWindow: number; withoutScope: number;
  chain: { valid: boolean; checked: number; brokenAt?: number; contentIntact?: boolean | null; checkable?: boolean };
}

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

/** A figure the system holds, or nothing at all. Never a placeholder. */
const Figure = ({ value, label, sub, state }: {
  value: React.ReactNode; label: string; sub?: string; state?: Determination;
}) => (
  <div className="text-center px-3">
    <div className={cn('text-3xl font-bold tabular-nums',
      state === 'FAILED' ? 'text-red-400 ops-state-failed'
        : state === 'UNKNOWN' ? 'text-amber-400 ops-state-unknown'
        : state === 'ABSENT' ? 'text-text-muted ops-state-absent'
        : 'text-[#00FF88] ops-state-demonstrated')}>
      {value}
    </div>
    <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted mt-1">{label}</div>
    {sub && <div className="text-[10px] text-text-muted/70 mt-0.5">{sub}</div>}
  </div>
);

/**
 * The seven layers, each reporting what it can actually see.
 *
 * A layer with nothing to report says so. None of these are decorative: every
 * reading traces to a field on a record or a count the system holds.
 */
function layerReadings(stats: Stats | null, unknownCount: number | null, attention: number | null, servicesUp: number, servicesTotal: number) {
  if (!stats) return [];
  return [
    {
      name: 'Observe', question: 'What did they do?',
      value: stats.total.toLocaleString('en-US'),
      detail: `${stats.inWindow.toLocaleString('en-US')} in 24h · ${stats.subjects} subject(s)`,
      state: (stats.total > 0 ? 'DEMONSTRATED' : 'ABSENT') as Determination,
    },
    {
      name: 'Verify', question: 'Has it been altered?',
      value: stats.total === 0 ? '—' : stats.chain.valid ? 'Intact' : stats.chain.checkable === false ? 'Unreadable' : 'Broken',
      detail: stats.total === 0 ? 'nothing to verify' : `${stats.chain.checked.toLocaleString('en-US')} verified on this request`,
      state: (stats.total === 0 ? 'ABSENT' : stats.chain.valid ? 'DEMONSTRATED' : stats.chain.checkable === false ? 'UNKNOWN' : 'FAILED') as Determination,
    },
    {
      name: 'Explain', question: 'What does it mean?',
      value: stats.total === 0 ? '—' : 'Derived',
      detail: 'no language model involved',
      state: (stats.total > 0 ? 'DEMONSTRATED' : 'ABSENT') as Determination,
    },
    {
      name: 'Govern', question: 'Under what rule?',
      value: stats.withoutScope === 0 && stats.total > 0 ? 'Scoped' : `${stats.withoutScope}`,
      detail: stats.withoutScope > 0 ? 'record(s) with no recorded authority' : 'every record names its authority',
      state: (stats.total === 0 ? 'ABSENT' : stats.withoutScope > 0 ? 'UNKNOWN' : 'DEMONSTRATED') as Determination,
    },
    {
      name: 'Arbitrate', question: 'Who is right?',
      value: attention === null ? '—' : attention.toLocaleString('en-US'),
      detail: attention === null ? 'not checked' : attention === 0 ? 'nothing warrants a look' : 'warrant a look',
      state: (attention === null ? 'UNKNOWN' : attention > 0 ? 'FAILED' : 'DEMONSTRATED') as Determination,
    },
    {
      name: 'Act', question: 'What can it reach?',
      value: `${servicesUp}/${servicesTotal}`,
      detail: servicesUp === servicesTotal ? 'all execution surfaces up' : 'some surfaces down',
      state: (servicesUp === servicesTotal ? 'DEMONSTRATED' : 'FAILED') as Determination,
    },
    {
      name: 'Learn', question: 'What do we not know?',
      value: unknownCount === null ? '—' : unknownCount.toLocaleString('en-US'),
      detail: unknownCount === null ? 'not checked' : unknownCount === 0 ? 'no open unknowns' : 'kind(s) of open work',
      state: (unknownCount === null ? 'UNKNOWN' : unknownCount > 0 ? 'UNKNOWN' : 'DEMONSTRATED') as Determination,
    },
  ];
}

export const Operations = ({ live, arrivedIds, connected, servicesUp, servicesTotal, integrity, arrivals, verifying, onOpenRecord, onOpenLayer }: {
  live: LiveExecution[];
  arrivedIds: Set<string>;
  connected: boolean;
  servicesUp: number;
  servicesTotal: number;
  /** The chain's state, read once by the shell so both cubes always agree. */
  integrity: Integrity;
  arrivals: { id: string; outcome?: string }[];
  verifying: boolean;
  onOpenRecord?: (id: string) => void;
  onOpenLayer?: (layer: string) => void;
}) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [unknownCount, setUnknownCount] = useState<number | null>(null);
  const [attention, setAttention] = useState<number | null>(null);
  const [layers, setLayers] = useState<Layer[] | null>(null);
  const [layersReason, setLayersReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, u, a] = await Promise.all([
        fetch('/executions/stats?windowHours=24', { headers: adminHeaders() }),
        fetch('/executions/unknowns?limit=200', { headers: adminHeaders() }),
        fetch('/executions/attention?limit=500', { headers: adminHeaders() }),
      ]);
      if (s.ok) { setStats((await s.json()) as Stats); setError(''); }
      else if (s.status === 401 || s.status === 403) {
        setError('Reading the log needs your admin key — Settings → Admin API key.');
      }
      if (u.ok) setUnknownCount(((await u.json()) as { queue: unknown[] }).queue?.length ?? 0);
      if (a.ok) setAttention(((await a.json()) as { count: number }).count ?? 0);

      // ABSuite reporting on ABSuite, from the Constitution rather than a
      // constant in this file.
      const l = await fetch('/system/layers');
      if (l.ok) {
        const payload = (await l.json()) as { available: boolean; layers?: Layer[]; reason?: string };
        if (payload.available && payload.layers) setLayers(payload.layers);
        else setLayersReason(payload.reason ?? 'The layer states cannot be read.');
      }
    } catch {
      setError('CapKit is unreachable, so nothing here can be stated.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Re-read when a record arrives, so the figures move with the feed.
  useEffect(() => { if (live.length) void load(); }, [live.length, load]);

  const readings = layerReadings(stats, unknownCount, attention, servicesUp, servicesTotal);

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="text-center pt-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.4em] text-[#00D9FF]/70">
          Trust Operations Center
        </div>
        <h1 className="text-3xl font-bold text-text-primary mt-1.5">ABSuite</h1>
        <p className="text-xs text-text-muted mt-1 italic">The Future Is Accountable.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3 text-center">
          <p className="text-xs text-amber-400">{error}</p>
        </div>
      )}

      {/* ── The cube, and the layers around it ───────────────────────────── */}
      <div className="relative rounded-2xl border border-border bg-bg-secondary/60 overflow-hidden">
        <div className="relative flex flex-col items-center justify-center py-10 min-h-[26rem]">
          {/* Rings — structure, not activity. */}
          <div className="ops-ring" style={{ width: 340, height: 340, top: '50%', left: '50%', marginTop: -170, marginLeft: -170 }} />
          <div className="ops-ring reverse" style={{ width: 470, height: 470, top: '50%', left: '50%', marginTop: -235, marginLeft: -235 }} />

          {/* The same component the shell mounts, at centrepiece size. One
              implementation, so the small cube and the large one can never
              disagree about what the system is doing. */}
          <TrustCube
            connected={connected}
            integrity={integrity}
            arrivals={arrivals}
            verifying={verifying}
            variant="centre"
            size={130}
          />

          <div className="mt-6 text-center">
            <div className={cn('text-[10px] font-mono uppercase tracking-[0.3em]',
              !connected ? 'text-red-400/80'
                : integrity === 'FAILED' ? 'text-red-400/80'
                : integrity === 'UNKNOWN' ? 'text-amber-400/80'
                : integrity === 'ABSENT' ? 'text-text-muted'
                : 'text-[#00FF88]/80')}>
              {!connected ? 'not connected'
                : integrity === 'FAILED' ? 'chain broken'
                : integrity === 'UNKNOWN' ? 'chain not checked'
                : integrity === 'ABSENT' ? 'nothing recorded'
                : 'observing · chain intact'}
            </div>
            {!connected && (
              <div className="text-[10px] text-text-muted mt-1">
                nothing is being observed — the cube is still on purpose
              </div>
            )}
          </div>
        </div>

        {/* The seven, reading real state. */}
        {readings.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 border-t border-border">
            {readings.map((layer, i) => (
              <motion.button
                key={layer.name}
                type="button"
                onClick={() => onOpenLayer?.(layer.name.toLowerCase())}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className={cn(
                  'px-3 py-4 text-center border-r border-border last:border-r-0 hover:bg-bg-tertiary/40 transition-colors',
                  i >= 4 && 'lg:border-t-0'
                )}
              >
                <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-text-muted/70">
                  {i + 1} · {layer.name}
                </div>
                <div className={cn('text-xl font-bold mt-1.5 tabular-nums',
                  layer.state === 'FAILED' ? 'text-red-400 ops-state-failed'
                    : layer.state === 'UNKNOWN' ? 'text-amber-400 ops-state-unknown'
                    : layer.state === 'ABSENT' ? 'text-text-muted ops-state-absent'
                    : 'text-[#00FF88] ops-state-demonstrated')}>
                  {layer.value}
                </div>
                <div className="text-[10px] text-text-muted mt-1 leading-snug">{layer.detail}</div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* ── What is held, in figures that exist ──────────────────────────── */}
      {stats && (
        <div className="rounded-xl border border-border bg-bg-secondary py-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-y-4">
            <Figure value={stats.total.toLocaleString('en-US')} label="Records held" sub="signed and chained" />
            <Figure
              value={stats.total === 0 ? '—' : `${((stats.chain.checked / stats.total) * 100).toFixed(0)}%`}
              label="Verified" sub="on this request"
              state={stats.total === 0 ? 'ABSENT' : stats.chain.valid ? 'DEMONSTRATED' : 'FAILED'}
            />
            <Figure value={stats.subjects.toLocaleString('en-US')} label="Subjects seen" sub={`${stats.actions} distinct action(s)`} />
            <Figure
              value={stats.failuresInWindow.toLocaleString('en-US')} label="Failures" sub="in the last 24 hours"
              state={stats.failuresInWindow > 0 ? 'FAILED' : 'DEMONSTRATED'}
            />
            <Figure
              value={stats.withoutScope.toLocaleString('en-US')} label="Unscoped" sub="cannot be shown permitted"
              state={stats.withoutScope > 0 ? 'UNKNOWN' : 'DEMONSTRATED'}
            />
          </div>
          <p className="text-[10px] text-text-muted/60 text-center mt-4 px-4">
            Every figure above is a count of records that exist. There is no active-agent number,
            no incident count and no open-dispute figure, because each would have to be invented.
          </p>
        </div>
      )}

      {/* ── ABSuite, reporting on ABSuite ────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
          <h3 className="text-sm font-semibold text-text-primary">System status — this system, by its own standard</h3>
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">
            docs/CONSTITUTION.md
          </span>
        </div>
        <p className="text-xs text-text-muted mb-4 leading-relaxed">
          The eight architectural layers, read from the Constitution at request time. A layer cannot be
          promoted on this screen without changing that document, and the build fails if a promoted
          layer names no file that exists. ABSuite holds itself to what it asks of everything it watches.
        </p>

        {!layers && (
          <p className="text-xs text-amber-400">
            {layersReason || 'Reading the layer states…'}
          </p>
        )}

        {layers && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {layers.map(layer => {
              const tone = layer.status === 'Built' ? 'demonstrated'
                : layer.status === 'Partly built' ? 'unknown' : 'absent';
              return (
                <div key={layer.number} className={cn('rounded-lg border p-3',
                  tone === 'demonstrated' ? 'border-[#00FF88]/30 bg-[#00FF88]/[0.04]'
                    : tone === 'unknown' ? 'border-amber-500/30 bg-amber-500/[0.04]'
                    : 'border-border bg-bg-primary/40')}>
                  <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-text-muted/70">
                    Layer {layer.number}
                  </div>
                  <div className={cn('text-sm font-semibold mt-0.5',
                    tone === 'absent' ? 'text-text-muted ops-state-absent' : 'text-text-primary')}>
                    {layer.layer}
                  </div>
                  <div className={cn('text-[10px] font-mono mt-1.5 uppercase tracking-[0.12em]',
                    tone === 'demonstrated' ? 'text-[#00FF88] ops-state-demonstrated'
                      : tone === 'unknown' ? 'text-amber-400 ops-state-unknown'
                      : 'text-text-muted ops-state-absent')}>
                    {layer.status}
                  </div>
                  {layer.evidence && layer.evidence !== '—' && (
                    <div className="text-[9px] font-mono text-text-muted/50 mt-1 break-all">{layer.evidence}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {layers && (
          <p className="text-[10px] text-text-muted/60 mt-3 leading-snug">
            Two layers are marked not built and name nothing, because nothing exists to name. Civilisation
            is a scale, not a feature — no commit makes it true.
          </p>
        )}
      </div>

      {/* ── The stream ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
          <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-[#00FF88] live-pulse' : 'bg-red-400')} />
          <h3 className="text-sm font-semibold text-text-primary">Activity</h3>
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted ml-auto">
            {live.length} in view
          </span>
        </div>

        {live.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">
            Nothing recorded yet. Any instrumented agent that acts appears here, signed, without being asked.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {live.slice(0, 24).map(execution => (
              <motion.button
                key={execution.id}
                type="button"
                onClick={() => onOpenRecord?.(execution.id)}
                initial={arrivedIds.has(execution.id) ? { opacity: 0, x: -10 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full text-left px-4 py-2 border-b border-border/40 hover:bg-bg-tertiary/40 flex items-center gap-3 flex-wrap"
              >
                <span className="text-[10px] font-mono text-text-muted/70 shrink-0">
                  {new Date(execution.startedAt).toLocaleTimeString()}
                </span>
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                  execution.outcome === 'success' ? 'bg-[#00FF88]' : 'bg-red-500')} />
                <span className="text-xs font-mono text-text-primary">{execution.action}</span>
                <span className="text-[11px] text-text-muted">{execution.subject}</span>
                {execution.governance && (
                  <span className="text-[10px] font-mono text-[#00D9FF]/70">
                    {execution.governance.policyRef} v{execution.governance.policyVersion}
                  </span>
                )}
                <span className="text-[10px] font-mono text-text-muted/50 ml-auto shrink-0">
                  {execution.hash.slice(0, 10)}…
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Operations;

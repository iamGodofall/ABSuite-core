/**
 * Act — what is running, what is scheduled, and what this instance can reach.
 *
 * This layer showed service tiles: a deployment detail, and the least
 * interesting thing about it. Whether a container is up is infrastructure;
 * what work is in flight is the layer.
 *
 * Everything here is a count of things that exist. An empty queue says empty —
 * that is a measured result and the correct answer for a system nobody is
 * driving, not a gap to be filled with a plausible number.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

interface QueueTask {
  id: string; name?: string; status: string; attempts?: number;
  createdAt?: string; error?: string;
}

interface QueueState {
  tasks: QueueTask[];
  stats: { queued: number; running: number; completed: number; dead: number; concurrency: number; limit: number };
}

interface Schedule {
  id: string; name?: string; cron?: string; paused?: boolean; nextRunAt?: string; lastRunAt?: string;
}

interface Connector {
  id: string; label: string; description: string;
  configured: boolean; missing: string[];
  actions: { name: string; description: string }[];
}

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const Stat = ({ value, label, tone }: { value: number; label: string; tone?: 'ok' | 'warn' | 'bad' }) => (
  <div className="text-center">
    <div className={cn('text-2xl font-bold tabular-nums',
      tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : 'text-[#00FF88]')}>
      {value.toLocaleString('en-US')}
    </div>
    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mt-0.5">{label}</div>
  </div>
);

export const ActLayer = () => {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [q, s, c] = await Promise.all([
        fetch('/edge/queue', { headers: adminHeaders() }),
        fetch('/edge/schedule', { headers: adminHeaders() }),
        fetch('/edge/connectors', { headers: adminHeaders() }),
      ]);

      if (q.ok) setQueue((await q.json()) as QueueState);
      else if (q.status === 401 || q.status === 403) {
        setError('Reading the queue requires your admin key — Settings → Admin API key.');
      } else setError('Edge-Run did not answer, so what is running cannot be stated.');

      if (s.ok) setSchedules(((await s.json()) as { tasks: Schedule[] }).tasks ?? []);
      if (c.ok) setConnectors(((await c.json()) as { connectors: Connector[] }).connectors ?? []);
    } catch {
      setError('Edge-Run is unreachable, so what is running cannot be stated.');
    }
  }, []);

  useEffect(() => {
    void load();
    // Work in flight changes on its own; a static queue view is a screenshot.
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const reachable = connectors?.filter(connector => connector.configured) ?? [];
  const unreachable = connectors?.filter(connector => !connector.configured) ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3">
          <p className="text-xs text-amber-400">{error}</p>
        </div>
      )}

      {/* ── Work in flight ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Work in flight</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Nothing here runs because ABSuite decided it should. Every task executes under a capability
              that was granted, and lands in Observe as a signed record.
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">
            refreshed every 5s
          </span>
        </div>

        {!queue ? (
          <p className="text-sm text-text-muted">Reading the queue…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-y-4 py-3 rounded-lg border border-border bg-bg-primary/40">
              <Stat value={queue.stats.running} label="Running" />
              <Stat value={queue.stats.queued} label="Queued" tone={queue.stats.queued > 0 ? 'warn' : 'ok'} />
              <Stat value={queue.stats.completed} label="Completed" />
              <Stat value={queue.stats.dead} label="Dead" tone={queue.stats.dead > 0 ? 'bad' : 'ok'} />
              <Stat value={queue.stats.concurrency} label="Concurrency" />
            </div>

            {queue.tasks.length === 0 ? (
              <p className="text-sm text-text-muted mt-3">
                The queue is empty. That is a measured result — nothing is waiting, nothing is running,
                and a system nobody is driving is correctly reporting that.
              </p>
            ) : (
              <div className="mt-3 space-y-1">
                {queue.tasks.slice(0, 12).map(task => (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-bg-primary/40 flex-wrap"
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                      task.status === 'running' ? 'bg-[#00FF88] live-pulse'
                        : task.status === 'dead' ? 'bg-red-500'
                        : task.status === 'completed' ? 'bg-[#00FF88]/50' : 'bg-amber-400')} />
                    <span className="text-xs font-mono text-text-primary">{task.name ?? task.id}</span>
                    <span className="text-[10px] font-mono text-text-muted uppercase">{task.status}</span>
                    {task.attempts != null && task.attempts > 1 && (
                      <span className="text-[10px] font-mono text-amber-400">attempt {task.attempts}</span>
                    )}
                    {task.error && <span className="text-[10px] text-red-400">{task.error}</span>}
                  </motion.div>
                ))}
                {queue.tasks.length > 12 && (
                  <p className="text-[10px] text-text-muted/60 pl-3">
                    Showing 12 of {queue.tasks.length} — a window, not the queue.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Scheduled ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Scheduled</h3>
        <p className="text-xs text-text-muted mb-3">
          Work that will run without anyone asking again. Each run produces a record like any other.
        </p>

        {!schedules ? (
          <p className="text-sm text-text-muted">Reading the schedule…</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nothing is scheduled. No recurring work exists on this instance.
          </p>
        ) : (
          <div className="space-y-1">
            {schedules.map(schedule => (
              <div key={schedule.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-bg-primary/40 flex-wrap">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                  schedule.paused ? 'bg-text-muted' : 'bg-[#00FF88]')} />
                <span className="text-xs font-mono text-text-primary">{schedule.name ?? schedule.id}</span>
                {schedule.cron && <span className="text-[10px] font-mono text-[#00D9FF]/70">{schedule.cron}</span>}
                {schedule.paused && <span className="text-[10px] font-mono text-amber-400">paused</span>}
                {schedule.nextRunAt && (
                  <span className="text-[10px] font-mono text-text-muted ml-auto">
                    next {new Date(schedule.nextRunAt).toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Reach ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1">What this instance can reach</h3>
        <p className="text-xs text-text-muted mb-3">
          Configured means credentials are present, not that the far end is healthy. An unconfigured
          connector is listed rather than hidden — knowing what you cannot reach is part of knowing what
          you can.
        </p>

        {!connectors ? (
          <p className="text-sm text-text-muted">Reading the registry…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {[...reachable, ...unreachable].map(connector => (
              <div key={connector.id} className={cn('rounded-lg border p-3',
                connector.configured
                  ? 'border-[#00FF88]/25 bg-[#00FF88]/[0.03]'
                  : 'border-border bg-bg-primary/40')}>
                <div className="flex items-baseline gap-2">
                  <span className={cn('text-xs font-semibold',
                    connector.configured ? 'text-text-primary' : 'text-text-muted')}>
                    {connector.label}
                  </span>
                  <span className={cn('text-[10px] font-mono ml-auto',
                    connector.configured ? 'text-[#00FF88]' : 'text-text-muted/60')}>
                    {connector.configured ? 'configured' : 'not configured'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-1 leading-snug">{connector.description}</p>
                {!connector.configured && connector.missing.length > 0 && (
                  <p className="text-[10px] font-mono text-amber-400/80 mt-1.5">
                    needs {connector.missing.join(', ')}
                  </p>
                )}
                {connector.actions.length > 0 && (
                  <p className="text-[10px] font-mono text-text-muted/50 mt-1.5">
                    {connector.actions.length} action(s): {connector.actions.slice(0, 3).map(a => a.name).join(', ')}
                    {connector.actions.length > 3 ? '…' : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {connectors && (
          <p className="text-[10px] text-text-muted/60 mt-3">
            {reachable.length} of {connectors.length} connector(s) configured on this instance.
          </p>
        )}
      </div>
    </div>
  );
};

export default ActLayer;

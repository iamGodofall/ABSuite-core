/**
 * The machine room — what is running underneath, and nothing more.
 *
 * What stood here was a dashboard: four metric cards (Services Up, Services
 * Down, Avg CPU, Avg Memory), a grid of service tiles with Start / Stop /
 * Restart on each, and an "Activity Feed" whose lines were manufactured from
 * the status field one component above it. It was the Grafana furniture this
 * product exists to argue against, and it sat on the tab a stranger clicks
 * second.
 *
 * Three specific things were untrue about it. Uptime read 100% for anything
 * that answered a health check once. CPU and memory read 0% when the service
 * reported nothing, drawing an absent measurement as a real reading of zero.
 * And every service carried a hardcoded capability list — "Self-Healing",
 * "AI Analyzer" — describing an intention rather than an endpoint.
 *
 * This states four things it can defend: whether a process answered, on what
 * port, when it was last asked, and which numbers it declined to report. An
 * unreported metric is drawn as unreported. Nothing here averages anything.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import type { Service } from '../hooks/useServices';

const TONE: Record<Service['status'], { dot: string; text: string; word: string }> = {
  up:       { dot: 'bg-[#00FF88]',    text: 'text-[#00FF88]', word: 'answered' },
  down:     { dot: 'bg-red-500',      text: 'text-red-400',   word: 'did not answer' },
  failed:   { dot: 'bg-red-400',      text: 'text-red-400',   word: 'failed' },
  starting: { dot: 'bg-teal-300',     text: 'text-teal-300',  word: 'starting' },
  stopping: { dot: 'bg-yellow-400',   text: 'text-yellow-300', word: 'stopping' },
  unknown:  { dot: 'bg-amber-400',    text: 'text-amber-400', word: 'not checked' },
};

/** A figure, or an honest statement that there is no figure. */
const Reading = ({ label, value, unit }: { label: string; value?: number; unit?: string }) => (
  <div className="rounded-lg border border-border bg-bg-primary/40 px-3 py-2">
    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">{label}</div>
    {value === undefined ? (
      <div className="text-xs text-text-muted/60 mt-0.5 italic">not reported</div>
    ) : (
      <div className="text-sm font-mono text-text-primary mt-0.5 tabular-nums">
        {value}{unit}
      </div>
    )}
  </div>
);

export const MachineRoom = ({ services, error }: { services: Service[]; error: string | null }) => {
  const answered = services.filter(service => service.status === 'up');
  const silent = services.filter(service => service.status === 'down' || service.status === 'failed');
  const unchecked = services.filter(service => service.status === 'unknown');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary">
          Which processes answered when asked
        </h3>
        <p className="text-xs text-text-muted mt-1 max-w-3xl leading-relaxed">
          This is the deployment, not the product. Whether a container is up says nothing about
          whether an agent stayed inside its authority — that question lives in Observe, Verify and
          Govern, and it is answered from signed records rather than from a health check.
        </p>
        <p className="text-[11px] text-text-muted/70 mt-2 leading-relaxed">
          There are no start, stop or restart controls here. Turning a process off from a browser tab
          is an administration function; this room is for reading the state of the stack, and a
          console that can silently restart the thing producing the evidence is a console you have to
          trust twice.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-4">
          <p className="text-sm font-semibold text-red-400">The orchestrator did not answer</p>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            {error} Every service below is therefore listed as not checked. Nothing is being
            substituted — an unreachable orchestrator cannot tell you a service is down, only that it
            could not be asked.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="text-sm text-text-primary">
            <span className="font-bold text-[#00FF88] tabular-nums">{answered.length}</span>{' '}
            <span className="text-text-muted">answered</span>
          </span>
          <span className="text-sm text-text-primary">
            <span className={cn('font-bold tabular-nums', silent.length > 0 ? 'text-red-400' : 'text-text-muted')}>
              {silent.length}
            </span>{' '}
            <span className="text-text-muted">did not</span>
          </span>
          <span className="text-sm text-text-primary">
            <span className={cn('font-bold tabular-nums', unchecked.length > 0 ? 'text-amber-400' : 'text-text-muted')}>
              {unchecked.length}
            </span>{' '}
            <span className="text-text-muted">could not be checked</span>
          </span>
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted/60 ml-auto">
            {services.length} tracked · re-asked every 3s
          </span>
        </div>
        <p className="text-[10px] text-text-muted/60 mt-2 leading-snug">
          Counts, not an average. Averaging CPU across six processes produces a number that describes
          none of them.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {services.map((service, index) => {
          const tone = TONE[service.status];
          return (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.04, 0.24), duration: 0.3 }}
              className={cn('rounded-xl border p-4',
                service.status === 'up' ? 'border-[#00FF88]/25 bg-[#00FF88]/[0.03]'
                  : service.status === 'down' || service.status === 'failed' ? 'border-red-500/25 bg-red-500/[0.03]'
                  : 'border-border bg-bg-secondary')}
            >
              <div className="flex items-center gap-2.5 mb-1">
                <span className={cn('w-2 h-2 rounded-full shrink-0', tone.dot)} />
                <span className="text-sm font-mono font-semibold text-text-primary">{service.name}</span>
                <span className="text-[10px] font-mono text-text-muted ml-auto">:{service.port}</span>
              </div>

              <div className={cn('text-[11px] font-mono', tone.text)}>{tone.word}</div>
              <div className="text-[10px] font-mono text-text-muted/60 mt-0.5">
                asked {service.lastCheck.toLocaleTimeString()}
              </div>

              {!service.reported ? (
                <p className="text-[10px] text-text-muted/60 mt-3 leading-snug italic">
                  No health payload — nothing about this process's resource use can be stated.
                </p>
              ) : service.health === undefined ? (
                <p className="text-[10px] text-text-muted/60 mt-3 leading-snug italic">
                  Answered, but reported no CPU, memory or uptime figure. Three empty boxes would say
                  this same thing three times.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5 mt-3">
                  <Reading label="CPU" value={service.health.cpu} unit="%" />
                  <Reading label="Mem" value={service.health.memory} unit="%" />
                  <Reading label="Uptime" value={service.health.uptime} unit="%" />
                </div>
              )}

              {service.features.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {service.features.map(feature => (
                    <span key={feature}
                      className="text-[10px] font-mono text-[#00D9FF]/70 border border-[#00D9FF]/20 rounded px-1.5 py-0.5">
                      {feature}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <p className="text-[10px] text-text-muted/60 leading-snug px-1">
        Ports and names come from this build's service map; status, timing and any reading beside it
        come from asking each process directly. Where a process reported nothing, this screen says so
        rather than printing a zero.
      </p>
    </div>
  );
};

export default MachineRoom;

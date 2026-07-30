/**
 * The instruments around the room.
 *
 * These are the panels from the design: system health, live activity, the
 * unknown queue, agents requiring attention, the evidence stream and the
 * constitutional reminder. They are instruments, not pages — you never navigate
 * to one, they are simply always readable from where you stand.
 *
 * The design's figures were illustrative: 12.5K observations, 9.8K actions, a
 * 124-item queue, record #88371. Every one of them is replaced here by what the
 * instance actually holds, which on a fresh deployment means small numbers and
 * empty panels. That is the trade the critical rule asks for, and it is the
 * whole reason the design is worth building: a mockup can afford 12.5K, a trust
 * product cannot.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

export const Panel = ({ title, icon, children, action }: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <section className="rounded-xl border border-[#00FF88]/12 bg-[#0D1117]/80 backdrop-blur-sm overflow-hidden">
    <header className="flex items-center gap-2 px-4 py-3 border-b border-[#00FF88]/10">
      {icon && <span className="text-[#00FF88]/70 shrink-0">{icon}</span>}
      <h2 className="text-[11px] font-mono uppercase tracking-[0.18em] text-text-primary">{title}</h2>
      {action && <span className="ml-auto">{action}</span>}
    </header>
    <div className="p-4">{children}</div>
  </section>
);

/* ── System health ──────────────────────────────────────────────────────────
   The design shows a 100% ring. That figure is only honest when it means
   "6 of 6 answered", so the ring is drawn from the count and labelled with it.
   It is never a synthetic uptime percentage. */

export const SystemHealth = ({ services }: {
  services: { id: string; name: string; status: string }[];
}) => {
  const up = services.filter(service => service.status === 'up').length;
  const total = services.length;
  const pct = total === 0 ? 0 : Math.round((up / total) * 100);
  const state: Determination =
    total === 0 ? 'UNKNOWN' : up === total ? 'DEMONSTRATED' : up === 0 ? 'FAILED' : 'UNKNOWN';

  const circumference = 2 * Math.PI * 42;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[104px] h-[104px] shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="5" />
          <motion.circle
            cx="50" cy="50" r="42" fill="none" strokeWidth="5" strokeLinecap="round"
            stroke={state === 'DEMONSTRATED' ? '#00FF88' : state === 'FAILED' ? '#EF4444' : '#F59E0B'}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - (pct / 100) * circumference }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-xl font-bold tabular-nums',
            state === 'DEMONSTRATED' ? 'text-[#00FF88]' : state === 'FAILED' ? 'text-red-400' : 'text-amber-400')}>
            {total === 0 ? '—' : `${pct}%`}
          </span>
          <span className="text-[7px] font-mono uppercase tracking-[0.14em] text-text-muted mt-0.5">
            {state}
          </span>
          <span className="text-[7px] font-mono text-text-muted/60">{up} / {total} services</span>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 min-w-0">
        {services.map(service => (
          <li key={service.id} className="flex items-center gap-2">
            <span className={cn('w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 text-[8px]',
              service.status === 'up' ? 'border-[#00FF88]/50 text-[#00FF88]'
                : service.status === 'down' || service.status === 'failed' ? 'border-red-500/50 text-red-400'
                : 'border-amber-500/50 text-amber-400')}>
              {service.status === 'up' ? '✓' : service.status === 'unknown' ? '?' : '✕'}
            </span>
            <span className="text-[11px] text-text-secondary truncate">{service.name}</span>
          </li>
        ))}
        {services.length === 0 && (
          <li className="text-[11px] text-text-muted">
            The orchestrator has not answered, so no service can be reported.
          </li>
        )}
      </ul>
    </div>
  );
};

/* ── Live activity ─────────────────────────────────────────────────────────
   Real records, newest first, each labelled with the determination it actually
   carries rather than a severity someone assigned. */

export interface ActivityRow {
  id: string;
  time: string;
  subject: string;
  action: string;
  state: Determination | 'UNSCOPED' | 'APPLIED' | 'ADDED';
}

const ROW_TONE: Record<string, string> = {
  DEMONSTRATED: 'text-[#00FF88]',
  FAILED: 'text-red-400',
  UNKNOWN: 'text-amber-400',
  ABSENT: 'text-text-muted',
  UNSCOPED: 'text-amber-400',
  APPLIED: 'text-[#00D9FF]',
  ADDED: 'text-[#00D9FF]',
};

export const LiveActivity = ({ rows, onOpen }: {
  rows: ActivityRow[];
  onOpen?: (id: string) => void;
}) => (
  <div className="space-y-0.5">
    {rows.length === 0 ? (
      <p className="text-[11px] text-text-muted leading-relaxed">
        Nothing has happened yet on this instance. An empty feed is a measured
        result, not a panel waiting to be filled.
      </p>
    ) : rows.map(row => (
      <motion.button
        key={row.id}
        type="button"
        onClick={() => onOpen?.(row.id)}
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        className="w-full flex items-baseline gap-2.5 py-1 text-left hover:bg-[#00FF88]/[0.04] rounded px-1 -mx-1 transition-colors"
      >
        <span className="text-[10px] font-mono text-text-muted/60 shrink-0 tabular-nums">{row.time}</span>
        <span className="text-[11px] font-mono text-text-secondary truncate max-w-[46%]">{row.subject}</span>
        <span className="text-[11px] font-mono text-text-muted truncate">{row.action}</span>
        <span className={cn('ml-auto text-[9px] font-mono uppercase tracking-wider shrink-0', ROW_TONE[row.state])}>
          {row.state}
        </span>
      </motion.button>
    ))}
  </div>
);

/* ── Unknown queue ─────────────────────────────────────────────────────────
   The design's "124 items requiring attention" with a breakdown. Real counts,
   and the copy holds the line that unknown is work, not failure. */

export const UnknownQueue = ({ total, breakdown, onOpen }: {
  total: number | null;
  breakdown: { label: string; count: number }[];
  onOpen?: () => void;
}) => (
  <div>
    <div className="flex items-start gap-4">
      <div className="shrink-0">
        <div className={cn('text-4xl font-bold tabular-nums',
          total === null ? 'text-amber-400' : total > 0 ? 'text-[#00FF88]' : 'text-text-muted')}>
          {total === null ? '—' : total}
        </div>
        <div className="text-[8px] font-mono uppercase tracking-[0.14em] text-text-muted mt-1 max-w-[92px] leading-tight">
          {total === null ? 'not checked' : 'items requiring attention'}
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 min-w-0">
        {breakdown.length === 0 ? (
          <li className="text-[11px] text-text-muted">
            {total === null
              ? 'The queue could not be read.'
              : 'Nothing outstanding. Every record answers what it is asked.'}
          </li>
        ) : breakdown.map(item => (
          <li key={item.label} className="flex items-baseline gap-2">
            <span className="text-[11px] text-text-secondary truncate">{item.label}</span>
            <span className="ml-auto text-[11px] font-mono text-text-primary tabular-nums">{item.count}</span>
          </li>
        ))}
      </ul>
    </div>

    {onOpen && (
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 w-full text-[10px] font-mono uppercase tracking-[0.16em] text-[#00FF88]/70 hover:text-[#00FF88] transition-colors text-right"
      >
        open queue →
      </button>
    )}
  </div>
);

/* ── Agents requiring attention ────────────────────────────────────────────
   Ordered by what is unproven, never scored. The design's own footnote said
   this correctly and it is kept verbatim. */

export const AgentsAttention = ({ agents, held }: {
  agents: { subject: string; actions: number; tags: { label: string; tone: 'warn' | 'bad' | 'ok' }[]; detail?: string }[];
  /** Records held overall — the difference between the two kinds of empty. */
  held: number;
}) => (
  <div className="space-y-3">
    {agents.length === 0 ? (
      <p className="text-[11px] text-text-muted leading-relaxed">
        {held > 0
          ? `Nothing requires attention. All ${held} record(s) held are scoped, successful and name their authority — a measured result, not an empty panel.`
          : 'No subject has acted yet, so there is nothing to review.'}
      </p>
    ) : agents.map(agent => (
      <div key={agent.subject}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[12px] font-mono text-text-primary">{agent.subject}</span>
          <span className="ml-auto flex items-center gap-1.5 flex-wrap">
            {agent.tags.map(tag => (
              <span key={tag.label} className={cn('text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border',
                tag.tone === 'bad' ? 'border-red-500/40 text-red-400'
                  : tag.tone === 'warn' ? 'border-amber-500/40 text-amber-400'
                  : 'border-[#00FF88]/40 text-[#00FF88]')}>
                {tag.label}
              </span>
            ))}
          </span>
        </div>
        <div className="text-[10px] text-text-muted mt-0.5">
          {agent.actions} action{agent.actions === 1 ? '' : 's'}
          {agent.detail ? ` · ${agent.detail}` : ''}
        </div>
      </div>
    ))}

    <p className="text-[9px] text-text-muted/60 leading-snug pt-2 border-t border-[#00FF88]/10">
      Ordering is not ranking — which of these matters is your judgement, not ABSuite's.
    </p>
  </div>
);

/* ── Evidence stream ───────────────────────────────────────────────────────
   The pipeline a record travels: action, evidence, verification, policy,
   governance, ledger. Each stage lights only when the newest record actually
   carries what that stage needs, so a record with no governance shows the
   governance stage dark rather than green. */

export interface Stage { name: string; note: string; reached: boolean; at?: string }

export const EvidenceStream = ({ stages, latest, onOpen }: {
  stages: Stage[];
  latest: string | null;
  onOpen?: () => void;
}) => (
  <div>
    <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
      {stages.map((stage, index) => (
        <React.Fragment key={stage.name}>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.07, duration: 0.35 }}
            className={cn('flex-1 min-w-[104px] rounded-lg border px-3 py-2.5 text-center',
              stage.reached
                ? 'border-[#00FF88]/35 bg-[#00FF88]/[0.05]'
                : 'border-border bg-bg-primary/40 opacity-55')}
          >
            <div className={cn('text-[9px] font-mono uppercase tracking-[0.14em]',
              stage.reached ? 'text-[#00FF88]' : 'text-text-muted')}>
              {stage.name}
            </div>
            <div className="text-[10px] text-text-secondary mt-1">{stage.note}</div>
            <div className="text-[9px] font-mono text-text-muted/60 mt-0.5">
              {stage.at ?? '—'}
            </div>
          </motion.div>
          {index < stages.length - 1 && (
            <div className="flex items-center px-1 shrink-0">
              <span className={cn('text-xs', stage.reached ? 'text-[#00FF88]/50' : 'text-text-muted/30')}>→</span>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>

    <div className="flex items-baseline gap-3 mt-3 flex-wrap">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">
        latest record
      </span>
      <span className="text-[11px] font-mono text-[#00FF88]">{latest ?? 'none held'}</span>
      {latest && onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto text-[10px] font-mono uppercase tracking-[0.16em] text-[#00FF88]/70 hover:text-[#00FF88] transition-colors"
        >
          open record →
        </button>
      )}
    </div>
  </div>
);

/* ── Constitutional reminder ───────────────────────────────────────────────
   Fixed text, and the only panel here that is allowed to be. It is the
   product's own standard, quoted, not a figure about the instance. */

export const ConstitutionalReminder = () => (
  <div>
    <p className="text-sm text-text-primary leading-relaxed">
      “Tell me what happened.<br />Prove it.<br />Tell me whether I should worry.”
    </p>
    <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
      ABSuite answers the first two. The third is shown by what the first two rest on.
    </p>
    <p className="text-[10px] font-mono text-[#00FF88]/70 mt-3 leading-snug uppercase tracking-[0.08em]">
      Nothing may look more complete, more certain, or more authoritative than it actually is.
    </p>
  </div>
);

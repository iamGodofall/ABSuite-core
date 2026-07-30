/**
 * The evidence stream, and nothing else.
 *
 * This file once held six panel components and a generic `Panel` card. They
 * were built for a cockpit layout that has since been deleted, and leaving them
 * here was leaving the door open: a `Panel` export is an invitation to wrap the
 * next thing in a card, and `<aside>` is one import away from a sidebar.
 *
 * The regression risk in this project is no longer fabrication. It is someone
 * reasonably concluding, from finding a layout component in the tree, that a
 * layout was intended.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

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
                ? 'border-[#00F58C]/35 bg-[#00F58C]/[0.05]'
                : 'border-border bg-bg-primary/40 opacity-55')}
          >
            <div className={cn('text-[9px] font-mono uppercase tracking-[0.14em]',
              stage.reached ? 'text-[#00F58C]' : 'text-text-muted')}>
              {stage.name}
            </div>
            <div className="text-[10px] text-text-secondary mt-1">{stage.note}</div>
            <div className="text-[9px] font-mono text-text-muted/60 mt-0.5">
              {stage.at ?? '—'}
            </div>
          </motion.div>
          {index < stages.length - 1 && (
            <div className="flex items-center px-1 shrink-0">
              <span className={cn('text-xs', stage.reached ? 'text-[#00F58C]/50' : 'text-text-muted/30')}>→</span>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>

    <div className="flex items-baseline gap-3 mt-3 flex-wrap">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">
        latest record
      </span>
      <span className="text-[11px] font-mono text-[#00F58C]">{latest ?? 'none held'}</span>
      {latest && onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto text-[10px] font-mono uppercase tracking-[0.16em] text-[#00F58C]/70 hover:text-[#00F58C] transition-colors"
        >
          open record →
        </button>
      )}
    </div>
  </div>
);


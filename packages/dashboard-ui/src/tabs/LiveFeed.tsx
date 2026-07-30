/**
 * The recorder, recording.
 *
 * Everything else in this console shows what a record *was*. This shows records
 * arriving — which is the only part that cannot be conveyed by a screenshot, and
 * the reason a flight recorder is believable as one.
 *
 * The single rule that keeps motion honest: **only records this client actually
 * watched arrive are animated.** Replaying history with an entrance animation
 * would tell a viewer that thirty things just happened. That is a lie told with
 * motion, and motion is the easiest way to overstate something — which makes it
 * the easiest way to break the only principle this product has.
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils';
import type { LiveExecution } from '../hooks/useSocket';

const relative = (iso: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

/**
 * Which stage of the loop this record demonstrates.
 *
 * Derived from fields that exist on the record, never guessed: a governed record
 * reached Govern, a failure needs Arbitrate, a scoped one passed Verify. This is
 * the product's own model, shown happening.
 */
function stageOf(execution: LiveExecution): { stage: string; tone: 'ok' | 'warn' | 'bad' } {
  if (execution.outcome === 'failure') return { stage: 'Arbitrate', tone: 'bad' };
  if (!execution.scope || execution.scope.length === 0) return { stage: 'Observe', tone: 'warn' };
  if (execution.governance) return { stage: 'Govern', tone: 'ok' };
  return { stage: 'Verify', tone: 'ok' };
}

export const LiveFeed = ({
  executions,
  arrivedIds,
  connected,
  onSelect,
}: {
  executions: LiveExecution[];
  arrivedIds: Set<string>;
  connected: boolean;
  onSelect?: (execution: LiveExecution) => void;
}) => (
  <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            connected ? 'bg-emerald-400 live-pulse' : 'bg-red-400'
          )}
        />
        <h3 className="text-sm font-semibold text-text-primary">Live</h3>
        <span className="text-[11px] text-text-muted">
          {connected ? 'observing' : 'not connected — nothing is being observed'}
        </span>
      </div>
      <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">
        {executions.length} in view
      </span>
    </div>

    {executions.length === 0 ? (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-text-muted">Nothing recorded yet.</p>
        <p className="text-xs text-text-muted/70 mt-1">
          Any instrumented agent that acts will appear here, signed, without being asked to.
        </p>
      </div>
    ) : (
      <div className="max-h-[30rem] overflow-y-auto">
        <AnimatePresence initial={false}>
          {executions.map(execution => {
            const isNew = arrivedIds.has(execution.id);
            const { stage, tone } = stageOf(execution);

            return (
              <motion.button
                key={execution.id}
                type="button"
                onClick={() => onSelect?.(execution)}
                // Only a watched arrival animates. Everything else is simply there.
                initial={isNew ? { opacity: 0, y: -12, backgroundColor: 'rgba(16,185,129,0.14)' } : false}
                animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(0,0,0,0)' }}
                transition={{ duration: 0.45, ease: 'easeOut', backgroundColor: { duration: 1.6 } }}
                className="w-full text-left px-4 py-2.5 border-b border-border/50 hover:bg-bg-tertiary/40 transition-colors block"
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span
                    className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      execution.outcome === 'success' ? 'bg-emerald-500' : 'bg-red-500'
                    )}
                  />
                  <span className="text-xs font-mono text-text-primary">{execution.action}</span>
                  <span className="text-[11px] text-text-muted">{execution.subject}</span>

                  <span
                    className={cn(
                      'ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border',
                      tone === 'ok'
                        ? 'border-emerald-500/30 text-emerald-400/90'
                        : tone === 'warn'
                          ? 'border-amber-500/30 text-amber-400/90'
                          : 'border-red-500/30 text-red-400/90'
                    )}
                  >
                    {stage}
                  </span>
                  <span className="text-[10px] font-mono text-text-muted shrink-0">
                    {relative(execution.startedAt)}
                  </span>
                </div>

                <div className="text-[10px] font-mono text-text-muted/70 mt-1 truncate">
                  {execution.governance
                    ? `under ${execution.governance.policyRef} v${execution.governance.policyVersion} · `
                    : ''}
                  {execution.scope && execution.scope.length > 0
                    ? execution.scope.join(', ')
                    : 'no scope recorded'}
                  {' · '}
                  {execution.hash.slice(0, 12)}…
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    )}

    <div className="px-4 py-2 border-t border-border">
      <p className="text-[10px] text-text-muted/70 leading-snug">
        Only records that arrived while you were watching are animated. History does not
        pretend to be news.
      </p>
    </div>
  </div>
);

export default LiveFeed;

/**
 * The moment a link is sealed, drawn once, for a link that was actually sealed.
 *
 * The room could always show a *sealed* chain — a head hash, a link count, a
 * green tick. What it could not show was the sealing: the instant a record
 * closes over the one before it and the history stops being editable.
 *
 * There was a component for this before and it was deleted rather than kept,
 * for the right reason. It looped. It drew evidence forming continuously
 * whether or not anything had been recorded, which is the most persuasive way a
 * screen can lie — motion reads as activity, and a viewer will believe a moving
 * diagram over a static number every time.
 *
 * So the rule this is built to:
 *
 *   **One record arrives, one seal is drawn, and then it stops.**
 *
 * The trigger is `arrivedIds` from the socket, which by construction holds only
 * records that landed while somebody was watching — the initial snapshot is
 * excluded, because animating thirty historical records on page load would tell
 * the viewer that thirty things just happened.
 *
 * Nothing here is `infinite`, so there is no perpetual animation to register
 * with check-motion-is-evidence. The animation *is* the event.
 *
 * Every value shown is real: the previous head, the new hash, the sequence
 * position. If a record arrived with no `prevHash` this renders nothing rather
 * than drawing a link it cannot substantiate.
 */
import { useEffect, useState } from 'react';
import type { LiveExecution } from '../hooks/useSocket';

/** Long enough to read two hashes, short enough not to become scenery. */
const SEAL_MS = 2600;

interface Seal {
  id: string;
  prevHash: string;
  hash: string;
  subject: string;
  action: string;
  outcome: 'success' | 'failure';
}

export function ChainSeal({ executions, arrivedIds }: {
  executions: LiveExecution[];
  /** Only records that landed while watching. History does not pretend to be news. */
  arrivedIds: Set<string>;
}) {
  const [seal, setSeal] = useState<Seal | null>(null);

  /*
   * The newest arrival that carries both halves of a link.
   *
   * `prevHash` is what makes this a chain rather than a list, so a record
   * without one is not a sealing event and is skipped in silence. Drawing a
   * link from an unknown predecessor would be inventing the very thing this
   * animation exists to demonstrate.
   */
  const newest = executions.find(
    execution => arrivedIds.has(execution.id) && execution.hash && execution.prevHash
  );

  useEffect(() => {
    if (!newest) return;
    setSeal({
      id: newest.id,
      prevHash: newest.prevHash!,
      hash: newest.hash,
      subject: newest.subject,
      action: newest.action,
      outcome: newest.outcome,
    });

    // Cleared rather than left on screen. A seal that lingers becomes a label,
    // and a label implies a state that is continuously true.
    const timer = window.setTimeout(() => setSeal(null), SEAL_MS);
    return () => window.clearTimeout(timer);
  }, [newest?.id]);

  if (!seal) return null;

  const tone = seal.outcome === 'failure' ? '#DC2626' : '#00F58C';

  return (
    <div
      className="absolute bottom-24 left-8 z-20 pointer-events-none ab-seal"
      data-chain-seal={seal.id}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: tone }}>
          Link sealed
        </span>
      </div>

      {/*
        The two hashes and the link between them. The line is drawn left to
        right exactly once — the geometry of the thing being claimed, rather
        than decoration placed near a claim.
      */}
      <div className="flex items-center gap-2 font-mono text-[10px]">
        <span className="text-ab-white/40 tabular-nums">{seal.prevHash.slice(0, 10)}…</span>
        <span className="relative block w-16 h-px bg-ab-white/15 overflow-hidden">
          <span className="absolute inset-y-0 left-0 ab-seal-link" style={{ background: tone }} />
        </span>
        <span className="tabular-nums" style={{ color: tone }}>{seal.hash.slice(0, 10)}…</span>
      </div>

      <p className="mt-2 max-w-[17rem] text-[11px] leading-relaxed text-ab-white/45">
        <span className="font-mono text-ab-white/70">{seal.subject}</span> · {seal.action}.
        This record now closes over the one before it. Editing either of them breaks the link, and the
        chain names which.
      </p>
    </div>
  );
}

export default ChainSeal;

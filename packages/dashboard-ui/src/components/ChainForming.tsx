/**
 * Evidence chains forming as motion.
 *
 * One link per record actually held, sealed left to right in the order the
 * chain was built. The animation is not a loading bar: each link lands only
 * after the link before it, because that is how the chain is verified — every
 * hash depends on its predecessor, so nothing after a break can be trusted.
 *
 * When the chain is broken, links stop sealing at the break and the remainder
 * is drawn unsealed. That is the honest picture: everything before the break
 * still verifies, everything after it is unproven.
 *
 * The count is real. If eight records are held, eight links are drawn. Above a
 * threshold the row says how many it is showing rather than silently
 * truncating, because a chain drawn shorter than it is would misstate the very
 * thing it exists to show.
 */
import { motion } from 'framer-motion';
import { cn } from '../utils';

const MAX_DRAWN = 60;

export const ChainForming = ({ held, verified, brokenAt, checkable = true, verifying = false }: {
  /** Records actually held. */
  held: number;
  /** Links confirmed on the last verification pass. */
  verified: number;
  /** Index of the first link that failed, if any. */
  brokenAt?: number;
  /** False when the chain could not be read at all. */
  checkable?: boolean;
  verifying?: boolean;
}) => {
  if (held === 0) {
    return (
      <p className="text-xs text-text-muted">
        No records held, so there is no chain to form. An empty chain is not a broken one.
      </p>
    );
  }

  const drawn = Math.min(held, MAX_DRAWN);

  return (
    <div>
      <div className="flex items-center gap-[3px] flex-wrap">
        {Array.from({ length: drawn }, (_, index) => {
          const isBroken = brokenAt !== undefined && index >= brokenAt;
          const isSealed = checkable && !isBroken && index < verified;

          return (
            <motion.span
              key={index}
              // Each link waits for the one before it. The stagger is the
              // dependency, not decoration.
              initial={{ opacity: 0, scaleY: 0.2 }}
              animate={{ opacity: 1, scaleY: 1 }}
              transition={{ delay: Math.min(index * 0.035, 2.2), duration: 0.3, ease: 'easeOut' }}
              className={cn('block w-[7px] h-5 rounded-[2px] border',
                !checkable ? 'border-amber-500/40 bg-amber-500/10'
                  : isBroken ? 'border-red-500/50 bg-red-500/10'
                  : isSealed ? 'border-[#00F58C]/50 bg-[#00F58C]/20 chain-link-sealed'
                  : 'border-border bg-bg-primary/60')}
            />
          );
        })}
        {verifying && (
          <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.16em] text-[#00D9FF]/70">
            sealing…
          </span>
        )}
      </div>

      <p className="text-[10px] text-text-muted/70 mt-2 leading-snug">
        {!checkable
          ? `${held.toLocaleString('en-US')} link(s) held; the chain could not be read, so none is drawn as sealed. Unknown is not broken.`
          : brokenAt !== undefined
            ? `Sealed to link ${brokenAt}. Everything before the break still verifies; everything after it is unproven, because each hash depends on the one before.`
            : `${verified.toLocaleString('en-US')} of ${held.toLocaleString('en-US')} link(s) sealed on the last pass. Each link lands after its predecessor because that is the order the chain verifies in.`}
        {held > MAX_DRAWN && ` Showing the first ${MAX_DRAWN} of ${held.toLocaleString('en-US')}.`}
      </p>
    </div>
  );
};

export default ChainForming;

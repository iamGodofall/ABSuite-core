/**
 * The layer surfaces, as components rather than as repeated markup.
 *
 * All seven surfaces shared a design system and led with state, and underneath
 * that they were still the original components: hand-assembled divs, restyled
 * from outside by a block of `.ab-surface` overrides in globals.css. It worked
 * and it looked right, which is exactly why it survived — the seam was
 * structural, not visual.
 *
 * Measured before writing any of this:
 *
 *     40 panel divs across 19 files
 *     29 of them carrying the identical class string, character for character
 *     25 hand-written empty states
 *     17 hand-written error boxes
 *
 * The cost of that is not aesthetic. Every one of those is a place where the
 * next person writes `<div className="rounded-xl border border-border …">` from
 * memory and gets it slightly wrong, and a place where a decision this project
 * actually cares about — that an empty state must say what is absent rather than
 * apologise, that an error must name what failed — has to be re-made by hand and
 * can quietly not be.
 *
 * So these are not styling wrappers. Each one carries a rule:
 *
 *   `Panel`    — a heading is a claim about what is inside it, so it is required.
 *   `Empty`    — states what is absent and why, never "no data".
 *   `Problem`  — names what failed and what would resolve it.
 *   `Reading`  — state before explanation, in the four words, or nothing.
 *   `Note`     — the limits of what is above it, in the same voice everywhere.
 *
 * `check-surface-primitives.mjs` fails the build when a new ad-hoc panel appears
 * in a tab, so this does not decay back into forty divs.
 */
import type { ReactNode } from 'react';
import { cn } from '../utils';

export type SurfaceState = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

const STATE_TONE: Record<SurfaceState, string> = {
  DEMONSTRATED: 'text-[#00F58C] border-[#00F58C]/30',
  FAILED: 'text-red-400 border-red-500/30',
  UNKNOWN: 'text-amber-400 border-amber-500/30',
  ABSENT: 'text-text-muted border-border',
};

/**
 * A titled region of a surface.
 *
 * `title` is required and is not decoration: a panel without one is a box of
 * facts whose relationship to each other the reader has to infer, and inference
 * is the thing this product exists to remove. `subtitle` is where the panel says
 * what it will not claim, which is why it sits under the title rather than at
 * the bottom in smaller text.
 */
export function Panel({ title, subtitle, footnote, actions, children, className }: {
  title: string;
  /** What this panel does and does not assert. */
  subtitle?: string;
  /** The limits of what is above. Rendered in the muted voice, below the rule. */
  footnote?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-bg-secondary p-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="text-xs text-text-muted mt-1 leading-relaxed max-w-3xl">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </div>

      {children && <div className={cn(subtitle || actions ? 'mt-3' : 'mt-2')}>{children}</div>}

      {footnote && (
        <p className="text-[11px] text-text-muted/70 mt-3 pt-2 border-t border-border/50 leading-relaxed">
          {footnote}
        </p>
      )}
    </section>
  );
}

/**
 * Nothing is here, and the reason is stated.
 *
 * "No data" is the wrong sentence in this product. There is a difference
 * between *nothing has happened*, *nothing was recorded*, and *this cannot be
 * read from here*, and collapsing them is how an empty screen reads as a
 * healthy one. `because` is required for that reason.
 */
export function Empty({ because, resolvedBy }: { because: string; resolvedBy?: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-6">
      <p className="text-sm text-text-muted leading-relaxed">{because}</p>
      {resolvedBy && <p className="text-xs text-text-muted/70 mt-2 leading-relaxed">{resolvedBy}</p>}
    </div>
  );
}

/**
 * Something failed, and it says what.
 *
 * Amber rather than red, deliberately: a screen that cannot reach a service has
 * not discovered a failure in the record, and colouring the two the same way is
 * how an operator learns to ignore red.
 */
export function Problem({ title, what, resolvedBy, actions }: {
  /**
   * What kind of problem this is, in the product's own voice.
   *
   * Added after migrating the real ones, which all had a heading and were
   * better for it: "Not measured on this machine" and "Counts unavailable" say
   * something the raw error string does not, and burying that in body text was
   * the primitive being poorer than the markup it replaced.
   */
  title?: string;
  what: ReactNode;
  resolvedBy?: string;
  /** A retry, usually. The one place a failure should offer a way forward. */
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4" role="alert">
      {title && <p className="text-sm font-semibold text-amber-400 mb-1">{title}</p>}
      <div className={cn('text-xs leading-relaxed', title ? 'text-text-muted' : 'text-amber-400')}>{what}</div>
      {resolvedBy && <p className="text-[11px] text-amber-400/70 mt-1.5 leading-relaxed">{resolvedBy}</p>}
      {actions && <div className="mt-3 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Work is in progress. Never a skeleton pretending to be content. */
export function Loading({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-6">
      <p className="text-sm text-text-muted">{what}</p>
    </div>
  );
}

/**
 * A determination, in the four words, ahead of any explanation of it.
 *
 * The figure and the word travel together and neither is optional, because a
 * number with no determination invites the reader to supply one.
 */
export function Reading({ state, metric, answers }: {
  state: SurfaceState;
  metric: string;
  /** The question this reading answers. */
  answers?: string;
}) {
  return (
    <div className="flex items-baseline gap-4 flex-wrap">
      <span className={cn('font-mono text-[28px] leading-none tabular-nums', STATE_TONE[state].split(' ')[0])}>
        {metric}
      </span>
      <span className={cn('font-mono text-[10px] uppercase tracking-[0.24em]', STATE_TONE[state].split(' ')[0])}>
        {state}
      </span>
      {answers && (
        <span className="ml-auto text-[10px] text-text-muted font-mono uppercase tracking-[0.16em]">{answers}</span>
      )}
    </div>
  );
}

/** A counted fact, as a capsule. Never a score, never a percentage. */
export function Badge({ state, children }: { state?: SurfaceState; children: ReactNode }) {
  return (
    <span className={cn(
      'text-[10px] font-mono px-2 py-0.5 rounded-full border whitespace-nowrap',
      state ? STATE_TONE[state] : 'border-border text-text-muted'
    )}>
      {children}
    </span>
  );
}

/**
 * What the thing above it does not tell you.
 *
 * A separate component because this sentence keeps being written in a different
 * size and colour on every surface, and the one place it must never look like an
 * afterthought is the place where the product admits a limit.
 */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-text-muted/70 leading-relaxed px-1">{children}</p>;
}

export const Surface = { Panel, Empty, Problem, Loading, Reading, Badge, Note };
export default Surface;

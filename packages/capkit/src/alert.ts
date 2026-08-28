/**
 * Telling somebody when the chain breaks.
 *
 * ## Why this is the tier, not a nicety
 *
 * The watch already walks the chain on every sweep and raises a notice. That is
 * a finding sitting on a page, and a finding nobody reads is not vigilance —
 * the whole value of a tamper-evident ledger is the SPEED at which tampering is
 * noticed, and a dashboard is only as fast as the next time somebody opens it.
 * An alert closes that gap, and it is the first thing in this product a person
 * genuinely cannot self-host their way around: they can run the sweep, but they
 * cannot be woken by it.
 *
 * ## It fires on the TRANSITION, never on the state
 *
 * `watch` deliberately re-raises a standing problem as one notice seen many
 * times rather than a thousand notices. An alerter that sent on every sweep
 * would undo that: a chain broken on Monday would send an alert every five
 * minutes until Friday, and by Wednesday the recipient has a filter for it. An
 * alert that has been muted is worse than no alert, because everybody still
 * believes it is working.
 *
 * So state is remembered, and only a CHANGE is sent — broken when it was whole,
 * and whole again when it was broken. The recovery matters as much as the
 * break: a person who was told at 3am and never told it was fixed will not
 * trust the next one.
 */
import { guardedFetch } from './guarded-fetch';
import { type AddressRange } from './outbound';

export type ChainState = 'whole' | 'broken';

export interface ChainAlert {
  event: 'chain.broken' | 'chain.recovered';
  at: string;
  /** Absent on recovery. */
  brokenAt?: number;
  brokenId?: string;
  reason?: string;
  /** Whatever the operator named this instance, so an alert says where from. */
  instance?: string;
}

/**
 * Decide whether this sweep should send, and what.
 *
 * Pure. The delivery is separate so the DECISION can be tested exhaustively
 * without a network, which is where every mistake in this file would live.
 */
export function alertForTransition(
  previous: ChainState | undefined,
  current: ChainState,
  detail: { brokenAt?: number; brokenId?: string; reason?: string; instance?: string; at?: string } = {}
): ChainAlert | undefined {
  const at = detail.at ?? new Date().toISOString();

  /*
   * The FIRST sweep of a process is not a transition and must not alert on a
   * whole chain — every restart would announce good news nobody asked for. A
   * first sweep that finds a BROKEN chain does alert, because the alternative
   * is silence about a broken ledger until it changes state, which on a
   * ledger nobody is writing to is never.
   */
  if (previous === undefined) {
    return current === 'broken'
      ? { event: 'chain.broken', at, ...strip(detail) }
      : undefined;
  }

  if (previous === current) return undefined;

  return current === 'broken'
    ? { event: 'chain.broken', at, ...strip(detail) }
    : { event: 'chain.recovered', at, ...(detail.instance ? { instance: detail.instance } : {}) };
}

function strip(d: { brokenAt?: number; brokenId?: string; reason?: string; instance?: string }) {
  return {
    ...(d.brokenAt !== undefined ? { brokenAt: d.brokenAt } : {}),
    ...(d.brokenId ? { brokenId: d.brokenId } : {}),
    ...(d.reason ? { reason: d.reason } : {}),
    ...(d.instance ? { instance: d.instance } : {}),
  };
}

export interface AlertDelivery {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * POST an alert to an operator-configured URL.
 *
 * Through `guardedFetch`, because the destination is configuration and
 * configuration is reachable by anyone who can edit configuration — the SSRF
 * this repository has already found four times. A webhook pointed at
 * `169.254.169.254` would turn an alerting feature into a credential leak.
 *
 * Never throws. An alerter that can take down the sweep it rides on has made
 * the monitoring worse than not having it.
 */
export async function deliverAlert(
  url: string,
  alert: ChainAlert,
  options: { refuse: AddressRange[]; allow?: string[]; timeoutMs?: number } = { refuse: [] }
): Promise<AlertDelivery> {
  try {
    const response = await guardedFetch(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
      },
      { refuse: options.refuse, ...(options.allow ? { allow: options.allow } : {}), verb: 'alert' }
    );
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Remembers the last state so a sweep can ask "has this changed?".
 *
 * In memory on purpose. A restart forgetting that the chain was broken means
 * the next sweep re-announces it, which is the safe direction: a duplicate
 * alert about a real break costs somebody a moment, and a suppressed one costs
 * them the break.
 */
export class ChainAlerter {
  private previous: ChainState | undefined;

  /** Returns the alert to send, or undefined when nothing changed. */
  observe(
    current: ChainState,
    detail: { brokenAt?: number; brokenId?: string; reason?: string; instance?: string; at?: string } = {}
  ): ChainAlert | undefined {
    const alert = alertForTransition(this.previous, current, detail);
    this.previous = current;
    return alert;
  }

  /** What it last saw. For a status page that must not claim more than it knows. */
  get lastSeen(): ChainState | undefined {
    return this.previous;
  }
}

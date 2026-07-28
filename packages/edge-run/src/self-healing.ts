/**
 * Self-healing: a circuit breaker keyed by target.
 *
 * When a dependency starts failing, retrying into it makes things worse for
 * everyone. After a threshold of consecutive failures the breaker opens and
 * work for that target is held back; after a cooldown it half-opens and lets a
 * single probe through to decide whether to close again.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  /** Successes required in half-open before fully closing. */
  successThreshold?: number;
}

interface BreakerRecord {
  state: BreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number;
  totalFailures: number;
  totalSuccesses: number;
  /** Set while a half-open probe is in flight, so only one is admitted. */
  probeInFlight: boolean;
}

export class SelfHealing {
  private readonly records = new Map<string, BreakerRecord>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly successThreshold: number;

  constructor(options: BreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? Number(process.env.EDGERUN_FAILURE_THRESHOLD || 5));
    this.cooldownMs = Math.max(1000, options.cooldownMs ?? Number(process.env.EDGERUN_COOLDOWN_MS || 30_000));
    this.successThreshold = Math.max(1, options.successThreshold ?? 2);
  }

  private record(target: string): BreakerRecord {
    let existing = this.records.get(target);
    if (!existing) {
      existing = {
        state: 'closed',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        openedAt: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        probeInFlight: false,
      };
      this.records.set(target, existing);
    }
    return existing;
  }

  /**
   * May work proceed against this target right now?
   *
   * Transitions open -> half-open once the cooldown has elapsed, and admits
   * exactly one probe so a recovering dependency is not stampeded.
   */
  canProceed(target: string, now: number = Date.now()): boolean {
    const record = this.record(target);

    if (record.state === 'closed') return true;

    if (record.state === 'open') {
      if (now - record.openedAt < this.cooldownMs) return false;
      record.state = 'half-open';
      record.consecutiveSuccesses = 0;
      record.probeInFlight = true;
      return true;
    }

    if (record.probeInFlight) return false;
    record.probeInFlight = true;
    return true;
  }

  succeed(target: string): void {
    const record = this.record(target);
    record.totalSuccesses += 1;
    record.consecutiveFailures = 0;
    record.probeInFlight = false;

    if (record.state === 'half-open') {
      record.consecutiveSuccesses += 1;
      if (record.consecutiveSuccesses >= this.successThreshold) {
        record.state = 'closed';
        record.consecutiveSuccesses = 0;
      }
      return;
    }

    record.state = 'closed';
  }

  fail(target: string, now: number = Date.now()): void {
    const record = this.record(target);
    record.totalFailures += 1;
    record.consecutiveFailures += 1;
    record.consecutiveSuccesses = 0;
    record.probeInFlight = false;

    // A failed probe sends us straight back to open — the dependency is not well.
    if (record.state === 'half-open' || record.consecutiveFailures >= this.failureThreshold) {
      record.state = 'open';
      record.openedAt = now;
    }
  }

  stateOf(target: string): BreakerState {
    return this.records.get(target)?.state ?? 'closed';
  }

  snapshot(): Record<string, { state: BreakerState; failures: number; successes: number }> {
    const output: Record<string, { state: BreakerState; failures: number; successes: number }> = {};
    for (const [target, record] of this.records) {
      output[target] = { state: record.state, failures: record.totalFailures, successes: record.totalSuccesses };
    }
    return output;
  }

  reset(target?: string): void {
    if (target) this.records.delete(target);
    else this.records.clear();
  }
}

/** Identify the dependency a task talks to, so failures group sensibly. */
export function targetOf(task: { type: string; url?: string; script?: string }): string {
  if (task.type === 'http' && task.url) {
    try {
      return new URL(task.url).hostname;
    } catch {
      return 'invalid-url';
    }
  }
  if (task.type === 'script' && task.script) return `script:${task.script}`;
  return task.type;
}

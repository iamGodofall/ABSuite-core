/**
 * Cron scheduler.
 *
 * Holds schedule definitions and, on each tick, enqueues the ones that are due.
 * The scheduler never executes work itself — it hands off to the queue, so
 * concurrency, retries and circuit-breaking apply uniformly to scheduled and
 * ad-hoc work alike.
 */
import { nextRun, isValidCron } from './cron';
import type { TaskDefinition } from './runtime';
import type { RetryPolicy, TaskQueue } from './queue';

export type ScheduleStatus = 'active' | 'paused';

export interface ScheduleDefinition {
  id: string;
  cron: string;
  task: TaskDefinition;
  retry?: RetryPolicy;
  timeout?: number;
}

export interface Schedule extends ScheduleDefinition {
  status: ScheduleStatus;
  nextRun: string;
  lastRun?: string;
  runCount: number;
  failureCount: number;
  createdAt: string;
}

export class AgentScheduler {
  private readonly schedules = new Map<string, Schedule>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly queue: TaskQueue) {}

  schedule(definition: ScheduleDefinition): Schedule {
    if (!definition.id) throw new Error('A schedule id is required');
    if (!isValidCron(definition.cron)) throw new Error(`Invalid cron expression: "${definition.cron}"`);
    if (!definition.task || !definition.task.type) throw new Error('A task definition is required');

    const existing = this.schedules.get(definition.id);
    const entry: Schedule = {
      ...definition,
      status: 'active',
      nextRun: nextRun(definition.cron).toISOString(),
      runCount: existing?.runCount ?? 0,
      failureCount: existing?.failureCount ?? 0,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...(existing?.lastRun ? { lastRun: existing.lastRun } : {}),
    };

    this.schedules.set(definition.id, entry);
    return entry;
  }

  get(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  remove(id: string): boolean {
    return this.schedules.delete(id);
  }

  pause(id: string): Schedule | undefined {
    const schedule = this.schedules.get(id);
    if (schedule) schedule.status = 'paused';
    return schedule;
  }

  resume(id: string): Schedule | undefined {
    const schedule = this.schedules.get(id);
    if (!schedule) return undefined;
    schedule.status = 'active';
    // Recompute from now so a long pause does not fire a burst of catch-ups.
    schedule.nextRun = nextRun(schedule.cron).toISOString();
    return schedule;
  }

  /**
   * Enqueue every schedule that is due. Returns the ids that fired.
   *
   * Each firing gets a unique task id so a slow run never collides with the
   * next one, and the schedule's own next-run time advances immediately.
   */
  tick(now: Date = new Date()): string[] {
    const fired: string[] = [];

    for (const schedule of this.schedules.values()) {
      if (schedule.status !== 'active') continue;
      if (Date.parse(schedule.nextRun) > now.getTime()) continue;

      try {
        this.queue.enqueue(schedule.task, {
          id: `${schedule.id}-${now.getTime()}`,
          priority: 'normal',
          scheduleId: schedule.id,
          ...(schedule.retry ? { retry: schedule.retry } : {}),
          ...(schedule.timeout !== undefined ? { timeoutMs: schedule.timeout } : {}),
        });

        schedule.runCount += 1;
        schedule.lastRun = now.toISOString();
        fired.push(schedule.id);
      } catch (error) {
        // A full queue must not wedge the scheduler; count it and move on.
        schedule.failureCount += 1;
        console.error(`[edge-run] Schedule ${schedule.id} could not enqueue:`, (error as Error).message);
      }

      schedule.nextRun = nextRun(schedule.cron, now).toISOString();
    }

    return fired;
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Record the outcome of a scheduled run so failure counts stay meaningful. */
  recordOutcome(scheduleId: string, ok: boolean): void {
    const schedule = this.schedules.get(scheduleId);
    if (schedule && !ok) schedule.failureCount += 1;
  }
}

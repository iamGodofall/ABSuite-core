/**
 * Durable schedules and queued work.
 *
 * Without this, a restart silently drops every registered schedule and every
 * pending task — which is fine for a demo and disqualifying for anything with
 * an SLA. Records are written through to the shared ABSuite database, so a
 * restarted process resumes exactly where it left off.
 *
 * When no database is configured the whole layer becomes a no-op, so local
 * development stays zero-setup.
 */
import type { Storage } from '@absuite/capkit';
import type { TaskDefinition } from './runtime';
import type { QueuedTask, Priority, TaskState, RetryPolicy } from './queue';
import type { Schedule } from './scheduler';

export class EdgeRunPersistence {
  /** Null storage means "not configured"; every method becomes a no-op. */
  constructor(private readonly storage: Storage | null) {}

  get enabled(): boolean {
    return this.storage !== null;
  }

  // ---- Schedules ----

  saveSchedule(schedule: Schedule, tenantId?: string): void {
    if (!this.storage) return;

    this.storage.run(
      `INSERT INTO schedules (id, tenant_id, cron, task, retry, timeout_ms, status, next_run, last_run, run_count, failure_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET
         cron = excluded.cron, task = excluded.task, retry = excluded.retry,
         timeout_ms = excluded.timeout_ms, status = excluded.status,
         next_run = excluded.next_run, last_run = excluded.last_run,
         run_count = excluded.run_count, failure_count = excluded.failure_count`,
      schedule.id,
      tenantId ?? null,
      schedule.cron,
      JSON.stringify(schedule.task),
      schedule.retry ? JSON.stringify(schedule.retry) : null,
      schedule.timeout ?? null,
      schedule.status,
      schedule.nextRun,
      schedule.lastRun ?? null,
      schedule.runCount,
      schedule.failureCount,
      schedule.createdAt
    );
  }

  deleteSchedule(id: string): void {
    this.storage?.run('DELETE FROM schedules WHERE id = ?', id);
  }

  loadSchedules(): Array<{ definition: { id: string; cron: string; task: TaskDefinition; retry?: RetryPolicy; timeout?: number }; status: string; runCount: number; failureCount: number }> {
    if (!this.storage) return [];

    return this.storage
      .all<{
        id: string; cron: string; task: string; retry: string | null;
        timeout_ms: number | null; status: string; run_count: number; failure_count: number;
      }>('SELECT * FROM schedules')
      .flatMap(row => {
        try {
          return [{
            definition: {
              id: row.id,
              cron: row.cron,
              task: JSON.parse(row.task) as TaskDefinition,
              ...(row.retry ? { retry: JSON.parse(row.retry) as RetryPolicy } : {}),
              ...(row.timeout_ms !== null ? { timeout: Number(row.timeout_ms) } : {}),
            },
            status: row.status,
            runCount: Number(row.run_count),
            failureCount: Number(row.failure_count),
          }];
        } catch {
          // A corrupt row must not stop the service from starting.
          console.error(`[edge-run] Skipping unreadable schedule: ${row.id}`);
          return [];
        }
      });
  }

  // ---- Queue ----

  saveTask(task: QueuedTask, tenantId?: string): void {
    if (!this.storage) return;

    this.storage.run(
      `INSERT INTO queue_tasks (id, tenant_id, priority, task, retry, timeout_ms, state, attempts, available_at, queued_at, started_at, completed_at, last_error, result, schedule_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (id) DO UPDATE SET
         state = excluded.state, attempts = excluded.attempts,
         available_at = excluded.available_at, started_at = excluded.started_at,
         completed_at = excluded.completed_at, last_error = excluded.last_error,
         result = excluded.result`,
      task.id,
      tenantId ?? null,
      task.priority,
      JSON.stringify(task.task),
      JSON.stringify(task.retry),
      task.timeoutMs ?? null,
      task.state,
      task.attempts,
      task.availableAt,
      task.queuedAt,
      task.startedAt ?? null,
      task.completedAt ?? null,
      task.lastError ?? null,
      task.result ? JSON.stringify(task.result) : null,
      task.scheduleId ?? null
    );
  }

  /**
   * Tasks to resume after a restart.
   *
   * A task recorded as `running` when the process died never completed, so it
   * comes back as `queued` — at-least-once delivery. Callers whose tasks are
   * not idempotent should say so in their own design; silently dropping the
   * work would be the worse default.
   */
  loadPendingTasks(): Array<{ id: string; task: TaskDefinition; priority: Priority; retry: RetryPolicy; timeoutMs?: number; attempts: number; availableAt: number; scheduleId?: string }> {
    if (!this.storage) return [];

    return this.storage
      .all<{
        id: string; priority: string; task: string; retry: string; timeout_ms: number | null;
        state: string; attempts: number; available_at: number; schedule_id: string | null;
      }>("SELECT * FROM queue_tasks WHERE state IN ('queued','running')")
      .flatMap(row => {
        try {
          return [{
            id: row.id,
            task: JSON.parse(row.task) as TaskDefinition,
            priority: (row.priority as Priority) ?? 'normal',
            retry: JSON.parse(row.retry) as RetryPolicy,
            ...(row.timeout_ms !== null ? { timeoutMs: Number(row.timeout_ms) } : {}),
            attempts: Number(row.attempts),
            availableAt: Number(row.available_at),
            ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}),
          }];
        } catch {
          console.error(`[edge-run] Skipping unreadable task: ${row.id}`);
          return [];
        }
      });
  }

  /** Drop finished tasks older than the retention window. */
  pruneTasks(maxAgeMs = 86_400_000): void {
    if (!this.storage) return;
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    this.storage.run(
      "DELETE FROM queue_tasks WHERE state IN ('completed','dead','failed') AND completed_at IS NOT NULL AND completed_at < ?",
      cutoff
    );
  }

  countPending(): number {
    if (!this.storage) return 0;
    const row = this.storage.get<{ n: number }>("SELECT COUNT(*) AS n FROM queue_tasks WHERE state IN ('queued','running')");
    return Number(row?.n ?? 0);
  }

  countSchedules(): number {
    if (!this.storage) return 0;
    const row = this.storage.get<{ n: number }>('SELECT COUNT(*) AS n FROM schedules');
    return Number(row?.n ?? 0);
  }
}

/** Build persistence from the environment; disabled when no database is set. */
export function persistenceFromEnv(
  getStorage: (env?: NodeJS.ProcessEnv) => Storage,
  env: NodeJS.ProcessEnv = process.env
): EdgeRunPersistence {
  const configured = (env.ABSUITE_DB_PATH || env.CAPKIT_DB_PATH || '').trim();
  return new EdgeRunPersistence(configured ? getStorage(env) : null);
}

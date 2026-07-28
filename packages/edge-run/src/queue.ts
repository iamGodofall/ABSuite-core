/**
 * Priority queue with bounded concurrency and retry/backoff.
 *
 * Tasks are held in memory and drained by a worker loop. Work is picked by
 * priority, then by the time it became available, so a delayed high-priority
 * task cannot starve normal work that is already runnable.
 */
import { randomUUID } from 'node:crypto';
import type { TaskDefinition, TaskResult, TaskRuntime } from './runtime';

export type Priority = 'high' | 'normal' | 'low';
export type TaskState = 'queued' | 'running' | 'completed' | 'failed' | 'dead';
export type BackoffStrategy = 'fixed' | 'exponential';

export interface RetryPolicy {
  maxAttempts?: number;
  backoff?: BackoffStrategy;
  baseDelay?: number;
  maxDelay?: number;
}

export interface QueuedTask {
  id: string;
  priority: Priority;
  task: TaskDefinition;
  retry: Required<RetryPolicy>;
  timeoutMs?: number;
  state: TaskState;
  attempts: number;
  availableAt: number;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: TaskResult;
  lastError?: string;
  /** Set when the task originated from a schedule. */
  scheduleId?: string;
}

export interface EnqueueOptions {
  id?: string;
  priority?: Priority;
  delay?: number;
  retry?: RetryPolicy;
  timeoutMs?: number;
  scheduleId?: string;
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

const DEFAULT_RETRY: Required<RetryPolicy> = {
  maxAttempts: 3,
  backoff: 'exponential',
  baseDelay: 1000,
  maxDelay: 60_000,
};

/**
 * Delay before the next attempt.
 *
 * Exponential backoff carries full jitter — without it, a batch of tasks that
 * fail together retries in lockstep and hammers the recovering dependency.
 */
export function backoffDelay(policy: Required<RetryPolicy>, attempt: number, random: () => number = Math.random): number {
  const raw = policy.backoff === 'exponential'
    ? policy.baseDelay * Math.pow(2, Math.max(0, attempt - 1))
    : policy.baseDelay;

  const capped = Math.min(raw, policy.maxDelay);
  return policy.backoff === 'exponential' ? Math.round(random() * capped) : capped;
}

export interface QueueOptions {
  concurrency?: number;
  limit?: number;
  runtime: TaskRuntime;
  onEvent?: (event: { type: string; task: QueuedTask; message?: string }) => void;
  /** Consulted before running a task; lets self-healing pause a failing target. */
  canRun?: (task: QueuedTask) => boolean;
}

export class TaskQueue {
  private readonly tasks = new Map<string, QueuedTask>();
  private readonly concurrency: number;
  private readonly limit: number;
  private readonly runtime: TaskRuntime;
  private readonly onEvent: QueueOptions['onEvent'];
  private readonly canRun: QueueOptions['canRun'];
  private running = 0;
  private timer?: NodeJS.Timeout;

  constructor(options: QueueOptions) {
    this.concurrency = Math.max(1, options.concurrency ?? Number(process.env.EDGERUN_MAX_CONCURRENT || 10));
    this.limit = Math.max(1, options.limit ?? Number(process.env.EDGERUN_QUEUE_LIMIT || 100));
    this.runtime = options.runtime;
    this.onEvent = options.onEvent;
    this.canRun = options.canRun;
  }

  enqueue(task: TaskDefinition, options: EnqueueOptions = {}): QueuedTask {
    const pending = this.countByState('queued') + this.countByState('running');
    if (pending >= this.limit) {
      throw new Error(`Queue limit reached (${this.limit})`);
    }

    const id = options.id ?? randomUUID();
    if (this.tasks.has(id)) {
      throw new Error(`Task already exists: ${id}`);
    }

    const queued: QueuedTask = {
      id,
      priority: options.priority ?? 'normal',
      task,
      retry: { ...DEFAULT_RETRY, ...(options.retry ?? {}) },
      state: 'queued',
      attempts: 0,
      availableAt: Date.now() + Math.max(0, options.delay ?? 0),
      queuedAt: new Date().toISOString(),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
    };

    this.tasks.set(id, queued);
    this.onEvent?.({ type: 'enqueued', task: queued });
    return queued;
  }

  get(id: string): QueuedTask | undefined {
    return this.tasks.get(id);
  }

  list(state?: TaskState): QueuedTask[] {
    const all = [...this.tasks.values()];
    return state ? all.filter(task => task.state === state) : all;
  }

  countByState(state: TaskState): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.state === state) count += 1;
    }
    return count;
  }

  /** Next runnable task, or undefined if none is available yet. */
  private nextRunnable(now: number): QueuedTask | undefined {
    let best: QueuedTask | undefined;

    for (const task of this.tasks.values()) {
      if (task.state !== 'queued' || task.availableAt > now) continue;
      if (this.canRun && !this.canRun(task)) continue;

      if (
        !best ||
        PRIORITY_ORDER[task.priority] < PRIORITY_ORDER[best.priority] ||
        (PRIORITY_ORDER[task.priority] === PRIORITY_ORDER[best.priority] && task.availableAt < best.availableAt)
      ) {
        best = task;
      }
    }
    return best;
  }

  /** Drain as much work as concurrency allows. Safe to call repeatedly. */
  async tick(): Promise<void> {
    const now = Date.now();

    while (this.running < this.concurrency) {
      const task = this.nextRunnable(now);
      if (!task) break;

      this.running += 1;
      void this.run(task).finally(() => {
        this.running -= 1;
      });
    }
  }

  private async run(task: QueuedTask): Promise<void> {
    task.state = 'running';
    task.attempts += 1;
    task.startedAt = new Date().toISOString();
    this.onEvent?.({ type: 'started', task });

    const result = await this.runtime.execute(task.task, task.timeoutMs);
    task.result = result;

    if (result.ok) {
      task.state = 'completed';
      task.completedAt = new Date().toISOString();
      this.onEvent?.({ type: 'completed', task });
      return;
    }

    task.lastError = result.error ?? 'Task failed';

    if (task.attempts >= task.retry.maxAttempts) {
      // Exhausted: park it as dead rather than retrying forever.
      task.state = 'dead';
      task.completedAt = new Date().toISOString();
      this.onEvent?.({ type: 'dead', task, message: task.lastError });
      return;
    }

    task.state = 'queued';
    task.availableAt = Date.now() + backoffDelay(task.retry, task.attempts);
    this.onEvent?.({ type: 'retrying', task, message: task.lastError });
  }

  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Do not hold the event loop open purely for the queue.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Drop finished tasks older than the retention window. */
  prune(maxAgeMs = 3_600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, task] of this.tasks) {
      const finished = task.state === 'completed' || task.state === 'dead' || task.state === 'failed';
      if (finished && task.completedAt && Date.parse(task.completedAt) < cutoff) {
        this.tasks.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get stats() {
    return {
      queued: this.countByState('queued'),
      running: this.countByState('running'),
      completed: this.countByState('completed'),
      dead: this.countByState('dead'),
      concurrency: this.concurrency,
      limit: this.limit,
    };
  }
}

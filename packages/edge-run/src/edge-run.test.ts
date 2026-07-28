import { parseCron, nextRun, isValidCron } from './cron';
import { TaskQueue, backoffDelay, type RetryPolicy } from './queue';
import { SelfHealing, targetOf } from './self-healing';
import { AgentScheduler } from './scheduler';
import { TaskRuntime, type TaskDefinition, type TaskResult } from './runtime';

/** Runtime stub so queue tests never touch the network. */
class FakeRuntime {
  public calls: TaskDefinition[] = [];
  constructor(private readonly responder: (task: TaskDefinition, call: number) => TaskResult) {}

  async execute(task: TaskDefinition): Promise<TaskResult> {
    this.calls.push(task);
    return this.responder(task, this.calls.length);
  }
}

const asRuntime = (fake: FakeRuntime) => fake as unknown as TaskRuntime;
const httpTask: TaskDefinition = { type: 'http', url: 'https://example.com/hook' };

describe('cron parsing', () => {
  test('parses a standard expression', () => {
    const fields = parseCron('*/15 * * * *');
    expect([...fields.minute]).toEqual([0, 15, 30, 45]);
    expect(fields.hour.size).toBe(24);
  });

  test('supports ranges, lists and steps', () => {
    expect([...parseCron('0 9-17 * * *').hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...parseCron('0,30 * * * *').minute]).toEqual([0, 30]);
    expect([...parseCron('0 0-23/6 * * *').hour]).toEqual([0, 6, 12, 18]);
  });

  test('supports names and aliases', () => {
    expect(parseCron('0 0 1 jan *').month.has(1)).toBe(true);
    expect(parseCron('0 0 * * mon').dayOfWeek.has(1)).toBe(true);
    expect([...parseCron('@daily').minute]).toEqual([0]);
  });

  test('normalises day 7 onto Sunday', () => {
    const fields = parseCron('0 0 * * 7');
    expect(fields.dayOfWeek.has(0)).toBe(true);
    expect(fields.dayOfWeek.has(7)).toBe(false);
  });

  test('rejects malformed expressions', () => {
    expect(isValidCron('* * * *')).toBe(false);
    expect(isValidCron('60 * * * *')).toBe(false);
    expect(isValidCron('* 25 * * *')).toBe(false);
    expect(isValidCron('10-5 * * * *')).toBe(false);
    expect(isValidCron('*/0 * * * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});

describe('next run calculation', () => {
  test('finds the next quarter hour', () => {
    const from = new Date(2026, 0, 1, 10, 7, 30);
    expect(nextRun('*/15 * * * *', from)).toEqual(new Date(2026, 0, 1, 10, 15, 0, 0));
  });

  test('rolls over to the next day', () => {
    const from = new Date(2026, 0, 1, 23, 45);
    expect(nextRun('0 0 * * *', from)).toEqual(new Date(2026, 0, 2, 0, 0, 0, 0));
  });

  test('is always strictly in the future', () => {
    const from = new Date(2026, 0, 1, 10, 0, 0, 0);
    expect(nextRun('0 10 * * *', from).getTime()).toBeGreaterThan(from.getTime());
  });

  test('handles a sparse schedule (29 Feb) without timing out', () => {
    const from = new Date(2026, 0, 1);
    const next = nextRun('0 0 29 2 *', from);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
    expect(next.getFullYear()).toBe(2028);
  });

  test('treats restricted day-of-month and day-of-week as OR', () => {
    // 1st of the month, or any Monday.
    const from = new Date(2026, 0, 2); // Friday 2 Jan 2026
    const next = nextRun('0 0 1 * mon', from);
    expect(next.getDay()).toBe(1); // the following Monday, 5 Jan
    expect(next.getDate()).toBe(5);
  });
});

describe('backoff', () => {
  const policy: Required<RetryPolicy> = { maxAttempts: 5, backoff: 'exponential', baseDelay: 1000, maxDelay: 60_000 };

  test('grows exponentially before jitter', () => {
    expect(backoffDelay(policy, 1, () => 1)).toBe(1000);
    expect(backoffDelay(policy, 2, () => 1)).toBe(2000);
    expect(backoffDelay(policy, 4, () => 1)).toBe(8000);
  });

  test('caps at maxDelay', () => {
    expect(backoffDelay(policy, 20, () => 1)).toBe(60_000);
  });

  test('applies jitter so retries do not synchronise', () => {
    expect(backoffDelay(policy, 3, () => 0.5)).toBe(2000);
    expect(backoffDelay(policy, 3, () => 0)).toBe(0);
  });

  test('fixed backoff ignores the attempt number', () => {
    const fixed: Required<RetryPolicy> = { ...policy, backoff: 'fixed' };
    expect(backoffDelay(fixed, 1)).toBe(1000);
    expect(backoffDelay(fixed, 9)).toBe(1000);
  });
});

describe('task queue', () => {
  test('runs a task and marks it completed', async () => {
    const runtime = new FakeRuntime(() => ({ ok: true, output: 'done', durationMs: 1 }));
    const queue = new TaskQueue({ runtime: asRuntime(runtime) });

    const task = queue.enqueue(httpTask, { id: 'task-1' });
    await queue.tick();
    await new Promise(resolve => setImmediate(resolve));

    expect(queue.get(task.id)?.state).toBe('completed');
  });

  test('retries a failing task then marks it dead', async () => {
    const runtime = new FakeRuntime(() => ({ ok: false, error: 'boom', durationMs: 1 }));
    const queue = new TaskQueue({ runtime: asRuntime(runtime) });

    queue.enqueue(httpTask, { id: 'task-2', retry: { maxAttempts: 2, backoff: 'fixed', baseDelay: 0 } });

    for (let i = 0; i < 4; i++) {
      await queue.tick();
      await new Promise(resolve => setImmediate(resolve));
    }

    expect(queue.get('task-2')?.state).toBe('dead');
    expect(queue.get('task-2')?.attempts).toBe(2);
  });

  test('honours priority ordering', async () => {
    const order: string[] = [];
    const runtime = new FakeRuntime(task => {
      order.push((task as { url: string }).url);
      return { ok: true, durationMs: 1 };
    });
    const queue = new TaskQueue({ runtime: asRuntime(runtime), concurrency: 1 });

    queue.enqueue({ type: 'http', url: 'low' }, { priority: 'low' });
    queue.enqueue({ type: 'http', url: 'high' }, { priority: 'high' });

    await queue.tick();
    await new Promise(resolve => setImmediate(resolve));
    await queue.tick();
    await new Promise(resolve => setImmediate(resolve));

    expect(order[0]).toBe('high');
  });

  test('does not run a delayed task before it is due', async () => {
    const runtime = new FakeRuntime(() => ({ ok: true, durationMs: 1 }));
    const queue = new TaskQueue({ runtime: asRuntime(runtime) });

    queue.enqueue(httpTask, { id: 'later', delay: 60_000 });
    await queue.tick();

    expect(runtime.calls).toHaveLength(0);
    expect(queue.get('later')?.state).toBe('queued');
  });

  test('enforces the queue limit', () => {
    const runtime = new FakeRuntime(() => ({ ok: true, durationMs: 1 }));
    const queue = new TaskQueue({ runtime: asRuntime(runtime), limit: 1 });

    queue.enqueue(httpTask, { id: 'a' });
    expect(() => queue.enqueue(httpTask, { id: 'b' })).toThrow(/limit/i);
  });

  test('rejects duplicate ids', () => {
    const runtime = new FakeRuntime(() => ({ ok: true, durationMs: 1 }));
    const queue = new TaskQueue({ runtime: asRuntime(runtime) });

    queue.enqueue(httpTask, { id: 'dupe' });
    expect(() => queue.enqueue(httpTask, { id: 'dupe' })).toThrow(/already exists/i);
  });
});

describe('self-healing circuit breaker', () => {
  test('opens after the failure threshold', () => {
    const healing = new SelfHealing({ failureThreshold: 3, cooldownMs: 1000 });

    expect(healing.canProceed('api.example.com')).toBe(true);
    healing.fail('api.example.com');
    healing.fail('api.example.com');
    expect(healing.stateOf('api.example.com')).toBe('closed');

    healing.fail('api.example.com');
    expect(healing.stateOf('api.example.com')).toBe('open');
    expect(healing.canProceed('api.example.com')).toBe(false);
  });

  test('half-opens after the cooldown and admits one probe', () => {
    const healing = new SelfHealing({ failureThreshold: 1, cooldownMs: 1000 });
    const start = Date.now();

    healing.fail('host', start);
    expect(healing.canProceed('host', start + 500)).toBe(false);

    expect(healing.canProceed('host', start + 1500)).toBe(true);
    expect(healing.stateOf('host')).toBe('half-open');
    // A second caller must not slip through while the probe is in flight.
    expect(healing.canProceed('host', start + 1500)).toBe(false);
  });

  test('closes only after enough successes', () => {
    const healing = new SelfHealing({ failureThreshold: 1, cooldownMs: 0, successThreshold: 2 });
    const start = Date.now();

    healing.fail('host', start);
    healing.canProceed('host', start + 5000);

    healing.succeed('host');
    expect(healing.stateOf('host')).toBe('half-open');
    healing.succeed('host');
    expect(healing.stateOf('host')).toBe('closed');
  });

  test('a failed probe reopens the breaker immediately', () => {
    const healing = new SelfHealing({ failureThreshold: 5, cooldownMs: 0 });
    const start = Date.now();

    for (let i = 0; i < 5; i++) healing.fail('host', start);
    healing.canProceed('host', start + 1000);
    expect(healing.stateOf('host')).toBe('half-open');

    healing.fail('host', start + 1000);
    expect(healing.stateOf('host')).toBe('open');
  });

  test('groups failures by host, not by full URL', () => {
    expect(targetOf({ type: 'http', url: 'https://api.example.com/a' })).toBe('api.example.com');
    expect(targetOf({ type: 'http', url: 'https://api.example.com/b' })).toBe('api.example.com');
  });
});

describe('scheduler', () => {
  const makeQueue = () => new TaskQueue({ runtime: asRuntime(new FakeRuntime(() => ({ ok: true, durationMs: 1 }))) });

  test('registers a schedule and computes its next run', () => {
    const scheduler = new AgentScheduler(makeQueue());
    const created = scheduler.schedule({ id: 'sync', cron: '*/15 * * * *', task: httpTask });

    expect(created.status).toBe('active');
    expect(Date.parse(created.nextRun)).toBeGreaterThan(Date.now());
  });

  test('rejects an invalid cron expression', () => {
    const scheduler = new AgentScheduler(makeQueue());
    expect(() => scheduler.schedule({ id: 'bad', cron: 'not-cron', task: httpTask })).toThrow(/cron/i);
  });

  test('enqueues a due schedule and advances its next run', () => {
    const queue = makeQueue();
    const scheduler = new AgentScheduler(queue);
    scheduler.schedule({ id: 'due', cron: '* * * * *', task: httpTask });

    const later = new Date(Date.now() + 120_000);
    const fired = scheduler.tick(later);

    expect(fired).toEqual(['due']);
    expect(queue.stats.queued).toBe(1);
    expect(Date.parse(scheduler.get('due')!.nextRun)).toBeGreaterThan(later.getTime());
    expect(scheduler.get('due')!.runCount).toBe(1);
  });

  test('does not fire a paused schedule', () => {
    const queue = makeQueue();
    const scheduler = new AgentScheduler(queue);
    scheduler.schedule({ id: 'paused', cron: '* * * * *', task: httpTask });
    scheduler.pause('paused');

    expect(scheduler.tick(new Date(Date.now() + 120_000))).toEqual([]);
    expect(queue.stats.queued).toBe(0);
  });
});

describe('runtime safety', () => {
  test('script tasks are disabled unless a root is configured', async () => {
    const runtime = new TaskRuntime({ scriptRoot: '' });
    expect(runtime.scriptsEnabled).toBe(false);

    const result = await runtime.execute({ type: 'script', script: 'anything.js' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disabled/i);
  });

  test('refuses a script path that escapes the allowed root', async () => {
    const runtime = new TaskRuntime({ scriptRoot: '/srv/scripts' });
    const result = await runtime.execute({ type: 'script', script: '../../etc/passwd' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escapes/i);
  });

  test('rejects a host outside the allowlist', async () => {
    const runtime = new TaskRuntime({ allowedHosts: ['allowed.example.com'] });
    const result = await runtime.execute({ type: 'http', url: 'https://evil.example.com/x' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  test('rejects non-http protocols', async () => {
    const runtime = new TaskRuntime();
    const result = await runtime.execute({ type: 'http', url: 'file:///etc/passwd' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/protocol/i);
  });
});

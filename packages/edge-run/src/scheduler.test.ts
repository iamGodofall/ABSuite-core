/**
 * The scheduler's failure and lifecycle paths.
 *
 * These were the least-covered lines in `edge-run` — 54% of statements, 41% of
 * functions — and probing them found no defect: the code does what its comments
 * say. That is the reason to write these tests rather than a reason not to.
 *
 * Each behaviour below is a promise somebody depends on operationally, and an
 * untested correct behaviour is one refactor away from being an untested
 * incorrect one. The full-queue case in particular is the difference between
 * *one bad schedule stops every schedule* and *it is counted and the rest run*,
 * which is not a distinction anybody wants to discover in production.
 */
import { AgentScheduler } from './scheduler';
import { TaskQueue } from './queue';
import type { TaskRuntime, TaskDefinition } from './runtime';

const runtime = { run: async () => ({ ok: true }) } as unknown as TaskRuntime;
const task: TaskDefinition = { type: 'http', url: 'https://example.com/hook' };

/** Far enough ahead that any every-minute schedule is due. */
const due = () => new Date(Date.now() + 120_000);

describe('scheduler failure paths', () => {
  test('a full queue is counted against the schedule, not swallowed', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 1 }));
    scheduler.schedule({ id: 'first', cron: '* * * * *', task });
    scheduler.schedule({ id: 'second', cron: '* * * * *', task });

    const fired = scheduler.tick(due());

    // The first takes the only slot. The second cannot enqueue.
    expect(fired).toEqual(['first']);
    expect(scheduler.get('first')!.runCount).toBe(1);
    expect(scheduler.get('first')!.failureCount).toBe(0);
    expect(scheduler.get('second')!.runCount).toBe(0);
    expect(scheduler.get('second')!.failureCount).toBe(1);
  });

  test('a schedule that cannot enqueue still advances, so it does not wedge', () => {
    // `limit: 0` cannot be used to force this: the queue clamps with
    // `Math.max(1, …)`, so a zero limit becomes one. That is deliberate — a
    // queue that accepts nothing is a configuration nobody wants by accident —
    // and it means the only honest way to fill a queue is to fill it.
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 1 }));
    scheduler.schedule({ id: 'takes-the-slot', cron: '* * * * *', task });
    scheduler.schedule({ id: 'blocked', cron: '* * * * *', task });

    const before = scheduler.get('blocked')!.nextRun;
    scheduler.tick(due());
    const after = scheduler.get('blocked')!.nextRun;

    // If nextRun did not move, every subsequent tick would retry the same
    // firing forever and the schedule would never recover.
    expect(after).not.toBe(before);
    expect(scheduler.get('blocked')!.failureCount).toBe(1);
  });

  test('one failing schedule does not stop the ones after it', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 1 }));
    scheduler.schedule({ id: 'takes-the-slot', cron: '* * * * *', task });
    scheduler.schedule({ id: 'cannot-enqueue', cron: '* * * * *', task });
    scheduler.schedule({ id: 'after-the-failure', cron: '* * * * *', task });

    scheduler.tick(due());

    // The third is reached at all — the loop continued past the throw.
    expect(scheduler.get('after-the-failure')!.failureCount).toBe(1);
  });
});

describe('scheduler lifecycle', () => {
  test('a paused schedule does not fire', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 10 }));
    scheduler.schedule({ id: 'paused', cron: '* * * * *', task });
    scheduler.pause('paused');

    expect(scheduler.tick(due())).toEqual([]);
    expect(scheduler.get('paused')!.runCount).toBe(0);
  });

  test('resuming recomputes from now, so a long pause fires no catch-up burst', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 10 }));
    scheduler.schedule({ id: 'slept', cron: '* * * * *', task });
    scheduler.pause('slept');

    // The schedule's next run is now long past. Resuming must not treat that
    // as a backlog to work through.
    const resumed = scheduler.resume('slept')!;
    expect(resumed.status).toBe('active');
    expect(Date.parse(resumed.nextRun)).toBeGreaterThan(Date.now() - 1_000);

    expect(scheduler.tick(new Date())).toEqual([]);
  });

  test('pause and resume on an unknown id return undefined rather than inventing one', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 10 }));
    expect(scheduler.pause('nonesuch')).toBeUndefined();
    expect(scheduler.resume('nonesuch')).toBeUndefined();
    expect(scheduler.remove('nonesuch')).toBe(false);
  });

  test('recordOutcome counts failures and leaves successes alone', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 10 }));
    scheduler.schedule({ id: 'watched', cron: '* * * * *', task });

    scheduler.recordOutcome('watched', true);
    expect(scheduler.get('watched')!.failureCount).toBe(0);

    scheduler.recordOutcome('watched', false);
    expect(scheduler.get('watched')!.failureCount).toBe(1);

    // An outcome for a schedule that no longer exists must not throw.
    expect(() => scheduler.recordOutcome('deleted', false)).not.toThrow();
  });

  test('start is idempotent and stop is safe to call twice', () => {
    const scheduler = new AgentScheduler(new TaskQueue({ runtime, limit: 10 }));

    scheduler.start(60_000);
    scheduler.start(60_000);   // must not leak a second interval
    expect(() => { scheduler.stop(); scheduler.stop(); }).not.toThrow();
  });
});

import { Storage } from '@absuite/capkit';
import { EdgeRunPersistence, persistenceFromEnv } from './persistence';
import type { Schedule } from './scheduler';
import type { QueuedTask } from './queue';

const httpTask = { type: 'http' as const, url: 'https://example.com/hook' };

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: 'sync',
  cron: '*/15 * * * *',
  task: httpTask,
  status: 'active',
  nextRun: '2026-08-01T00:00:00.000Z',
  runCount: 0,
  failureCount: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const queued = (overrides: Partial<QueuedTask> = {}): QueuedTask => ({
  id: 'task-1',
  priority: 'normal',
  task: httpTask,
  retry: { maxAttempts: 3, backoff: 'exponential', baseDelay: 1000, maxDelay: 60_000 },
  state: 'queued',
  attempts: 0,
  availableAt: Date.now(),
  queuedAt: new Date().toISOString(),
  ...overrides,
});

describe('edge-run persistence', () => {
  test('is a no-op when no database is configured', () => {
    const persistence = new EdgeRunPersistence(null);

    expect(persistence.enabled).toBe(false);
    expect(() => persistence.saveSchedule(schedule())).not.toThrow();
    expect(persistence.loadSchedules()).toEqual([]);
    expect(persistence.loadPendingTasks()).toEqual([]);
    expect(persistence.countPending()).toBe(0);
  });

  test('env selects persistence only when a database path is set', () => {
    expect(persistenceFromEnv(() => new Storage(':memory:'), {}).enabled).toBe(false);
    expect(persistenceFromEnv(() => new Storage(':memory:'), { ABSUITE_DB_PATH: ':memory:' }).enabled).toBe(true);
  });

  test('round-trips a schedule', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveSchedule(schedule({ id: 'nightly', cron: '0 0 * * *' }));

    const [restored] = persistence.loadSchedules();
    expect(restored?.definition.id).toBe('nightly');
    expect(restored?.definition.cron).toBe('0 0 * * *');
    expect(restored?.definition.task).toEqual(httpTask);
  });

  test('saving the same schedule twice updates rather than duplicates', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveSchedule(schedule({ cron: '0 0 * * *' }));
    persistence.saveSchedule(schedule({ cron: '30 3 * * *', runCount: 7 }));

    const all = persistence.loadSchedules();
    expect(all).toHaveLength(1);
    expect(all[0]?.definition.cron).toBe('30 3 * * *');
    expect(all[0]?.runCount).toBe(7);
  });

  test('preserves paused status across a reload', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveSchedule(schedule({ status: 'paused' }));

    expect(persistence.loadSchedules()[0]?.status).toBe('paused');
  });

  test('deletes a schedule', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveSchedule(schedule());
    persistence.deleteSchedule('sync');

    expect(persistence.loadSchedules()).toEqual([]);
  });

  test('restores queued work, preserving the attempt count', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveTask(queued({ attempts: 2 }));

    const [restored] = persistence.loadPendingTasks();
    expect(restored?.id).toBe('task-1');
    expect(restored?.attempts).toBe(2);
    expect(restored?.retry.maxAttempts).toBe(3);
  });

  test('a task that was running when the process died comes back pending', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveTask(queued({ id: 'interrupted', state: 'running' }));

    // At-least-once: losing the work silently would be the worse default.
    expect(persistence.loadPendingTasks().map(task => task.id)).toContain('interrupted');
  });

  test('does not restore finished work', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveTask(queued({ id: 'done', state: 'completed', completedAt: new Date().toISOString() }));
    persistence.saveTask(queued({ id: 'dead', state: 'dead', completedAt: new Date().toISOString() }));

    expect(persistence.loadPendingTasks()).toEqual([]);
  });

  test('prunes finished tasks older than the retention window', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveTask(queued({
      id: 'old',
      state: 'completed',
      completedAt: new Date(Date.now() - 172_800_000).toISOString(),
    }));

    persistence.pruneTasks(86_400_000);
    expect(persistence.countPending()).toBe(0);
  });

  test('skips a corrupt row instead of refusing to start', () => {
    const storage = new Storage(':memory:');
    const persistence = new EdgeRunPersistence(storage);
    persistence.saveSchedule(schedule({ id: 'good' }));

    storage.run(
      `INSERT INTO schedules (id, cron, task, status, next_run, run_count, failure_count, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      'broken', '* * * * *', '{not json', 'active', '2026-08-01T00:00:00.000Z', 0, 0, '2026-07-01T00:00:00.000Z'
    );

    const restored = persistence.loadSchedules();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.definition.id).toBe('good');
  });

  test('counts pending work and schedules', () => {
    const persistence = new EdgeRunPersistence(new Storage(':memory:'));
    persistence.saveSchedule(schedule());
    persistence.saveTask(queued());

    expect(persistence.countSchedules()).toBe(1);
    expect(persistence.countPending()).toBe(1);
  });
});

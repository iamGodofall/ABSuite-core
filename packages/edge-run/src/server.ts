/**
 * Edge-Run HTTP server — scheduling, queueing and runtime logs.
 *
 * Every mutating endpoint is guarded by a CapKit capability, so authority is
 * issued and revoked centrally rather than per-service.
 */
import express from 'express';
import { capabilityGuard, revocationStoreFromEnv, getStorage, createServiceMetrics } from '@absuite/capkit';
import { TaskRuntime } from './runtime';
import { TaskQueue, type QueuedTask } from './queue';
import { AgentScheduler } from './scheduler';
import { SelfHealing, targetOf } from './self-healing';
import { isValidCron } from './cron';
import { persistenceFromEnv } from './persistence';

const PORT = Number(process.env.EDGERUN_PORT || process.env.PORT || 8082);
const STARTED_AT = Date.now();

const runtime = new TaskRuntime();
const healing = new SelfHealing();
const persistence = persistenceFromEnv(getStorage);
const metrics = createServiceMetrics('edge-run');

/** Ring buffer of recent events, streamed to SSE subscribers. */
const recentLogs: Array<{ task: string; timestamp: string; level: string; message: string }> = [];
const subscribers = new Set<express.Response>();

function emit(level: string, taskId: string, message: string) {
  const entry = { task: taskId, timestamp: new Date().toISOString(), level, message };
  recentLogs.push(entry);
  if (recentLogs.length > 500) recentLogs.shift();

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const subscriber of subscribers) {
    subscriber.write(payload);
  }
}

const queue = new TaskQueue({
  runtime,
  canRun: task => healing.canProceed(targetOf(task.task as { type: string; url?: string; script?: string })),
  onEvent: ({ type, task, message }) => {
    const target = targetOf(task.task as { type: string; url?: string; script?: string });

    if (type === 'completed') healing.succeed(target);
    if (type === 'dead' || type === 'retrying') healing.fail(target);
    if (task.scheduleId && (type === 'completed' || type === 'dead')) {
      scheduler.recordOutcome(task.scheduleId, type === 'completed');
    }

    // Write through on every transition so a crash mid-run is recoverable.
    persistence.saveTask(task);
    metrics.increment('absuite_tasks_total', { event: type });

    const level = type === 'dead' ? 'error' : type === 'retrying' ? 'warn' : 'info';
    emit(level, task.id, message ? `${type}: ${message}` : type);
  },
});

const scheduler = new AgentScheduler(queue);

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

metrics.counter('absuite_tasks_total', 'Task lifecycle events by type');

app.use((req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    const route = req.path.split('/').slice(0, 3).join('/') || '/';
    metrics.increment('absuite_requests_total', { service: 'edge-run', route, status: res.statusCode });
    metrics.observe('absuite_request_duration_ms', performance.now() - startedAt, { service: 'edge-run', route });
  });
  return next();
});

const requireCapability = capabilityGuard({
  revocations: revocationStoreFromEnv(),
  onDecision: ({ allowed, subject, scope, reason }) => {
    if (!allowed) emit('warn', 'auth', `denied ${subject} for ${scope}: ${reason}`);
  },
});

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function publicView(task: QueuedTask) {
  return {
    id: task.id,
    state: task.state,
    status: task.state,
    priority: task.priority,
    attempts: task.attempts,
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    result: task.result?.output,
    error: task.lastError,
    scheduleId: task.scheduleId,
  };
}

// ---- Health ----

app.get('/health', (_req, res) => {
  const stats = queue.stats;
  res.status(200).json({
    status: 'healthy',
    service: 'edge-run',
    activeTasks: stats.running,
    queuedTasks: stats.queued,
    failedTasks: stats.dead,
    schedules: scheduler.list().length,
    scriptsEnabled: runtime.scriptsEnabled,
    durable: persistence.enabled,
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
});

app.get('/ready', (_req, res) => {
  res.status(200).json({ ready: true, durable: persistence.enabled });
});

app.get('/metrics', (_req, res) => {
  const stats = queue.stats;
  metrics.set('absuite_uptime_seconds', Math.floor((Date.now() - STARTED_AT) / 1000), { service: 'edge-run' });
  metrics.gauge('absuite_queue_depth', 'Tasks currently queued');
  metrics.set('absuite_queue_depth', stats.queued, { service: 'edge-run' });
  metrics.gauge('absuite_queue_running', 'Tasks currently running');
  metrics.set('absuite_queue_running', stats.running, { service: 'edge-run' });

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(metrics.render());
});

// ---- Schedules ----

app.post('/schedule', requireCapability('schedule:create'), (req, res) => {
  const { id, cron, task, retry, timeout } = req.body ?? {};

  if (!id || !cron || !task) return fail(res, 400, 'INVALID_REQUEST', 'id, cron and task are required');
  if (!isValidCron(String(cron))) return fail(res, 400, 'INVALID_REQUEST', `Invalid cron expression: "${cron}"`);

  try {
    const created = scheduler.schedule({ id: String(id), cron: String(cron), task, retry, timeout });
    persistence.saveSchedule(created);
    return res.status(201).json({ id: created.id, nextRun: created.nextRun, status: 'scheduled', durable: persistence.enabled });
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/schedule', requireCapability('schedule:read'), (_req, res) => {
  res.status(200).json({
    tasks: scheduler.list().map(schedule => ({
      id: schedule.id,
      cron: schedule.cron,
      status: schedule.status,
      nextRun: schedule.nextRun,
      lastRun: schedule.lastRun,
      runCount: schedule.runCount,
      failureCount: schedule.failureCount,
    })),
  });
});

app.post('/schedule/:id/pause', requireCapability('schedule:create'), (req, res) => {
  const schedule = scheduler.pause(String(req.params.id));
  if (!schedule) return fail(res, 404, 'NOT_FOUND', 'No such schedule');
  persistence.saveSchedule(schedule);
  return res.status(200).json({ id: schedule.id, status: schedule.status });
});

app.post('/schedule/:id/resume', requireCapability('schedule:create'), (req, res) => {
  const schedule = scheduler.resume(String(req.params.id));
  if (!schedule) return fail(res, 404, 'NOT_FOUND', 'No such schedule');
  persistence.saveSchedule(schedule);
  return res.status(200).json({ id: schedule.id, status: schedule.status, nextRun: schedule.nextRun });
});

app.delete('/schedule/:id', requireCapability('schedule:create'), (req, res) => {
  const removed = scheduler.remove(String(req.params.id));
  if (!removed) return fail(res, 404, 'NOT_FOUND', 'No such schedule');
  persistence.deleteSchedule(String(req.params.id));
  return res.status(200).json({ id: req.params.id, removed: true });
});

// ---- Queue ----

app.post('/queue', requireCapability('queue:write'), async (req, res) => {
  const { id, priority, delay, task, retry, timeout } = req.body ?? {};
  if (!task || !task.type) return fail(res, 400, 'INVALID_REQUEST', 'A task with a type is required');

  try {
    const queued = queue.enqueue(task, {
      ...(id ? { id: String(id) } : {}),
      ...(priority ? { priority } : {}),
      ...(delay !== undefined ? { delay: Number(delay) } : {}),
      ...(retry ? { retry } : {}),
      ...(timeout !== undefined ? { timeoutMs: Number(timeout) } : {}),
    });

    void queue.tick();
    return res.status(201).json({ id: queued.id, status: queued.state, queuedAt: queued.queuedAt });
  } catch (error) {
    return fail(res, 429, 'RATE_LIMITED', (error as Error).message);
  }
});

app.get('/queue', requireCapability('queue:read'), (_req, res) => {
  res.status(200).json({ tasks: queue.list().map(publicView), stats: queue.stats });
});

app.get('/queue/:id/status', requireCapability('queue:read'), (req, res) => {
  const task = queue.get(String(req.params.id));
  if (!task) return fail(res, 404, 'NOT_FOUND', 'No such task');
  return res.status(200).json(publicView(task));
});

// ---- Runtime ----

app.get('/runtime/health', requireCapability('runtime:read'), (_req, res) => {
  res.status(200).json({ breakers: healing.snapshot(), queue: queue.stats });
});

app.get('/runtime/logs', requireCapability('runtime:read'), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  for (const entry of recentLogs.slice(-20)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  subscribers.add(res);
  req.on('close', () => {
    subscribers.delete(res);
  });
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app, queue, scheduler, healing, runtime };

/**
 * Restore schedules and pending work recorded before the last shutdown.
 *
 * Runs before the queue starts so nothing is executed twice and nothing that
 * was pending is lost.
 */
export function hydrate(): { schedules: number; tasks: number } {
  if (!persistence.enabled) return { schedules: 0, tasks: 0 };

  let schedules = 0;
  for (const record of persistence.loadSchedules()) {
    try {
      const restored = scheduler.schedule(record.definition);
      if (record.status === 'paused') scheduler.pause(restored.id);
      schedules += 1;
    } catch (error) {
      console.error(`[edge-run] Could not restore schedule ${record.definition.id}:`, (error as Error).message);
    }
  }

  let tasks = 0;
  for (const record of persistence.loadPendingTasks()) {
    try {
      const restored = queue.enqueue(record.task, {
        id: record.id,
        priority: record.priority,
        retry: record.retry,
        ...(record.timeoutMs !== undefined ? { timeoutMs: record.timeoutMs } : {}),
        ...(record.scheduleId ? { scheduleId: record.scheduleId } : {}),
      });
      // Preserve the attempt count so retry limits still mean something.
      restored.attempts = record.attempts;
      restored.availableAt = record.availableAt;
      tasks += 1;
    } catch {
      // Duplicate id means it is already tracked; nothing to restore.
    }
  }

  return { schedules, tasks };
}

if (require.main === module) {
  const restored = hydrate();
  if (persistence.enabled) {
    console.log(`[edge-run] Restored ${restored.schedules} schedule(s) and ${restored.tasks} pending task(s)`);
  }

  queue.start();
  scheduler.start();

  const pruneTimer = setInterval(() => {
    queue.prune();
    persistence.pruneTasks();
  }, 300_000);
  pruneTimer.unref?.();

  const server = app.listen(PORT, () => {
    console.log(`[edge-run] listening on :${PORT} (durable: ${persistence.enabled})`);
    if (!runtime.scriptsEnabled) {
      console.log('[edge-run] Script tasks are disabled. Set EDGERUN_SCRIPT_ROOT to enable them.');
    }
  });

  const shutdown = (signal: string) => {
    console.log(`[edge-run] ${signal} received, shutting down`);
    clearInterval(pruneTimer);
    queue.stop();
    scheduler.stop();
    // Flush current task state so a restart resumes accurately.
    for (const task of queue.list()) persistence.saveTask(task);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

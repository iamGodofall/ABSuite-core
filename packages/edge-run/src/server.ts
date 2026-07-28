/**
 * Edge-Run HTTP server — scheduling, queueing and runtime logs.
 *
 * Every mutating endpoint is guarded by a CapKit capability, so authority is
 * issued and revoked centrally rather than per-service.
 */
import express from 'express';
import { capabilityGuard } from '@absuite/capkit';
import { revocationStoreFromEnv } from '@absuite/capkit';
import { TaskRuntime } from './runtime';
import { TaskQueue, type QueuedTask } from './queue';
import { AgentScheduler } from './scheduler';
import { SelfHealing, targetOf } from './self-healing';
import { isValidCron } from './cron';

const PORT = Number(process.env.EDGERUN_PORT || process.env.PORT || 8082);
const STARTED_AT = Date.now();

const runtime = new TaskRuntime();
const healing = new SelfHealing();

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

    const level = type === 'dead' ? 'error' : type === 'retrying' ? 'warn' : 'info';
    emit(level, task.id, message ? `${type}: ${message}` : type);
  },
});

const scheduler = new AgentScheduler(queue);

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

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
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
  });
});

// ---- Schedules ----

app.post('/schedule', requireCapability('schedule:create'), (req, res) => {
  const { id, cron, task, retry, timeout } = req.body ?? {};

  if (!id || !cron || !task) return fail(res, 400, 'INVALID_REQUEST', 'id, cron and task are required');
  if (!isValidCron(String(cron))) return fail(res, 400, 'INVALID_REQUEST', `Invalid cron expression: "${cron}"`);

  try {
    const created = scheduler.schedule({ id: String(id), cron: String(cron), task, retry, timeout });
    return res.status(201).json({ id: created.id, nextRun: created.nextRun, status: 'scheduled' });
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
  return res.status(200).json({ id: schedule.id, status: schedule.status });
});

app.post('/schedule/:id/resume', requireCapability('schedule:create'), (req, res) => {
  const schedule = scheduler.resume(String(req.params.id));
  if (!schedule) return fail(res, 404, 'NOT_FOUND', 'No such schedule');
  return res.status(200).json({ id: schedule.id, status: schedule.status, nextRun: schedule.nextRun });
});

app.delete('/schedule/:id', requireCapability('schedule:create'), (req, res) => {
  const removed = scheduler.remove(String(req.params.id));
  if (!removed) return fail(res, 404, 'NOT_FOUND', 'No such schedule');
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

if (require.main === module) {
  queue.start();
  scheduler.start();
  setInterval(() => queue.prune(), 300_000).unref?.();

  app.listen(PORT, () => {
    console.log(`[edge-run] listening on :${PORT}`);
    if (!runtime.scriptsEnabled) {
      console.log('[edge-run] Script tasks are disabled. Set EDGERUN_SCRIPT_ROOT to enable them.');
    }
  });
}

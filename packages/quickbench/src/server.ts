/**
 * QuickBench HTTP server — benchmark submission, status, reports and history.
 */
import express from 'express';
import { capabilityGuard, revocationStoreFromEnv, createServiceMetrics } from '@absuitecore/capkit';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { BenchmarkRunner } from './runner';
import { availableProviders } from './providers';
import { toMarkdown, toCsv } from './report';
import { runCoreSuite } from './core-suite';
import { renderReport, compareReports, type BenchReport } from './measure';

const PORT = Number(process.env.QUICKBENCH_PORT || process.env.PORT || 8083);
const STARTED_AT = Date.now();

const runner = new BenchmarkRunner();
const metrics = createServiceMetrics('quickbench');

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    const route = req.path.split('/').slice(0, 3).join('/') || '/';
    metrics.increment('absuite_requests_total', { service: 'quickbench', route, status: res.statusCode });
    metrics.observe('absuite_request_duration_ms', performance.now() - startedAt, { service: 'quickbench', route });
  });
  return next();
});

const requireCapability = capabilityGuard({ revocations: revocationStoreFromEnv() });

function fail(res: express.Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'quickbench',
    uptime: Math.floor((Date.now() - STARTED_AT) / 1000),
    availableProviders: availableProviders().filter(provider => provider.configured).map(provider => provider.name),
  });
});

app.get('/ready', (_req, res) => {
  res.status(200).json({ ready: true });
});

app.get('/metrics', (_req, res) => {
  metrics.set('absuite_uptime_seconds', Math.floor((Date.now() - STARTED_AT) / 1000), { service: 'quickbench' });
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.status(200).send(metrics.render());
});

app.get('/providers', (_req, res) => {
  res.status(200).json({ providers: availableProviders() });
});

app.post('/run', requireCapability('bench:run'), (req, res) => {
  const { provider, model, name, prompt, url, warmupRuns, testRuns, concurrency, maxTokens, timeoutMs } = req.body ?? {};

  if (!provider) return fail(res, 400, 'INVALID_REQUEST', 'A provider is required');

  try {
    const job = runner.submit({ provider, model, name, prompt, url, warmupRuns, testRuns, concurrency, maxTokens, timeoutMs });
    return res.status(202).json({
      jobId: job.jobId,
      status: job.status,
      estimatedDuration: runner.estimateDuration(testRuns ?? 10, concurrency ?? 1),
    });
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.get('/run/:jobId', requireCapability('bench:read'), (req, res) => {
  const job = runner.get(String(req.params.jobId));
  if (!job) return fail(res, 404, 'NOT_FOUND', 'No such job');

  return res.status(200).json({
    jobId: job.jobId,
    status: job.status,
    progress: Math.round(job.progress * 100) / 100,
    ...(job.error ? { error: job.error } : {}),
  });
});

app.get('/run/:jobId/report', requireCapability('bench:read'), (req, res) => {
  const job = runner.get(String(req.params.jobId));
  if (!job) return fail(res, 404, 'NOT_FOUND', 'No such job');
  if (job.status !== 'completed') {
    return fail(res, 409, 'INVALID_REQUEST', `Job is ${job.status}, not completed`);
  }

  if (String(req.query.format) === 'markdown') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.status(200).send(toMarkdown(job));
  }

  return res.status(200).json({
    jobId: job.jobId,
    name: job.name,
    provider: job.provider,
    model: job.model,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    results: job.results,
  });
});

app.get('/history', requireCapability('bench:read'), (req, res) => {
  const jobs = runner.history(
    Number(req.query.limit ?? 20),
    {
      ...(req.query.model ? { model: String(req.query.model) } : {}),
      ...(req.query.provider ? { provider: String(req.query.provider) } : {}),
    }
  );

  if (String(req.query.format) === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(toCsv(jobs));
  }

  return res.status(200).json({
    benchmarks: jobs.map(job => ({
      jobId: job.jobId,
      name: job.name,
      model: job.model,
      provider: job.provider,
      status: job.status,
      completedAt: job.completedAt,
      summary: job.results
        ? {
            latency_p50_ms: job.results.latency.p50,
            latency_p95_ms: job.results.latency.p95,
            requests_per_sec: job.results.throughput.requestsPerSecond,
            tokens_per_sec: job.results.throughput.tokensPerSecond,
          }
        : null,
    })),
  });
});

/**
 * ABSuite's own numbers.
 *
 * `/bench/core` is deliberately not behind a capability: the whole point is
 * that anyone can check what this instance claims about its own speed. It
 * exposes no execution data, no keys and no tenant information — only how fast
 * this machine signs and verifies, and which machine that is.
 *
 * When nothing has been measured it says so. It never returns zeros, an
 * estimate or a figure from another machine, because an unmeasured system that
 * reports numbers is exactly the failure ABSuite exists to catch.
 */
const RESULTS_PATH = resolve(
  process.env.ABSUITE_BENCH_RESULTS || `${process.cwd()}/bench/core-latest.json`
);

function loadRecordedReport(): BenchReport | null {
  try {
    if (!existsSync(RESULTS_PATH)) return null;
    const parsed = JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) as BenchReport;
    return parsed?.schema === 'absuite.bench.v1' ? parsed : null;
  } catch {
    // A corrupt file is not a measurement. Report "not measured" rather than
    // half of one.
    return null;
  }
}

/** The most recent run before `measuredAt`, from the history directory. */
function loadPreviousReport(measuredAt: string): BenchReport | null {
  try {
    const dir = join(dirname(RESULTS_PATH), 'history');
    if (!existsSync(dir)) return null;
    const candidates = readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .sort()
      .reverse();

    for (const name of candidates) {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as BenchReport;
      if (parsed?.schema !== 'absuite.bench.v1') continue;
      // Strictly earlier: comparing a run against itself is not a comparison.
      if (parsed.environment.measuredAt < measuredAt) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** The most recent run in this process, which beats anything on disk. */
let liveReport: BenchReport | null = null;
let running = false;

app.get('/bench/core', (req, res) => {
  const report = liveReport ?? loadRecordedReport();

  if (!report) {
    return res.status(200).json({
      measured: false,
      reason: 'No benchmark has been run on this machine.',
      howTo: 'pnpm bench:core',
      resultsPath: RESULTS_PATH,
    });
  }

  if (String(req.query.format) === 'markdown') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.status(200).send(renderReport(report));
  }

  return res.status(200).json({ measured: true, source: liveReport ? 'this process' : RESULTS_PATH, report });
});

/**
 * This run against the previous one — the step that closes the loop.
 *
 * A measurement on its own is a number on a screen. Compared against the last
 * run on the same machine it becomes a signal, which is what makes Learn feed
 * back into the system instead of terminating in a dashboard tile.
 */
app.get('/bench/core/regression', (_req, res) => {
  const current = liveReport ?? loadRecordedReport();
  if (!current) {
    return res.status(200).json({ compared: false, reason: 'No benchmark has been run on this machine.', howTo: 'pnpm bench:core' });
  }

  const baseline = loadPreviousReport(current.environment.measuredAt);
  if (!baseline) {
    return res.status(200).json({
      compared: false,
      reason: 'Only one run exists, so there is nothing to compare it against. Run the benchmark again to get a baseline.',
      howTo: 'pnpm bench:core',
    });
  }

  const comparison = compareReports(baseline, current);
  return res.status(200).json({ compared: comparison.comparable, comparison });
});

app.post('/bench/core', requireCapability('bench:run'), async (req, res) => {
  if (running) return fail(res, 409, 'BENCH_BUSY', 'A core benchmark is already running');

  // Signing and SQLite writes are synchronous, so a large run holds the event
  // loop and this service stops answering health checks. Cap it rather than
  // letting a benchmark take the service down.
  const iterations = Math.min(Math.max(Number(req.body?.iterations ?? 500), 1), 5000);
  const chainLength = Math.min(Math.max(Number(req.body?.chainLength ?? 200), 1), 5000);

  running = true;
  try {
    liveReport = await runCoreSuite({ iterations, chainLength });
    return res.status(200).json({ measured: true, source: 'this process', report: liveReport });
  } catch (error) {
    return fail(res, 500, 'BENCH_FAILED', (error as Error).message);
  } finally {
    running = false;
  }
});

app.get('/compare', requireCapability('bench:read'), (req, res) => {
  const baseline = String(req.query.baseline || '');
  const candidate = String(req.query.candidate || '');

  if (!baseline || !candidate) {
    return fail(res, 400, 'INVALID_REQUEST', 'baseline and candidate job ids are required');
  }

  try {
    return res.status(200).json(runner.compare(baseline, candidate));
  } catch (error) {
    return fail(res, 400, 'INVALID_REQUEST', (error as Error).message);
  }
});

app.use((req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export { app, runner };

if (require.main === module) {
  app.listen(PORT, () => console.log(`[quickbench] listening on :${PORT}`));
}

/**
 * QuickBench HTTP server — benchmark submission, status, reports and history.
 */
import express from 'express';
import { capabilityGuard, revocationStoreFromEnv } from '@absuite/capkit';
import { BenchmarkRunner } from './runner';
import { availableProviders } from './providers';
import { toMarkdown, toCsv } from './report';

const PORT = Number(process.env.QUICKBENCH_PORT || process.env.PORT || 8083);
const STARTED_AT = Date.now();

const runner = new BenchmarkRunner();

const app: express.Express = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

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

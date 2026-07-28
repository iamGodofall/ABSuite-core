/**
 * Benchmark orchestration.
 *
 * Runs warmup iterations (discarded), then timed iterations at a chosen
 * concurrency, and summarises latency and throughput. Jobs run in the
 * background so the HTTP API can return a job id immediately.
 */
import { randomUUID } from 'node:crypto';
import { summarise, compareRuns, type LatencySummary } from './stats';
import { createProvider, type Provider, type CompletionResult } from './providers';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BenchmarkRequest {
  name?: string;
  provider: string;
  model?: string;
  prompt?: string;
  url?: string;
  warmupRuns?: number;
  testRuns?: number;
  concurrency?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface BenchmarkResults {
  latency: LatencySummary & { unit: 'ms' };
  throughput: { requestsPerSecond: number; tokensPerSecond: number | null; unit: string };
  tokens: { promptTotal: number; completionTotal: number } | null;
  successRate: number;
  errorSamples: string[];
}

export interface BenchmarkJob {
  jobId: string;
  name: string;
  provider: string;
  model: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  results?: BenchmarkResults;
  error?: string;
  /** Raw latencies retained so runs can be compared statistically. */
  samples?: number[];
}

const MAX_RUNS = 500;
const MAX_CONCURRENCY = 32;

export class BenchmarkRunner {
  private readonly jobs = new Map<string, BenchmarkJob>();

  constructor(private readonly maxHistory = 100) {}

  get(jobId: string): BenchmarkJob | undefined {
    return this.jobs.get(jobId);
  }

  history(limit = 20, filter: { model?: string; provider?: string } = {}): BenchmarkJob[] {
    return [...this.jobs.values()]
      .filter(job => (!filter.model || job.model === filter.model) && (!filter.provider || job.provider === filter.provider))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  /** Validate and register a job, then start it without blocking the caller. */
  submit(request: BenchmarkRequest): BenchmarkJob {
    const provider = createProvider(request.provider, request.url ? { url: request.url } : {});

    const testRuns = clamp(request.testRuns ?? 10, 1, MAX_RUNS);
    const warmupRuns = clamp(request.warmupRuns ?? 2, 0, 50);
    const concurrency = clamp(request.concurrency ?? 1, 1, MAX_CONCURRENCY);

    const job: BenchmarkJob = {
      jobId: `bench-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
      name: request.name ?? `${request.provider}-${request.model ?? 'default'}`,
      provider: request.provider,
      model: request.model ?? 'default',
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(job.jobId, job);
    this.evictOldJobs();

    void this.run(job, provider, {
      model: request.model ?? 'default',
      prompt: request.prompt ?? 'Write one sentence about reliability.',
      testRuns,
      warmupRuns,
      concurrency,
      ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    });

    return job;
  }

  estimateDuration(testRuns: number, concurrency: number): string {
    const batches = Math.ceil(testRuns / concurrency);
    return `${Math.max(1, Math.round(batches * 1.5))}s`;
  }

  private async run(
    job: BenchmarkJob,
    provider: Provider,
    options: {
      model: string;
      prompt: string;
      testRuns: number;
      warmupRuns: number;
      concurrency: number;
      maxTokens?: number;
      timeoutMs?: number;
    }
  ): Promise<void> {
    job.status = 'running';
    const startedAt = performance.now();

    const request = {
      model: options.model,
      prompt: options.prompt,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    };

    try {
      // Warmup results are discarded — they measure cold caches, not steady state.
      for (let i = 0; i < options.warmupRuns; i++) {
        await provider.complete(request);
        job.progress = ((i + 1) / (options.warmupRuns + options.testRuns)) * 0.3;
      }

      const results: CompletionResult[] = [];
      let dispatched = 0;

      // A fixed pool of workers pulling from a shared counter keeps exactly
      // `concurrency` requests in flight rather than running in lockstep batches.
      const worker = async () => {
        while (dispatched < options.testRuns) {
          dispatched += 1;
          const result = await provider.complete(request);
          results.push(result);
          job.progress = 0.3 + (results.length / options.testRuns) * 0.7;
        }
      };

      await Promise.all(Array.from({ length: Math.min(options.concurrency, options.testRuns) }, worker));

      const durationMs = performance.now() - startedAt;
      const successes = results.filter(result => result.ok);
      const latencies = successes.map(result => result.latencyMs);

      if (successes.length === 0) {
        job.status = 'failed';
        job.error = results[0]?.error ?? 'Every request failed';
        job.completedAt = new Date().toISOString();
        job.durationMs = Math.round(durationMs);
        return;
      }

      const completionTokens = successes.reduce((total, result) => total + (result.completionTokens ?? 0), 0);
      const promptTokens = successes.reduce((total, result) => total + (result.promptTokens ?? 0), 0);
      const seconds = durationMs / 1000;

      job.samples = latencies;
      job.results = {
        latency: { ...summarise(latencies), unit: 'ms' },
        throughput: {
          requestsPerSecond: Math.round((successes.length / seconds) * 100) / 100,
          tokensPerSecond: completionTokens > 0 ? Math.round((completionTokens / seconds) * 100) / 100 : null,
          unit: 'per second',
        },
        tokens: completionTokens > 0 || promptTokens > 0 ? { promptTotal: promptTokens, completionTotal: completionTokens } : null,
        successRate: Math.round((successes.length / results.length) * 10000) / 100,
        errorSamples: [...new Set(results.filter(r => !r.ok).map(r => r.error ?? 'unknown'))].slice(0, 5),
      };

      job.status = 'completed';
      job.progress = 1;
      job.durationMs = Math.round(durationMs);
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.completedAt = new Date().toISOString();
    }
  }

  /** Compare two completed jobs for a regression verdict. */
  compare(baselineId: string, candidateId: string) {
    const baseline = this.jobs.get(baselineId);
    const candidate = this.jobs.get(candidateId);

    if (!baseline?.samples || !candidate?.samples) {
      throw new Error('Both jobs must exist and have completed with samples');
    }

    const comparison = compareRuns(baseline.samples, candidate.samples);
    return {
      baseline: { jobId: baseline.jobId, name: baseline.name, p50: baseline.results?.latency.p50 },
      candidate: { jobId: candidate.jobId, name: candidate.name, p50: candidate.results?.latency.p50 },
      ...comparison,
      verdict: !comparison.significant
        ? 'no significant change'
        : comparison.deltaMeanMs > 0
          ? 'regression'
          : 'improvement',
    };
  }

  private evictOldJobs(): void {
    if (this.jobs.size <= this.maxHistory) return;
    const ordered = [...this.jobs.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const job of ordered.slice(0, this.jobs.size - this.maxHistory)) {
      this.jobs.delete(job.jobId);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(Math.floor(numeric), min), max);
}

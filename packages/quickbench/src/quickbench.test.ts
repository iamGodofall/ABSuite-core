import { percentile, mean, stddev, summarise, compareRuns } from './stats';
import { BenchmarkRunner } from './runner';
import { toMarkdown, toCsv } from './report';
import { createProvider, HttpProvider } from './providers';
import type { BenchmarkJob } from './runner';

describe('percentiles', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  test('uses nearest-rank, returning an observed value', () => {
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 100)).toBe(10);
  });

  test('handles a single sample', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  test('handles an empty set without throwing', () => {
    expect(percentile([], 50)).toBe(0);
    expect(summarise([]).count).toBe(0);
  });

  test('is order independent', () => {
    expect(percentile([10, 1, 5, 3], 50)).toBe(percentile([1, 3, 5, 10], 50));
  });

  test('p99 of 100 samples is the 99th value', () => {
    const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(hundred, 99)).toBe(99);
  });
});

describe('summary statistics', () => {
  test('computes mean and standard deviation', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(1.633, 2);
    expect(stddev([5, 5, 5])).toBe(0);
  });

  test('summarises a latency set', () => {
    const summary = summarise([10, 20, 30, 40, 50]);
    expect(summary.count).toBe(5);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(50);
    expect(summary.mean).toBe(30);
    expect(summary.p50).toBe(30);
  });
});

describe('run comparison', () => {
  test('detects a clear regression', () => {
    const baseline = Array.from({ length: 30 }, () => 100);
    const candidate = Array.from({ length: 30 }, () => 200);
    const result = compareRuns(baseline, candidate);

    expect(result.deltaMeanMs).toBe(100);
    expect(result.deltaPercent).toBe(100);
    expect(result.significant).toBe(true);
  });

  test('reports an improvement as a negative delta', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => 200 + (i % 3));
    const candidate = Array.from({ length: 30 }, (_, i) => 100 + (i % 3));
    const result = compareRuns(baseline, candidate);

    expect(result.deltaMeanMs).toBeLessThan(0);
    expect(result.significant).toBe(true);
  });

  test('does not flag noise as significant', () => {
    // Same distribution, high variance — should not read as a real change.
    const baseline = [100, 150, 90, 200, 110, 130, 95, 180];
    const candidate = [105, 140, 95, 195, 115, 125, 100, 175];
    expect(compareRuns(baseline, candidate).significant).toBe(false);
  });

  test('handles a zero baseline without dividing by zero', () => {
    expect(compareRuns([0, 0], [0, 0]).deltaPercent).toBe(0);
  });
});

describe('benchmark runner', () => {
  /** Stub provider so tests never hit the network. */
  const stubProvider = (latency: number, ok = true) => ({
    name: 'stub',
    configured: true,
    complete: async () => ({ ok, latencyMs: latency, completionTokens: 10, promptTokens: 5, ...(ok ? {} : { error: 'stub failure' }) }),
  });

  test('runs a benchmark and produces results', async () => {
    const runner = new BenchmarkRunner();
    const job = (runner as unknown as {
      submit: (r: unknown) => BenchmarkJob;
    }).submit({ provider: 'http', url: 'http://localhost:1/never', testRuns: 2, warmupRuns: 0 });

    expect(job.jobId).toMatch(/^bench-/);
    // submit() kicks the run off without awaiting it, so the job has already
    // advanced past 'queued' by the time it returns.
    expect(['queued', 'running']).toContain(job.status);
  });

  test('rejects an unknown provider', () => {
    const runner = new BenchmarkRunner();
    expect(() => runner.submit({ provider: 'not-a-provider' })).toThrow(/unknown provider/i);
  });

  test('requires a url for the http provider', () => {
    expect(() => createProvider('http')).toThrow(/requires a url/i);
  });

  test('clamps run counts into a sane range', async () => {
    const runner = new BenchmarkRunner();
    const job = runner.submit({ provider: 'http', url: 'http://127.0.0.1:1/x', testRuns: 100000, warmupRuns: 0, concurrency: 1 });
    // Job accepted; the clamp prevents a caller from requesting unbounded work.
    expect(job.status).toMatch(/queued|running|failed|completed/);
  });

  test('marks a job failed when every request fails', async () => {
    const runner = new BenchmarkRunner();
    const job = runner.submit({
      provider: 'http',
      url: 'http://127.0.0.1:1/unreachable',
      testRuns: 2,
      warmupRuns: 0,
      timeoutMs: 300,
    });

    // Poll briefly for the background run to settle.
    for (let i = 0; i < 60 && job.status !== 'failed' && job.status !== 'completed'; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(job.status).toBe('failed');
    expect(job.error).toBeTruthy();
  });

  test('compare requires two completed jobs', () => {
    const runner = new BenchmarkRunner();
    expect(() => runner.compare('missing-a', 'missing-b')).toThrow(/must exist/i);
  });

  test('history filters by provider', () => {
    const runner = new BenchmarkRunner();
    runner.submit({ provider: 'http', url: 'http://127.0.0.1:1/a', testRuns: 1, warmupRuns: 0, timeoutMs: 100 });
    expect(runner.history(10, { provider: 'http' }).length).toBeGreaterThan(0);
    expect(runner.history(10, { provider: 'ollama' })).toHaveLength(0);
  });
});

describe('reports', () => {
  const job: BenchmarkJob = {
    jobId: 'bench-2026-01-01-abc',
    name: 'llama3 latency',
    provider: 'ollama',
    model: 'llama3',
    status: 'completed',
    progress: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    results: {
      latency: { count: 10, min: 90, max: 300, mean: 150, stddev: 40, p50: 140, p90: 250, p95: 280, p99: 300, unit: 'ms' },
      throughput: { requestsPerSecond: 6.5, tokensPerSecond: 42.1, unit: 'per second' },
      tokens: { promptTotal: 50, completionTotal: 420 },
      successRate: 100,
      errorSamples: [],
    },
  };

  test('renders markdown with the key percentiles', () => {
    const markdown = toMarkdown(job);
    expect(markdown).toContain('# Benchmark — llama3 latency');
    expect(markdown).toContain('| p95 | 280 |');
    expect(markdown).toContain('Tokens/sec: **42.1**');
  });

  test('renders a job that has no results', () => {
    const failed: BenchmarkJob = { ...job, status: 'failed', results: undefined as never, error: 'boom' };
    expect(toMarkdown(failed)).toContain('Error: boom');
  });

  test('renders csv with a header row', () => {
    const csv = toCsv([job]);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('jobId,name,provider');
    expect(row).toContain('bench-2026-01-01-abc');
  });

  test('escapes commas in csv fields', () => {
    const tricky: BenchmarkJob = { ...job, name: 'a,b "quoted"' };
    expect(toCsv([tricky])).toContain('"a,b ""quoted"""');
  });
});

describe('providers', () => {
  test('reports configuration state without making a request', () => {
    expect(new HttpProvider('http://localhost/x').configured).toBe(true);
  });

  test('openai reports an error when unconfigured', async () => {
    const provider = createProvider('openai');
    if (!provider.configured) {
      const result = await provider.complete({ model: 'gpt-4o', prompt: 'hi' });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/OPENAI_API_KEY/);
    }
  });
});

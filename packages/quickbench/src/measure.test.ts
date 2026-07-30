import { measureOperation, measureSuite, describeEnvironment, renderReport, compareReports, type BenchReport } from './measure';

describe('measuring honestly', () => {
  test('times every iteration and discards exactly the stated warmup', async () => {
    let calls = 0;
    const result = await measureOperation({
      operation: 'noop',
      description: 'does nothing',
      iterations: 50,
      warmup: 7,
      run: () => { calls++; },
    });

    // The warmup ran, and is not hidden: it is counted separately and the
    // timed sample size matches the iterations that were reported.
    expect(calls).toBe(57);
    expect(result.warmupDiscarded).toBe(7);
    expect(result.iterations).toBe(50);
    expect(result.latencyMs.count).toBe(50);
  });

  test('a failing operation is reported, not retried away', async () => {
    const result = await measureOperation({
      operation: 'flaky',
      description: 'fails every third call',
      iterations: 30,
      warmup: 0,
      run: i => { if (i % 3 === 0) throw new Error('provider refused'); },
    });

    expect(result.failures).toBe(10);
    expect(result.successRate).toBeCloseTo(20 / 30, 3);
    // The first real error travels with the number, so nobody has to guess why
    // a success rate is not 1.
    expect(result.errorSample).toBe('provider refused');
    // Failed iterations are still timed — a run that fails fast must not be
    // able to look fast by having its failures excluded.
    expect(result.latencyMs.count).toBe(30);
  });

  test('throughput comes from the wall clock, so concurrency cannot inflate it', async () => {
    const result = await measureOperation({
      operation: 'sleep',
      description: 'waits 5ms',
      iterations: 20,
      warmup: 0,
      concurrency: 5,
      run: () => new Promise(resolve => setTimeout(resolve, 5)),
    });

    // Dividing 1000 by the 5ms mean would claim ~200 ops/sec per worker and
    // 1000 overall. The truth is iterations / elapsed, and nothing else.
    const fromWallClock = (result.iterations / result.wallClockMs) * 1000;
    expect(result.opsPerSecond).toBeCloseTo(fromWallClock, 0);
    expect(result.opsPerSecond).toBeLessThan(1000);
  });

  test('teardown runs even when the operation throws every time', async () => {
    let torndown = false;
    await measureOperation({
      operation: 'always-fails',
      description: 'throws',
      iterations: 3,
      warmup: 0,
      run: () => { throw new Error('boom'); },
      teardown: () => { torndown = true; },
    });

    // A benchmark that leaks a database handle on failure poisons the next one.
    expect(torndown).toBe(true);
  });

  test('an unmeasurably fast run reports zero rather than infinity', async () => {
    const result = await measureOperation({
      operation: 'instant',
      description: 'nothing at all',
      iterations: 1,
      warmup: 0,
      run: () => {},
    });

    expect(Number.isFinite(result.opsPerSecond)).toBe(true);
  });

  test('the environment is described, never assumed', () => {
    const env = describeEnvironment();

    expect(env.node).toBe(process.versions.node);
    expect(env.cpuCount).toBeGreaterThan(0);
    expect(env.cpuModel.length).toBeGreaterThan(0);
    expect(Date.parse(env.measuredAt)).not.toBeNaN();
    // Hostname and commit identify a machine and a build. Neither is invented,
    // and the hostname is opt-in.
    expect(env.host).toBeUndefined();
    expect(env.commit).toBeUndefined();
    expect(describeEnvironment({ includeHost: true }).host).toBeTruthy();
  });

  test('a report cannot be read without the machine it was measured on', async () => {
    const report = await measureSuite(
      [{ operation: 'noop', description: 'nothing', iterations: 5, warmup: 0, run: () => {} }],
      { commit: 'abc1234', reproduce: 'pnpm bench:core' }
    );

    expect(report.schema).toBe('absuite.bench.v1');
    const text = renderReport(report);
    expect(text).toContain(report.environment.cpuModel);
    expect(text).toContain(`Node ${process.versions.node}`);
    expect(text).toContain('abc1234');
    // Anyone must be able to re-run it and disagree with the result.
    expect(text).toContain('pnpm bench:core');
  });
});

describe('comparing a run against the last one', () => {
  const env = (over: Partial<BenchReport['environment']> = {}) => ({
    node: '22.22.2', v8: '12.4', platform: 'linux', arch: 'x64',
    cpuModel: 'Xeon 2.80GHz', cpuCount: 4, memoryGb: 15.7,
    measuredAt: '2026-07-29T00:00:00.000Z', ...over,
  });

  const measurement = (over: Record<string, unknown> = {}) => ({
    operation: 'trace.record',
    description: 'sign and store a record',
    iterations: 500, warmupDiscarded: 25, concurrency: 1, failures: 0, successRate: 1,
    opsPerSecond: 700, wallClockMs: 714,
    latencyMs: { count: 500, min: 1, max: 3, mean: 1.4, stddev: 0.2, p50: 1.3, p90: 1.8, p95: 2, p99: 2.5 },
    ...over,
  }) as BenchReport['measurements'][number];

  const report = (over: Partial<BenchReport> = {}): BenchReport => ({
    schema: 'absuite.bench.v1',
    environment: env(),
    measurements: [measurement()],
    totalDurationMs: 1000,
    reproduce: 'pnpm bench:core',
    ...over,
  });

  test('refuses to compare across machines', () => {
    const other = report({ environment: env({ cpuModel: 'Apple M2', cpuCount: 10 }) });
    const result = compareReports(report(), other);

    // A laptop is not slower than a CI runner in any sense that means anything
    // about the code. An alert that fires on hardware gets muted within a week.
    expect(result.comparable).toBe(false);
    if (!result.comparable) expect(result.reason).toMatch(/different machines/i);
  });

  test('refuses to compare across Node versions', () => {
    const result = compareReports(report(), report({ environment: env({ node: '24.0.0' }) }));
    expect(result.comparable).toBe(false);
    if (!result.comparable) expect(result.reason).toMatch(/Node versions/i);
  });

  test('refuses to compare an operation whose work changed', () => {
    // This is a real bug the tool produced: a 400-record chain measured against
    // a 1,000-record baseline reported a 59% "improvement" that was entirely the
    // smaller chain.
    const before = report({ measurements: [measurement({ operation: 'chain.verify', description: 'walk a 1000-record chain' })] });
    const after = report({
      environment: env({ measuredAt: '2026-07-30T00:00:00.000Z' }),
      measurements: [measurement({
        operation: 'chain.verify',
        description: 'walk a 400-record chain',
        latencyMs: { count: 10, min: 60, max: 80, mean: 70, stddev: 5, p50: 70, p90: 78, p95: 79, p99: 80 },
      })],
    });

    const result = compareReports(before, after);
    expect(result.comparable).toBe(true);
    if (result.comparable) {
      expect(result.deltas).toHaveLength(0);
      expect(result.incomparable[0]!.operation).toBe('chain.verify');
      expect(result.regressions).toEqual([]);
    }
  });

  test('a real slowdown is a regression; noise is not', () => {
    const slower = report({
      environment: env({ measuredAt: '2026-07-30T00:00:00.000Z' }),
      measurements: [measurement({
        latencyMs: { count: 500, min: 2, max: 5, mean: 2.8, stddev: 0.3, p50: 2.7, p90: 3.2, p95: 3.5, p99: 4 },
        opsPerSecond: 350,
      })],
    });

    const regressed = compareReports(report(), slower);
    expect(regressed.comparable).toBe(true);
    if (regressed.comparable) {
      expect(regressed.regressions).toEqual(['trace.record']);
      expect(regressed.deltas[0]!.verdict).toBe('slower');
      expect(regressed.deltas[0]!.deltaPercent).toBeGreaterThan(90);
    }

    // A hair's difference well inside the spread is not a finding.
    const jitter = report({
      environment: env({ measuredAt: '2026-07-30T00:00:00.000Z' }),
      measurements: [measurement({ latencyMs: { count: 500, min: 1, max: 3, mean: 1.401, stddev: 0.2, p50: 1.3, p90: 1.8, p95: 2, p99: 2.5 } })],
    });
    const quiet = compareReports(report(), jitter);
    if (quiet.comparable) {
      expect(quiet.regressions).toEqual([]);
      expect(quiet.deltas[0]!.verdict).toBe('unchanged');
    }
  });

  test('an operation that did not exist before is not compared to nothing', () => {
    const withNew = report({
      measurements: [measurement(), measurement({ operation: 'explain.render' })],
    });
    const result = compareReports(report(), withNew);
    if (result.comparable) {
      expect(result.onlyInCurrent).toEqual(['explain.render']);
      expect(result.deltas.map(d => d.operation)).toEqual(['trace.record']);
    }
  });
});

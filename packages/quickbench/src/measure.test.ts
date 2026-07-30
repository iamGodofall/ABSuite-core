import { measureOperation, measureSuite, describeEnvironment, renderReport } from './measure';

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

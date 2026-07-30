import { runCoreSuite, coreSuiteSpecs } from './core-suite';

describe('the ABSuite core benchmark', () => {
  test('measures the operations the product actually rests on', () => {
    const names = coreSuiteSpecs().map(spec => spec.operation);

    // If one of these disappears, a published number quietly stops being backed
    // by anything. The list is the contract.
    expect(names).toEqual([
      'trace.record',
      'trace.verify',
      'chain.verify',
      'capability.issue',
      'capability.validate',
      'explain.render',
    ]);
  });

  test('runs the real signing and storage paths, and everything succeeds', async () => {
    // Small but real: a genuine SQLite file, genuine Ed25519 signatures.
    const report = await runCoreSuite({ iterations: 25, chainLength: 20 });

    expect(report.measurements).toHaveLength(6);
    for (const measurement of report.measurements) {
      // A benchmark that silently swallows failures reports a fast, false
      // number. Every operation here must genuinely complete.
      expect(measurement.failures).toBe(0);
      expect(measurement.successRate).toBe(1);
      expect(measurement.opsPerSecond).toBeGreaterThan(0);
      expect(measurement.latencyMs.count).toBe(measurement.iterations);
      expect(measurement.description.length).toBeGreaterThan(20);
    }
  }, 60_000);

  test('the chain measurement really verifies the whole chain', async () => {
    const report = await runCoreSuite({ iterations: 25, chainLength: 50 });
    const chain = report.measurements.find(m => m.operation === 'chain.verify')!;
    const single = report.measurements.find(m => m.operation === 'trace.verify')!;

    // Verifying 50 records cannot be cheaper than verifying one. If it were,
    // verifyChain would not be doing the work the number claims.
    expect(chain.latencyMs.p50).toBeGreaterThan(single.latencyMs.p50);
    expect(chain.description).toContain('50-record chain');
  }, 60_000);

  test('every measurement carries the machine and a way to re-run it', async () => {
    const report = await runCoreSuite({ iterations: 5, chainLength: 5 });

    expect(report.environment.cpuCount).toBeGreaterThan(0);
    expect(report.reproduce).toBe('pnpm bench:core');
  }, 60_000);
});

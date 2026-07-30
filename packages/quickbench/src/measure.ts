/**
 * Measuring ABSuite itself.
 *
 * Every performance number this project publishes has to come from here, and
 * every one of them carries the machine it was measured on. A throughput figure
 * without a CPU, an iteration count and a date is a marketing claim wearing a
 * number's clothes — and this is the worst possible project to make one of
 * those. "Trust must be verifiable" has to include our own benchmarks, or it
 * means nothing.
 *
 * So: no defaults that flatter, no discarded outliers, no best-of-N. Warmup is
 * discarded and *stated*. Failures are counted and reported rather than retried
 * into invisibility. Throughput is derived from elapsed wall-clock time, not
 * from mean latency, because dividing 1000 by a mean under concurrency invents
 * requests that never happened.
 */
import { cpus, totalmem, platform, arch, hostname } from 'node:os';
import { summarise, compareSummaries, type LatencySummary } from './stats';

/** The machine a measurement is only true of. */
export interface BenchEnvironment {
  node: string;
  v8: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  memoryGb: number;
  /** Present only when the runner was told; never guessed. */
  host?: string;
  commit?: string;
  measuredAt: string;
}

export interface OperationMeasurement {
  /** Stable identifier, safe to compare across runs. */
  operation: string;
  /** What was actually executed, in one sentence a reader can check. */
  description: string;
  iterations: number;
  warmupDiscarded: number;
  concurrency: number;
  failures: number;
  /** 0–1, measured. 1 means every iteration returned without throwing. */
  successRate: number;
  latencyMs: LatencySummary;
  /** Iterations divided by elapsed wall-clock seconds. */
  opsPerSecond: number;
  wallClockMs: number;
  /** First error seen, verbatim, when anything failed. */
  errorSample?: string;
}

export interface BenchReport {
  schema: 'absuite.bench.v1';
  environment: BenchEnvironment;
  measurements: OperationMeasurement[];
  totalDurationMs: number;
  /** The exact command that produces this file, so anyone can re-run it. */
  reproduce: string;
}

export interface MeasureSpec {
  operation: string;
  description: string;
  /** Called once per iteration. Throwing counts as a failure, not a crash. */
  run: (iteration: number) => unknown | Promise<unknown>;
  /** Called once before anything is timed. */
  setup?: () => unknown | Promise<unknown>;
  /** Always called, even if the run threw. */
  teardown?: () => unknown | Promise<unknown>;
  iterations?: number;
  warmup?: number;
  concurrency?: number;
}

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Describe the machine. Nothing here is inferred or supplied by a caller. */
export function describeEnvironment(extra: { commit?: string; includeHost?: boolean } = {}): BenchEnvironment {
  const cores = cpus();
  return {
    node: process.versions.node,
    v8: process.versions.v8,
    platform: platform(),
    arch: arch(),
    // A container can report zero CPUs; say so rather than printing "undefined".
    cpuModel: cores[0]?.model?.trim() || 'unknown',
    cpuCount: cores.length,
    memoryGb: round(totalmem() / 1024 ** 3, 1),
    ...(extra.includeHost ? { host: hostname() } : {}),
    ...(extra.commit ? { commit: extra.commit } : {}),
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Time one operation.
 *
 * Latency is measured per iteration with a monotonic clock, so a wall-clock
 * adjustment mid-run cannot produce a negative duration. Throughput comes from
 * the elapsed time of the whole run, which is the only figure that stays honest
 * when `concurrency > 1`.
 */
export async function measureOperation(spec: MeasureSpec): Promise<OperationMeasurement> {
  const iterations = Math.max(1, Math.floor(spec.iterations ?? 1000));
  const warmup = Math.max(0, Math.floor(spec.warmup ?? Math.min(50, Math.ceil(iterations / 20))));
  const concurrency = Math.max(1, Math.floor(spec.concurrency ?? 1));

  await spec.setup?.();

  try {
    // Warmup exists to let the JIT settle. Its timings are thrown away, never
    // averaged in, and the count is reported so nobody has to take that on faith.
    for (let i = 0; i < warmup; i++) {
      try {
        await spec.run(i);
      } catch {
        // A failing warmup is not a result; the timed run will record it.
      }
    }

    const latencies: number[] = [];
    let failures = 0;
    let errorSample: string | undefined;

    const one = async (iteration: number) => {
      const started = process.hrtime.bigint();
      try {
        await spec.run(iteration);
      } catch (error) {
        failures++;
        errorSample ??= error instanceof Error ? error.message : String(error);
      } finally {
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
    };

    const startedAt = process.hrtime.bigint();

    if (concurrency === 1) {
      for (let i = 0; i < iterations; i++) await one(i);
    } else {
      // A shared cursor rather than fixed slices: a slow worker must not leave
      // the others idle, or the wall clock measures scheduling, not the work.
      let next = 0;
      const worker = async () => {
        for (;;) {
          const i = next++;
          if (i >= iterations) return;
          await one(i);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, iterations) }, worker));
    }

    const wallClockMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    return {
      operation: spec.operation,
      description: spec.description,
      iterations,
      warmupDiscarded: warmup,
      concurrency,
      failures,
      successRate: round((iterations - failures) / iterations, 4),
      latencyMs: summarise(latencies),
      // Guard the degenerate case where the whole run is below clock resolution:
      // reporting Infinity ops/sec would be worse than reporting nothing.
      opsPerSecond: wallClockMs > 0 ? round((iterations / wallClockMs) * 1000, 1) : 0,
      wallClockMs: round(wallClockMs),
      ...(errorSample ? { errorSample } : {}),
    };
  } finally {
    await spec.teardown?.();
  }
}

/** Run several operations in sequence and assemble a report. */
export async function measureSuite(
  specs: MeasureSpec[],
  options: { commit?: string; includeHost?: boolean; reproduce?: string } = {}
): Promise<BenchReport> {
  const environment = describeEnvironment(options);
  const startedAt = process.hrtime.bigint();

  const measurements: OperationMeasurement[] = [];
  for (const spec of specs) {
    measurements.push(await measureOperation(spec));
  }

  return {
    schema: 'absuite.bench.v1',
    environment,
    measurements,
    totalDurationMs: round(Number(process.hrtime.bigint() - startedAt) / 1e6),
    reproduce: options.reproduce ?? 'pnpm bench:core',
  };
}

export interface OperationDelta {
  operation: string;
  baselineOpsPerSecond: number;
  currentOpsPerSecond: number;
  deltaPercent: number;
  /** Change in mean latency, milliseconds. Positive is slower. */
  deltaMeanMs: number;
  /** Welch's t-test says this is unlikely to be noise. */
  significant: boolean;
  tStatistic: number;
  verdict: 'faster' | 'slower' | 'unchanged';
}

export type ReportComparison =
  | {
      comparable: false;
      /** Why these two runs must not be compared. */
      reason: string;
    }
  | {
      comparable: true;
      baselineMeasuredAt: string;
      currentMeasuredAt: string;
      deltas: OperationDelta[];
      /** Operations that got significantly slower. The reason this exists. */
      regressions: string[];
      /** Present in one report and not the other; compared to nothing. */
      onlyInCurrent: string[];
      onlyInBaseline: string[];
      /** Same name, different work. Reported rather than silently compared. */
      incomparable: { operation: string; reason: string }[];
    };

/**
 * Compare a run against an earlier one — the step that closes the loop.
 *
 * Measurement on its own is a number. A measurement compared against the last
 * one is a signal, and that is what makes "Learn" feed back into the system
 * rather than terminating in a dashboard tile.
 *
 * It refuses to compare across machines. A laptop and a CI runner produce
 * different numbers for reasons that have nothing to do with the code, and a
 * regression alert that fires on hardware differences gets muted within a week —
 * after which the real regression arrives and nobody looks.
 */
export function compareReports(baseline: BenchReport, current: BenchReport): ReportComparison {
  const a = baseline.environment;
  const b = current.environment;

  if (a.cpuModel !== b.cpuModel || a.cpuCount !== b.cpuCount || a.arch !== b.arch || a.platform !== b.platform) {
    return {
      comparable: false,
      reason:
        `Measured on different machines (${a.cpuModel}, ${a.cpuCount} vCPU, ${a.platform}/${a.arch} vs ` +
        `${b.cpuModel}, ${b.cpuCount} vCPU, ${b.platform}/${b.arch}). A difference between them says nothing about the code.`,
    };
  }

  if (a.node !== b.node) {
    return {
      comparable: false,
      reason: `Measured on different Node versions (${a.node} vs ${b.node}). The runtime is part of what was measured.`,
    };
  }

  const byOperation = new Map(baseline.measurements.map(m => [m.operation, m]));
  const deltas: OperationDelta[] = [];
  const regressions: string[] = [];
  const onlyInCurrent: string[] = [];
  const incomparable: { operation: string; reason: string }[] = [];

  for (const measurement of current.measurements) {
    const previous = byOperation.get(measurement.operation);
    if (!previous) {
      onlyInCurrent.push(measurement.operation);
      continue;
    }

    // The description states the work — "a 1,000-record chain" versus "a
    // 400-record chain" is the same operation doing different amounts of it.
    // Comparing those produced a 59% "improvement" that was purely the smaller
    // chain, which is exactly the kind of flattering nonsense this file exists
    // to prevent.
    if (previous.description !== measurement.description) {
      incomparable.push({
        operation: measurement.operation,
        reason: `The work changed between runs, so a difference says nothing about speed. Was: "${previous.description}" Now: "${measurement.description}"`,
      });
      continue;
    }

    const comparison = compareSummaries(previous.latencyMs, measurement.latencyMs);
    const verdict: OperationDelta['verdict'] = !comparison.significant
      ? 'unchanged'
      : comparison.deltaMeanMs > 0
        ? 'slower'
        : 'faster';

    if (verdict === 'slower') regressions.push(measurement.operation);

    deltas.push({
      operation: measurement.operation,
      baselineOpsPerSecond: previous.opsPerSecond,
      currentOpsPerSecond: measurement.opsPerSecond,
      deltaPercent: comparison.deltaPercent,
      deltaMeanMs: comparison.deltaMeanMs,
      significant: comparison.significant,
      tStatistic: comparison.tStatistic,
      verdict,
    });
  }

  const current_ops = new Set(current.measurements.map(m => m.operation));

  return {
    comparable: true,
    baselineMeasuredAt: a.measuredAt,
    currentMeasuredAt: b.measuredAt,
    deltas,
    regressions,
    onlyInCurrent,
    onlyInBaseline: baseline.measurements.map(m => m.operation).filter(op => !current_ops.has(op)),
    incomparable,
  };
}

/** The report as a table, for a README, a PR comment or a terminal. */
export function renderReport(report: BenchReport): string {
  const env = report.environment;
  const lines = [
    `ABSuite core performance — measured ${env.measuredAt}`,
    `${env.cpuModel} · ${env.cpuCount} vCPU · ${env.memoryGb} GB · ${env.platform}/${env.arch} · Node ${env.node}`,
    env.commit ? `commit ${env.commit}` : '',
    '',
    '| Operation | Iterations | ops/sec | p50 ms | p95 ms | p99 ms | Success |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ].filter(Boolean);

  for (const m of report.measurements) {
    lines.push(
      `| ${m.operation} | ${m.iterations} | ${m.opsPerSecond.toLocaleString('en-US')} | ` +
        `${m.latencyMs.p50} | ${m.latencyMs.p95} | ${m.latencyMs.p99} | ${round(m.successRate * 100, 2)}% |`
    );
  }

  lines.push('', `Reproduce: ${report.reproduce}`);
  return lines.join('\n');
}

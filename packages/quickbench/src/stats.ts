/**
 * Statistics for benchmark results.
 *
 * Percentiles use the nearest-rank method, which is what latency reporting
 * conventionally means: p95 is the smallest observed value that at least 95%
 * of samples fall at or below. No interpolation, so every reported number is a
 * value that was actually measured.
 */

export interface LatencySummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  stddev: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);

  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: ceil(p/100 * N), clamped into the array.
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index]!;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Population standard deviation — we measure the whole run, not a sample. */
export function stddev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  const variance = mean(values.map(value => (value - average) ** 2));
  return Math.sqrt(variance);
}

export function summarise(values: readonly number[]): LatencySummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, stddev: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    count: values.length,
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    mean: round(mean(values)),
    stddev: round(stddev(values)),
    p50: round(percentile(values, 50)),
    p90: round(percentile(values, 90)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
  };
}

/**
 * Compare two runs from their summaries alone.
 *
 * Welch's t-test needs only a mean, a standard deviation and a sample size, all
 * of which a `LatencySummary` already carries — so a regression can be judged
 * against a stored baseline without keeping thousands of raw timings around.
 * Same test, same threshold, same answer as `compareRuns`; less to store.
 */
export function compareSummaries(
  baseline: LatencySummary,
  candidate: LatencySummary
): { deltaMeanMs: number; deltaPercent: number; significant: boolean; tStatistic: number } {
  const deltaMeanMs = candidate.mean - baseline.mean;
  const deltaPercent = baseline.mean === 0 ? 0 : (deltaMeanMs / baseline.mean) * 100;

  const baselineVariance = baseline.count > 1 ? baseline.stddev ** 2 / baseline.count : 0;
  const candidateVariance = candidate.count > 1 ? candidate.stddev ** 2 / candidate.count : 0;
  const denominator = Math.sqrt(baselineVariance + candidateVariance);

  const round = (value: number) => Math.round(value * 100) / 100;

  // Two perfectly repeatable runs with different means are strong evidence, not
  // absent evidence. Deciding on the means beats reporting 0/0 as "no change".
  if (denominator === 0) {
    const changed = deltaMeanMs !== 0;
    return {
      deltaMeanMs: round(deltaMeanMs),
      deltaPercent: round(deltaPercent),
      significant: changed,
      tStatistic: changed ? Infinity : 0,
    };
  }

  const tStatistic = deltaMeanMs / denominator;
  return {
    deltaMeanMs: round(deltaMeanMs),
    deltaPercent: round(deltaPercent),
    significant: Math.abs(tStatistic) > 2,
    tStatistic: round(tStatistic),
  };
}

/**
 * Compare two runs and report whether the change is likely real.
 *
 * Uses Welch's t-test, which does not assume the two runs have equal variance —
 * important because a regressed build is often both slower *and* noisier. A
 * |t| above 2 is treated as significant, roughly 95% confidence at these
 * sample sizes.
 */
export function compareRuns(
  baseline: readonly number[],
  candidate: readonly number[]
): { deltaMeanMs: number; deltaPercent: number; significant: boolean; tStatistic: number } {
  const baselineMean = mean(baseline);
  const candidateMean = mean(candidate);
  const deltaMeanMs = candidateMean - baselineMean;

  const deltaPercent = baselineMean === 0 ? 0 : (deltaMeanMs / baselineMean) * 100;

  const baselineVariance = baseline.length > 1 ? stddev(baseline) ** 2 / baseline.length : 0;
  const candidateVariance = candidate.length > 1 ? stddev(candidate) ** 2 / candidate.length : 0;
  const denominator = Math.sqrt(baselineVariance + candidateVariance);

  // Zero variance in both runs makes the t-statistic 0/0. That is not "no
  // change" — perfectly repeatable runs with different means are the strongest
  // possible evidence, so decide on the means instead of reporting t = 0.
  if (denominator === 0) {
    const changed = deltaMeanMs !== 0;
    return {
      deltaMeanMs: Math.round(deltaMeanMs * 100) / 100,
      deltaPercent: Math.round(deltaPercent * 100) / 100,
      significant: changed,
      tStatistic: changed ? Infinity : 0,
    };
  }

  const tStatistic = deltaMeanMs / denominator;

  return {
    deltaMeanMs: Math.round(deltaMeanMs * 100) / 100,
    deltaPercent: Math.round(deltaPercent * 100) / 100,
    significant: Math.abs(tStatistic) > 2,
    tStatistic: Math.round(tStatistic * 100) / 100,
  };
}

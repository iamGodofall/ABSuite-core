/**
 * @absuitecore/quickbench — LLM and service benchmarking with statistically
 * grounded regression detection.
 */
export {
  percentile,
  mean,
  stddev,
  summarise,
  compareRuns,
  compareSummaries,
  type LatencySummary,
} from './stats';

export {
  OllamaProvider,
  OpenAIProvider,
  AnthropicProvider,
  HttpProvider,
  createProvider,
  availableProviders,
  type Provider,
  type CompletionRequest,
  type CompletionResult,
} from './providers';

export {
  BenchmarkRunner,
  type BenchmarkJob,
  type BenchmarkRequest,
  type BenchmarkResults,
  type JobStatus,
} from './runner';

export { toMarkdown, toCsv, summaryLine } from './report';

export {
  measureOperation,
  measureSuite,
  describeEnvironment,
  renderReport,
  compareReports,
  type OperationDelta,
  type ReportComparison,
  type MeasureSpec,
  type OperationMeasurement,
  type BenchReport,
  type BenchEnvironment,
} from './measure';

export { runCoreSuite, coreSuiteSpecs, type CoreSuiteOptions } from './core-suite';

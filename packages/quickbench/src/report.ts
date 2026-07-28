/**
 * Report rendering.
 *
 * Turns a completed job into Markdown or CSV, so results can go straight into
 * a PR comment or a spreadsheet without anyone re-typing numbers.
 */
import type { BenchmarkJob } from './runner';

export function toMarkdown(job: BenchmarkJob): string {
  if (!job.results) {
    return `# ${job.name}\n\nStatus: **${job.status}**${job.error ? `\n\nError: ${job.error}` : ''}\n`;
  }

  const { latency, throughput, successRate, tokens } = job.results;

  const lines = [
    `# Benchmark — ${job.name}`,
    '',
    `- **Job** \`${job.jobId}\``,
    `- **Provider** ${job.provider}`,
    `- **Model** ${job.model}`,
    `- **Completed** ${job.completedAt ?? 'n/a'}`,
    `- **Success rate** ${successRate}%`,
    '',
    '## Latency (ms)',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| min | ${latency.min} |`,
    `| p50 | ${latency.p50} |`,
    `| p90 | ${latency.p90} |`,
    `| p95 | ${latency.p95} |`,
    `| p99 | ${latency.p99} |`,
    `| max | ${latency.max} |`,
    `| mean | ${latency.mean} |`,
    `| stddev | ${latency.stddev} |`,
    `| samples | ${latency.count} |`,
    '',
    '## Throughput',
    '',
    `- Requests/sec: **${throughput.requestsPerSecond}**`,
    ...(throughput.tokensPerSecond !== null ? [`- Tokens/sec: **${throughput.tokensPerSecond}**`] : []),
    ...(tokens ? [`- Tokens: ${tokens.promptTotal} prompt / ${tokens.completionTotal} completion`] : []),
  ];

  if (job.results.errorSamples.length > 0) {
    lines.push('', '## Errors', '', ...job.results.errorSamples.map(error => `- ${error}`));
  }

  return lines.join('\n') + '\n';
}

export function toCsv(jobs: readonly BenchmarkJob[]): string {
  const header = 'jobId,name,provider,model,completedAt,successRate,p50,p95,p99,mean,requestsPerSecond,tokensPerSecond';

  const rows = jobs
    .filter(job => job.results)
    .map(job => {
      const { latency, throughput, successRate } = job.results!;
      return [
        job.jobId,
        escapeCsv(job.name),
        job.provider,
        job.model,
        job.completedAt ?? '',
        successRate,
        latency.p50,
        latency.p95,
        latency.p99,
        latency.mean,
        throughput.requestsPerSecond,
        throughput.tokensPerSecond ?? '',
      ].join(',');
    });

  return [header, ...rows].join('\n') + '\n';
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function summaryLine(job: BenchmarkJob): string {
  if (!job.results) return `${job.name}: ${job.status}`;
  const { latency, throughput } = job.results;
  return `${job.name}: p50 ${latency.p50}ms, p95 ${latency.p95}ms, ${throughput.requestsPerSecond} req/s`;
}

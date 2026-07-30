#!/usr/bin/env node
/**
 * Run the ABSuite core benchmark and write the result down.
 *
 *   pnpm bench:core                       # default: 2000 iterations per operation
 *   pnpm bench:core -- --iterations 500   # quicker, noisier, still real
 *   pnpm bench:core -- --json             # report on stdout, nothing written
 *
 * The output file is the only source any published performance number may come
 * from. It records the machine alongside the figures, because a number without
 * its machine is not a measurement.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCoreSuite } from './core-suite';
import { renderReport } from './measure';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

function currentCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // Not a checkout, or no git. The report simply omits the commit rather than
    // guessing one.
    return undefined;
  }
}

async function main() {
  const iterations = Number(flag('iterations') ?? 2000);
  const chainLength = Number(flag('chain') ?? 1000);
  const out = resolve(flag('out') ?? join(process.cwd(), 'bench', 'core-latest.json'));
  const commit = currentCommit();

  if (!has('json')) {
    process.stderr.write(
      `Measuring ABSuite core — ${iterations} iterations per operation, ${chainLength}-record chain.\n` +
        'Nothing is stubbed; this runs the real signing, storage and verification paths.\n\n'
    );
  }

  const report = await runCoreSuite({
    iterations,
    chainLength,
    ...(commit ? { commit } : {}),
    // Hostnames can identify a person's laptop. Opt in only.
    includeHost: has('include-host'),
  });

  if (has('json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  // A dated copy as well, so a regression has something to be a regression from.
  const history = join(dirname(out), 'history');
  mkdirSync(history, { recursive: true });
  writeFileSync(
    join(history, `${report.environment.measuredAt.replace(/[:.]/g, '-')}.json`),
    `${JSON.stringify(report, null, 2)}\n`
  );

  process.stdout.write(`${renderReport(report)}\n\nWritten to ${out}\n`);

  const failing = report.measurements.filter(m => m.successRate < 1);
  if (failing.length > 0) {
    process.stderr.write(
      `\n${failing.length} operation(s) had failures: ${failing.map(m => `${m.operation} (${m.errorSample ?? 'no message'})`).join(', ')}\n`
    );
    process.exitCode = 1;
  }
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

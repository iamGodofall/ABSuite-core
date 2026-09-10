#!/usr/bin/env node
/**
 * EVERY GATE `pnpm verify` RUNS MUST ALSO RUN IN CI, OR BE EXCLUDED ON PURPOSE.
 *
 * `verify` ran 27 gates. `.github/workflows/ci.yml` hand-listed 12 of them as
 * 12 separate steps. **Fifteen never ran in CI at all**, and the list of what
 * was missing is the argument for this file existing:
 *
 *   check:numbers      the gate against publishing a figure nobody measured —
 *                      on the repository whose whole sales argument is that its
 *                      figures are measured. Five wrong numbers were live on the
 *                      site while it sat unrun.
 *   check:routeauth    written after twelve routes shipped with no authentication
 *                      decision (AUDIT §3x). Two more had arrived since.
 *   check:outbound     written after the SSRF findings (§3n, §3j, §3z).
 *   check:map, :site   generated pages, drifting silently.
 *   check:protocol, :surface, :config, :metered, :listings, :apis, :python,
 *   check:container-pnpm, :cross-platform, :demo
 *
 * None of that was a decision. Adding a gate meant remembering a second place,
 * and fifteen times nobody did — which is this project's favourite defect
 * (something built and reachable from nothing) wearing a workflow file.
 *
 * ## Why not simply `run: pnpm verify`
 *
 * Because one step stops at the first failure. `ci.yml` lists the gates
 * separately with `if: always()` precisely so ONE run names every red gate
 * rather than the first — a property added the same week a stale generated file
 * hid the state of twelve others behind it. Keeping the steps and checking the
 * LIST is what keeps both.
 *
 * ## An exclusion is a decision with a reason, never an omission
 *
 * Anything in EXCLUDED is deliberately not in CI and says why. Anything else
 * missing fails this check, and an exclusion for a gate that is no longer in
 * `verify` fails it too — a stale exemption is how a gate comes back quietly.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/**
 * Gates that must NOT run in CI, each with the reason. **Empty, and that is the
 * finding rather than an oversight**: every gate `verify` runs passed in this
 * container, so there was never a technical reason for the fifteen omissions —
 * only that ci.yml was a second, hand-kept list.
 *
 * It stays here because the day one is genuinely un-runnable in CI, the choice
 * is between writing the reason down and quietly dropping the step, and that is
 * exactly the choice that produced the fifteen.
 *
 * NOT COVERED, and stated so nobody reads a green tick as broader than it is:
 * `check:live` and `check:registry` are not in `verify` at all, so this gate
 * says nothing about them. The first probes a RUNNING instance over HTTP and the
 * second queries the npm registry; both belong to a release, not to a commit.
 */
const EXCLUDED = {};

const manifest = JSON.parse(read('package.json'));

/** The gate list, taken from `verify` itself so the two cannot drift. */
const inVerify = manifest.scripts.verify
  .split('&&')
  .map((step) => step.trim().replace(/^pnpm\s+/, ''))
  // The build and the suite are CI's own jobs, not gates in the lint job.
  .filter((name) => name !== 'build' && name !== 'test');

const ci = read('.github/workflows/ci.yml');
const inCI = new Set(
  [...ci.matchAll(/run:\s*pnpm\s+([a-z:-]+)/g)].map((m) => m[1]),
);

const missing = inVerify.filter((g) => !inCI.has(g) && !(g in EXCLUDED));
const staleExemption = Object.keys(EXCLUDED).filter((g) => !inVerify.includes(g));
const excludedButPresent = Object.keys(EXCLUDED).filter((g) => inCI.has(g));

console.log('\nEvery gate in `pnpm verify` runs in CI\n');

const problems = [];
for (const gate of missing) {
  problems.push(`${gate} is in \`verify\` and not in ci.yml, and is not excluded with a reason`);
}
for (const gate of staleExemption) {
  problems.push(`${gate} is excluded here but no longer in \`verify\` — a stale exemption`);
}
for (const gate of excludedButPresent) {
  problems.push(`${gate} is excluded here and ci.yml runs it anyway — one of the two is wrong`);
}

if (problems.length > 0) {
  console.error(`\x1b[31m✗\x1b[0m ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nAdd the step to .github/workflows/ci.yml (with `if: always()`, so one run\n' +
    'names every red gate rather than the first), or add it to EXCLUDED in\n' +
    'scripts/check-ci-gates.mjs with the reason it cannot run there.\n',
  );
  process.exit(1);
}

console.log(
  `\x1b[32m✓\x1b[0m ${inVerify.length - Object.keys(EXCLUDED).length} gate(s) in \`verify\` all run in CI; ` +
  `${Object.keys(EXCLUDED).length} excluded with a reason.`,
);
for (const [gate, why] of Object.entries(EXCLUDED)) console.log(`    ${gate} — ${why}`);
console.log('');

#!/usr/bin/env node
/**
 * Every number a document publishes must match what the repository measures.
 *
 * This project's first principle is that nothing may look more complete than it
 * is, and its stated rule is that no number is published that a measurement did
 * not produce. Both were violated repeatedly and quietly:
 *
 *   "719 tests"      when the suite ran 721
 *   "495 tests"      for weeks before that
 *   "103 endpoints"  when the API table listed 127
 *   "17 gates"       when `pnpm verify` runs sixteen checks — a number nobody
 *                    ever counted, repeated across two documents and dozens of
 *                    commit messages until somebody finally did
 *
 * None of those were caught by reading. Every one was a plausible number sitting
 * in prose, and prose is exactly where a wrong number survives longest.
 *
 * So the numbers are derived here and compared against what the documents claim.
 * A figure that drifts fails the build, in the repository whose whole argument is
 * that a claim nobody can check is not evidence.
 *
 * ## What is deliberately not checked
 *
 * The test count. `test.each` expands at runtime, so any static parse is an
 * approximation — and an approximation enforced as exact would fail the build
 * for being right. It is measured by running the suite, which `pnpm verify`
 * already does immediately before this. Documents may state it; this cannot
 * police it, and says so rather than pretending.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ── What the repository actually contains ──────────────────────────────── */

const manifest = JSON.parse(read('package.json'));

/** Checks in `pnpm verify` — the build and the suite are not checks. */
const CHECKS = manifest.scripts.verify
  .split('&&')
  .map(step => step.trim())
  .filter(step => step !== 'pnpm build' && step !== 'pnpm test')
  .length;

/** Rows in the generated route table, which is itself generated from source. */
const ROUTES = [...read('docs/API.md').matchAll(/^\|\s*(?:GET|POST|PUT|DELETE|PATCH)\s*\|/gm)].length;

const PACKAGES = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).length;

/** Test *files*, which is exact — unlike the number of tests inside them. */
const countSuites = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
  .reduce((total, entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return total;
    if (entry.isDirectory()) return total + countSuites(join(dir, entry.name));
    return total + (entry.name.endsWith('.test.ts') ? 1 : 0);
  }, 0);
const SUITES = countSuites('packages');

const LAYERS_BUILT = [...read('docs/CONSTITUTION.md')
  .matchAll(/^\|\s*\d\s*\|\s*\*\*[^*]+\*\*\s*\|[^|]+\|\s*(Built|Partly built|Not built)\s*\|/gm)]
  .filter(match => match[1] === 'Built').length;

/* ── What the documents claim ───────────────────────────────────────────── */

/**
 * Patterns are deliberately narrow.
 *
 * A looser regex would sweep up prose that merely contains a number near a word
 * — "the 8 layers", "127 in the table" — and a check that fires on sentences it
 * misread gets disabled within a week. Each of these matches a figure being
 * stated as fact about this repository, and nothing else.
 */
const CLAIMS = [
  { what: 'checks in pnpm verify', actual: CHECKS,
    find: /(\d+)\s+(?:build\s+)?(?:gates?|checks)\b/gi,
    // "16 checks" is the claim; "four checks the room runs" is not this number.
    ignore: /conformance|python|surface|opacity|COPY|route/i },
  // Qualified deliberately. AUDIT.md counts routes per feature — "identity.ts,
  // 7 routes" — and an unqualified pattern read those as claims about the whole
  // API. A check that fires on sentences it misread gets switched off.
  { what: 'documented routes', actual: ROUTES,
    find: /(\d+)\s+(?:documented\s+routes|API\s+endpoints|endpoints\s+are\s+documented)\b/gi,
    ignore: /GET routes|reaches|client calls|server routes/i },
  { what: 'packages in the monorepo', actual: PACKAGES,
    find: /(\d+)\s+packages\s+in\s+the\s+monorepo/gi },
  { what: 'test suites', actual: SUITES,
    find: /(\d+)\s+suites\b/gi },
  { what: 'layers built', actual: LAYERS_BUILT,
    find: /(\d+)\s+of\s+8\s+layers\s+built/gi },
];

/** Documents that describe a moment rather than the present. */
const DATED = ['docs/UI-OVERHAUL-BRIEF.md'];

const docs = ['README.md', ...readdirSync(join(root, 'docs'))
  .filter(name => name.endsWith('.md')).map(name => `docs/${name}`)]
  .filter(path => !DATED.includes(path));

const wrong = [];
const right = [];

for (const path of docs) {
  const lines = read(path).split('\n');
  lines.forEach((line, index) => {
    // A line explicitly marked as historical is a record, not a claim.
    // A quoted figure is being reported, not asserted — including this file's
    // own note about the "17 gates" it was wrong about.
    if (/superseded|was\s+\d|it said|for months|described as|["'“‘]\s*\d/i.test(line)) return;
    for (const claim of CLAIMS) {
      if (claim.ignore?.test(line)) continue;
      for (const match of line.matchAll(claim.find)) {
        const stated = Number(match[1]);
        if (stated === claim.actual) { right.push(`${path}:${index + 1}  ${claim.what} = ${stated}`); continue; }
        wrong.push(
          `${path}:${index + 1}\n      claims ${stated} ${claim.what}, repository has ${claim.actual}\n      ${line.trim().slice(0, 96)}`
        );
      }
    }
  });
}

for (const line of right) console.log(`✓ ${line}`);

if (wrong.length > 0) {
  console.error(`\n${wrong.length} published number(s) no measurement produced:\n`);
  for (const line of wrong) console.error(`  ✗ ${line}\n`);
  console.error('Fix the document, or fix the repository. A number nobody measured is');
  console.error('the defect this project exists to catch, and it does not get an exemption\n');
  process.exit(1);
}

console.log(
  `\n${right.length} published figure(s) match the repository — ` +
  `${CHECKS} checks, ${ROUTES} routes, ${PACKAGES} packages, ${SUITES} suites, ${LAYERS_BUILT} of 8 layers.`
);
console.log('The test count is not policed here: test.each expands at runtime, so any');
console.log('static parse would be an approximation enforced as though it were exact.');

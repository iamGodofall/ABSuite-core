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

/**
 * Backend services the room brings up — the source of truth is the list
 * `pnpm room` actually spawns, not a count anybody wrote down.
 *
 * This was published as "six services" in eleven places, in two shapes that
 * cannot both be true: *six services* (correct only if the room counts as one)
 * and *six services plus the interface* (which counts the room twice). Two
 * files said five and were right the whole time — `MODULES.md` and
 * `deploy/serve-all.mjs` — and disagreed with everything around them without
 * anyone noticing, because nine documents agreeing looks like consensus.
 */
const SERVICES = [...read('scripts/run-room.mjs')
  .matchAll(/^\s*\{\s*name:\s*'[^']+',\s*pkg:\s*'[^']+',\s*port:\s*\d+\s*\},?$/gm)].length;

/**
 * Routes behind `ABSUITE_ADMIN_API_KEY`.
 *
 * `DEPLOY.md` published this as **"Twenty-eight routes"** while the dashboard
 * had thirty-eight. Spelled out in words, so every pattern here — all of which
 * match digits — walked straight past it. An operator reads that table to decide
 * whether the variable matters.
 *
 * Counted from the server rather than from a sentence, and matched in both
 * shapes for the same reason `SERVICES` is.
 */
const ADMIN_ROUTES = [...read('packages/dashboard-ui/server.ts')
  .matchAll(/^app\.(?:get|post|put|delete|patch)\([^)]*requireAdminAccess/gm)].length;

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
  { what: 'routes behind ABSUITE_ADMIN_API_KEY', actual: ADMIN_ROUTES,
    find: /(\d+)\s+routes\s+sit\s+behind\s+it\b/gi },
  // Written as digits and as words, because both shipped. "six services plus
  // the interface" is the phrasing that double-counted the room, so the word
  // form has to be caught — a check that only reads digits misses the way this
  // number was actually wrong.
  { what: 'services the room starts', actual: SERVICES,
    find: /\b(?:(\d+)|(five|six|seven|eight))\s+(?:HTTP\s+)?services\b/gi,
    words: { five: 5, six: 6, seven: 7, eight: 8 },
    // k8s manifests and container counts are a different tally.
    ignore: /manifest|container|k8s|three of/i },
];

/** Documents that describe a moment rather than the present. */
const DATED = ['docs/UI-OVERHAUL-BRIEF.md'];

/*
 * `deploy/serve-all.mjs` is in this list because it printed the same wrong
 * figure as DEPLOY.md — "Twenty-eight read routes" — in a message an operator
 * sees at startup, when the dashboard had thirty-eight. Scanning only Markdown
 * meant a published number in a *program* was outside the one check built to
 * catch published numbers. A claim is a claim wherever a person reads it.
 */
const docs = ['README.md', 'deploy/serve-all.mjs', ...readdirSync(join(root, 'docs'))
  .filter(name => name.endsWith('.md')).map(name => `docs/${name}`)]
  .filter(path => !DATED.includes(path));

/**
 * Character ranges on a line that are quoting rather than asserting.
 *
 * A figure inside quotation marks, emphasis or a code span is being *shown* —
 * `6/6 SERVICES ANSWERED` in UI-PHILOSOPHY is an example of fabricated output,
 * and AUDIT §3e quotes the wrong `"six services"` in order to correct it. Both
 * are the opposite of a claim about this repository.
 *
 * This is positional rather than a line-level keyword test, because the earlier
 * version was line-level and could not tell *"six services"* in a correction
 * from six services in a promise. It also had to be taught number-words: the
 * figure that shipped wrong eleven times was spelled out, not written as a
 * digit, and a guard that only understood digits let every one of them past.
 *
 * **Bold is not quoting.** It used to be exempt here, and that exempted the
 * loudest numbers in the repository — `**932 tests, 42 suites, 19 checks**` is
 * a headline assertion, not a figure being held up for inspection, and it sat
 * stale at 19 while the line under it was policed at 24. Italic still counts as
 * quoting, because §3e really does write *six services* to correct it; the
 * pattern below just refuses to see the inside of a `**bold**` span as italic,
 * which is how the stale headline hid behind a rule written for something else.
 */
const quotedRanges = (line) => {
  const ranges = [];
  const spans = [/"[^"]*"/g, /'[^']*'/g, /[“][^”]*[”]/g, /`[^`]*`/g, /(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g];
  for (const span of spans) {
    for (const match of line.matchAll(span)) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
};

const wrong = [];
const right = [];

for (const path of docs) {
  const lines = read(path).split('\n');
  lines.forEach((line, index) => {
    // A line explicitly marked as historical is a record, not a claim.
    if (/superseded|was\s+\d|it said|for months|described as|\d\s*\/\s*\d/i.test(line)) return;
    const quoted = quotedRanges(line);
    for (const claim of CLAIMS) {
      if (claim.ignore?.test(line)) continue;
      for (const match of line.matchAll(claim.find)) {
        if (quoted.some(([from, to]) => match.index >= from && match.index < to)) continue;
        // A claim may be written as a digit or as a word; both shipped wrong.
        const stated = match[1] !== undefined
          ? Number(match[1])
          : claim.words?.[match[2]?.toLowerCase()];
        if (stated === undefined || Number.isNaN(stated)) continue;
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
/* ── The pricing tables, against the plans the code actually sells ──────── */

/*
 * A PRICE IS THE ONE PUBLISHED NUMBER THAT TAKES SOMEBODY'S MONEY.
 *
 * Every other figure in this file is a claim about size. These are a claim
 * about what a customer will be charged and what they get for it, and they are
 * published in two documents and served by a running instance at `GET /plans`
 * — four copies of one fact, three of them prose.
 *
 * The drift this catches is not hypothetical anywhere else in this project:
 * `billing.ts` already carries a comment about the annual price being stored
 * twice and silently becoming a 40% discount on the tier that just got more
 * expensive. The same fault in a README is worse, because the reader acts on it
 * before anybody reconciles an invoice.
 *
 * Parsed from the source rather than imported, for the same reason the rest of
 * this script is: it must run before the build, against a tree that may not
 * compile.
 */
const billing = read('packages/capkit/src/billing.ts');

const annualMonths = Number(/ANNUAL_MONTHS_CHARGED\s*=\s*(\d+)/.exec(billing)?.[1]);
if (!annualMonths) throw new Error('ANNUAL_MONTHS_CHARGED not found in billing.ts');

const planBlock = (id) => {
  const from = billing.indexOf(`  ${id}: {`);
  if (from < 0) throw new Error(`plan ${id} not found in billing.ts`);
  return billing.slice(from, billing.indexOf('\n  },', from));
};
const field = (id, name) => {
  const found = new RegExp(`${name}:\\s*(-?[\\d_]+)`).exec(planBlock(id));
  if (!found) throw new Error(`${id}.${name} not found in billing.ts`);
  return Number(found[1].replace(/_/g, ''));
};

const money = (cents) => `$${(cents / 100).toLocaleString('en-US')}`;
const cadence = (hours) => (hours < 0 ? 'never' : hours === 24 ? 'daily' : hours === 1 ? 'hourly' : `every ${hours} hours`);
const window_ = (hours) => (hours < 0 ? 'unwitnessed' : hours === 1 ? '1 hour' : `${hours} hours`);

/**
 * What each row of a published pricing table must say for Team and Business.
 *
 * Only the two priced rungs are policed. Free is $0 and Enterprise is
 * negotiated — neither is derived from a number that can drift.
 */
const priced = ['team', 'business'];
const PRICING_ROWS = {
  'Monthly': priced.map(id => money(field(id, 'priceCents'))),
  'Annual': priced.map(id => money(field(id, 'priceCents') * annualMonths)),
  'Witnessed by us': priced.map(id => cadence(field(id, 'witnessIntervalHours'))),
  'Rewrite window': priced.map(id => window_(field(id, 'witnessIntervalHours'))),
  'Agents': priced.map(id => field(id, 'agents').toLocaleString('en-US')),
  'Validations / month': priced.map(id => field(id, 'validations').toLocaleString('en-US')),
  'Audit retention': priced.map(id => `${field(id, 'auditRetentionDays')} days`),
};

/* Emphasis and italics are presentation; the cell underneath is the claim. */
const plain = (cell) => cell.replace(/\*+/g, '').replace(/`/g, '').trim();

const pricingWrong = [];
let pricingRight = 0;

for (const path of docs) {
  read(path).split('\n').forEach((line, index) => {
    if (!line.startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map(plain);
    // | label | free | team | business | enterprise |
    if (cells.length !== 5) return;
    const expected = PRICING_ROWS[cells[0]];
    if (!expected) return;
    [cells[2], cells[3]].forEach((stated, rung) => {
      if (stated === expected[rung]) { pricingRight += 1; return; }
      pricingWrong.push(
        `${path}:${index + 1}\n      ${priced[rung]} "${cells[0]}" says ${stated}, billing.ts says ${expected[rung]}`
      );
    });
  });
}

if (pricingWrong.length > 0) {
  console.error(`\n${pricingWrong.length} published price(s) the code does not charge:\n`);
  for (const line of pricingWrong) console.error(`  ✗ ${line}\n`);
  console.error('billing.ts is the price. A table that disagrees with it is not a');
  console.error('typo — it is a quote nobody can honour\n');
  process.exit(1);
}

console.log(`${pricingRight} published pricing cell(s) match billing.ts — ` +
  `team ${money(field('team', 'priceCents'))}/mo, business ${money(field('business', 'priceCents'))}/mo, ` +
  `annual charged ${annualMonths} months.`);

console.log('The test count is not policed here: test.each expands at runtime, so any');
console.log('static parse would be an approximation enforced as though it were exact.');

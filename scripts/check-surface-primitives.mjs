#!/usr/bin/env node
/**
 * A refactor that nothing enforces is a refactor that happens twice.
 *
 * The layer surfaces were rebuilt on shared primitives after counting what was
 * actually there:
 *
 *     40 panel divs across 19 files
 *     29 carrying the identical class string, character for character
 *     25 hand-written empty states
 *     17 hand-written error boxes
 *
 * Every one of those was a place where the next person writes the markup from
 * memory and gets it slightly wrong — and, worse, a place where a decision this
 * project cares about has to be re-made by hand and can quietly not be. An empty
 * state that says "no data" instead of naming what is absent is not a styling
 * mistake; it is the product failing to be honest in the one situation it exists
 * for.
 *
 * So this counts. It does not forbid a raw panel outright — a surface with a
 * genuinely different shape is allowed to exist — it forbids the count from
 * creeping back up, which is the failure mode that actually happens. The budget
 * ratchets down as files are migrated and can never ratchet up without somebody
 * editing this file and explaining why in the commit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiSrc = join(root, 'packages/dashboard-ui/src');

/**
 * The ceiling, and where it came from.
 *
 * Lower this when you migrate a surface. Raising it requires saying why in the
 * commit message, which is the whole point — a number that can be quietly
 * raised is not a budget, it is a suggestion.
 */
const BUDGET = {
  // Ratcheted to what was actually migrated, not to a target that sounded good.
  // Agents was rebuilt on the primitives by hand; three more header panels were
  // migrated mechanically. The rest carry JSX or expressions inside their body,
  // and a regex that rewrote those into string props would render braces as
  // visible text — so they were deliberately left, and the number reflects that.
  panels: 35,   // was 40
  empties: 2,   // was 25 by the original count; 2 remain under the corrected pattern
  problems: 4,  // was 17 under a pattern that also counted legitimate state colouring
};

/*
 * Anchored to a literal `className="…"`, and that correction matters.
 *
 * The first version of this matched the amber error styling anywhere it
 * appeared, and most appearances are not error boxes at all — they are
 * conditional state colouring inside a cn() ternary:
 *
 *     result.requiresHuman ? 'border-amber-500/40 bg-amber-500/[0.06]' : …
 *
 * That is exactly right and must not be rewritten into a Problem component. A
 * check that flags correct code is worse than no check: it teaches people to
 * ignore the output, or to make a bad edit to silence it. So each pattern now
 * requires a literal class attribute, which is what a hand-built box actually
 * looks like.
 */
const PATTERNS = {
  panels: /className="[^"]*rounded-(?:xl|lg|2xl)\s+border\s+border-border\s+bg-bg-secondary[^"]*"/g,
  empties: /className="[^"]*border-border\s+bg-bg-secondary\s+p-6[^"]*"/g,
  problems: /className="[^"]*border-amber-500\/40\s+bg-amber-500\/\[0\.06\][^"]*"/g,
};

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    // The primitives themselves are where this markup is supposed to live.
    if (full.includes(`${join('src', 'surface')}`)) continue;
    if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) files.push(full);
  }
})(uiSrc);

const counts = { panels: 0, empties: 0, problems: 0 };
const byFile = {};

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const local = {};
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    const found = (text.match(pattern) ?? []).length;
    counts[name] += found;
    if (found > 0) local[name] = found;
  }
  if (Object.keys(local).length > 0) byFile[relative(root, file)] = local;
}

const over = Object.entries(BUDGET).filter(([name, budget]) => counts[name] > budget);

if (over.length > 0) {
  console.error('\nHand-assembled surface markup is above its budget:\n');
  for (const [name, budget] of over) {
    console.error(`  ✗ ${name}: ${counts[name]}, budget ${budget}`);
  }
  console.error('\nWorst offenders:');
  for (const [file, local] of Object.entries(byFile).sort((a, b) =>
    Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0)).slice(0, 6)) {
    console.error(`    ${file}  ${JSON.stringify(local)}`);
  }
  console.error('\nUse the primitives in packages/dashboard-ui/src/surface/Surface.tsx.');
  console.error('Panel requires a title. Empty requires a reason. Problem requires what failed.');
  console.error('Those are not conveniences — they are the decisions that get skipped when');
  console.error('the markup is written by hand.\n');
  process.exit(1);
}

/**
 * A budget check is uniquely vulnerable to scanning nothing.
 *
 * Every other gate looks for a defect; this one counts occurrences against a
 * ceiling, so an empty file set produces zero of everything and passes with the
 * most confident output in the suite. It did exactly that on Windows, where the
 * walk matched no files because of path separators.
 *
 * The floor catches "the walk found nothing" and is set well below the real
 * count on purpose — an exact figure would fail the build for adding a
 * component, which is how a floor gets raised until it means nothing.
 */
const FLOOR = 20;
if (files.length < FLOOR) {
  console.error(`\n✗ Only ${files.length} interface file(s) were scanned, and at least ${FLOOR} were expected.`);
  console.error('');
  console.error('  A budget check that scans nothing counts zero of everything and reports');
  console.error('  three ticks. That is the most confident output in the suite, produced by');
  console.error('  inspecting an empty set, and it is how this passed on Windows.');
  console.error('');
  console.error('  Looked in packages/dashboard-ui/src. Either the interface moved, or the');
  console.error('  walk is broken on this platform.\n');
  process.exit(1);
}

console.log(`✓ ${counts.panels} hand-built panel(s), budget ${BUDGET.panels}`);
console.log(`✓ ${counts.empties} hand-built empty state(s), budget ${BUDGET.empties}`);
console.log(`✓ ${counts.problems} hand-built error box(es), budget ${BUDGET.problems}`);
console.log(`  ${files.length} interface file(s) scanned. The primitives carry the rest.`);

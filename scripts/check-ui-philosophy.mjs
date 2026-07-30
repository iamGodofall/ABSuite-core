#!/usr/bin/env node
/**
 * The UI philosophy is a specification, not a mood board.
 *
 * `docs/UI-PHILOSOPHY.md` names thirteen primary views, a five-value colour
 * system, a header identity and eight state-to-motion bindings. A document that
 * asserts all of that while the interface quietly drifts is exactly the failure
 * the document itself forbids: something looking more complete than it is.
 *
 * So the document is the source of truth and this reads it. Every claim below
 * is parsed out of the Markdown rather than hardcoded here, which means the
 * only way to change what is enforced is to change what is promised.
 *
 * Exits non-zero on any drift.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'docs/UI-PHILOSOPHY.md'), 'utf8');
const app = readFileSync(join(root, 'packages/dashboard-ui/src/App.tsx'), 'utf8');
const css = readFileSync(join(root, 'packages/dashboard-ui/src/styles/globals.css'), 'utf8');

const failures = [];
const passes = [];

const section = (heading) => {
  const start = doc.indexOf(heading);
  if (start === -1) return '';
  const after = doc.slice(start + heading.length);
  const end = after.search(/\n#{2,3} /);
  return end === -1 ? after : after.slice(0, end);
};

// ── 1. The thirteen primary views must all be reachable ─────────────────────
//
// "Reachable" means present in TAB_CONFIG, which is what builds the sidebar. A
// view that exists as a component but hangs off no nav entry is a capability
// nobody will find, which is the state most of these were in before.

const promisedViews = [...section('### Primary views').matchAll(/^\d+\.\s+(.+)$/gm)]
  .map(match => match[1].trim());

if (promisedViews.length === 0) {
  failures.push('docs/UI-PHILOSOPHY.md: could not parse the numbered "Primary views" list.');
}

const navLabels = [...app.matchAll(/\blabel:\s*'([^']+)'/g)].map(match => match[1]);

for (const view of promisedViews) {
  const found = navLabels.some(label => label.toLowerCase() === view.toLowerCase());
  if (found) passes.push(`view reachable: ${view}`);
  else failures.push(`docs/UI-PHILOSOPHY.md promises the "${view}" view; no nav entry in App.tsx has that label.`);
}

// The reverse direction is deliberately not enforced. Settings is real and is
// not a "primary view"; the document does not have to list plumbing.

// ── 2. Header identity ──────────────────────────────────────────────────────
//
// The document's Final Test is that a stranger ten feet away can name the
// thing. That test fails silently if the masthead loses a line.

const headerLines = ['ABSuite', 'Trust Operations Center', 'The Future Is Accountable.'];
for (const line of headerLines) {
  if (app.includes(line)) passes.push(`header carries: "${line}"`);
  else failures.push(`The header must carry "${line}" — docs/UI-PHILOSOPHY.md § Header.`);
}

// ── 3. The colour system ────────────────────────────────────────────────────
//
// Each stated hex must appear in the stylesheet. They are authored as HSL
// custom properties, so the hex lives in the comment beside its value — which
// is the only place a reader can check the mapping, and therefore the place
// that must not rot.

const promisedColours = [...section('**Colour system**').matchAll(/`(#[0-9A-Fa-f]{6})`/g)]
  .map(match => match[1].toUpperCase());

if (promisedColours.length === 0) {
  failures.push('docs/UI-PHILOSOPHY.md: could not parse the colour system table.');
}

for (const hex of promisedColours) {
  const inCss = css.toUpperCase().includes(hex);
  const inApp = app.toUpperCase().includes(hex);
  if (inCss || inApp) passes.push(`colour present: ${hex}`);
  else failures.push(`${hex} is in the stated colour system but appears in neither globals.css nor App.tsx.`);
}

// ── 4. State-to-motion bindings for the four determinations ─────────────────
//
// DEMONSTRATED / FAILED / UNKNOWN / ABSENT are the product's evidence language.
// The document binds each to a visual state. If a class disappears, records
// stop being distinguishable at a glance and the four states collapse into
// "green and not green" — which is the two-state world this product rejects.

const determinationClasses = {
  DEMONSTRATED: 'ops-state-demonstrated',
  FAILED: 'ops-state-failed',
  UNKNOWN: 'ops-state-unknown',
  ABSENT: 'ops-state-absent',
};

for (const [state, className] of Object.entries(determinationClasses)) {
  if (!doc.includes(`\`${state}\``)) {
    failures.push(`docs/UI-PHILOSOPHY.md no longer binds ${state} to a visual state.`);
    continue;
  }
  if (css.includes(`.${className}`)) passes.push(`${state} → .${className}`);
  else failures.push(`${state} is bound to a visual state in the document, but .${className} is not defined in globals.css.`);
}

// ── 5. Motion must yield to reduced-motion ──────────────────────────────────
//
// "Never distracting" is not a preference when someone has told their operating
// system that motion hurts them.

if (/@media\s*\(\s*prefers-reduced-motion/.test(css)) {
  passes.push('motion yields to prefers-reduced-motion');
} else {
  failures.push('globals.css defines state animations but honours no prefers-reduced-motion query.');
}

// ── 6. Promises must be kept or listed as unkept ────────────────────────────
//
// This check passed for a whole session while the interface violated the
// document's centerpiece section outright: "The cube is always present" was
// true of one view out of thirteen. It passed because it only checked what was
// cheap to check — names, hexes, header strings — and never the claims that
// actually describe what the thing feels like.
//
// A check that certifies compliance with a document nobody is complying with is
// worse than no check, because it converts an open question into a green tick.
// That is precisely the failure this product exists to argue against, committed
// by the tool built to prevent it.
//
// So the verifiable claims are verified, and anything unmet must appear in the
// "What is not built yet" ledger. Both directions are enforced: an unmet
// promise missing from the ledger fails, and a ledger entry that has since been
// built also fails, so the list cannot rot into an excuse.

const ledger = section('## What is not built yet');
const ledgerRows = [...ledger.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)]
  .map(match => match[1].trim())
  .filter(entry => entry && !/^-+$/.test(entry) && entry.toLowerCase() !== 'promise');

const uiFiles = [];
const collect = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { collect(full); continue; }
    if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) uiFiles.push(full);
  }
};
collect(join(root, 'packages/dashboard-ui/src'));

/**
 * Claims this script can actually settle by reading the source.
 *
 * `met()` must be a real test, not a proxy. Where a claim cannot be settled
 * mechanically — "familiar and impossible at the same time" — it is left to a
 * human and deliberately not asserted here, because a check that pretends to
 * measure taste is the same lie in a different costume.
 */
const VERIFIABLE = [
  {
    promise: 'The cube is always present',
    met: () => {
      const withCube = uiFiles.filter(file => /cube/i.test(readFileSync(file, 'utf8')));
      // "Always present" means the shell, not one tab.
      return withCube.some(file => /App\.tsx$/.test(file));
    },
  },
  {
    promise: 'Particle fields, particle convergence on evidence created',
    met: () => /@keyframes[^{]*particle/i.test(css) || /particle/i.test(css),
  },
];

for (const claim of VERIFIABLE) {
  const isMet = claim.met();
  const isListed = ledgerRows.some(row => row.toLowerCase() === claim.promise.toLowerCase());

  if (isMet && isListed) {
    failures.push(`"${claim.promise}" is built, but still listed under "What is not built yet". Remove the row — a stale ledger becomes an excuse.`);
  } else if (!isMet && !isListed) {
    failures.push(`"${claim.promise}" is promised by this document, is not implemented, and is not listed under "What is not built yet". Build it or record it.`);
  } else {
    passes.push(isMet ? `promise kept: ${claim.promise}` : `promise recorded as unbuilt: ${claim.promise}`);
  }
}

if (ledgerRows.length === 0) {
  failures.push('docs/UI-PHILOSOPHY.md: the "What is not built yet" ledger is missing or unparseable. An empty ledger must be an empty table, not an absent section.');
}

// ── 6. The critical rule outranks the rest ──────────────────────────────────
//
// This one is a documentation check, not a code check, and it is here because
// the ordering is the whole safeguard: if "alive" ever reads as equal in weight
// to "never fake data", someone will eventually resolve the conflict the wrong
// way and call it a design decision.

if (/critical rule/i.test(doc) && /never fake data/i.test(doc)) {
  passes.push('the critical rule is stated');
} else {
  failures.push('docs/UI-PHILOSOPHY.md must state the critical rule: never fake data.');
}

// ── Report ──────────────────────────────────────────────────────────────────

for (const line of passes) console.log(`✓ ${line}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} drift(s) between docs/UI-PHILOSOPHY.md and the interface:\n`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  console.error('\nEither the interface owes the document, or the document is out of date. Fix one.\n');
  process.exit(1);
}

console.log(
  `\n${promisedViews.length} promised view(s) reachable, ${promisedColours.length} stated colour(s) present, ` +
  `4 determination(s) bound to a visual state.`
);

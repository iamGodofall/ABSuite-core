#!/usr/bin/env node
/**
 * The line between aspiration and implementation must not drift.
 *
 * The Constitution's layer table claims eight things, each marked built, partly
 * built, or not built, and each built claim names a file. That is the most
 * dangerous table in the repository: it is where a project quietly promotes a
 * plan to a feature, one honest-looking edit at a time, and nobody notices
 * because prose does not fail a build.
 *
 * This makes it fail a build. Every layer claimed as built or partly built must
 * name a file that exists. Every layer marked not built must name none — a
 * promotion has to be a deliberate act, argued for, not something that happens
 * because someone pasted a path into a table.
 *
 *   node scripts/check-doctrine.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const constitution = join(root, 'docs/CONSTITUTION.md');

if (!existsSync(constitution)) {
  console.error('docs/CONSTITUTION.md does not exist.');
  process.exit(1);
}

const text = readFileSync(constitution, 'utf8');

// | 3 | **Evidence** | … | Built | `packages/trust/src/verification.ts` |
const rows = [
  ...text.matchAll(
    /^\|\s*(\d)\s*\|\s*\*\*([^*]+)\*\*\s*\|[^|]*\|\s*(Built|Partly built|Not built)\s*\|\s*([^|]*?)\s*\|$/gm
  ),
].map(match => ({
  number: Number(match[1]),
  layer: match[2].trim(),
  status: match[3].trim(),
  evidence: match[4].trim().replace(/^`|`$/g, ''),
}));

if (rows.length !== 8) {
  console.error(
    `Expected 8 architectural layers in docs/CONSTITUTION.md, found ${rows.length}. ` +
      'Either the table changed shape or a layer was dropped; both need a human.'
  );
  process.exit(1);
}

let failures = 0;

for (const row of rows) {
  const claimed = row.status !== 'Not built';
  const hasEvidence = row.evidence !== '' && row.evidence !== '—';

  if (claimed && !hasEvidence) {
    console.error(`✗ ${row.number}. ${row.layer} — claimed "${row.status}" with nothing to point at.`);
    failures++;
    continue;
  }

  if (!claimed && hasEvidence) {
    console.error(
      `✗ ${row.number}. ${row.layer} — marked "Not built" but cites ${row.evidence}. ` +
        'Promoting a layer is a deliberate decision, not a table edit.'
    );
    failures++;
    continue;
  }

  if (claimed && !existsSync(join(root, row.evidence))) {
    console.error(`✗ ${row.number}. ${row.layer} — claims ${row.evidence}, which does not exist.`);
    failures++;
    continue;
  }

  console.log(
    `✓ ${row.number}. ${row.layer.padEnd(24)} ${row.status.padEnd(12)} ${hasEvidence ? row.evidence : '(nothing claimed)'}`
  );
}

// ── Every constitutional application must name an enforcement that exists ───
//
// "No new principle without a failing test that proves its absence." A
// principle that does not deserve a test is a preference, and preferences that
// dress as principles are how a constitution becomes decoration.
//
// The derivations table names the check behind each application. This walks it
// and fails if one of those files is gone.
// Scoped to the derivations table alone. Parsing every table in the document
// swept up the hierarchy example and reported "Claimed: Collective Intelligence
// = Built" as a missing file — a check that cries wolf gets muted like any
// other false alarm.
const derivationsSection = (() => {
  const marker = 'Read the applications back and each one traces to a root:';
  const from = text.indexOf(marker);
  if (from === -1) return '';
  const to = text.indexOf('\n---', from);
  return text.slice(from, to === -1 ? undefined : to);
})();

const derivations = [...derivationsSection.matchAll(/^\| ([^|]+?) \| ([^|]*?) \| `([^`]+?)`([^|]*)\|$/gm)]
  .map(match => ({ application: match[1].trim(), from: match[2].trim(), enforcedBy: match[3].trim() }));

if (derivations.length === 0) {
  console.error('\n✗ No derivations table found in docs/CONSTITUTION.md — every application must name its enforcement.');
  failures++;
} else {
  console.log('');
  for (const row of derivations) {
    // "checked by CI" style entries name a script; test files name a test file.
    const candidates = [
      row.enforcedBy,
      `packages/capkit/src/${row.enforcedBy}`,
      `packages/trust/src/${row.enforcedBy}`,
      `scripts/${row.enforcedBy.split(' ')[0]}`,
    ];

    if (candidates.some(candidate => existsSync(join(root, candidate)))) {
      console.log(`✓ ${row.application.padEnd(46)} ← ${row.enforcedBy}`);
    } else {
      console.error(`✗ ${row.application} claims enforcement by ${row.enforcedBy}, which does not exist.`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} claim(s) do not hold. Fix the code or fix the claim.`);
  process.exit(1);
}

const built = rows.filter(row => row.status !== 'Not built').length;
console.log(
  `\n${built} of ${rows.length} layers claim to exist, and ${derivations.length} constitutional ` +
    'application(s) name an enforcement — all of which exist.'
);

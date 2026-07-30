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

if (failures > 0) {
  console.error(`\n${failures} layer claim(s) do not hold. Fix the code or fix the claim.`);
  process.exit(1);
}

const built = rows.filter(row => row.status !== 'Not built').length;
console.log(`\n${built} of ${rows.length} layers claim to exist, and each names something that does.`);

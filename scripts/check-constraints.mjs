#!/usr/bin/env node
/**
 * The refusals the dashboard advertises must still be enforced by a test.
 *
 * The Govern panel claims ABSuite refuses seven specific things, and names the
 * test holding each one in place. That claim rots the moment a test is renamed
 * or deleted — and a trust product advertising a guarantee it no longer keeps
 * is worse than one that never claimed it.
 *
 * This reads the constraints out of the panel and checks that each named test
 * exists, verbatim, in the file it points at.
 *
 *   node scripts/check-constraints.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = join(root, 'packages/dashboard-ui/src/tabs/Govern.tsx');

if (!existsSync(panel)) {
  console.error(`✗ ${panel} does not exist — the constraints panel is gone.`);
  process.exit(1);
}

const source = readFileSync(panel, 'utf8');

// test: { file: '…', name: '…' }
const claims = [...source.matchAll(/test:\s*\{\s*file:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)'\s*\}/g)].map(m => ({
  file: m[1],
  name: m[2].replace(/\\'/g, "'"),
}));

if (claims.length === 0) {
  console.error('✗ No constraints found in the panel. Either the format changed or the list is empty.');
  process.exit(1);
}

let failures = 0;
for (const claim of claims) {
  const path = join(root, claim.file);
  if (!existsSync(path)) {
    console.error(`✗ ${claim.file} does not exist (claimed to hold "${claim.name}")`);
    failures++;
    continue;
  }

  const body = readFileSync(path, 'utf8');
  // Match the test name as it is written in the file, quoted either way.
  if (!body.includes(`'${claim.name}'`) && !body.includes(`"${claim.name}"`) && !body.includes(`\`${claim.name}\``)) {
    console.error(`✗ ${claim.file} no longer contains a test named "${claim.name}"`);
    failures++;
    continue;
  }

  console.log(`✓ "${claim.name}" — ${claim.file}`);
}

if (failures > 0) {
  console.error(
    `\n${failures} advertised refusal(s) have no test behind them. Either restore the test or stop claiming the behaviour.`
  );
  process.exit(1);
}

console.log(`\n${claims.length} advertised refusal(s), each still enforced by a test.`);

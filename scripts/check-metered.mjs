#!/usr/bin/env node
/**
 * The interface's idea of which quotas are counted matches the code that counts.
 *
 * ## Why this exists
 *
 * Every plan in `billing.ts` declares five limits — agents, validations,
 * schedules, benchmarkRuns, auditRetentionDays. **Two are incremented.**
 * `enforceQuota` is applied to `POST /auth/token` and `POST /auth/token/validate`
 * and nowhere else; schedules live in edge-run, benchmark runs in quickbench,
 * and neither shares the meter. Nothing enforces a retention period at all.
 *
 * A billing screen showing `0 / 5 schedules` would therefore be the most
 * dangerous shape this project knows: **zero because nothing counted looks
 * exactly like zero because nothing happened**, and the reader concludes they
 * have headroom. It is the defect `watch.coverage()` exists to prevent, arriving
 * in a screen about money.
 *
 * So `Tenancy.tsx` carries a `METERED` map naming which limits are real. That is
 * a hand-copied fact — the thing this repository keeps catching in itself — and
 * it is copied on purpose, because the alternative is inferring "metered" from a
 * usage count of zero, which cannot tell the two zeros apart.
 *
 * This is what stops the copy drifting. Wire `enforceQuota('schedules')` into a
 * route and the build fails until the interface stops calling it uncounted.
 *
 *   node scripts/check-metered.mjs      # or: pnpm check:metered
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SERVER = 'packages/capkit/src/server.ts';
const PANEL = 'packages/dashboard-ui/src/tabs/Tenancy.tsx';
const PLANS = 'packages/capkit/src/billing.ts';

const read = (path) => readFileSync(join(root, path), 'utf8');

/** Limits every plan declares, from the plan definition rather than a list here. */
const declared = new Set(
  [...read(PLANS).matchAll(/limits:\s*\{([^}]+)\}/g)]
    .flatMap(match => [...match[1].matchAll(/(\w+):/g)].map(entry => entry[1]))
);

/** Limits something actually increments. */
const metered = new Set(
  [...read(SERVER).matchAll(/enforceQuota\(\s*'([a-zA-Z]+)'\s*\)/g)].map(match => match[1])
);

/** What the interface claims is counted: an entry mapped to `null`. */
const panel = read(PANEL);
const mapBody = panel.match(/const METERED:[^=]*=\s*\{([\s\S]*?)\n\};/);

if (!mapBody) {
  console.error(`\n\x1b[31m✗\x1b[0m could not find the METERED map in ${PANEL}.`);
  console.error('  The gate reads it directly; a renamed or reshaped map must not pass silently.');
  process.exit(1);
}

const claimedCounted = new Set(
  [...mapBody[1].matchAll(/^\s*(\w+):\s*null\b/gm)].map(match => match[1])
);
const claimedAbsent = new Set(
  [...mapBody[1].matchAll(/^\s*(\w+):\s*['"]/gm)].map(match => match[1])
);

/* ── Report ─────────────────────────────────────────────────────────────── */

console.log('\nQuotas declared, counted, and described\n');

const problems = [];

if (declared.size < 3) {
  problems.push(`only ${declared.size} declared limit(s) found in ${PLANS} — the scan matched almost nothing`);
}

for (const metric of declared) {
  const isCounted = metered.has(metric);
  const saysCounted = claimedCounted.has(metric);
  const saysAbsent = claimedAbsent.has(metric);

  if (!saysCounted && !saysAbsent) {
    problems.push(`\`${metric}\` is declared by a plan and the interface says nothing about it`);
  } else if (isCounted && !saysCounted) {
    problems.push(`\`${metric}\` IS counted by enforceQuota, but the interface calls it not counted`);
  } else if (!isCounted && saysCounted) {
    problems.push(`\`${metric}\` is NOT counted by anything, and the interface shows it as a real number`);
  }
}

for (const metric of claimedCounted) {
  if (!declared.has(metric)) problems.push(`\`${metric}\` is claimed counted but no plan declares it`);
}

if (problems.length > 0) {
  console.error(`\x1b[31m✗\x1b[0m ${problems.length} disagreement(s) between the meter and the interface:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\nFix ${PANEL}, or wire enforceQuota into the route that should count it.\n` +
    'A quota bar reading empty because nothing measures it looks exactly like one\n' +
    'reading empty because nothing happened, and the reader concludes they have room.'
  );
  process.exit(1);
}

console.log(`\x1b[32m✓\x1b[0m ${declared.size} declared limit(s): ` +
  `${[...metered].sort().join(', ')} counted, ` +
  `${[...claimedAbsent].sort().join(', ')} stated as not counted.`);
console.log(`  ${PANEL} agrees with ${SERVER}.\n`);

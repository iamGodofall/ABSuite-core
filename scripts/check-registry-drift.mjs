#!/usr/bin/env node
/**
 * Is what this repository says it shipped actually installable?
 *
 * ## Why this exists
 *
 * `@absuitecore/edge-run` was fixed for SSRF, the fix was committed, the audit
 * recorded it as done and the README described the new behaviour. The registry
 * still had 1.0.2. Anybody running `npm i @absuitecore/edge-run` got the
 * version without the guard, while every document in the repository described
 * the version with it.
 *
 * Nothing was wrong in the repository. That is exactly the problem — this is
 * §3f again in a new shape. There, a hand-written package list meant three
 * documents named a package the registry did not have. Here, a version bump
 * that never reached the registry means the documents describe code nobody can
 * install. Both are the same failure: **the repository and the artifact people
 * actually receive drifted apart, and nothing looked wrong from inside.**
 *
 * ## What it reports
 *
 * For every publishable package, the local version against the registry's
 * latest, in the four words the rest of the system uses:
 *
 *   DEMONSTRATED  the registry has this exact version — what is documented is
 *                 what installs
 *   FAILED        the local version is behind the registry, which means a
 *                 publish happened from somewhere else, or a bump was reverted
 *   UNKNOWN       the registry could not be reached; nothing is concluded
 *   ABSENT        the registry has no record of the package at all
 *
 * A local version *ahead* of the registry is the ordinary state between a
 * commit and a publish, so it is reported as PENDING rather than as a failure —
 * it is only a defect once it sits there. The exit code is non-zero only for
 * FAILED and ABSENT, so this can be run without it crying wolf on every commit.
 *
 *   node scripts/check-registry-drift.mjs      # or: pnpm check:registry
 *
 * Deliberately **not** wired into `pnpm verify`, for the same reason
 * `measure-adoption.mjs` is not: it needs the network, and a gate that fails
 * when the wifi drops gets switched off within a week — taking the twenty
 * checks that need no network with it.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The package list is derived, never written here.
 *
 * `publishable-packages.mjs` exists because this list used to be hand-copied
 * into five places and `@absuitecore/notary` was in none of them.
 */
const dirs = execFileSync('node', [join(root, 'scripts/publishable-packages.mjs')], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);

const manifest = (dir) => JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));

/** Compare two semver strings numerically. Returns -1, 0 or 1. */
function compare(a, b) {
  const parse = (v) => v.split('-')[0].split('.').map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

const rows = [];

for (const dir of dirs) {
  const { name, version } = manifest(dir);
  const row = { name, local: version };

  let meta;
  try {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
    if (response.status === 404) {
      rows.push({ ...row, state: 'ABSENT', because: 'the registry has no record of this package' });
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    meta = await response.json();
  } catch (error) {
    // Unreachable is not the same as wrong, and must never be reported as wrong.
    rows.push({ ...row, state: 'UNKNOWN', because: `the registry could not be reached (${error.message})` });
    continue;
  }

  const latest = meta['dist-tags']?.latest;
  if (!latest) {
    rows.push({ ...row, state: 'ABSENT', because: 'the package exists but has no latest tag' });
    continue;
  }
  row.registry = latest;

  const order = compare(version, latest);
  if (order === 0) {
    rows.push({ ...row, state: 'DEMONSTRATED', because: 'the published version is the documented one' });
  } else if (order > 0) {
    const published = Object.keys(meta.versions ?? {});
    rows.push({
      ...row,
      state: 'PENDING',
      because: published.includes(version)
        ? `${version} is on the registry but is not the latest tag`
        : `${version} is committed here and has not been published`,
    });
  } else {
    rows.push({
      ...row,
      state: 'FAILED',
      because: `the registry is ahead — ${latest} was published from somewhere other than this tree`,
    });
  }
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const MARK = {
  DEMONSTRATED: '\x1b[32m✓\x1b[0m',
  PENDING: '\x1b[33m·\x1b[0m',
  UNKNOWN: '\x1b[33m?\x1b[0m',
  FAILED: '\x1b[31m✗\x1b[0m',
  ABSENT: '\x1b[31m✗\x1b[0m',
};

console.log('\nWhat is documented here, against what installs from npm\n');

const width = Math.max(...rows.map(r => r.name.length));
for (const row of rows) {
  const versions = row.registry ? `${row.local} → ${row.registry}` : row.local;
  console.log(`${MARK[row.state]} ${row.name.padEnd(width)}  ${versions.padEnd(20)} ${row.state}`);
  console.log(`  ${' '.repeat(width)}  ${row.because}`);
}

const count = (state) => rows.filter(r => r.state === state).length;
const pending = rows.filter(r => r.state === 'PENDING');

console.log(`\n${count('DEMONSTRATED')} in sync, ${pending.length} awaiting publish, ` +
  `${count('FAILED') + count('ABSENT')} wrong, ${count('UNKNOWN')} unknown.`);

if (pending.length > 0) {
  console.log('\nAwaiting publish is normal between a commit and a release. It stops being\n' +
    'normal once the documents describe behaviour nobody can install:\n' +
    pending.map(r => `  ${r.name}@${r.local}`).join('\n') +
    '\n\nRun the "Publish to npm" workflow with Dry run unchecked.');
}

/*
 * Exit non-zero only for the two states that mean something is actually wrong.
 * PENDING is the ordinary state of a repository between commits, and UNKNOWN is
 * a network condition — failing on either would make this a gate people learn
 * to ignore, which is worse than not having it.
 */
process.exit(count('FAILED') + count('ABSENT') > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * Every environment variable this project offers must be read by something.
 *
 * ## Why this is a gate and not a tidy-up
 *
 * Configuration that does nothing is not clutter. It is a false statement about
 * the system, written in the one file an operator trusts most, and it was found
 * twice here:
 *
 *   ABSUITE_DB_ENCRYPTION_KEY   `.env.example` offered it. No code read it.
 *                               An operator who set it believed the record on
 *                               disk was encrypted. It was plaintext. That is
 *                               the exact defect this project exists to catch,
 *                               sitting in its own configuration file.
 *
 *   ABSUITE_LOG_LEVEL           Passed into all six containers by
 *                               docker-compose. Read by nothing. An operator
 *                               raising it to debug an incident gets silence
 *                               and concludes there is nothing to see.
 *
 * Neither was catchable by reading, because both looked exactly like the
 * variables around them that work. The difference is only visible by comparing
 * two lists nobody holds in their head at once.
 *
 * ## What counts as "offered"
 *
 * Only assignments in `.env.example` and `environment:` entries in
 * `docker-compose.yml` — the two places that constitute a promise to an
 * operator. Deliberately not source files: an early hand-rolled version of this
 * sweep read `deploy/serve-all.mjs` and reported `DATA_DIR` and `PUBLIC_PORT`
 * as dead configuration when both are ordinary local constants. A check that
 * fires on things it misread gets switched off within a week.
 *
 * ## What counts as "read"
 *
 * Deliberately generous: `process.env.X`, `process.env['X']`, bare `env.X` off
 * a passed object, and destructuring. A missed read produces a false alarm on a
 * working variable, which is the expensive failure — `CAPKIT_REVOCATION_FILE`
 * was reported dead once by a detector that only knew `process.env.`, when it
 * is read as `env.CAPKIT_REVOCATION_FILE` off an injected object.
 *
 * Erring generous means this can miss a dead variable. It will not condemn a
 * live one, and that is the right way round for a check that fails a build.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/* ── Offered: what an operator is invited to set ────────────────────────── */

const offered = new Map(); // name -> where it was promised

if (existsSync(join(root, '.env.example'))) {
  read('.env.example').split('\n').forEach((line, index) => {
    // A commented example is a documented option, not a live promise, but it is
    // still an invitation — `# ABSUITE_PUBLIC_PASSWORD=` tells you it works.
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=/);
    if (match) offered.set(match[1], `.env.example:${index + 1}`);
  });
}

if (existsSync(join(root, 'docker-compose.yml'))) {
  read('docker-compose.yml').split('\n').forEach((line, index) => {
    const match = line.match(/^\s*-\s*([A-Z][A-Z0-9_]{2,})\s*=/);
    if (match && !offered.has(match[1])) offered.set(match[1], `docker-compose.yml:${index + 1}`);
  });
}

/* ── Read: what the code actually consumes ──────────────────────────────── */

const CODE = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next']);

const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (CODE.test(entry.name)) sources.push(path);
  }
};
for (const dir of ['packages', 'scripts', 'deploy', 'implementations', 'examples']) {
  if (existsSync(join(root, dir))) walk(dir);
}

const consumed = new Set();
for (const path of sources) {
  const text = readFileSync(join(root, path), 'utf8');
  // process.env.X / env.X — the bare form matters, see the note above.
  for (const m of text.matchAll(/\benv\s*\.\s*([A-Z][A-Z0-9_]{2,})/g)) consumed.add(m[1]);
  // process.env['X'] / env["X"]
  for (const m of text.matchAll(/\benv\s*\[\s*['"`]([A-Z][A-Z0-9_]{2,})['"`]\s*\]/g)) consumed.add(m[1]);
  // const { X, Y } = process.env
  for (const m of text.matchAll(/\{([^{}]*)\}\s*=\s*(?:process\.)?env\b/g)) {
    for (const name of m[1].matchAll(/([A-Z][A-Z0-9_]{2,})/g)) consumed.add(name[1]);
  }
}

// The second implementation is Python, and it configures itself the same way.
// Swept separately because the walk above only collects JavaScript.
const pyWalk = (dir) => {
  if (!existsSync(join(root, dir))) return;
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pyWalk(path);
    else if (entry.name.endsWith('.py')) {
      const text = readFileSync(join(root, path), 'utf8');
      for (const m of text.matchAll(/environ(?:\.get)?\s*[[(]\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g)) consumed.add(m[1]);
    }
  }
};
pyWalk('implementations');

/**
 * Variables that belong to somebody else's software and are correctly set here
 * without this repository reading them. Each needs a reason, not just a name.
 */
const FOREIGN = new Map([
  ['NODE_ENV', 'read by Node and Express, not by this code'],
  ['NODE_OPTIONS', 'read by the Node runtime itself'],
  ['PATH', 'the operating system'],
  ['TZ', 'read by the C library, which is the point — the room shows local time'],
  ['PORT', 'the platform convention; services read their own CAPKIT_PORT etc.'],
]);

/* ── Compare ────────────────────────────────────────────────────────────── */

/**
 * This check finds nothing to complain about when it reads nothing, and a
 * sweep of the whole suite found it sharing that hole with two others — both
 * of which had already passed on Windows by matching an empty file set.
 * Writing a gate does not exempt you from the failure mode you wrote it to
 * catch, so the floors were added everywhere at once.
 *
 * Set low deliberately: this is here to catch "the files are missing", not to
 * police how many variables the project has.
 */
const FLOOR = 10;
if (offered.size < FLOOR) {
  console.error(`\n✗ Only ${offered.size} configuration variable(s) were found to check, and at least ${FLOOR} were expected.`);
  console.error('');
  console.error('  With nothing offered there is nothing to compare, so this would have');
  console.error('  reported success having inspected an empty set — the same way two');
  console.error('  interface checks passed on Windows for weeks.');
  console.error('');
  console.error('  Expected .env.example and docker-compose.yml at the repository root.\n');
  process.exit(1);
}

const dead = [];
for (const [name, where] of offered) {
  if (consumed.has(name) || FOREIGN.has(name)) continue;
  dead.push({ name, where });
}

if (dead.length > 0) {
  console.error(`\n${dead.length} configuration variable(s) offered and read by nothing:\n`);
  for (const { name, where } of dead) console.error(`  ✗ ${name.padEnd(34)} ${where}`);
  console.error('');
  console.error('Configuration that does nothing is a false statement in the file an');
  console.error('operator trusts most. Either something reads it, or it comes out —');
  console.error('and if the honest answer is that it should not exist, say so where it');
  console.error('was, so the next person does not add it back.');
  console.error('');
  console.error('If it is set for other software, add it to FOREIGN with the reason.\n');
  process.exit(1);
}

console.log(
  `✓ ${offered.size} offered configuration variable(s), every one read by something ` +
  `(${FOREIGN.size} belong to other software and say so).`
);
console.log(`  ${consumed.size} variable(s) read across ${sources.length} source file(s).`);

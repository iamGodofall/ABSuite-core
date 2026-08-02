#!/usr/bin/env node
/**
 * Every published package must appear everywhere packages are listed.
 *
 * ## Why this is a gate
 *
 * `@absuitecore/notary` was built, marked publishable, and named in three
 * documents as though it shipped — while appearing in **none** of the six
 * hand-written package lists that drive publishing and documentation. It was
 * never published, and after it was, it was still missing from the README table
 * that links each package to npm and from the suite table in the CLI's README,
 * which is a page rendered on npm itself.
 *
 * A reader who lands on the CLI package page and counts six packages has been
 * told something false by omission. That is the same defect as a wrong number,
 * and it survived three separate passes over these documents because a missing
 * row looks exactly like a list that is simply finished.
 *
 * ## What is checked
 *
 * Every non-private package under `packages/` must be named in each surface
 * below. The surfaces are listed explicitly rather than discovered, because a
 * new document that lists packages should be added here deliberately — a check
 * that silently widens its own scope starts failing for reasons nobody chose.
 *
 * ## Also checked: links that only work in the repository
 *
 * A published README is rendered on npmjs.com, where `../../docs/API.md` is a
 * 404. Two shipped that way. Relative links in a published package's README are
 * therefore an error, and the fix is always an absolute GitHub URL.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const published = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => {
    const manifest = JSON.parse(read(`packages/${entry.name}/package.json`));
    return manifest.private ? null : { dir: entry.name, name: manifest.name };
  })
  .filter(Boolean);

/** Surfaces that enumerate the suite, and what each one is for. */
const SURFACES = [
  { path: 'README.md', why: 'the repository front page, where each package links to npm' },
  { path: 'packages/cli/README.md', why: 'rendered on npmjs.com — a reader counts the suite here' },
  { path: 'docs/MODULES.md', why: 'what each package looks like to use' },
];

const problems = [];

for (const surface of SURFACES) {
  if (!existsSync(join(root, surface.path))) {
    problems.push(`${surface.path} is missing — it is ${surface.why}`);
    continue;
  }
  const text = read(surface.path);
  for (const pkg of published) {
    // The CLI's own README does not need to list itself in "the rest of the
    // suite", and it names itself in its title regardless.
    if (surface.path === `packages/${pkg.dir}/README.md`) continue;
    if (!text.includes(pkg.name)) {
      problems.push(
        `${surface.path} does not mention ${pkg.name}\n      (${surface.why})`
      );
    }
  }
}

/* ── Links that break once the README leaves the repository ─────────────── */

for (const pkg of published) {
  const readme = `packages/${pkg.dir}/README.md`;
  if (!existsSync(join(root, readme))) {
    problems.push(`${readme} does not exist — it is the package's page on npm`);
    continue;
  }
  read(readme).split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) {
      problems.push(
        `${readme}:${index + 1} links to ${match[1]}, which is a 404 on npmjs.com\n` +
        `      Use https://github.com/iamGodofall/ABSuite-core/blob/main/…`
      );
    }
  });
}

if (problems.length > 0) {
  console.error(`\n${problems.length} package-listing problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}\n`);
  console.error('A package missing from a list looks exactly like a list that is finished,');
  console.error('which is why this is checked rather than read.\n');
  process.exit(1);
}

console.log(
  `✓ all ${published.length} published package(s) appear in ${SURFACES.length} listing surface(s), ` +
  `and no published README links relatively.`
);

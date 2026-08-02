#!/usr/bin/env node
/**
 * The list of packages to publish, derived from the repository.
 *
 * ## Why this is not a hand-written list
 *
 * It was one. `publish.yml` named seven packages inline, in five separate
 * places — preview, workspace-protocol check, publish loop, and twice in the
 * summary. `@absuitecore/notary` was built, marked `publishConfig.access:
 * public`, named in three documents as though it shipped, and **appeared in
 * none of those five lists**. So it was never published, and nothing noticed,
 * because the lists agreed with each other.
 *
 * That is the same defect as "six services" in eleven documents: a fact copied
 * by hand into several places drifts from the thing it describes, and the
 * copies agreeing looks like confirmation.
 *
 * ## Ordering matters
 *
 * capkit is published first. Every other package depends on it, and npm
 * resolves dependencies at install time against what is actually on the
 * registry — publishing a dependent before its dependency leaves a window
 * where installing it fails.
 *
 *   node scripts/publishable-packages.mjs           # newline separated
 *   node scripts/publishable-packages.mjs --json    # for a workflow matrix
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8'));
    return { dir: entry.name, name: manifest.name, version: manifest.version, private: !!manifest.private };
  })
  // `private: true` is the one deliberate exclusion — dashboard-ui is an
  // application, not a library, and publishing it would be a mistake rather
  // than an omission.
  .filter(entry => !entry.private)
  .sort((a, b) => (a.dir === 'capkit' ? -1 : b.dir === 'capkit' ? 1 : a.dir.localeCompare(b.dir)));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(packages));
} else if (process.argv.includes('--verbose')) {
  for (const entry of packages) console.log(`${entry.dir.padEnd(20)} ${entry.name}@${entry.version}`);
} else {
  for (const entry of packages) console.log(entry.dir);
}

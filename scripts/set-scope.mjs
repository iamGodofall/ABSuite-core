#!/usr/bin/env node
/**
 * Rename the npm scope across every package, consistently.
 *
 * The packages publish as `@absuitecore/*`, which requires owning the `absuite`
 * organisation on npm. If that name is unavailable, this switches the whole
 * workspace to a scope you definitely control — your own username works
 * without creating anything.
 *
 *   node scripts/set-scope.mjs @themba-mpehle    # personal scope, always yours
 *   node scripts/set-scope.mjs @absuite-dev      # a different org name
 *   node scripts/set-scope.mjs --check           # show the current scope
 *
 * Updates package names, cross-package dependencies, publish filters, imports
 * in source and tests, and documentation, so nothing is left pointing at the
 * old scope.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PACKAGES = ['capkit', 'trust', 'edge-run', 'quickbench', 'connector-starter', 'mcp', 'cli'];

function currentScope() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages/capkit/package.json'), 'utf8'));
  return pkg.name.split('/')[0];
}

const arg = process.argv[2];

if (!arg || arg === '--check') {
  console.log(`Current scope: ${currentScope()}`);
  console.log(`Packages: ${PACKAGES.map(p => `${currentScope()}/${p}`).join(', ')}`);
  process.exit(0);
}

const next = arg.startsWith('@') ? arg : `@${arg}`;
if (!/^@[a-z0-9][a-z0-9._-]*$/.test(next)) {
  console.error(`Invalid scope: "${next}". Use lowercase letters, digits, hyphens.`);
  process.exit(1);
}

const prev = currentScope();
if (prev === next) {
  console.log(`Already using ${next}. Nothing to do.`);
  process.exit(0);
}

/** Walk the tree, skipping anything that is generated or vendored. */
function* files(dir) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'coverage', '.next'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yaml', '.yml', '.html']);
// Extensionless build files matter too: a Dockerfile still referencing the old
// scope fails with "no projects matched the filter" only once CI builds an
// image, long after the rename looked complete.
const TEXT_BY_NAME = new Set(['Dockerfile', 'Makefile', '.npmrc', '.dockerignore']);
let changed = 0;

for (const file of files(ROOT)) {
  if (!TEXT.has(extname(file)) && !TEXT_BY_NAME.has(basename(file))) continue;

  const before = readFileSync(file, 'utf8');
  // Only rewrite the scope when followed by '/' or a quote, so unrelated
  // prose mentioning the word is left alone.
  const after = before.split(`${prev}/`).join(`${next}/`);
  if (after !== before) {
    writeFileSync(file, after);
    changed += 1;
  }
}

// The publish filters reference the scope by glob.
const rootPkgPath = join(ROOT, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
for (const key of Object.keys(rootPkg.scripts ?? {})) {
  rootPkg.scripts[key] = rootPkg.scripts[key].split(`${prev}/*`).join(`${next}/*`);
}
writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');

console.log(`Scope: ${prev} -> ${next}`);
console.log(`Files updated: ${changed}`);
console.log('');
console.log('Next:');
console.log('  pnpm install');
console.log('  pnpm test');
console.log('  pnpm publish:packages');

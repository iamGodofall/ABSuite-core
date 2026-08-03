#!/usr/bin/env node
/**
 * Every ABSuite symbol a document imports actually exists.
 *
 * ## Why this exists
 *
 * `docs/SECURITY-MODEL.md` showed `await capkit.rotateKey()` — a method that
 * has never existed — in a fenced TypeScript block, next to an `AIPolicyRule`
 * interface for an engine that was never built. Both read as API. Neither was.
 *
 * A code block in a document is the most credible thing on the page: a reader
 * copies it. It is also the least checked thing in this repository, because
 * nothing compiles it. `check:numbers` catches a published figure nobody
 * measured; nothing caught a published *symbol* nobody exported.
 *
 * ## What it checks
 *
 * Every `import { … } from '@absuitecore/<pkg>'` in a fenced ts/js block, in
 * every document, against the real export surface of that package — read from
 * the built `dist/index.js`, not from a list maintained by hand.
 *
 * Reading the build rather than parsing the source is the point. A list of
 * "things capkit exports" written into this script would be one more hand-copied
 * fact that drifts, which is the defect this repository keeps finding in itself.
 *
 * ## And then type-checks them
 *
 * Symbol existence does not catch `rotated.active()` on a getter, or a method
 * called with the wrong arguments. So every self-contained block is extracted
 * and run through `tsc --strict` against the packages' own declarations.
 *
 * A document elides its setup — `secret`, `publicKeyPem`, `input` are named
 * without being declared, and should be. So the errors that mean *you left
 * something out* are ignored by code, and the errors that mean *you used the
 * API wrongly* fail the build. That list is short and stated below rather than
 * tuned until the output was quiet.
 *
 * ## What it still does not check
 *
 * Prose, and the elided identifiers themselves — `ring.rotate(…)` in a block
 * that never constructs `ring` reports `TS2304`, which is indistinguishable
 * from a deliberate elision. That one is caught by running examples before
 * publishing them, which is a practice and not a gate.
 *
 *   node scripts/check-doc-apis.mjs        # or: pnpm check:apis
 *
 * Needs the packages built, so it runs after `pnpm build` in `pnpm verify`.
 */
import { readdirSync, readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Floors, because a check that inspects nothing reports success.
 *
 * Three gates here once passed by matching an empty file set — one of them
 * written to catch exactly that. Both numbers sit well under the current count.
 */
const MIN_BLOCKS = 25;
const MIN_SYMBOLS = 30;

/* ── Gather the documents ───────────────────────────────────────────────── */

const documents = [
  ...readdirSync(join(root, 'docs')).filter(name => name.endsWith('.md')).map(name => join('docs', name)),
  'README.md',
  'GETTING-STARTED.md',
  ...readdirSync(join(root, 'packages'))
    .map(pkg => join('packages', pkg, 'README.md'))
    .filter(path => existsSync(join(root, path))),
].filter(path => existsSync(join(root, path)));

const FENCE = /```(?:ts|typescript|js|javascript)\n([\s\S]*?)```/g;
const IMPORT = /import\s*\{([^}]+)\}\s*from\s*['"](@absuitecore\/[a-z-]+)['"]/g;

/** Which line of the file a character offset falls on, for a clickable report. */
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const references = [];
const typeable = [];
let blocks = 0;

for (const document of documents) {
  const text = readFileSync(join(root, document), 'utf8');

  for (const fence of text.matchAll(FENCE)) {
    blocks++;
    // Only blocks that import from a package can be compiled against one.
    if (/@absuitecore\//.test(fence[1])) {
      typeable.push({ document, line: lineOf(text, fence.index), source: fence[1] });
    }
    for (const statement of fence[1].matchAll(IMPORT)) {
      const names = statement[1]
        .split(',')
        .map(name => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
        .filter(Boolean);

      for (const name of names) {
        references.push({ document, line: lineOf(text, fence.index), pkg: statement[2], name });
      }
    }
  }
}

/* ── Ask each package what it exports ───────────────────────────────────── */

const surfaces = new Map();

async function exportsOf(pkg) {
  if (surfaces.has(pkg)) return surfaces.get(pkg);

  const dir = join(root, 'packages', pkg.replace('@absuitecore/', ''));
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) { surfaces.set(pkg, undefined); return undefined; }

  const entry = join(dir, JSON.parse(readFileSync(manifest, 'utf8')).main ?? 'dist/index.js');
  if (!existsSync(entry)) { surfaces.set(pkg, undefined); return undefined; }

  const loaded = await import(pathToFileURL(entry).href);
  // Types vanish at runtime, so a `type Foo` import cannot be checked this way.
  // Read the declarations alongside the build for those.
  const declaration = entry.replace(/\.js$/, '.d.ts');
  const declared = existsSync(declaration)
    ? [...readFileSync(declaration, 'utf8').matchAll(/\b(?:type|interface|class|enum)\s+(\w+)/g)].map(m => m[1])
    : [];

  const surface = new Set([...Object.keys(loaded), ...declared]);
  surfaces.set(pkg, surface);
  return surface;
}

const missing = [];
const unbuilt = new Set();

for (const reference of references) {
  const surface = await exportsOf(reference.pkg);
  if (!surface) { unbuilt.add(reference.pkg); continue; }
  if (!surface.has(reference.name)) missing.push(reference);
}

/* ── Compile them ───────────────────────────────────────────────────────── */

/**
 * Errors a document *should* produce, because it elides its own setup.
 *
 * A README that declared `secret`, `publicKeyPem` and `input` before every
 * example would be unreadable, so those identifiers are named and not defined
 * on purpose. Ignoring the codes that say so is what makes the rest meaningful.
 *
 * This list is short, and each entry is a category rather than a specific
 * message — an ignore list tuned until the output went quiet would be a gate
 * that reports success by suppression.
 */
const ELIDED = new Set([
  'TS2304',   // Cannot find name — a placeholder the prose introduces
  'TS2552',   // Cannot find name, with a suggestion — same thing
  'TS18004',  // Shorthand property with no value in scope — { input, output }
  'TS2307',   // Cannot find module — a third-party import like express
]);

const MIN_TYPED_BLOCKS = 12;

function typeCheck(blocksToCheck) {
  const dir = mkdtempSync(join(tmpdir(), 'absuite-docs-'));
  const names = new Map();

  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));

    const paths = Object.fromEntries(
      readdirSync(join(root, 'packages'))
        .map(pkg => [`@absuitecore/${pkg}`, [join(root, 'packages', pkg, 'dist/index.d.ts')]])
        .filter(([, [declaration]]) => existsSync(declaration))
    );

    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        // Strict, because `strictNullChecks: false` silently disables
        // discriminated-union narrowing and reports correct examples as broken.
        strict: true, noEmit: true, skipLibCheck: true,
        typeRoots: [join(root, 'node_modules/@types')], types: ['node'],
        paths,
      },
    }));

    blocksToCheck.forEach((block, index) => {
      const name = `block${index}.ts`;
      names.set(name, block);
      writeFileSync(join(dir, name), block.source);
    });

    try {
      execFileSync('npx', ['tsc', '-p', dir], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
      return [];
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      return output.split('\n')
        .map(line => line.match(/(block\d+\.ts)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.*)/))
        .filter(Boolean)
        .filter(match => !ELIDED.has(match[3]))
        .map(match => ({ block: names.get(match[1]), line: Number(match[2]), code: match[3], message: match[4] }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const typeErrors = typeCheck(typeable);

/* ── Report ─────────────────────────────────────────────────────────────── */

console.log('\nAPI symbols named in documentation\n');

if (blocks < MIN_BLOCKS || references.length < MIN_SYMBOLS) {
  console.error(
    `\x1b[31m✗\x1b[0m found ${blocks} code block(s) and ${references.length} imported symbol(s), ` +
    `expected at least ${MIN_BLOCKS} and ${MIN_SYMBOLS}.\n` +
    '  The scan matched almost nothing, which is how a gate passes by checking nothing.'
  );
  process.exit(1);
}

if (unbuilt.size > 0) {
  console.error(
    `\x1b[31m✗\x1b[0m no build found for: ${[...unbuilt].join(', ')}\n` +
    '  Run `pnpm -r build` first — this reads the real export surface, not a list.'
  );
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`\x1b[31m✗\x1b[0m ${missing.length} symbol(s) documented but not exported:\n`);
  for (const hit of missing) {
    console.error(`  ${hit.document}:${hit.line}`);
    console.error(`    \`${hit.name}\` is not exported by ${hit.pkg}\n`);
  }
  console.error(
    'A fenced code block is the most credible thing on a page — a reader copies it.\n' +
    'Either export the symbol, or correct the document. `capkit.rotateKey()` sat in\n' +
    'docs/SECURITY-MODEL.md looking exactly like API and never existed.'
  );
  process.exit(1);
}

if (typeable.length < MIN_TYPED_BLOCKS) {
  console.error(
    `\x1b[31m✗\x1b[0m only ${typeable.length} compilable block(s), expected at least ${MIN_TYPED_BLOCKS}.\n` +
    '  A type check that compiles almost nothing reports success for the wrong reason.'
  );
  process.exit(1);
}

if (typeErrors.length > 0) {
  console.error(`\x1b[31m✗\x1b[0m ${typeErrors.length} documented example(s) do not type-check:\n`);
  for (const hit of typeErrors) {
    console.error(`  ${hit.block.document}:${hit.block.line}  (line ${hit.line} of the block)`);
    console.error(`    ${hit.code}: ${hit.message}\n`);
  }
  console.error(
    'These are compiled against the packages\' own declarations, with the errors a\n' +
    'document necessarily produces by eliding setup already filtered out. What is\n' +
    'left means the example uses the API in a way the API does not support.'
  );
  process.exit(1);
}

const perPackage = [...new Set(references.map(r => r.pkg))].sort();
console.log(`\x1b[32m✓\x1b[0m ${references.length} imported symbol(s) across ${blocks} code block(s) all exist.`);
console.log(`  ${perPackage.length} package(s): ${perPackage.map(p => p.replace('@absuitecore/', '')).join(', ')}`);
console.log(`  ${typeable.length} block(s) compiled against the real declarations, strict, clean.`);
console.log(`  ${documents.length} document(s) scanned.\n`);

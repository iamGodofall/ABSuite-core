#!/usr/bin/env node
/**
 * The eight architectural layers, from the constitution into the room.
 *
 * The seven operations have been navigable in the interface for a long time.
 * The eight layers have not — they existed only as a table in
 * docs/CONSTITUTION.md, which meant the roadmap and the product were two
 * separate artefacts that could drift apart without anyone noticing.
 *
 * This reads that table and emits it as data the interface can render, so the
 * cube's eight vertices report what the constitution says is built. Typing the
 * statuses into a component by hand would have been faster and would have been
 * a fabrication: a layer promoted in the document and not in the code, or the
 * reverse, would look identical on screen. Generated from the source of truth,
 * a promotion has to happen in one place and shows up in both.
 *
 * `--check` fails when the committed file no longer matches the constitution,
 * which is what stops the generated copy going stale in a branch nobody
 * regenerated.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'docs/CONSTITUTION.md');
const target = join(root, 'packages/dashboard-ui/src/generated/architecture-layers.json');

const STATUS = {
  'built': 'BUILT',
  'partly built': 'PARTLY',
  'not built': 'NOT_BUILT',
};

const text = readFileSync(source, 'utf8');

/*
 * The roadmap table, matched by its shape rather than by a heading.
 *
 * Rows look like:
 *   | 1 | **Identity** | Every agent … | Partly built | `packages/…/keyring.ts` |
 *
 * A heading match would break the moment someone reworded the section title;
 * the row shape is the thing that actually has to hold.
 */
const rows = [...text.matchAll(
  /^\|\s*(\d)\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+?)\s*\|\s*(Built|Partly built|Not built)\s*\|\s*([^|]*?)\s*\|\s*$/gim,
)];

if (rows.length !== 8) {
  console.error(
    `Expected 8 architectural layers in docs/CONSTITUTION.md, found ${rows.length}.\n` +
    'The room draws one vertex per layer, so a cube with seven of them would be a\n' +
    'cube that quietly stopped being the architecture.',
  );
  process.exit(1);
}

const layers = rows.map(([, index, name, property, status, evidence]) => ({
  index: Number(index),
  name: name.trim(),
  property: property.trim(),
  status: STATUS[status.trim().toLowerCase()],
  // Backticks stripped; an em-dash means the layer names no file, which is
  // exactly what "not built" should look like.
  evidence: evidence.replace(/`/g, '').trim() === '—' ? null : evidence.replace(/`/g, '').trim(),
}));

const payload = JSON.stringify({ layers }, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let committed = '';
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    console.error(`${target} does not exist. Run: node scripts/gen-architecture-layers.mjs`);
    process.exit(1);
  }
  if (committed !== payload) {
    console.error(
      'The generated architecture layers no longer match docs/CONSTITUTION.md.\n' +
      'The room would be drawing a roadmap the constitution has moved on from.\n' +
      'Run: node scripts/gen-architecture-layers.mjs',
    );
    process.exit(1);
  }
  const built = layers.filter(l => l.status === 'BUILT').length;
  const partly = layers.filter(l => l.status === 'PARTLY').length;
  console.log(`✓ 8 architectural layers in sync — ${built} built, ${partly} partly, ${8 - built - partly} not built.`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, payload);
console.log(`Wrote ${layers.length} layers to ${target.replace(root + '/', '')}`);
for (const layer of layers) console.log(`  ${layer.index}. ${layer.name.padEnd(24)} ${layer.status}`);

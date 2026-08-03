#!/usr/bin/env node
/**
 * Every outbound `fetch` in server code is accounted for.
 *
 * ## Why this exists
 *
 * The same SSRF was found four times, in four packages, over three passes:
 * `webhook.send`, edge-run's `http` tasks, quickbench's `http` provider, and the
 * dashboard's `/endpoint-check`. Each was found by a person asking *what else
 * fetches a URL somebody else chose?* — and the fourth was found only because
 * the question got asked a fourth time.
 *
 * Nothing stops a fifth. A `fetch(url)` added to a route handler next month
 * looks exactly like the forty-two calls in this repository that are perfectly
 * safe, and the difference is invisible at a glance.
 *
 * ## What it requires
 *
 * Every `fetch(` in server-side source must be one of:
 *
 *   - `guardedFetch(` — the shared guard, which classifies every redirect hop
 *   - annotated `// outbound-ok: <reason>` on the call or the line above it
 *
 * The annotation is the point. It does not make anything safe; it makes someone
 * write down *why* it is safe, on the line, where the next reader sees it. A
 * gate that tried to infer safety from the shape of the URL expression would be
 * guessing, and would be wrong quietly. This one is wrong loudly or not at all.
 *
 * Browser code under `dashboard-ui/src` is excluded: it runs in the user's
 * browser and fetches relative paths on its own origin, which is not the
 * server-side request-forgery surface this is about.
 *
 *   node scripts/check-outbound-guard.mjs      # or: pnpm check:outbound
 *
 * Wired into `pnpm verify`, because it is static and needs no network.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A floor, because a check that inspects nothing reports success.
 *
 * Three gates in this repository once passed by matching an empty file set —
 * including one written to catch exactly that. The number is deliberately well
 * under the current count: it is a tripwire for a broken path or a changed
 * layout, not a count to maintain.
 */
const FLOOR = 40;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const files = sourceFiles(join(root, 'packages'))
  .map(path => relative(root, path))
  // Browser code fetches relative paths on its own origin.
  .filter(path => !path.replace(/\\/g, '/').includes('dashboard-ui/src/'));

/*
 * `fetch(` but not `guardedFetch(`, `.fetch(`, or `refetch(`. The negative
 * lookbehind on a word character is what separates the call from every name
 * that merely ends in it.
 */
const CALL = /(?<![.\w])fetch\s*\(/;
const ANNOTATION = /outbound-ok:\s*\S/;

/** Is there an `outbound-ok:` anywhere in the comment block directly above? */
function annotatedAbove(lines, index) {
  for (let i = index - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;
    // Stop at the first line that is not part of a comment block.
    if (!/^(\/\/|\/\*|\*)/.test(line)) return false;
    if (ANNOTATION.test(line)) return true;
  }
  return false;
}

const unaccounted = [];
let annotated = 0;
let guarded = 0;

for (const file of files) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (/guardedFetch\s*\(/.test(line)) { guarded++; return; }
    if (!CALL.test(line)) return;

    // Walk up through the contiguous comment block above the call. Anchoring on
    // the single previous line would force the annotation to be the last line of
    // a comment, which is where nobody would naturally write it.
    if (ANNOTATION.test(line) || annotatedAbove(lines, index)) { annotated++; return; }

    unaccounted.push({ file, line: index + 1, text: line.trim().slice(0, 96) });
  });
}

/* ── Report ─────────────────────────────────────────────────────────────── */

console.log('\nOutbound calls in server code\n');

if (files.length < FLOOR) {
  console.error(
    `\x1b[31m✗\x1b[0m only ${files.length} server-side source file(s) found, expected at least ${FLOOR}.\n` +
    '  The scan matched almost nothing, which is how a gate passes by checking nothing.'
  );
  process.exit(1);
}

if (unaccounted.length > 0) {
  console.error(`\x1b[31m✗\x1b[0m ${unaccounted.length} unaccounted \`fetch(\` call(s):\n`);
  for (const hit of unaccounted) {
    console.error(`  ${hit.file}:${hit.line}`);
    console.error(`    ${hit.text}\n`);
  }
  console.error(
    'Use `guardedFetch` from @absuitecore/capkit if the URL comes from a caller —\n' +
    'it classifies every redirect hop, not just the one you were given.\n\n' +
    'If the URL is fixed by this code and cannot be influenced, say so on the line:\n' +
    '  // outbound-ok: fixed internal service base URL, no caller input\n\n' +
    'The annotation does not make it safe. It makes the reason visible to the next\n' +
    'person, which is the only thing that stopped the previous four from being five.'
  );
  process.exit(1);
}

console.log(`\x1b[32m✓\x1b[0m ${guarded} guarded call(s), ${annotated} annotated as fixed, 0 unaccounted.`);
console.log(`  ${files.length} server-side source file(s) scanned.\n`);

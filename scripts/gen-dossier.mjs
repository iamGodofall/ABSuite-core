#!/usr/bin/env node
/**
 * Render docs/DOSSIER.md to a PDF.
 *
 * Routed through `findPython` rather than calling `python3` from package.json,
 * because `python3.exe` does not exist on a Windows machine running Anaconda —
 * a real failure this repository already hit once, which is why the helper
 * exists at all. `check:cross-platform` catches it, and caught this.
 *
 * A missing Python or a missing reportlab is reported as UNKNOWN and exits 0.
 * The PDF is a convenience artefact; the document itself is DOSSIER.md, and a
 * machine without Python should not fail a build over a rendering of it.
 *
 *   node scripts/gen-dossier.mjs      # or: pnpm docs:dossier
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, runPython } from './lib/python.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts', 'gen-dossier-pdf.py');

if (!findPython()) {
  console.log('\n\x1b[33m?\x1b[0m No Python found — skipping the dossier PDF.');
  console.log('  docs/DOSSIER.md is the document; the PDF is a rendering of it.');
  process.exit(0);
}

const result = runPython(script, {
  cwd: root,
  args: [],
  timeout: 120_000,
});

// runPython passes only the script path, so the arguments go through the
// environment rather than argv — one fewer quoting hazard on the shell path
// this helper exists to survive.
if (result && result.status === 0) {
  console.log(`\n\x1b[32m✓\x1b[0m ${(result.stdout || '').trim() || 'dossier rendered'}`);
  process.exit(0);
}

if (result && /reportlab/i.test(`${result.stderr}`)) {
  console.log('\n\x1b[33m?\x1b[0m reportlab is not installed — skipping the dossier PDF.');
  console.log('  pip install reportlab');
  process.exit(0);
}

console.error('\n\x1b[31m✗\x1b[0m The dossier PDF could not be rendered.');
console.error(`${result?.stderr ?? 'no output'}`);
process.exit(1);

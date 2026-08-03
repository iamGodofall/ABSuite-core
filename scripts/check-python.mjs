#!/usr/bin/env node
/**
 * The second implementation, run against the protocol.
 *
 * This used to be `"check:python": "python3 implementations/..."` straight in
 * package.json. That is a hardcoded interpreter name, and it is wrong on a
 * Windows machine running Anaconda, which installs `python.exe` and no
 * `python3.exe` — the last link in `pnpm verify` would have failed there for a
 * reason that has nothing to do with the conformance suite.
 *
 * The suite is the strongest single piece of evidence this project has: an
 * independent implementation, written from `docs/PROTOCOL.md` alone, verifying
 * records the TypeScript signed. It is worth being runnable.
 *
 * ## When Python is not installed at all
 *
 * It reports UNKNOWN and exits 0.
 *
 * That is uncomfortable and it is deliberate. The four words this product is
 * built on distinguish *the evidence contradicts it* from *nobody checked*, and
 * a missing interpreter is squarely the second. Failing the build would state
 * FAILED for something never run — the exact conflation §1 of the constitution
 * refuses, in the check that exists to demonstrate it.
 *
 * The protection against this being a quiet hole is that it is loud: it prints
 * UNKNOWN, names what it tried, and says what would settle it. CI has Python, so
 * the suite genuinely runs on every push — a contributor without Python gets a
 * clear statement that one check did not run, rather than a wall they cannot
 * pass or, worse, a green tick they did not earn.
 *
 *   node scripts/check-python.mjs      # or: pnpm check:python
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, runPython } from './lib/python.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'implementations/python/test_conformance.py');

const python = findPython();

if (!python) {
  console.log('UNKNOWN: the Python conformance suite did not run — no Python 3 found.');
  console.log('  Tried: python3, python, py -3');
  console.log('  This is not a failure. Nothing was checked, and nothing is claimed.');
  console.log('  Install Python 3 to run it, or read the result from CI, where it always runs.');
  process.exit(0);
}

const run = runPython(script, { cwd: root, stdio: 'inherit' });

if (run.error) {
  console.error(`Could not run ${python.command}: ${run.error.message}`);
  process.exit(1);
}

process.exit(run.status ?? 1);

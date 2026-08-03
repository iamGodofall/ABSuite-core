/**
 * Finding Python, on a machine that may not call it `python3`.
 *
 * ## Why this exists
 *
 * `spawnSync('python3', ...)` was hardcoded in two places: `gen-site.mjs`, which
 * runs the conformance suite to read its own check count, and the `check:python`
 * script in package.json. Both work on Linux and macOS. Both fail on a Windows
 * machine running Anaconda, which installs `python.exe` and no `python3.exe`.
 *
 * The failure was not a clean one. `gen-site` treats a non-zero exit as "Python
 * is unavailable" and writes a different sentence — *"A conformance suite runs
 * on every build"* instead of *"33 conformance checks run on every build"* —
 * which is a considered fallback, and correct as far as it goes. But `--check`
 * then compares that page against the committed one, finds them different, and
 * reports:
 *
 *     docs/index.html is out of date. Run: pnpm docs:site
 *
 * The document was not out of date. The machine did not have `python3` on its
 * PATH. Those are different facts and the build reported the wrong one, which is
 * the same defect as the CRLF comparison in §4l: a portability difference
 * rendered as a claim about content.
 *
 * ## What it does
 *
 * Tries the names Python actually goes by, and verifies each one is Python 3
 * before trusting it — `python` on some systems is still Python 2, and running
 * the conformance suite under it would fail in a way that looks like a defect in
 * the suite.
 *
 * Returns `null` when there is no Python at all, which is a legitimate state: a
 * documentation generator that cannot run without a second language runtime is a
 * generator that stops being run. Callers must handle `null` as UNKNOWN — *we
 * could not measure this* — and never as FAILED.
 */
import { spawnSync } from 'node:child_process';

/** The names Python answers to, in the order worth trying. */
const CANDIDATES = [
  { command: 'python3', args: [] },
  { command: 'python', args: [] },
  // The Windows launcher. Present on most Windows installs, and `-3` makes it
  // pick a Python 3 even when a Python 2 is also installed.
  { command: 'py', args: ['-3'] },
];

let cached;

/**
 * The interpreter this machine has, or `null`.
 *
 * Result is cached: this runs at most three subprocesses, and a generator that
 * asks twice should not pay twice.
 */
export function findPython() {
  if (cached !== undefined) return cached;

  for (const candidate of CANDIDATES) {
    const probe = spawnSync(
      candidate.command,
      [...candidate.args, '-c', 'import sys; print(sys.version_info[0])'],
      { encoding: 'utf8', timeout: 15_000 },
    );
    // status is null when the binary was not found at all, rather than 0 or 1.
    if (probe.status !== 0) continue;
    if ((probe.stdout ?? '').trim() !== '3') continue;
    cached = candidate;
    return cached;
  }

  cached = null;
  return cached;
}

/**
 * Run a Python script, whatever the interpreter is called here.
 *
 * Returns `null` when no Python exists — again UNKNOWN, not failure.
 */
export function runPython(scriptPath, options = {}) {
  const python = findPython();
  if (!python) return null;
  return spawnSync(python.command, [...python.args, scriptPath], {
    encoding: 'utf8',
    timeout: 60_000,
    ...options,
  });
}

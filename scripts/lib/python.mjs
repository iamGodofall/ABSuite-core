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
 * `--version` rather than `-c "import sys; ..."`.
 *
 * The first version of this probe passed a `-c` snippet full of spaces,
 * semicolons and parentheses. Node builds a single command line from argv on
 * Windows, and under a shell that string is at the mercy of `cmd.exe` parsing.
 * `--version` has no such surface and answers the same question.
 */
function probe(candidate, shell) {
  const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
    encoding: 'utf8', timeout: 15_000, shell,
  });
  if (result.status !== 0) return false;
  // Python 3.4+ prints to stdout; older builds used stderr. Read both rather
  // than depend on which, since the whole point is not to assume the flavour.
  const said = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return /Python\s+3\./.test(said);
}

/**
 * The interpreter this machine has, or `null`.
 *
 * Each name is tried directly first, then through a shell.
 *
 * The shell retry is not belt-and-braces. Since Node 18.20 and 20.12 —
 * CVE-2024-27980 — `spawn` **refuses** to launch a `.bat` or `.cmd` without
 * `shell: true`, and conda installs `python` on Windows behind exactly that kind
 * of shim. A machine running Anaconda reported *"no Python 3 found (tried
 * python3, python, py -3)"* while having a perfectly good Python on PATH,
 * because every candidate was rejected by Node before it ever ran.
 *
 * Direct is tried first because it needs no quoting and cannot be confused by a
 * shell. The shell is the fallback, and callers are told which one applied so
 * they can quote accordingly.
 *
 * Result is cached: this runs at most six probes, and a generator that asks
 * twice should not pay twice.
 */
export function findPython() {
  if (cached !== undefined) return cached;

  for (const shell of [false, true]) {
    for (const candidate of CANDIDATES) {
      if (probe(candidate, shell)) {
        cached = { ...candidate, shell };
        return cached;
      }
    }
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
  // Under a shell the argv is re-parsed as a command line, so a path containing
  // a space — `D:\ABS main\ABSuite-core\...`, which is where this was found —
  // splits into two arguments unless it is quoted. Direct spawn must not be
  // quoted, for the mirror-image reason: the quotes would become part of the
  // filename.
  const argument = python.shell ? `"${scriptPath}"` : scriptPath;
  return spawnSync(python.command, [...python.args, argument], {
    encoding: 'utf8',
    timeout: 60_000,
    shell: python.shell,
    ...options,
    // Belt and braces. The scripts set their own output encoding, which is the
    // real fix because a human redirecting to a file gets no help from here.
    // This covers anything spawned that has not yet learned to, and costs
    // nothing: on Windows a captured stdout otherwise defaults to the locale
    // codepage and dies on the first `§`.
    env: { PYTHONIOENCODING: 'utf-8', ...process.env, ...(options.env ?? {}) },
  });
}

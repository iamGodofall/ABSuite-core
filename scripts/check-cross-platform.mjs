#!/usr/bin/env node
/**
 * The repository behaves the same on Windows as it does here.
 *
 * ## Why this exists
 *
 * Twice now, a defect has reached `main` that no machine in CI and no container
 * could see, and both were found by the one person running this on Windows.
 *
 * The first was `spawn` on an extension-less `.bin/tsx` shim — `ENOENT`, and
 * §2b of AUDIT.md had already documented that exact class before it was
 * repeated. The second is the reason for this file: there was no
 * `.gitattributes`, so Git for Windows checked text files out with CRLF. Five
 * generators build their output with `\n` and compared it byte-for-byte to the
 * file on disk. All six of those comparisons failed, and `pnpm verify` stopped
 * at step three with:
 *
 *     docs/API.md is out of date. Run: pnpm docs:api
 *
 * That command rewrote an identical document, so the instruction in the error
 * message could not work. **Nothing after the third check had ever run on
 * Windows** — twenty-two checks that were reported as part of the suite, on a
 * platform where they were unreachable.
 *
 * Neither defect is exotic. Both are invisible from a Linux container, which is
 * the only place this project's automation runs, and that is precisely why they
 * need a check rather than vigilance.
 *
 * ## What it requires
 *
 *   1. `.gitattributes` normalises the working tree to LF — `* text=auto eol=lf`.
 *      `text=auto` alone is not enough: it normalises what enters the repository
 *      and still hands Windows a CRLF checkout, which is the half that broke.
 *   2. No text file in the tree contains CRLF. If one does, the normalisation is
 *      not taking effect and a Windows clone is about to diverge again.
 *   3. Every generator with a `--check` mode compares through `sameGenerated`
 *      rather than `===`. A newline is not a fact about content, and a check
 *      that reports one as a difference tells somebody to run a command that
 *      cannot help them.
 *
 *   node scripts/check-cross-platform.mjs      # or: pnpm check:cross-platform
 *
 * Wired into `pnpm verify`. Static, no network, no platform of its own.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Floors, because a check that inspects nothing reports success. If a refactor
 * moves the generators or the walk stops reaching the tree, that is a failure of
 * this gate and it has to say so rather than pass an empty set.
 */
const GENERATOR_FLOOR = 5;
const FILE_FLOOR = 200;

/** Formats that are compressed or already binary; a `\r` in them means nothing. */
const BINARY = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.wasm', '.db', '.sqlite',
]);

const failures = [];

// ---------------------------------------------------------------------------
// 1. The working tree is LF on every platform.
// ---------------------------------------------------------------------------
const attributesPath = join(root, '.gitattributes');
if (!existsSync(attributesPath)) {
  failures.push(
    'There is no .gitattributes.\n' +
      '    Git for Windows then applies its own default and checks text files out\n' +
      '    with CRLF, which is how six generator comparisons failed at once.',
  );
} else {
  const attributes = readFileSync(attributesPath, 'utf8');
  if (!/^\*\s+text=auto\s+eol=lf\s*$/m.test(attributes)) {
    failures.push(
      '.gitattributes does not contain `* text=auto eol=lf`.\n' +
        '    `text=auto` on its own normalises what enters the repository but still\n' +
        '    gives Windows a CRLF working tree — the half that broke the build.',
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Nothing in the tree actually carries CRLF.
// ---------------------------------------------------------------------------
let filesInspected = 0;

/*
 * Only files Git tracks.
 *
 * This walked the filesystem at first, and immediately failed a contributor's
 * build with `.env:9 contains CRLF`. `.env` is in `.gitignore` — `.gitattributes`
 * cannot normalise a file Git does not track, so the check was demanding
 * something of a file nothing in this repository controls, and any stray
 * `build.log` or editor scratch file would have done the same.
 *
 * **A shared gate must not fail on a private file.** The set this rule is about
 * is the set that reaches other machines, and that set is exactly what Git
 * tracks.
 */
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });

if (tracked.status !== 0) {
  // No git, or not a checkout. Nothing was examined, so nothing is claimed —
  // the same UNKNOWN the Python check reports, for the same reason.
  console.log('UNKNOWN: line endings were not checked — `git ls-files` did not run here.');
} else {
  for (const path of tracked.stdout.split('\0').filter(Boolean)) {
    if (BINARY.has(extname(path).toLowerCase())) continue;
    const full = join(root, path);
    if (!existsSync(full) || statSync(full).isDirectory()) continue;

    const buffer = readFileSync(full);
    // A NUL byte means binary regardless of extension. Not our business.
    if (buffer.includes(0)) continue;

    filesInspected += 1;
    const index = buffer.indexOf('\r\n');
    if (index !== -1) {
      const line = buffer.subarray(0, index).toString('utf8').split('\n').length;
      failures.push(
        `${path}:${line} contains CRLF.\n` +
          '    LF normalisation is not reaching this file. A Windows clone will read\n' +
          '    it differently from CI, which is the difference that hid for a day.',
      );
    }
  }

  if (filesInspected < FILE_FLOOR) {
    failures.push(
      `Only ${filesInspected} tracked text files were inspected, fewer than the floor of ${FILE_FLOOR}.\n` +
        '    The listing is no longer reaching the tree, so this check is proving nothing.',
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Generators compare content, not newlines.
// ---------------------------------------------------------------------------
const scripts = join(root, 'scripts');
let generators = 0;

for (const entry of readdirSync(scripts)) {
  if (!entry.startsWith('gen-') || !entry.endsWith('.mjs')) continue;
  const text = readFileSync(join(scripts, entry), 'utf8');
  if (!text.includes("'--check'")) continue;

  generators += 1;

  if (!/import\s*\{[^}]*\bsameGenerated\b[^}]*\}\s*from\s*'\.\/lib\/generated\.mjs'/.test(text)) {
    failures.push(
      `scripts/${entry} supports --check but does not import sameGenerated.\n` +
        "    Its comparison is byte-exact, so a CRLF checkout reports the file as out\n" +
        '    of date and sends the reader to a command that rewrites it identically.',
    );
  }

  // A raw comparison against what was just read off disk is the defect itself.
  const raw = /readFileSync\([^)]*\)[^;\n]*(?:!==|===)|(?:!==|===)[^;\n]*readFileSync\(/;
  text.split('\n').forEach((line, index) => {
    if (raw.test(line)) {
      failures.push(
        `scripts/${entry}:${index + 1} compares file contents with === or !==.\n` +
          `    ${line.trim().slice(0, 88)}\n` +
          '    Use sameGenerated(current, generated) — a newline is not a difference in\n' +
          '    what the document says.',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Nothing hardcodes an interpreter name.
//
// `spawnSync('python3', ...)` in gen-site and `"check:python": "python3 ..."` in
// package.json both fail on Windows running Anaconda, which installs
// `python.exe` and no `python3.exe`. The first did not fail cleanly: it treated
// "no interpreter" as "no Python", generated a page with different wording, and
// reported `docs/index.html is out of date` — a fact about PATH, published as a
// fact about a document. `scripts/lib/python.mjs` is the one place allowed to
// know what the binary might be called.
// ---------------------------------------------------------------------------
const INTERPRETER = /(?:spawnSync|spawn|exec|execSync|execFileSync)\s*\(\s*['"`]python\d?['"`]/;

for (const entry of readdirSync(scripts)) {
  if (!entry.endsWith('.mjs')) continue;
  readFileSync(join(scripts, entry), 'utf8').split('\n').forEach((line, index) => {
    // A comment describing the defect is not the defect. This rule's first run
    // flagged its own explanatory note — and because the note sorts first, it
    // masked the two real regressions being tested at the time.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (INTERPRETER.test(line)) {
      failures.push(
        `scripts/${entry}:${index + 1} spawns an interpreter by a hardcoded name.\n` +
          `    ${line.trim().slice(0, 88)}\n` +
          '    Use findPython()/runPython() from ./lib/python.mjs — `python3` does not\n' +
          '    exist on a Windows machine running Anaconda, and the failure does not look\n' +
          '    like a missing interpreter, it looks like a stale document.',
      );
    }
  });
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
  if (/(^|&&\s*|\|\s*)python\d?\s/.test(command)) {
    failures.push(
      `package.json script "${name}" runs \`python\` directly:\n` +
        `    ${command.slice(0, 88)}\n` +
        '    Route it through a script that resolves the interpreter, so the command\n' +
        '    works on a machine where Python is not called `python3`.',
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Python that prints non-ASCII says which encoding it means.
//
// Both Python files here print `§`, `—` and `✓`. On Windows, Python takes the
// encoding for stdout from the locale whenever output is redirected rather than
// attached to a console — cp1252 on a typical install, which has none of those
// characters. Run by hand they worked; captured or redirected they exited 1 with
// UnicodeEncodeError, before printing anything.
//
// That asymmetry is what made it expensive: `check:python` inherits the console
// and passed while `gen-site` captured stdout and failed, on the same machine,
// in the same run. And `absuite_verify.py` is the reference verifier a stranger
// downloads — `python absuite_verify.py records.json > report.txt` crashed
// instead of reporting, which to the person running it is indistinguishable from
// a verification that failed.
// ---------------------------------------------------------------------------
const NON_ASCII = /[^\x00-\x7F]/;
let pythonFiles = 0;

const pythonDir = join(root, 'implementations/python');
if (existsSync(pythonDir)) {
  for (const entry of readdirSync(pythonDir)) {
    if (!entry.endsWith('.py')) continue;
    const text = readFileSync(join(pythonDir, entry), 'utf8');
    // Only files that actually print. A module nobody runs cannot break on it.
    if (!text.includes('print(')) continue;

    pythonFiles += 1;
    if (NON_ASCII.test(text) && !/sys\.stdout\.reconfigure\(/.test(text)) {
      failures.push(
        `implementations/python/${entry} prints non-ASCII without setting the output encoding.\n` +
          '    Add `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`. Without it\n' +
          '    this exits 1 on Windows the moment its output is redirected — including\n' +
          '    into a file, a pipe, or another program reading its result.',
      );
    }
  }
}

if (pythonFiles < 2) {
  failures.push(
    `Only ${pythonFiles} printing Python file(s) were found, expected at least 2.\n` +
      '    The second implementation is the strongest evidence this project has; if it\n' +
      '    moved, this rule is no longer looking at it.',
  );
}

if (generators < GENERATOR_FLOOR) {
  failures.push(
    `Only ${generators} generators with a --check mode were found, fewer than the floor of ${GENERATOR_FLOOR}.\n` +
      '    Either generators were removed and the floor should come down deliberately,\n' +
      '    or this check is no longer looking at them.',
  );
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\nCross-platform check FAILED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  console.error('  Read scripts/check-cross-platform.mjs for why each of these matters.\n');
  process.exit(1);
}

console.log(
  `Cross-platform check passed — ${filesInspected} text files are LF, ` +
    `${generators} generators compare content rather than newlines.`,
);

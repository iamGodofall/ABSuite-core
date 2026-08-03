#!/usr/bin/env node
/**
 * The pnpm a container runs is the pnpm this repository declares.
 *
 * ## Why this exists
 *
 * Two things were true at once in the build that went red for the second time
 * in a day, and neither was visible from inside the repository:
 *
 *   1. Every Dockerfile said `corepack prepare pnpm@9.15.0 --activate`.
 *   2. Every Dockerfile ran pnpm 11.18.0.
 *
 * Corepack obeys `packageManager` in package.json, so the pin was inert — it
 * downloaded a pnpm nobody then used. The line read like a version decision and
 * was not one. When `packageManager` moved from 9 to 11, nothing in the tree
 * changed and nothing local failed; the containers silently changed major
 * version, and pnpm 11's new confirmation prompt aborted the second install:
 *
 *     ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
 *
 * Every service image installs twice — once in full to build, then again with
 * `--prod` to drop devDependencies before the artefact is copied out. The
 * second install purges node_modules, pnpm 11 asks first, and a Docker build
 * has no TTY to answer with. Seven images had this defect; the build only ever
 * showed the first one to reach the step, because BuildKit cancels the rest.
 *
 * Twenty-four local checks and a green `pnpm verify` said nothing, because
 * nothing here executes a Dockerfile. This gate does not build images either —
 * it holds the three properties that would have made the failure impossible.
 *
 * ## What it requires
 *
 *   1. `pnpm-workspace.yaml` sets `confirmModulesPurge: false`, so no install
 *      anywhere waits for a keystroke that will never come.
 *   2. Every stage that runs `pnpm install` has copied `pnpm-workspace.yaml`
 *      first — the setting only applies if the file is actually there. A stage
 *      that installs without it is back to the original failure.
 *   3. No Dockerfile pins a pnpm version at all. `packageManager` is the one
 *      place the version is decided; a second place can only ever drift out of
 *      agreement with it, and drift is what made this silent.
 *
 *   node scripts/check-container-pnpm.mjs      # or: pnpm check:container-pnpm
 *
 * Wired into `pnpm verify`: it is static, needs no daemon and no network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A floor, because a check that inspects nothing reports success. If a refactor
 * moves the Dockerfiles somewhere this walk does not reach, that is a failure
 * of the gate and it has to say so rather than pass an empty set.
 */
const FLOOR = 8;

const failures = [];

function dockerfiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) dockerfiles(full, found);
    else if (entry === 'Dockerfile' || entry.startsWith('Dockerfile.')) found.push(full);
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. The setting exists at all.
// ---------------------------------------------------------------------------
const workspaceFile = join(root, 'pnpm-workspace.yaml');
const workspace = readFileSync(workspaceFile, 'utf8');
if (!/^confirmModulesPurge:\s*false\s*$/m.test(workspace)) {
  failures.push(
    'pnpm-workspace.yaml does not set `confirmModulesPurge: false`.\n' +
      '    Without it, any second `pnpm install` that purges node_modules stops and\n' +
      '    waits for a confirmation no Docker build can give:\n' +
      '    ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY',
  );
}

// ---------------------------------------------------------------------------
// 2 and 3, per Dockerfile, per stage.
// ---------------------------------------------------------------------------
const files = dockerfiles(root);

for (const file of files) {
  const shown = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  // A `RUN` can be continued across lines with a trailing backslash; join those
  // so `pnpm install` split over two lines is still seen as one instruction.
  const joined = [];
  let buffer = null;
  let bufferLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (buffer !== null) {
      buffer += ' ' + line.trim().replace(/\\$/, '');
      if (!line.trimEnd().endsWith('\\')) {
        joined.push({ text: buffer, line: bufferLine });
        buffer = null;
      }
      continue;
    }
    if (line.trimEnd().endsWith('\\')) {
      buffer = line.trimEnd().replace(/\\$/, '');
      bufferLine = i + 1;
      continue;
    }
    joined.push({ text: line, line: i + 1 });
  }
  if (buffer !== null) joined.push({ text: buffer, line: bufferLine });

  let workspaceCopied = false;

  for (const { text, line } of joined) {
    const trimmed = text.trim();

    // A new stage starts with a fresh, empty filesystem. Whatever an earlier
    // stage copied is not here unless this stage copies it again.
    if (/^FROM\s/i.test(trimmed)) {
      workspaceCopied = false;
      continue;
    }

    if (/^COPY\s/i.test(trimmed) && /pnpm-workspace\.yaml/.test(trimmed)) {
      workspaceCopied = true;
      continue;
    }

    // A version pinned anywhere other than `packageManager` is a second source
    // of truth, and the only thing a second source of truth can do is disagree.
    const pin = trimmed.match(/corepack\s+prepare\s+pnpm@([\w.\-]+)/);
    if (pin) {
      failures.push(
        `${shown}:${line} pins pnpm@${pin[1]} with \`corepack prepare\`.\n` +
          '    Corepack takes the version from `packageManager` in package.json, so this\n' +
          '    pin is inert — it downloads a pnpm the build then does not use, while\n' +
          '    reading like the version decision. Delete it; `corepack enable` is enough.',
      );
    }

    if (/^RUN\s/i.test(trimmed) && /\bpnpm\s+install\b/.test(trimmed) && !workspaceCopied) {
      failures.push(
        `${shown}:${line} runs \`pnpm install\` before this stage copies pnpm-workspace.yaml.\n` +
          '    `confirmModulesPurge: false` lives in that file. Without it in place, an\n' +
          '    install that purges node_modules aborts for want of a TTY.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
if (files.length < FLOOR) {
  failures.push(
    `Only ${files.length} Dockerfiles were found, fewer than the floor of ${FLOOR}.\n` +
      '    Either images were deleted and the floor should come down deliberately, or\n' +
      '    the walk no longer reaches them and this check is inspecting nothing.',
  );
}

if (failures.length > 0) {
  console.error(`\nContainer pnpm check FAILED — ${failures.length} problem(s):\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  console.error('  Read scripts/check-container-pnpm.mjs for why each of these matters.\n');
  process.exit(1);
}

console.log(
  `Container pnpm check passed — ${files.length} Dockerfiles, ` +
    'no rival version pin, purge confirmation off everywhere it installs.',
);

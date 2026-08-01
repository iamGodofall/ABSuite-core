#!/usr/bin/env node
/**
 * A class that generates no CSS is a style that does not exist.
 *
 * Three times now this interface has shipped a class name that was perfectly
 * spelled, perfectly valid as a string, present in the DOM — and backed by no
 * rule at all. Each time the element rendered, nothing errored, and the only
 * way anyone found out was by looking at the screen or reading a computed
 * style. This is the exact shape of the failure the rest of the repository
 * guards against everywhere else: something that looks complete and is not.
 *
 * The three:
 *
 *   1. Five `@keyframes` that were never defined. Seven layer nodes carried
 *      animation classes; the browser ignored them silently and six of the
 *      seven sat still. Caught by check-motion-is-evidence.mjs, which now
 *      verifies that every animation name resolves to a real keyframes block.
 *
 *   2. A class name split across two concatenated string literals so the line
 *      would fit. Tailwind finds classes by scanning source text, so it saw two
 *      fragments and no class. The transport keys rendered round and entirely
 *      flat, with every shadow missing.
 *
 *   3. `border-ab-white/12`. Twelve is not in the opacity scale, so no rule was
 *      generated and the border fell back to the browser default — a bright
 *      grey ring on a black instrument, which is worse than no border.
 *
 * This checks the two that are checkable from source. Both are cheap and
 * neither can produce a false positive, because both ask a question with an
 * exact answer: is this number in the scale, and are these brackets balanced.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiSrc = join(root, 'packages/dashboard-ui/src');
const configPath = join(root, 'packages/dashboard-ui/tailwind.config.ts');

/**
 * The opacity steps Tailwind will actually generate.
 *
 * A bare `/NN` modifier resolves against the opacity scale. Anything outside it
 * needs the arbitrary form — `/[0.12]` — which generates fine. So the rule is
 * not "12 is forbidden", it is "12 must be written as the thing that works".
 */
const DEFAULT_OPACITY = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

/*
 * Tailwind v3 ships 0–100 in fives. A project may extend it, so the config is
 * read rather than assumed — a check that is wrong about the scale would send
 * someone chasing a class that works.
 */
let allowed = new Set(DEFAULT_OPACITY);
try {
  const config = readFileSync(configPath, 'utf8');
  const block = config.match(/opacity:\s*\{([^}]*)\}/);
  if (block) {
    for (const entry of block[1].matchAll(/['"]?(\d+)['"]?\s*:/g)) allowed.add(Number(entry[1]));
  }
} catch { /* the default scale stands */ }

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) files.push(full);
  }
})(uiSrc);

const failures = [];
let opacityChecked = 0;
let literalsChecked = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    // Comments describing a class are not a class.
    if (/^\s*(\*|\/\/)/.test(line)) return;

    /* ── 1. Opacity modifiers outside the scale ──────────────────────────── */
    //
    // Matched only on utilities that take a colour, so `w-1/2` and `grid-cols-1/3`
    // are never mistaken for an opacity modifier.
    for (const match of line.matchAll(/\b(bg|text|border|ring|from|via|to|fill|stroke|shadow|divide|outline|decoration|accent|caret|placeholder)-(\[[^\]\s]+\]|[a-z0-9-]+)\/(\d+)\b/g)) {
      opacityChecked += 1;
      const step = Number(match[3]);
      if (!allowed.has(step)) {
        failures.push({
          file: relative(root, file), line: i + 1, text: match[0],
          why: `/${step} is not in the opacity scale, so Tailwind generates no rule and the property falls back to its inherited or default value. ` +
               `Use a step that exists (nearest: /${[...allowed].sort((a, b) => Math.abs(a - step) - Math.abs(b - step))[0]}), or the arbitrary form /[0.${String(step).padStart(2, '0')}].`,
        });
      }
    }

    /* ── 2. A class name split across concatenated literals ──────────────── */
    //
    // The signature is a string literal that opens an arbitrary value and ends
    // without closing it, next to a concatenation. Tailwind scans text, so the
    // full class name never exists anywhere for it to find.
    for (const match of line.matchAll(/(['"`])([^'"`]*\b[a-z-]+-\[[^\]'"`]*)\1\s*\+/g)) {
      literalsChecked += 1;
      const fragment = match[2];
      const opens = (fragment.match(/\[/g) ?? []).length;
      const closes = (fragment.match(/\]/g) ?? []).length;
      if (opens > closes) {
        failures.push({
          file: relative(root, file), line: i + 1, text: `…${fragment.slice(-46)}`,
          why: 'An arbitrary-value class is split across concatenated string literals. Tailwind scans source text and never sees the whole name, so no rule is generated and the element renders unstyled. Keep each class name whole, on one line.',
        });
      }
    }
  });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} class name(s) that generate no CSS:\n`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure.file}:${failure.line}  ${failure.text}`);
    console.error(`      ${failure.why}\n`);
  }
  console.error('A class that generates no rule is a style that does not exist.\n');
  process.exit(1);
}

console.log(`✓ ${opacityChecked} opacity modifier(s) resolve to a real step.`);
console.log(`✓ ${literalsChecked} concatenated class literal(s) keep their names whole.`);
console.log(`  ${files.length} interface source file(s) scanned.`);

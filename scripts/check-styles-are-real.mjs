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

/**
 * A gate that finds nothing must not report success.
 *
 * This check passed on Windows for a while by matching an empty file set — the
 * walk used `/` separators against paths that arrive with `\`, so it scanned
 * zero files, found zero problems, and printed a tick. A green build that
 * inspected nothing is worse than a red one, because it is trusted.
 *
 * The floor is deliberately far below the real count rather than equal to it.
 * An exact number turns every added component into a build failure and gets
 * raised without thought until it means nothing. This is here to catch "the
 * walk matched nothing", not to police the size of the interface.
 */
const FLOOR = 20;
if (files.length < FLOOR) {
  console.error(`\n✗ Only ${files.length} interface source file(s) were scanned, and at least ${FLOOR} were expected.`);
  console.error('');
  console.error('  Nothing was checked, so nothing failed, and this would have printed a');
  console.error('  tick. That is how this check passed on Windows while inspecting an');
  console.error('  empty set — the walk used / against paths that arrive with \\.');
  console.error('');
  console.error(`  Looked in packages/dashboard-ui/src. Either the interface moved, or the`);
  console.error('  walk is broken on this platform. Both are worth stopping the build for.\n');
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * Nothing operated has a square corner.
 *
 * The interface is built out of 26px panels and pill-shaped chips, and a sharp
 * control dropped into one does not read as a variation — it reads as a
 * component from another product. It happened often enough to be found by eye
 * twice, in the record surface and in the native dropdowns.
 *
 * Two assertions, both about the rule rather than about the call sites. Fixing
 * every button individually fixes every button individually; the next one is
 * written by somebody who has not read this file.
 *
 * 1. The base-layer default exists. It is what makes an unstyled control soft,
 *    and it lives in @layer base so any Tailwind utility still overrides it.
 * 2. Nothing squares a corner back off. `rounded-none` on a control is the one
 *    way to defeat the default, and it is never what this interface wants —
 *    the layer surface uses it on a panel edge that meets the viewport, which
 *    is a container and not something you press.
 * ------------------------------------------------------------------------- */
const cssPath = join(root, 'packages/dashboard-ui/src/styles/globals.css');
const css = readFileSync(cssPath, 'utf8');

const radiusFailures = [];

/* ---------------------------------------------------------------------------
 * A theme token the config points at and the stylesheet never defines.
 *
 * This file's whole subject is a class name that generates no CSS, and it could
 * not see the worst instance of that idea in the project. `rounded-lg` maps to
 * `var(--radius-lg)` in tailwind.config.ts; `--radius-lg` was never defined; a
 * custom property with no value makes the entire declaration invalid, so the
 * browser drops it. The class generated a rule, the rule pointed at nothing,
 * and every `rounded-lg` in the interface rendered a square corner.
 *
 * Four tokens were dead this way. Three of them were the corner scale, which is
 * why some controls were round and some were sharp with no pattern to it — the
 * soft ones happened to use rounded-xl and rounded-full, which are literals.
 * The fourth was a text colour, and elements using it silently inherited.
 *
 * Nothing failed. Nothing warned. It is only visible by looking at the screen,
 * which is how it was found, twice, by someone who had to say it twice.
 * ------------------------------------------------------------------------- */
const themeConfig = readFileSync(configPath, 'utf8');
const referenced = [...new Set([...themeConfig.matchAll(/var\((--[A-Za-z0-9-]+)\)/g)].map(match => match[1]))];
const defined = new Set([...css.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map(match => match[1]));
const dead = referenced.filter(name => !defined.has(name));

for (const name of dead) {
  radiusFailures.push(
    `tailwind.config.ts builds a utility on var(${name}) and globals.css never defines it. ` +
    'Every class using it emits a declaration the browser discards, so the utility renders as nothing at all — ' +
    'and both the build and this check would otherwise call that fine.',
  );
}
if (referenced.length < 10) {
  radiusFailures.push(
    `Only ${referenced.length} theme token(s) were read from tailwind.config.ts, and far more were expected. ` +
    'The config moved or the match broke, so this assertion is inspecting almost nothing.',
  );
}

// The default itself. Matched on the selector and the property together, so
// deleting the rule fails even if the word "button" survives elsewhere.
if (!/\bbutton\s*,[\s\S]{0,80}?\{[^}]*border-radius/.test(css)) {
  radiusFailures.push(
    'globals.css no longer gives buttons a default border-radius in @layer base. ' +
    'Every control written without a rounded utility goes square, and nothing in the build would say so.',
  );
}
if (!/\binput\s*,[\s\S]{0,80}?\bselect\b[\s\S]{0,80}?\{[^}]*border-radius/.test(css)) {
  radiusFailures.push(
    'globals.css no longer gives inputs, selects and textareas a default border-radius in @layer base.',
  );
}
// And the OS dropdown, which is foreign to this room until appearance is off.
if (!/\bselect\s*\{[^}]*appearance:\s*none/.test(css)) {
  radiusFailures.push(
    'Native <select> chrome is no longer suppressed. The operating system draws its own bevel and arrow, ' +
    'which is the most obviously foreign object this interface can put on screen.',
  );
}

// A control that squares itself back off.
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/<(button|select|input|textarea)\b/g)) {
    // The element's own attributes, to the first `>` that closes the tag rather
    // than the one inside an arrow function — which is why this counts braces
    // instead of stopping at the first angle bracket.
    let depth = 0;
    let end = match.index;
    for (let at = match.index; at < text.length && at < match.index + 2000; at += 1) {
      const character = text[at];
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
      else if (character === '>' && depth === 0 && text[at - 1] !== '=') { end = at; break; }
    }
    const attributes = text.slice(match.index, end);
    if (/\brounded-none\b/.test(attributes)) {
      radiusFailures.push(
        `${relative(root, file)}: a <${match[1]}> squares its own corners with rounded-none. ` +
        'Controls in this interface are pills or soft-edged; only a container that meets the viewport edge is square.',
      );
    }
  }
}

if (radiusFailures.length > 0) {
  console.error(`\n${radiusFailures.length} sharp-corner problem(s):\n`);
  for (const line of radiusFailures) console.error(`  ✗ ${line}\n`);
  console.error('  The shape is declared once, on the elements, in @layer base — so a');
  console.error('  utility can still override it and a control that says nothing is soft.\n');
  process.exit(1);
}

console.log(`✓ ${opacityChecked} opacity modifier(s) resolve to a real step.`);
console.log(`✓ ${literalsChecked} concatenated class literal(s) keep their names whole.`);
console.log('✓ nothing operated has a square corner, and the default that guarantees it is present.');
console.log(`  ${files.length} interface source file(s) scanned.`);

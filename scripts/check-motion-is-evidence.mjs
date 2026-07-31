#!/usr/bin/env node
/**
 * Motion is evidence. If nothing happened, nothing moves.
 *
 * This is the rule that arrived last and should have arrived first. Every other
 * check in this repo asks whether a *number* was measured. None of them asked
 * whether a *movement* was earned — and the interface was, until this check was
 * written, spinning a cube on a permanent eighteen-second loop whether or not a
 * single record existed. That is the animated form of a fabricated figure: a
 * system reporting activity it does not have.
 *
 * An infinite animation is a claim that something is continuously happening.
 * Sometimes that claim is true — a socket really is connected, a request really
 * is outstanding, a chain link really is sealed. So this does not ban them. It
 * requires each one to be declared here with the state that earns it, which
 * makes the list below the complete, reviewable inventory of every perpetual
 * motion in the product.
 *
 * Adding an animation without adding it here fails the build. Adding it here
 * costs a sentence explaining what it reports, which is the point: the sentence
 * is where someone notices they cannot name a state, and deletes the animation
 * instead.
 *
 * The list is also checked in reverse. Its first run carried three entries for
 * animations that run a fixed number of times rather than forever — the unknown
 * beacon beats once per unknown and rests. Justifying motion that does not
 * happen is how an inventory rots into a formality, so a stale entry fails too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiSrc = join(root, 'packages/dashboard-ui/src');
const css = readFileSync(join(uiSrc, 'styles/globals.css'), 'utf8');

/** Every component file, for the two places motion hides outside the stylesheet. */
const componentFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) componentFiles.push(full);
  }
})(uiSrc);
const components = componentFiles.map(file => ({ file: relative(root, file), text: readFileSync(file, 'utf8') }));

/**
 * Every perpetual animation, and the state that earns it.
 *
 * `gate` names what must be true for the motion to be running. "always" is
 * permitted only where the motion is imperceptible or is itself the resting
 * state — and each such entry has to argue for itself.
 */
const DECLARED = {
  'trust-cube-drift': {
    gate: 'socket connected',
    why: 'One revolution every two hours — 0.05°/sec, below the threshold at which the eye reads motion. It is the resting state of an instrument holding station, and it stops entirely when the socket drops.',
  },
  'live-pulse': { gate: 'socket connected', why: 'The connection indicator. Pulsing is the claim that the socket is live; it is removed when it is not.' },
  'status-up-pulse': { gate: 'service reported up', why: 'Applied only to a service whose health check answered.' },
  'ops-ring-drift': { gate: 'always', why: 'Orbit structure at 60s per revolution. Reports nothing and claims nothing; removing it would not remove information, and it is the one purely spatial element retained to give the core somewhere to sit.' },
  'ops-steady': { gate: 'determination is DEMONSTRATED', why: 'Stable illumination — the visual state bound to DEMONSTRATED in the philosophy document.' },
  'ops-unresolved': { gate: 'determination is UNKNOWN', why: 'Amber pulse — the visual state bound to UNKNOWN. Unresolved, not wrong.' },
  'trust-sweep': { gate: 'verification request in flight', why: 'Mounted when the request goes out, unmounted when it returns. Its duration is the real cost of verifying.' },
  'chain-sealed': { gate: 'link verified on the last pass', why: 'Applied per link, only to links the chain check confirmed.' },
  'governance-breach': { gate: 'a governance violation exists', why: 'One pulse every five seconds — rare enough not to be tuned out, applied only where a breach was recorded.' },
  'spin': { gate: 'an operation is in flight', why: 'The standard busy indicator, mounted only while something is loading.' },
  'node-observe': { gate: 'Observe reported DEMONSTRATED', why: 'The character motion of a live station, applied only while that station is demonstrating. A layer that is UNKNOWN, FAILED or ABSENT does not get it.' },
  'node-verify': { gate: 'Verify reported DEMONSTRATED', why: 'As above. Verify barely moves — a two-pixel lift over nine seconds — because stability is the thing it reports.' },
  'node-explain': { gate: 'Explain reported DEMONSTRATED', why: 'As above.' },
  'node-arbitrate': { gate: 'Arbitrate reported DEMONSTRATED', why: 'As above. Rotates briefly once per eleven seconds rather than continuously — a dispute resolves, it does not churn.' },
  'node-act': { gate: 'Act reported DEMONSTRATED', why: 'As above. A single snap per cycle: execution is discrete, not sustained.' },
  'node-learn': { gate: 'Learn reported DEMONSTRATED', why: 'As above.' },
  'node-unresolved': { gate: 'the layer reported UNKNOWN', why: 'The amber pulse the rest of the product uses for a question nothing has answered. Unresolved, not wrong.' },
  'evidence-travel': { gate: 'Observe reported DEMONSTRATED', why: 'One record travelling the seven stations. Mounted only when Observe is demonstrating, because a record in transit requires records; with nothing observed the particle is not rendered at all.' },
  'progress-shimmer': { gate: 'a determinate operation is running', why: 'Applied to a progress bar that is reporting real progress.' },
  'skeleton-shimmer': { gate: 'content is loading', why: 'A placeholder that exists only while a fetch is outstanding.' },
};

const failures = [];
const passes = [];

/** Every animation name used with `infinite`, wherever it appears. */
const used = new Set();
for (const match of css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)) {
  const declaration = match[1];
  if (!/\binfinite\b/.test(declaration)) continue;
  for (const name of declaration.matchAll(/\b([a-z][a-z0-9-]{2,})\b/gi)) {
    const token = name[1];
    // Keywords and `!important` are not animation names.
    if (/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|alternate|reverse|both|forwards|backwards|running|paused|normal|none|var|cubic-bezier|steps|important)$/i.test(token)) continue;
    if (/^\d/.test(token)) continue;
    used.add(token);
  }
}

/**
 * Motion declared outside the stylesheet.
 *
 * This check read globals.css and nothing else for its whole first life, and a
 * supplied package walked straight through the gap: seven layer nodes each
 * carrying animate-[float-stable_1s_ease-in-out_infinite] in JSX, plus an
 * evidence particle with an inline style={{ animation: '... infinite' }}. Eight
 * perpetual animations, none of them visible to a checker that only reads CSS.
 *
 * Worse, five of those keyframes did not exist. The class names compiled, the
 * browser silently ignored them, and the result was a scene where most nodes
 * were frozen and one particle flew forever — which is what "the animation is
 * glitching" turned out to mean. So this also verifies that every animation
 * named anywhere resolves to a real @keyframes block: an animation name with
 * no keyframes behind it is a claim with nothing behind it, which is the same
 * failure this repo checks for everywhere else.
 */
const declaredOutsideCss = new Map();
for (const source of components) {
  // Tailwind arbitrary values: animate-[name_1s_ease-in-out_infinite]
  for (const match of source.text.matchAll(/animate-\[([a-zA-Z][\w-]*)_[^\]]*\]/g)) {
    if (/infinite/.test(match[0])) declaredOutsideCss.set(match[1], source.file);
  }
  // Inline styles: animation: 'name 10s linear infinite'
  for (const match of source.text.matchAll(/animation\s*:\s*['"`]([a-zA-Z][\w-]*)[^'"`]*['"`]/g)) {
    if (/infinite/.test(match[0])) declaredOutsideCss.set(match[1], source.file);
  }
}
for (const name of declaredOutsideCss.keys()) used.add(name);

/** Every @keyframes block available to the interface. */
const keyframes = new Set([...css.matchAll(/@keyframes\s+([a-zA-Z][\w-]*)/g)].map(m => m[1]));
// Tailwind ships a handful of its own; they are real even though they are not
// in our stylesheet.
for (const builtin of ['spin', 'ping', 'pulse', 'bounce']) keyframes.add(builtin);

for (const name of [...used].sort()) {
  if (!keyframes.has(name)) {
    const where = declaredOutsideCss.get(name);
    failures.push(
      `"${name}" is applied${where ? ` in ${where}` : ''} but no @keyframes block defines it.\n` +
      `      The browser ignores it silently, so the element sits still while the code\n` +
      `      claims it is animating. Define the keyframes or remove the class.`
    );
  }
  const entry = DECLARED[name];
  if (entry) passes.push(`${name} — ${entry.gate}`);
  else {
    failures.push(
      `"${name}" runs forever and is not declared in scripts/check-motion-is-evidence.mjs.\n` +
      `      Motion is a claim that something is happening. Name the state that earns it,\n` +
      `      or delete the animation. If you cannot name the state, that is the answer.`
    );
  }
}

/** A declaration for an animation nobody uses is a stale justification. */
for (const name of Object.keys(DECLARED)) {
  if (!used.has(name)) {
    failures.push(`"${name}" is declared here but no longer runs anywhere. Remove the entry — a list that outlives its subject stops being an inventory.`);
  }
}

for (const line of passes) console.log(`✓ ${line}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} undeclared or stale perpetual motion(s):\n`);
  for (const line of failures) console.error(`  ✗ ${line}\n`);
  console.error('If nothing happened, nothing moves.\n');
  process.exit(1);
}

console.log(`\n${used.size} perpetual animation(s), each bound to a stated condition.`);

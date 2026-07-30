#!/usr/bin/env node
/**
 * The interface must not invent.
 *
 * Every other check in this repo reads code, docs or routes. None of them look
 * at the thing a stranger actually judges the product by. The UI overhaul brief
 * named this exactly — "none of them look at the interface" — and it is why a
 * notification bell once claimed a health check had passed that may never have
 * run, why six connector tiles carried enabled flags written into the source,
 * and why a dead branch sat in the token generator printing `ck_demo_<random>`
 * on failure: a fabricated credential that looked real, one flipped condition
 * from shipping.
 *
 * Each of those was found by a person reading, months late. This finds them at
 * build time.
 *
 * The rule being enforced is the one from docs/UI-PHILOSOPHY.md: never fake
 * data. If a metric does not exist, do not invent one.
 *
 * Scope is the dashboard's own source. Tests are exempt — a test fixture is
 * supposed to be fabricated, and saying so out loud is the point of a fixture.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiRoot = join(root, 'packages/dashboard-ui/src');

const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.|\.spec\./.test(entry)) continue;
    sources.push(full);
  }
};
walk(uiRoot);

/**
 * Each rule states what it bans and why that ban is not merely stylistic.
 *
 * `allow` exists because a blanket ban with no escape hatch gets deleted the
 * first time it is inconvenient. A rule you can suppress with a written reason
 * survives; a rule you cannot survives until it is annoying.
 */
const RULES = [
  {
    id: 'dead-toggle',
    pattern: /\bif\s*\(\s*(false|true)\s*\)/g,
    why: 'A literal if (false) is a switch someone can flip. Demo mode was deleted; the branches it left behind still contained fabricated tokens and policies.',
  },
  {
    id: 'randomness',
    pattern: /\bMath\.random\s*\(/g,
    why: 'Randomness has no honest use in an interface whose claim is that every figure came from a record. Use crypto.randomUUID() for identity.',
  },
  {
    id: 'demo-identifier',
    pattern: /\b(?:DEMO|MOCK|FAKE|SAMPLE|DUMMY)_[A-Z0-9_]+\b/g,
    why: 'A constant named for its own fictionality is data waiting to be rendered as real.',
  },
  {
    id: 'demo-literal',
    // Deliberately narrow: a demo/mock/fake prefix immediately followed by a
    // value, which is what a fabricated identifier looks like. Prose that
    // merely mentions the word is not matched.
    pattern: /['"`](?:ck_)?(?:demo|mock|fake|sample)[_:-][^'"`]*['"`]/gi,
    why: 'A string literal shaped like a fabricated value. The token generator shipped `ck_demo_<random>` inside a dead branch for months.',
  },
  {
    /**
     * The specification forbids four figures outright, whatever the layout:
     * a trust score, a confidence value, a count of attacks prevented, and an
     * intelligence rating. Each is a judgement wearing a decimal point, and
     * none is a thing this system measures.
     *
     * They are banned as rendered strings rather than as variable names,
     * because the harm is done when a reader sees them — the label is the lie,
     * not the identifier behind it.
     */
    id: 'forbidden-metric',
    pattern: /['"`>][^'"`<]*\b(?:trust score|confidence score|confidence:\s*0\.|attacks? prevented|tampering prevented|intelligence rating)\b/gi,
    why: 'Forbidden by the specification: trust scores, confidence figures, attacks prevented and intelligence ratings are judgements this system does not measure.',
    /**
     * Refusing a thing is not doing it.
     *
     * This rule's first run flagged Agents.tsx, whose copy reads "Not a trust
     * score. Trust is not a quantity this system computes." That sentence is
     * the product's argument, and a check that cannot tell an assertion from a
     * refusal would delete the clearest statement of the principle it exists to
     * enforce. Matches preceded by a negation are left alone.
     */
    exempt: (text, index, matched) =>
      // The negation usually sits inside the match — "Not a trust score" —
      // because the match starts at the enclosing quote or tag.
      /\b(?:not|no|never|without|refus\w*|nor)\b/i.test(matched) ||
      /\b(?:not|no|never|without|refus\w*|nor)\b[^.]{0,40}$/i.test(text.slice(Math.max(0, index - 60), index)),
  },
  {
    /**
     * A state claim written as literal text, with nothing behind it.
     *
     * Found by running this check against a supplied UI blueprint, which it
     * passed while containing `6/6 SERVICES ANSWERED`, `VERIFICATION → intact`
     * and `POLICY → scoped` as hardcoded strings. Every earlier rule looks for
     * things that are obviously fictional — a name containing DEMO, a random
     * call. This is the subtler and more dangerous shape: a sentence that is
     * simply asserted, indistinguishable on screen from one that was measured.
     *
     * The test is interpolation. A JSX text node that states a determination
     * and contains no expression is stating it from nowhere. Anything derived
     * carries a `{`, so honest code passes untouched.
     */
    id: 'asserted-state',
    pattern: />[^<>{}\n]*\b(?:intact|scoped|demonstrated|healthy|verified|hash[ -]chained|services answered|\d+\/\d+\s+services)\b[^<>{}\n]*</gi,
    why: 'A determination written as literal text with no expression behind it. On screen this is indistinguishable from a measured one, which is exactly what the critical rule forbids.',
  },
];

/**
 * Blank out comments while preserving every byte offset.
 *
 * The check must read code, not commentary. Its first run flagged its own
 * explanatory comment in App.tsx — a sentence describing the fabricated token
 * that had just been deleted. Prose about a fabrication is not a fabrication,
 * and a check that cannot tell the difference trains people to disable it.
 *
 * Replacing comment bodies with spaces rather than removing them keeps line and
 * column numbers honest, so a reported location is still the real one.
 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, blank => blank.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));

const failures = [];
let scanned = 0;

for (const file of sources) {
  const raw = readFileSync(file, 'utf8');
  const text = stripComments(raw);
  const lines = raw.split('\n');
  scanned += 1;

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      const line = text.slice(0, match.index).split('\n').length;

      // An escape hatch that costs a sentence. Placing it on the line above
      // keeps the justification next to the thing it justifies.
      const previous = lines[line - 2] ?? '';
      if (/absuite-allow-fabrication:/.test(previous)) continue;
      if (rule.exempt?.(text, match.index, match[0])) continue;

      failures.push({
        file: relative(root, file),
        line,
        rule: rule.id,
        text: match[0].length > 60 ? `${match[0].slice(0, 57)}…` : match[0],
        why: rule.why,
      });
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} possible fabrication(s) in the interface:\n`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure.file}:${failure.line}  [${failure.rule}]  ${failure.text}`);
    console.error(`      ${failure.why}\n`);
  }
  console.error('If a match is genuinely fine, put a comment directly above it:\n');
  console.error('    // absuite-allow-fabrication: <why this is not invented data>\n');
  process.exit(1);
}

console.log(`✓ ${scanned} interface source file(s) scanned, no fabricated data found.`);
console.log(`  Rules: ${RULES.map(rule => rule.id).join(', ')}`);

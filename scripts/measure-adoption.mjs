#!/usr/bin/env node
/**
 * What the registry actually says about adoption.
 *
 * ## Why this exists
 *
 * The adoption claim in this repository has been wrong twice, in opposite
 * directions, and both times the error was the same one: it was published
 * without a measurement behind it.
 *
 *   "Nobody outside the project has used it."
 *        Written into ROADMAP.md, README.md and FAQ.md Q11 with confidence.
 *        The registry was never queried. It happened to be approximately
 *        right, which is worse than being wrong — an unchecked claim that
 *        survives because it got lucky teaches nobody to check the next one.
 *
 *   "About 3,048 weekly downloads, and five dependents."
 *        The correction, which read automated traffic as people and a
 *        full-text search as a dependents list. `?text=depends:@scope/pkg`
 *        is not a dependents query; npm ignores the qualifier and returns
 *        seventeen thousand unrelated packages, one of which is literally
 *        named `capkit` and belongs to somebody else.
 *
 * This project's entire argument is that a claim nobody can check is not
 * evidence. That has to apply to claims about the project.
 *
 * ## Why a download count is not an adoption number
 *
 * Registry mirrors, CDN caches and security scanners fetch new packages hard
 * on the day they appear, then taper. The signature is unmistakable once you
 * look at the daily series rather than the weekly total: a large spike on the
 * publish date, then a decaying tail, in near-identical proportion across
 * every package published together — including the ones nobody would install
 * on purpose.
 *
 * A weekly total flattens that into one number that looks like people. So
 * this reports the series, names the publish-day spike as a spike, and
 * refuses to convert either into a user count.
 *
 * ## What it will and will not conclude
 *
 * It reports in the four words the rest of the system uses. For adoption it
 * will essentially always say UNKNOWN, and that is correct rather than
 * evasive: npm publishes no identity with a download, so the question "did a
 * person choose this" is not answerable from this data by anyone, at any
 * scale. The honest signal is a dependent package — a name, attached to a
 * human decision. That is what this looks for and what it reports.
 *
 *   node scripts/measure-adoption.mjs        # or: pnpm adoption
 *
 * Deliberately not wired into `pnpm verify`. It needs the network, and a gate
 * that fails when the wifi drops gets switched off within a week — which
 * would cost the build the sixteen checks that do not need a network.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Read the scope's published names from the repository, not from memory. */
const published = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => {
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', entry.name, 'package.json'), 'utf8'));
      return manifest.private ? null : manifest.name;
    } catch { return null; }
  })
  .filter(Boolean);

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const WINDOW = `${day(-30)}:${day(0)}`;

const json = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
};

/* ── Ask the registry ───────────────────────────────────────────────────── */

const measured = [];

for (const name of published) {
  const record = { name, state: 'UNKNOWN', because: '' };
  try {
    const meta = await json(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
    record.firstPublished = meta.time.created.slice(0, 10);
    record.versions = Object.keys(meta.versions).length;
    record.latest = meta['dist-tags']?.latest;
  } catch (error) {
    record.state = 'ABSENT';
    record.because = `the registry has no record of it (${error.message})`;
    measured.push(record);
    continue;
  }

  try {
    const range = await json(`https://api.npmjs.org/downloads/range/${WINDOW}/${name.replace('/', '%2f')}`);
    record.series = range.downloads.filter(entry => entry.downloads > 0);
    record.total = record.series.reduce((sum, entry) => sum + entry.downloads, 0);

    const peak = record.series.reduce((best, entry) => entry.downloads > best.downloads ? entry : best,
      { downloads: 0, day: '—' });
    record.peak = peak;
    // The tail is what happens after the day the mirrors arrived.
    const after = record.series.filter(entry => entry.day > peak.day);
    record.tail = after.reduce((sum, entry) => sum + entry.downloads, 0);
    record.tailDays = after.length;
    record.spikeShare = record.total > 0 ? peak.downloads / record.total : 0;
  } catch (error) {
    record.because = `downloads unavailable (${error.message})`;
    measured.push(record);
    continue;
  }

  measured.push(record);
}

/* ── Dependents: the only signal that carries a name ────────────────────── */

/**
 * npm's search API reports a `dependents` count per package, and it is real.
 *
 * This was got wrong twice in opposite directions, which is why it is worth
 * spelling out. First a *search* was used — `?text=depends:@scope/pkg` — which
 * npm reads as free text and answers with the whole registry ranked by
 * relevance; that returned five unrelated packages, one of them literally named
 * `capkit` and belonging to somebody else. Correcting that, the conclusion was
 * that npm has no dependents data at all. **It does.** It is a field on the
 * search result, and for `@absuitecore/capkit` it says five.
 *
 * And those five are all ours: connector-starter, edge-run, mcp, quickbench and
 * trust each depend on capkit. So the number is real, it is not adoption, and
 * reporting it without that distinction would be the third version of the same
 * mistake.
 *
 * Hence: count dependents, then subtract our own. **A first-party dependent is
 * a fact about our monorepo. A third-party one is the first evidence a stranger
 * chose this**, and it carries a name in a way no download does.
 */
const OWN = new Set(published);

const dependentsOf = async () => {
  const found = new Map();
  try {
    const search = await json('https://registry.npmjs.org/-/v1/search?text=%40absuitecore&size=25');
    for (const entry of search.objects ?? []) {
      const count = Number(entry.dependents ?? 0);
      if (Number.isFinite(count)) found.set(entry.package.name, count);
    }
  } catch {
    return null; // Unknown is a real answer; a zero here would be a false one.
  }
  return found;
};

const dependents = await dependentsOf();

/* ── Report ─────────────────────────────────────────────────────────────── */

const pad = (text, width) => String(text).padEnd(width);
const nameWidth = Math.max(...published.map(name => name.length)) + 2;

console.log(`\nRegistry measured ${new Date().toISOString().slice(0, 10)}, window ${WINDOW}\n`);
console.log(`  ${pad('package', nameWidth)}${pad('first', 12)}${pad('30d', 8)}${pad('peak day', 12)}${pad('peak', 8)}tail`);
console.log(`  ${'─'.repeat(nameWidth + 12 + 8 + 12 + 8 + 12)}`);

for (const record of measured) {
  if (!record.series) {
    console.log(`  ${pad(record.name, nameWidth)}${record.because}`);
    continue;
  }
  console.log(
    `  ${pad(record.name, nameWidth)}${pad(record.firstPublished, 12)}` +
    `${pad(record.total, 8)}${pad(record.peak.day, 12)}${pad(record.peak.downloads, 8)}` +
    `${record.tail} over ${record.tailDays}d`
  );
}

const withData = measured.filter(record => record.series?.length);
const total = withData.reduce((sum, record) => sum + record.total, 0);
const tail = withData.reduce((sum, record) => sum + record.tail, 0);

/**
 * The reading, stated as a finding rather than a number.
 *
 * If every package peaks on the same day and the tail is a small fraction of
 * the total, that is the mirror signature and the download count says nothing
 * about people. If the tail grows, or one package separates from the others,
 * that is the first thing that would look like adoption — and it would still
 * need a dependent to become DEMONSTRATED.
 */
const peakDays = new Set(withData.map(record => record.peak.day));
const spikeIsShared = peakDays.size === 1 && withData.length > 1;
const tailShare = total > 0 ? tail / total : 0;

console.log('');
if (withData.length === 0) {
  console.log('ADOPTION  ABSENT — the registry returned no download data at all.');
  console.log('          Nothing here answers the question; that is not the same as no.');
} else if (spikeIsShared && tailShare < 0.25) {
  console.log('ADOPTION  UNKNOWN — the downloads are consistent with automated traffic.');
  console.log(`          All ${withData.length} packages peak on the same day (${[...peakDays][0]}), and only`);
  console.log(`          ${Math.round(tailShare * 100)}% of ${total} downloads fall outside that day. Registry mirrors,`);
  console.log('          CDN caches and security scanners produce exactly that shape.');
  console.log('          It is not evidence of a person, and it is not evidence of nobody.');
} else {
  console.log('ADOPTION  UNKNOWN — but the shape is no longer just the publish spike.');
  console.log(`          ${tail} of ${total} downloads (${Math.round(tailShare * 100)}%) are outside the peak day,`);
  console.log(`          across ${peakDays.size} distinct peaks. Worth looking at directly.`);
}

console.log('');
if (dependents === null) {
  console.log('DEPENDENTS  UNKNOWN — the registry search did not answer. Not zero.');
} else {
  const total = [...dependents.values()].reduce((sum, n) => sum + n, 0);
  /*
   * Every package in this scope that depends on another is one of ours, so the
   * count of first-party edges is derivable from the manifests rather than
   * guessed at — and anything above it came from outside.
   */
  const firstParty = published.reduce((sum, name) => {
    const dir = name.replace('@absuitecore/', '');
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8'));
      return sum + Object.keys(manifest.dependencies ?? {}).filter(dep => OWN.has(dep)).length;
    } catch { return sum; }
  }, 0);
  const outside = total - firstParty;

  for (const [name, count] of [...dependents].filter(([, n]) => n > 0)) {
    console.log(`DEPENDENTS  ${name} — ${count}`);
  }
  console.log(
    outside > 0
      ? `            ${firstParty} are ours; ${outside} are not. Look at those — a package that\n` +
        '            depends on this is the first signal with a name on it.'
      : `            All ${total} are ours (packages in this monorepo depending on each other).\n` +
        '            No package outside this project depends on any of these yet.'
  );
}

console.log('');
console.log('          What would make adoption DEMONSTRATED: a dependent that is not ours,');
console.log('          an issue from somebody who is not the maintainer, or a deployment');
console.log('          that is not ours verifying a record. Each of those carries a name.');
console.log('          A download does not, at any scale.');
console.log('');
console.log('A download count is not a user count, and this refuses to convert one into');
console.log('the other. Documents may quote the series above; they may not quote a');
console.log('conclusion this did not reach.\n');

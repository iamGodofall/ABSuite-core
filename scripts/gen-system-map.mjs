#!/usr/bin/env node
/**
 * The system map — one page that says what this is, and cannot lie about it.
 *
 * A system diagram is usually the least trustworthy artifact a project has. It
 * is drawn once, in a tool nobody else opens, and from then on it describes the
 * software the author intended. Six months later it shows two services that were
 * merged and none of the three that were added, and every reader who trusted it
 * was misled by a picture.
 *
 * So this one is not drawn. Every box, status and count below is parsed from the
 * files the rest of the build already enforces:
 *
 *   docs/CONSTITUTION.md   the eight layers, their status, the file each claims
 *   docs/ARCHITECTURE.md   the seven operations and what implements each
 *   docs/API.md            the routes, per service
 *   packages/../package.json  the published units and their versions
 *
 * `--check` fails if the page on disk no longer matches what those files say,
 * so a diagram that has gone stale is a broken build rather than a quiet lie.
 * That is the same rule `gen-architecture-layers.mjs` applies to the roadmap and
 * `check-doctrine.mjs` applies to the constitution, extended to the picture.
 *
 * Output is one self-contained HTML file with no external requests, which is
 * also what makes it publishable for nothing on GitHub Pages.
 *
 *   node scripts/gen-system-map.mjs           # write docs/system.html
 *   node scripts/gen-system-map.mjs --check   # fail if it is out of date
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/* ── The eight layers: what ABSuite becomes ──────────────────────────────── */

const constitution = read('docs/CONSTITUTION.md');

const LAYERS = [...constitution.matchAll(
  /^\|\s*(\d)\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+?)\s*\|\s*(Built|Partly built|Not built)\s*\|\s*([^|]*?)\s*\|/gm
)].map(m => ({
  n: Number(m[1]),
  name: m[2].trim(),
  promise: m[3].trim(),
  status: m[4].trim(),
  evidence: m[5].replace(/`/g, '').trim(),
}));

if (LAYERS.length !== 8) {
  console.error(`Expected 8 architectural layers in CONSTITUTION.md, found ${LAYERS.length}.`);
  process.exit(1);
}

/*
 * The maturity grid — which operation serves which layer.
 *
 * This is the actual system diagram and it already existed, as a table nobody
 * looks at twice. ● means the operation carries that layer today, ◐ partly,
 * ○ planned. Rendering it is what turns two flat lists into a map.
 */
/*
 * Bounded to that one table, and this is not fussiness.
 *
 * Slicing to the end of the document instead put every later table with a
 * matching first column into the same map — the five necessary conditions
 * (Identity, Capability, Evidence, Governance, Time) is one — and
 * `Object.fromEntries` silently kept the last one. The Evidence row rendered
 * completely empty while the constitution said it was carried by three
 * operations, and the page looked entirely plausible while saying it.
 *
 * The row count is asserted below, so this cannot fail quietly again.
 */
const gridStart = constitution.indexOf('| Layer | Observe |');
const gridEnd = constitution.indexOf('\n\n', gridStart);
const gridBlock = constitution.slice(gridStart, gridEnd === -1 ? undefined : gridEnd);

const GRID = Object.fromEntries(
  [...gridBlock.matchAll(/^\|\s*([A-Za-z ]+?)\s*\|([^\n]*)\|\s*$/gm)]
    .filter(m => LAYERS.some(l => l.name === m[1].trim()))
    .map(m => [m[1].trim(), m[2].split('|').map(cell => cell.trim())])
);

const missing = LAYERS.filter(layer => !GRID[layer.name]).map(layer => layer.name);
if (missing.length > 0) {
  console.error(`These layers have no row in the maturity grid: ${missing.join(', ')}.`);
  console.error('A layer missing from the grid renders as an empty row, which reads as "this layer does nothing".');
  process.exit(1);
}

/* ── The seven operations: what ABSuite does ─────────────────────────────── */

const architecture = read('docs/ARCHITECTURE.md');

const OPERATIONS = [...architecture.matchAll(
  /^\|\s*(\d)\s*\|\s*\*\*([^*]+)\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm
)].map(m => ({
  n: Number(m[1]),
  name: m[2].trim(),
  implementedBy: m[3].replace(/`/g, '').trim(),
  entry: m[4].replace(/`/g, '').trim(),
}));

if (OPERATIONS.length !== 7) {
  console.error(`Expected 7 operations in ARCHITECTURE.md, found ${OPERATIONS.length}.`);
  process.exit(1);
}

/** The question each operation answers, from the interface's own tab config. */
const QUESTIONS = Object.fromEntries(
  [...read('packages/dashboard-ui/src/App.tsx').matchAll(
    /\{\s*id:\s*'(\w+)',\s*layer:\s*\d,\s*label:\s*'([^']+)',\s*question:\s*'([^']+)'/g
  )].map(m => [m[2], m[3]])
);

/* ── The units that ship ─────────────────────────────────────────────────── */

const PACKAGES = readdirSync(join(root, 'packages'))
  .filter(dir => existsSync(join(root, 'packages', dir, 'package.json')))
  .map(dir => {
    const manifest = JSON.parse(read(`packages/${dir}/package.json`));
    return {
      dir,
      name: manifest.name,
      version: manifest.version,
      description: (manifest.description || '').split(/[—:]/)[0].trim(),
      // `private` is the honest signal for "runs from this repository" — the
      // interface is not on npm and a map that implied otherwise would be wrong.
      published: manifest.private !== true,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/* ── Routes, counted from the generated API table ────────────────────────── */

const api = read('docs/API.md');
const ROUTES = [...api.matchAll(/^\|\s*(GET|POST|DELETE|PUT|PATCH)\s*\|\s*`([^`]+)`/gm)].length;

const STATUS_TONE = { 'Built': 'built', 'Partly built': 'partial', 'Not built': 'planned' };
const CELL_TONE = { '●': 'built', '◐': 'partial', '○': 'planned', '': 'none' };

const esc = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const OPERATION_NAMES = OPERATIONS.map(o => o.name);

/* ── The page ────────────────────────────────────────────────────────────── */

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ABSuite — the system, as it actually is</title>
<meta name="description" content="Every layer, operation and package in ABSuite, generated from the repository rather than drawn. Status is parsed from the files the build enforces.">
<style>
  :root {
    --ground: #000000;
    --panel: #020805;
    --raised: #04120B;
    --line: rgba(0,245,140,0.15);
    --green: #00F58C;
    --turquoise: #2DD4BF;
    --amber: #F6B100;
    --red: #DC2626;
    --white: #F4F7FA;
    --muted: #7C9389;
    --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --pill: 9999px;
    --card: 18px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--white);
    font-family: var(--sans); line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 4rem 1.5rem 6rem; }

  .eyebrow {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--muted);
  }
  h1 { font-size: clamp(1.9rem, 5vw, 3rem); line-height: 1.1; margin: 0.6rem 0 0; text-wrap: balance; letter-spacing: -0.02em; }
  h2 { font-family: var(--mono); font-size: 11px; font-weight: 400; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin: 0 0 1rem; }
  .lede { max-width: 62ch; color: rgba(244,247,250,0.72); margin: 1.2rem 0 0; }
  .lede strong { color: var(--white); font-weight: 600; }

  section { margin-top: 4rem; }

  .counts { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 2rem; }
  .count {
    font-family: var(--mono); font-size: 11px; padding: 0.4rem 0.9rem;
    border: 1px solid var(--line); border-radius: var(--pill); color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .count b { color: var(--white); font-weight: 500; }

  /* The matrix — the actual map. Scrolls in its own box, never the page. */
  .matrix-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--card); background: var(--panel); }
  table { border-collapse: collapse; width: 100%; min-width: 720px; }
  th, td { padding: 0.7rem 0.6rem; text-align: center; font-family: var(--mono); font-size: 11px; }
  thead th { color: var(--muted); font-weight: 400; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid var(--line); }
  tbody th { text-align: left; font-weight: 400; color: var(--white); white-space: nowrap; padding-left: 1rem; }
  tbody tr + tr th, tbody tr + tr td { border-top: 1px solid rgba(0,245,140,0.07); }
  tbody tr:hover td, tbody tr:hover th { background: rgba(0,245,140,0.04); }

  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
  .dot.built   { background: var(--green);     box-shadow: 0 0 10px rgba(0,245,140,0.55); }
  .dot.partial { background: var(--amber); }
  .dot.planned { background: transparent; border: 1px solid rgba(124,147,137,0.5); }
  .dot.none    { background: rgba(124,147,137,0.14); }

  .legend { display: flex; flex-wrap: wrap; gap: 1.2rem; margin-top: 1rem; font-family: var(--mono); font-size: 10px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 0.45rem; }

  /* The ascent. Eight layers, and they are an order, not a list. */
  .layers { display: flex; flex-direction: column-reverse; gap: 0.5rem; }
  .layer {
    display: grid; grid-template-columns: 2.2rem 1fr auto; align-items: center; gap: 1rem;
    width: 100%; text-align: left; cursor: pointer;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--card);
    padding: 0.85rem 1.1rem; color: inherit; font: inherit;
    transition: border-color 0.18s, background 0.18s, transform 0.18s;
  }
  .layer:hover, .layer:focus-visible { border-color: rgba(0,245,140,0.4); background: var(--raised); outline: none; transform: translateX(3px); }
  .layer[aria-expanded="true"] { border-color: rgba(0,245,140,0.5); }
  .layer .n { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .layer .name { font-weight: 600; letter-spacing: -0.01em; }
  .layer .promise { display: block; font-size: 12.5px; color: rgba(244,247,250,0.6); font-weight: 400; letter-spacing: 0; }
  .tag {
    font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase;
    padding: 0.28rem 0.7rem; border-radius: var(--pill); border: 1px solid; white-space: nowrap;
  }
  .tag.built   { color: var(--green);     border-color: rgba(0,245,140,0.35); }
  .tag.partial { color: var(--amber);     border-color: rgba(246,177,0,0.35); }
  .tag.planned { color: var(--muted);     border-color: rgba(124,147,137,0.3); }
  .detail {
    border-left: 1px solid var(--line); margin: 0.15rem 0 0.15rem 1.6rem; padding: 0.5rem 0 0.5rem 1.2rem;
    font-family: var(--mono); font-size: 11.5px; color: var(--muted);
  }
  .detail[hidden] { display: none; }
  .detail code { color: var(--turquoise); }

  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 0.75rem; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--card); padding: 1rem 1.1rem; }
  .card h3 { margin: 0; font-size: 15px; letter-spacing: -0.01em; }
  .card .q { color: var(--turquoise); font-size: 12.5px; margin: 0.15rem 0 0.6rem; }
  .card p { margin: 0; font-family: var(--mono); font-size: 11px; color: var(--muted); word-break: break-word; }
  .card .entry { color: rgba(244,247,250,0.55); margin-top: 0.35rem; }
  .ver { font-family: var(--mono); font-size: 10px; color: var(--muted); }

  footer { margin-top: 5rem; padding-top: 2rem; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
  footer a { color: var(--green); }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <p class="eyebrow">ABSuite · system map</p>
    <h1>The system, as it actually is.</h1>
    <p class="lede">
      Nothing on this page was drawn. Every box, status and count is parsed from the files the build
      already enforces — the constitution, the architecture, the generated route table, the package
      manifests. <strong>If the code and this page disagree, the build fails.</strong>
      A diagram nobody can check is a picture that misleads everyone who trusts it.
    </p>
    <div class="counts">
      <span class="count"><b>${LAYERS.filter(l => l.status === 'Built').length}</b> of ${LAYERS.length} layers built</span>
      <span class="count"><b>${OPERATIONS.length}</b> operations</span>
      <span class="count"><b>${PACKAGES.filter(p => p.published).length}</b> packages published</span>
      <span class="count"><b>${ROUTES}</b> documented routes</span>
    </div>
  </header>

  <section>
    <h2>Two axes, not two systems</h2>
    <p class="lede" style="margin-top:0">
      The seven <strong>operations</strong> are what the system does — seven verbs, each one a package you
      can run today. The eight <strong>layers</strong> are what it becomes — an ascent, where each rests on
      the one below. They are not two roadmaps to be added together. Every operation serves several
      layers, and this grid is where they meet: read a row to see how far a layer has been carried,
      read a column to see what one operation is holding up.
    </p>
    <div class="matrix-scroll">
      <table>
        <thead>
          <tr><th style="text-align:left;padding-left:1rem">Layer</th>${OPERATION_NAMES.map(name => `<th>${esc(name)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${LAYERS.map(layer => {
            const cells = GRID[layer.name] ?? [];
            return `<tr><th>${esc(layer.name)}</th>${OPERATION_NAMES.map((op, i) => {
              const tone = CELL_TONE[(cells[i] ?? '').trim()] ?? 'none';
              const says = tone === 'built' ? 'carried today' : tone === 'partial' ? 'partly carried' : tone === 'planned' ? 'planned' : 'not applicable';
              return `<td><span class="dot ${tone}" title="${esc(layer.name)} × ${esc(op)} — ${says}"></span></td>`;
            }).join('')}</tr>`;
          }).join('\n          ')}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <span><i class="dot built"></i> carried today</span>
      <span><i class="dot partial"></i> partly carried</span>
      <span><i class="dot planned"></i> planned</span>
      <span><i class="dot none"></i> not applicable</span>
    </div>
  </section>

  <section>
    <h2>The ascent — eight layers, bottom up</h2>
    <p class="lede" style="margin-top:0">
      Each one names the file that implements it, or admits it has none. Select a layer to see it.
    </p>
    <div class="layers">
      ${LAYERS.map(layer => `
      <div>
        <button class="layer" aria-expanded="false" aria-controls="layer-${layer.n}" onclick="toggle(this, 'layer-${layer.n}')">
          <span class="n">${layer.n}</span>
          <span>
            <span class="name">${esc(layer.name)}</span>
            <span class="promise">${esc(layer.promise)}</span>
          </span>
          <span class="tag ${STATUS_TONE[layer.status]}">${esc(layer.status)}</span>
        </button>
        <div class="detail" id="layer-${layer.n}" hidden>
          ${layer.evidence && layer.evidence !== '—'
            ? `implemented by <code>${esc(layer.evidence)}</code>`
            : 'No file claims this layer. It is on the roadmap and nothing pretends otherwise — <code>check:doctrine</code> fails the build if a layer marked not built starts claiming evidence.'}
        </div>
      </div>`).join('')}
    </div>
  </section>

  <section>
    <h2>The seven operations — what runs today</h2>
    <div class="grid2">
      ${OPERATIONS.map(op => `
      <article class="card">
        <h3>${op.n}. ${esc(op.name)}</h3>
        <p class="q">${esc(QUESTIONS[op.name] ?? '')}</p>
        <p>${esc(op.implementedBy)}</p>
        <p class="entry">${esc(op.entry)}</p>
      </article>`).join('')}
    </div>
  </section>

  <section>
    <h2>What ships</h2>
    <div class="grid2">
      ${PACKAGES.map(pkg => `
      <article class="card">
        <h3>${esc(pkg.name.replace('@absuitecore/', ''))} <span class="ver">v${esc(pkg.version)}${pkg.published ? '' : ' · not published'}</span></h3>
        <p style="color:rgba(244,247,250,0.65);font-family:var(--sans);font-size:13px">${esc(pkg.description)}</p>
      </article>`).join('')}
    </div>
  </section>

  <footer>
    <p>
      Generated from docs/CONSTITUTION.md, docs/ARCHITECTURE.md, docs/API.md and the package manifests by
      <code>scripts/gen-system-map.mjs</code>. <code>pnpm check:map</code> fails the build when this page
      and the repository disagree.
    </p>
    <p>Nothing may look more complete, more certain, or more authoritative than it actually is.</p>
  </footer>

</div>
<script>
  function toggle(button, id) {
    var open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    document.getElementById(id).hidden = open;
  }
</script>
</body>
</html>
`;

const target = join(root, 'docs/system.html');

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== page) {
    console.error('docs/system.html is out of date — the map and the repository disagree.');
    console.error('Run: pnpm docs:map');
    process.exit(1);
  }
  console.log(`✓ system map matches the repository — ${LAYERS.length} layers, ${OPERATIONS.length} operations, ${PACKAGES.length} packages, ${ROUTES} routes.`);
} else {
  writeFileSync(target, page);
  console.log(`Wrote docs/system.html — ${LAYERS.length} layers (${LAYERS.filter(l => l.status === 'Built').length} built), ${OPERATIONS.length} operations, ${PACKAGES.length} packages, ${ROUTES} routes.`);
}

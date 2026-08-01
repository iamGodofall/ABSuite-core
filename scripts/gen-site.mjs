#!/usr/bin/env node
/**
 * The public site, generated — and carrying its own evidence.
 *
 * The landing page used to live as a heredoc inside a GitHub Actions workflow.
 * That is why it never improved: nobody edits a 200-line HTML string nested in
 * YAML, nothing renders it in review, and no check can read it. It is a real
 * file now, generated from the repository like everything else here.
 *
 * What makes this page different from a product page is that it does not
 * describe the claim, it *performs* it. Three records signed in January and
 * committed to `packages/capkit/src/fixtures/` are embedded here, along with the
 * public key that verifies them. On load, the visitor's own browser rebuilds
 * each record's canonical form, hashes it, walks the chain, and checks the
 * Ed25519 signatures. Nothing is asked of a server, because nothing needs to be:
 * the entire argument of this product is that verification requires no trust in
 * the party being audited, and a page that had to phone home to prove it would
 * be arguing against itself.
 *
 * The cube's core is bound to the result — dark before the check, turquoise
 * while it runs, green only once the browser has actually verified, red the
 * moment anyone tampers. That is the same rule the operations room lives by:
 * the centre always shows the strongest claim the system can presently defend.
 *
 *   node scripts/gen-site.mjs           # write docs/index.html
 *   node scripts/gen-site.mjs --check   # fail if it is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/*
 * Real records, never regenerated.
 *
 * These are the frozen fixture the test suite verifies on every run — signed
 * once, committed, and guarded by frozen-chain.test.ts so that a change to the
 * canonical form fails the build rather than silently invalidating them. Using
 * them here means the page and the test suite are checking the same bytes.
 */
const fixture = JSON.parse(read('packages/capkit/src/fixtures/frozen-chain-v2.json'));

const constitution = read('docs/CONSTITUTION.md');
const built = [...constitution.matchAll(/^\|\s*\d\s*\|\s*\*\*[^*]+\*\*\s*\|[^|]+\|\s*(Built|Partly built|Not built)\s*\|/gm)]
  .filter(m => m[1] === 'Built').length;

const packages = JSON.parse(read('packages/capkit/package.json'));

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ABSuite — prove what your AI actually did</title>
<meta name="description" content="Ed25519-signed, hash-chained execution traces for AI agents. This page carries three real signed records and verifies them in your browser — no install, no account, no server.">
<meta name="color-scheme" content="dark">
<meta property="og:title" content="ABSuite — prove what your AI actually did">
<meta property="og:description" content="Record what happened. Prove it happened. Preserve the evidence. Verified in your browser, on this page, right now.">
<style>
  :root {
    --ground:#000000; --panel:#020805; --raised:#04120B;
    --line:rgba(0,245,140,0.15); --line-soft:rgba(0,245,140,0.06);
    --white:#F4F7FA; --muted:#7C9389;
    --green:#00F58C; --turquoise:#2DD4BF; --amber:#F6B100; --red:#DC2626;
    --mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;
    --sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    /* One shape language, matching the operations room: capsules for anything
       operated, a generous finite corner for anything read inside. */
    --pill:9999px; --card:20px; --panel-radius:28px;
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  body {
    margin:0; background:var(--ground); color:var(--white);
    font:16px/1.65 var(--sans); -webkit-font-smoothing:antialiased;
    background-image:
      radial-gradient(900px 520px at 12% -10%, rgba(0,245,140,0.07), transparent 62%),
      radial-gradient(700px 420px at 92% 4%, rgba(45,212,191,0.05), transparent 58%),
      linear-gradient(var(--line-soft) 1px, transparent 1px),
      linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
    background-size:auto,auto,48px 48px,48px 48px;
    background-attachment:fixed;
  }
  main { max-width:64rem; margin:0 auto; padding:2.5rem 1.25rem 6rem; }

  /* ── masthead ─────────────────────────────────────────────────────────── */
  .mast { display:flex; align-items:center; gap:.85rem; flex-wrap:wrap; margin-bottom:4.5rem; }
  .glyph {
    width:42px; height:42px; flex:none; display:grid; place-items:center;
    border:1.5px solid var(--green); border-radius:14px;
    box-shadow:inset 0 0 22px rgba(0,245,140,0.18), 0 0 18px rgba(0,245,140,0.16);
  }
  .glyph svg { width:22px; height:22px; stroke:var(--green); fill:none; stroke-width:1.6; }
  .brand { font-weight:700; font-size:1.25rem; line-height:1; letter-spacing:-.01em; }
  .brand small {
    display:block; font:600 .6rem/1 var(--mono); letter-spacing:.2em;
    color:var(--green); text-transform:uppercase; margin-top:.36rem;
  }
  .chip {
    display:inline-flex; align-items:center; gap:.5rem; white-space:nowrap;
    font:.62rem/1 var(--mono); letter-spacing:.16em; text-transform:uppercase; color:var(--muted);
    border:1px solid var(--line); border-radius:var(--pill); padding:.45rem .9rem; background:var(--panel);
  }
  .chip.right { margin-left:auto; }

  h1 {
    font-size:clamp(2.3rem,6.6vw,4.1rem); line-height:.98; letter-spacing:-.035em;
    margin:0 0 1.3rem; font-weight:800; text-wrap:balance;
  }
  h1 em { font-style:normal; color:var(--green); }
  .lede { font-size:1.2rem; margin:0 0 .7rem; max-width:38rem; }
  .sub { color:var(--muted); max-width:42rem; margin:0 0 2rem; }

  /* ── the proof ────────────────────────────────────────────────────────── */
  .proof {
    display:grid; gap:1.5rem; align-items:center;
    grid-template-columns:1fr; margin:0 0 1rem;
    border:1px solid var(--line); border-radius:var(--panel-radius);
    background:var(--panel); padding:1.75rem;
    box-shadow:0 8px 44px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05);
  }
  @media (min-width:820px) { .proof { grid-template-columns:280px 1fr; gap:2.25rem; padding:2.25rem; } }

  .cube { width:100%; max-width:250px; margin:0 auto; display:block; }
  .cube .edge { stroke:var(--muted); stroke-width:1.4; fill:none; opacity:.45; transition:stroke .6s, opacity .6s; }
  .cube .inner { stroke:var(--muted); stroke-width:1; fill:none; opacity:.28; transition:stroke .6s, opacity .6s; }
  .cube .core { transition:fill .6s, opacity .6s; }
  .cube .halo { transition:opacity .6s, fill .6s; filter:blur(20px); }

  /* The core carries the state, and nothing else changes colour — the same rule
     the operations room follows. A dark core is an honest empty instance. */
  [data-state="idle"]    .core { fill:#0A1712; } [data-state="idle"]    .halo { fill:#0A1712; opacity:0; }
  [data-state="working"] .core { fill:var(--turquoise); } [data-state="working"] .halo { fill:var(--turquoise); opacity:.5; }
  [data-state="ok"]      .core { fill:var(--green); } [data-state="ok"] .halo { fill:var(--green); opacity:1; }
  [data-state="failed"]  .core { fill:var(--red); } [data-state="failed"] .halo { fill:var(--red); opacity:.85; }
  [data-state="unknown"] .core { fill:var(--amber); } [data-state="unknown"] .halo { fill:var(--amber); opacity:.5; }
  [data-state="ok"] .edge, [data-state="ok"] .inner { stroke:var(--green); opacity:.7; }
  [data-state="failed"] .edge, [data-state="failed"] .inner { stroke:var(--red); opacity:.6; }
  [data-state="working"] .halo { animation:breathe 1.6s ease-in-out infinite; }
  @keyframes breathe { 0%,100% { opacity:.25; } 50% { opacity:.6; } }
  @media (prefers-reduced-motion:reduce) { [data-state="working"] .halo { animation:none; } }

  .verdict { font:700 1.45rem/1.2 var(--sans); letter-spacing:-.02em; margin:0 0 .45rem; }
  [data-state="idle"]    .verdict { color:var(--muted); }
  [data-state="working"] .verdict { color:var(--turquoise); }
  [data-state="ok"]      .verdict { color:var(--green); }
  [data-state="failed"]  .verdict { color:var(--red); }
  [data-state="unknown"] .verdict { color:var(--amber); }
  .verdict-sub { color:var(--muted); font-size:.94rem; margin:0 0 1.1rem; max-width:34rem; }

  ol.checks { list-style:none; margin:0 0 1.25rem; padding:0; display:grid; gap:.45rem; }
  ol.checks li {
    display:flex; align-items:flex-start; gap:.65rem;
    font:12px/1.5 var(--mono); color:var(--muted);
  }
  ol.checks .mark { flex:none; width:1.1rem; text-align:center; color:var(--muted); }
  ol.checks li[data-pass="true"]  .mark { color:var(--green); }
  ol.checks li[data-pass="false"] .mark { color:var(--red); }
  ol.checks li[data-pass="skip"]  .mark { color:var(--amber); }
  ol.checks b { color:var(--white); font-weight:500; }

  .controls { display:flex; gap:.6rem; flex-wrap:wrap; }
  button.act {
    font:600 .72rem/1 var(--mono); letter-spacing:.14em; text-transform:uppercase;
    padding:.75rem 1.25rem; border-radius:var(--pill); cursor:pointer;
    background:rgba(0,245,140,0.07); border:1px solid rgba(0,245,140,0.32); color:var(--green);
    transition:background .18s, border-color .18s;
  }
  button.act:hover { background:rgba(0,245,140,0.15); }
  button.act.danger { background:rgba(220,38,38,0.08); border-color:rgba(220,38,38,0.35); color:#F87171; }
  button.act.danger:hover { background:rgba(220,38,38,0.16); }
  button.act:focus-visible { outline:2px solid var(--turquoise); outline-offset:2px; }

  .aside { color:var(--muted); font-size:.85rem; margin:.9rem 0 3.5rem; max-width:44rem; }

  /* ── everything else ──────────────────────────────────────────────────── */
  .cta-row { display:flex; gap:.7rem; flex-wrap:wrap; margin:0 0 1rem; }
  a.cta, a.ghost {
    display:inline-block; padding:.9rem 1.6rem; border-radius:var(--pill);
    text-decoration:none; font-weight:700; font-size:.95rem;
  }
  a.cta { background:var(--green); color:#04120C; box-shadow:0 0 30px rgba(0,245,140,0.22); }
  a.cta:hover { background:#4BF0B4; }
  a.ghost { border:1px solid var(--line); color:var(--white); background:var(--panel); font-weight:600; }
  a.ghost:hover { border-color:var(--green); color:var(--green); }

  h2 {
    font:600 .68rem/1 var(--mono); letter-spacing:.2em; text-transform:uppercase;
    color:var(--muted); margin:4rem 0 1.1rem;
  }
  pre {
    background:var(--panel); border:1px solid var(--line); padding:1.15rem 1.3rem;
    border-radius:var(--card); overflow-x:auto; font:13px/1.75 var(--mono); color:var(--white);
  }
  pre .c { color:var(--green); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(215px,1fr)); gap:.8rem; }
  .card { border:1px solid var(--line); border-radius:var(--card); background:var(--panel); padding:1.2rem; }
  .card b {
    display:block; font:600 .61rem/1 var(--mono); letter-spacing:.16em;
    text-transform:uppercase; color:var(--green); margin-bottom:.55rem;
  }
  .card span { color:var(--muted); font-size:.89rem; line-height:1.55; }
  ul.links { list-style:none; padding:0; margin:0; display:grid; gap:.55rem; }
  ul.links a { color:var(--white); text-decoration:none; border-bottom:1px solid rgba(0,245,140,0.22); }
  ul.links a:hover { color:var(--green); border-bottom-color:var(--green); }
  ul.links span { color:var(--muted); }
  footer {
    margin-top:4.5rem; padding-top:1.8rem; border-top:1px solid var(--line);
    color:var(--muted); font-size:.85rem;
  }
  .creed { font:.66rem/1.8 var(--mono); letter-spacing:.16em; text-transform:uppercase; color:var(--green); margin-top:1.2rem; }
</style>
</head>
<body>
<main>

  <div class="mast">
    <span class="glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>
    </span>
    <span class="brand">ABSuite<small>AI Black Box Recorder</small></span>
    <span class="chip right">v${esc(packages.version)} · ${built} of 8 layers built</span>
  </div>

  <h1>Prove what your <em>AI actually did</em>.</h1>
  <p class="lede">Record what happened. Prove it happened. Preserve the evidence.</p>
  <p class="sub">
    Every action is Ed25519-signed and hash-chained, so anyone can check the record — including
    people with no reason to trust you. Payloads are hashed, never stored.
  </p>

  <!--
    The proof, performed rather than described.

    Three records signed in January and committed to the repository, embedded
    below with the public key that verifies them. Your browser does the work.
    Nothing is requested from a server, because a page that had to phone home to
    prove verification needs no trust would be arguing against itself.
  -->
  <section class="proof" id="proof" data-state="idle" aria-live="polite">
    <svg class="cube" viewBox="0 0 200 200" role="img" aria-label="Verification state">
      <!-- A blurred circle rather than a radial gradient. currentColor inside
           <defs> resolves against the defs context, not the element using it, so
           the gradient rendered as a grey smudge behind a green cube — the exact
           kind of defect that is invisible in the source and obvious on screen. -->
      <!-- A regular hexagon is exactly the silhouette of a cube seen corner-on. -->
      <circle class="halo" cx="100" cy="100" r="30" fill="#0A1712"/>
      <polygon class="edge" points="100,22 168,61 168,139 100,178 32,139 32,61"/>
      <path class="inner" d="M100,22 L100,100 M168,61 L100,100 M32,61 L100,100 M100,100 L100,178 M100,100 L168,139 M100,100 L32,139"/>
      <circle class="core" cx="100" cy="100" r="11" fill="#0A1712"/>
    </svg>

    <div>
      <p class="verdict" id="verdict">Ready to check</p>
      <p class="verdict-sub" id="verdict-sub">
        Three real signed records are on this page. Nothing has been checked yet, so the core is dark —
        an empty instance shows an empty core.
      </p>

      <ol class="checks" id="checks">
        <li data-pass="pending"><span class="mark">·</span><span><b>Content</b> — each record hashed and compared to its own recorded hash</span></li>
        <li data-pass="pending"><span class="mark">·</span><span><b>Chain</b> — every record links to the one before it</span></li>
        <li data-pass="pending"><span class="mark">·</span><span><b>Signature</b> — Ed25519, against a public key that cannot forge</span></li>
      </ol>

      <div class="controls">
        <button class="act" id="run" type="button">Verify in my browser</button>
        <button class="act danger" id="tamper" type="button" hidden>Alter one record</button>
        <button class="act" id="restore" type="button" hidden>Put it back</button>
      </div>
    </div>
  </section>

  <p class="aside">
    No install, no account, no server. Alter a record and the check names the exact sequence number that
    broke — which is the whole point: <em style="color:var(--white);font-style:normal">you are not being
    asked to believe this works.</em>
  </p>

  <div class="cta-row">
    <a class="cta" href="./verify.html">Verify your own trace &rarr;</a>
    <a class="ghost" href="./system.html">See the whole system</a>
    <a class="ghost" href="https://github.com/iamGodofall/ABSuite-core">Source on GitHub</a>
  </div>

  <h2>[ Sixty seconds ]</h2>
  <pre><span class="c">npm install</span> @absuitecore/capkit</pre>

  <h2>[ Questions it answers ]</h2>
  <div class="grid">
    <div class="card"><b>What happened</b><span>A signed, hash-chained trace of every real action.</span></div>
    <div class="card"><b>Who did it</b><span>An enrolled identity that proved it holds its own key — not a name someone typed.</span></div>
    <div class="card"><b>Was it allowed</b><span>Scope checked before execution, not after.</span></div>
    <div class="card"><b>What did it cost</b><span>Spend attributed to the agent that caused it, with coverage stated beside the total.</span></div>
    <div class="card"><b>Was it altered</b><span>Chain verification names the first broken record.</span></div>
    <div class="card"><b>Can you re-run it</b><span>Replay compares a re-run against the recorded hashes.</span></div>
  </div>

  <h2>[ A hash chain is not a signature ]</h2>
  <p style="color:var(--muted);max-width:44rem;margin:0">
    Hash-chaining proves a record was not edited afterwards. It does not prove
    <em style="color:var(--green);font-style:normal">who wrote it</em> — the operator being audited can
    build a perfectly valid chain containing anything they like. Ed25519 closes that gap: verification
    needs only the public key, and a public key cannot sign.
  </p>

  <h2>[ Read next ]</h2>
  <ul class="links">
    <li><a href="./system.html">The system map</a> <span>— every layer, operation and package, generated from the repository</span></li>
    <li><a href="./GETTING-STARTED.md">Getting started</a> <span>— library, HTTP API and Docker</span></li>
    <li><a href="./API.md">API reference</a> <span>— every route, generated from source</span></li>
    <li><a href="./openapi.yaml">OpenAPI spec</a> <span>— import it into your client</span></li>
    <li><a href="./ARCHITECTURE.md">Architecture</a> <span>— how the pieces fit together</span></li>
    <li><a href="./PRINCIPLES.md">Principles</a> <span>— what this project refuses to build</span></li>
    <li><a href="./SECURITY-MODEL.md">Security model</a> <span>— threat model and defence in depth</span></li>
    <li><a href="https://www.npmjs.com/org/absuitecore">Packages on npm</a> <span>— all seven, with provenance</span></li>
  </ul>

  <footer>
    <p>Evidence over opinion · verification over confidence · facts over scores · confidence never determines truth.</p>
    <p class="creed">Nothing may look more complete, more certain, or more authoritative than it actually is.</p>
  </footer>

</main>

<script id="evidence" type="application/json">${JSON.stringify(fixture)}</script>
<script>
(function () {
  'use strict';

  var evidence = JSON.parse(document.getElementById('evidence').textContent);
  var pristine = JSON.stringify(evidence.records);
  var records = JSON.parse(pristine);

  var proof   = document.getElementById('proof');
  var verdict = document.getElementById('verdict');
  var sub     = document.getElementById('verdict-sub');
  var items   = document.getElementById('checks').children;
  var runBtn  = document.getElementById('run');
  var tampBtn = document.getElementById('tamper');
  var restBtn = document.getElementById('restore');

  var GENESIS = '0'.repeat(64);

  function mark(i, pass, text) {
    items[i].setAttribute('data-pass', String(pass));
    items[i].querySelector('.mark').textContent = pass === true ? '✓' : pass === false ? '✗' : pass === 'skip' ? '!' : '·';
    if (text) items[i].querySelector('span:last-child').innerHTML = text;
  }

  /* The canonical form, reimplemented in the browser exactly as capkit writes
     it. If these ever disagree the page reports a failure it should not — which
     is why frozen-chain.test.ts guards the same bytes on every build. */
  function canonical(t) {
    var steps = (t.steps || []).map(function (s) { return [s.seq, s.name, s.at, s.detail == null ? null : s.detail]; });
    var gov = t.governance
      ? [t.governance.policyRef, t.governance.policyVersion, t.governance.decision,
         (t.governance.evidence || []).slice(), t.governance.evaluatedBy == null ? null : t.governance.evaluatedBy]
      : null;

    if ((t.canonicalVersion || 1) === 1) {
      var v1 = [t.id, t.tenantId == null ? null : t.tenantId, t.subject, t.jti == null ? null : t.jti,
        (t.scope || []).slice().sort(), t.module, t.action, t.inputHash,
        t.outputHash == null ? null : t.outputHash, t.outcome, t.error == null ? null : t.error,
        t.startedAt, t.completedAt == null ? null : t.completedAt,
        t.durationMs == null ? null : t.durationMs, steps, t.prevHash];
      if (gov) v1.push(gov);
      return JSON.stringify(v1);
    }

    var cost = t.cost
      ? [t.cost.amount, t.cost.currency, t.cost.source,
         t.cost.unit == null ? null : t.cost.unit, t.cost.quantity == null ? null : t.cost.quantity]
      : null;
    return JSON.stringify([2, t.id, t.tenantId == null ? null : t.tenantId, t.subject,
      t.jti == null ? null : t.jti, (t.scope || []).slice().sort(), t.module, t.action, t.inputHash,
      t.outputHash == null ? null : t.outputHash, t.outcome, t.error == null ? null : t.error,
      t.startedAt, t.completedAt == null ? null : t.completedAt,
      t.durationMs == null ? null : t.durationMs, steps, t.prevHash, gov, cost]);
  }

  function sha256Hex(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function pemToBytes(pem) {
    var body = pem.replace(/-----[^-]+-----/g, '').replace(/\\s+/g, '');
    var raw = atob(body);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function b64ToBytes(b64) {
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function state(name) { proof.setAttribute('data-state', name); }

  function run() {
    state('working');
    verdict.textContent = 'Checking…';
    sub.textContent = 'Your browser is rebuilding each record, hashing it, and walking the chain.';
    for (var i = 0; i < 3; i++) mark(i, 'pending');

    var contentOk = true, chainOk = true, brokenAt = null, expectedPrev = GENESIS;

    var work = records.reduce(function (chain, rec, index) {
      return chain.then(function () {
        if (rec.prevHash !== expectedPrev && chainOk) { chainOk = false; brokenAt = index + 1; }
        expectedPrev = rec.hash;
        return sha256Hex(canonical(rec)).then(function (hash) {
          if (hash !== rec.hash && contentOk) { contentOk = false; if (brokenAt === null) brokenAt = index + 1; }
        });
      });
    }, Promise.resolve());

    work.then(function () {
      mark(0, contentOk, contentOk
        ? '<b>Content</b> — all ' + records.length + ' records hash to exactly what was recorded'
        : '<b>Content</b> — record ' + brokenAt + ' does not match its own hash');
      mark(1, chainOk, chainOk
        ? '<b>Chain</b> — every record links to the one before it'
        : '<b>Chain</b> — the link breaks at record ' + brokenAt);

      // Once the content does not match its own hash, the signature says nothing
      // about the content — it was only ever over the hash. capkit returns
      // signatureValid: null in exactly this case rather than reporting a pass,
      // and a page that showed a green tick next to a broken record would be
      // making the claim the library refuses to make.
      if (!contentOk) {
        mark(2, 'skip', '<b>Signature</b> — not checked. It signs the hash, and the hash no longer describes the content, so verifying it would prove nothing.');
        finish(contentOk, chainOk, null, brokenAt);
        return;
      }

      // Ed25519 in WebCrypto is recent. Where it is missing the page says so
      // rather than quietly reporting two checks as three — an unchecked claim
      // must never read like a checked one.
      return crypto.subtle.importKey('spki', pemToBytes(evidence.publicKeyPem), { name: 'Ed25519' }, false, ['verify'])
        .then(function (key) {
          return records.reduce(function (chain, rec) {
            return chain.then(function (allOk) {
              if (!rec.signature) return false;
              return crypto.subtle.verify({ name: 'Ed25519' }, key,
                b64ToBytes(rec.signature), new TextEncoder().encode(rec.hash))
                .then(function (ok) { return allOk && ok; });
            });
          }, Promise.resolve(true));
        })
        .then(function (sigOk) {
          mark(2, sigOk, sigOk
            ? '<b>Signature</b> — Ed25519 verified against a key that cannot forge'
            : '<b>Signature</b> — does not verify against the published key');
          finish(contentOk, chainOk, sigOk, brokenAt);
        })
        .catch(function () {
          mark(2, 'skip', '<b>Signature</b> — this browser has no Ed25519 in WebCrypto, so it was not checked. Not a failure: an unknown.');
          finish(contentOk, chainOk, null, brokenAt);
        });
    });
  }

  function finish(contentOk, chainOk, sigOk, brokenAt) {
    tampBtn.hidden = false;
    if (!contentOk || !chainOk || sigOk === false) {
      state('failed');
      verdict.textContent = 'FAILED';
      sub.innerHTML = 'The record at sequence <b>' + brokenAt + '</b> does not hold. Nothing was hidden and nothing was ' +
        'guessed — your browser found it, and it names exactly which one.';
      return;
    }
    if (sigOk === null) {
      state('unknown');
      verdict.textContent = 'UNKNOWN';
      sub.innerHTML = 'The content and the chain hold. The signature could not be checked here, so this is ' +
        '<b>not</b> a pass — it is an honest unknown, and the core shows amber for exactly that reason.';
      return;
    }
    state('ok');
    verdict.textContent = 'DEMONSTRATED';
    sub.innerHTML = 'Checked in your browser, against a public key that cannot forge. ' +
      'Nothing was asked of any server — that is the whole claim, and you just tested it.';
  }

  runBtn.addEventListener('click', run);

  tampBtn.addEventListener('click', function () {
    // One field, on the middle record — the smallest possible change, which is
    // the one an auditor most needs to be caught.
    records = JSON.parse(pristine);
    records[1].subject = 'agent:someone-else';
    tampBtn.hidden = true;
    restBtn.hidden = false;
    run();
  });

  restBtn.addEventListener('click', function () {
    records = JSON.parse(pristine);
    restBtn.hidden = true;
    run();
  });
})();
</script>
</body>
</html>
`;

const target = join(root, 'docs/index.html');

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== page) {
    console.error('docs/index.html is out of date. Run: pnpm docs:site');
    process.exit(1);
  }
  console.log(`✓ site matches the repository — ${fixture.records.length} embedded records, ${built} of 8 layers built.`);
} else {
  writeFileSync(target, page);
  console.log(`Wrote docs/index.html — ${fixture.records.length} real signed records embedded, verified in the visitor's browser.`);
}

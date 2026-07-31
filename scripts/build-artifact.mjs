#!/usr/bin/env node
/**
 * The room as one file, for looking at without running anything.
 *
 * Vite's artifact build emits an index.html that references a script and a
 * stylesheet by path. A published artifact has no server to serve those paths,
 * so both have to be folded into the document itself.
 *
 * This existed once as a throwaway in a scratch directory, which is why it had
 * to be rewritten to republish. It lives in the repository now.
 *
 * ── The bug this file is shaped around ──────────────────────────────────────
 *
 * The first version passed the bundle to String.replace as a replacement
 * *string*. `$&`, `` $` `` and `$'` are substitution patterns there, and a
 * 1.4MB minified bundle contains all of them by chance — so the replacement
 * spliced fragments of the surrounding HTML into the middle of the JavaScript,
 * three times, and the page died with a syntax error in a build that reported
 * success. Passing a function instead makes the argument opaque, which is the
 * only reliable way to inline anything that is not known in advance.
 *
 * The publishing wrapper supplies <!doctype>, <html>, <head> and <body>, so
 * what is written here is the page content on its own.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'packages/dashboard-ui/dist-artifact');
const assets = join(build, 'assets');

const files = readdirSync(assets);
const jsName = files.find(f => f.endsWith('.js'));
const cssName = files.find(f => f.endsWith('.css'));

if (!jsName) {
  console.error('No bundle in dist-artifact/assets. Run the artifact build first:\n' +
    '  pnpm --filter @absuitecore/dashboard-ui exec vite build --config vite.artifact.config.ts');
  process.exit(1);
}

const js = readFileSync(join(assets, jsName), 'utf8');
const css = cssName ? readFileSync(join(assets, cssName), 'utf8') : '';

/*
 * `</script>` inside the bundle would close the tag early. It cannot appear in
 * valid JavaScript outside a string, and inside one it is escaped harmlessly.
 */
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const page = [
  '<title>ABSuite — Trust Operations Center</title>',
  css ? `<style>${css}</style>` : '',
  '<div id="root"></div>',
  // A module script, matching how the bundle was compiled.
  `<script type="module">${safeJs}</script>`,
].filter(Boolean).join('\n');

/*
 * Nothing may still point at a path that will 404.
 *
 * A dangling /assets reference is the failure this whole file exists to avoid,
 * and it is silent — the page loads and one thing is simply missing.
 */
const dangling = [...page.matchAll(/(?:src|href)\s*=\s*["']\/assets\/[^"']+["']/g)];
if (dangling.length > 0) {
  console.error(`${dangling.length} unresolved asset reference(s) remain:`);
  for (const match of dangling) console.error('  ' + match[0]);
  process.exit(1);
}

const out = join(root, 'packages/dashboard-ui/dist-artifact/artifact.html');
writeFileSync(out, page);

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
console.log(`Wrote ${out.replace(root + '/', '')}`);
console.log(`  script ${jsName}  ${mb(js.length)}`);
console.log(`  style  ${cssName ?? '(none)'}  ${mb(css.length)}`);
console.log(`  page   ${mb(page.length)}, no unresolved asset references`);

#!/usr/bin/env node
/**
 * Every path the dashboard UI fetches must exist on the dashboard server.
 *
 * This is the check that would have caught the Proof tab, which called four
 * endpoints nobody had implemented. Express serves the single-page app from a
 * catch-all, so a missing API route does not 404 — it returns `<!DOCTYPE html>`,
 * the client's `res.json()` throws a SyntaxError, and the user is told their
 * input is malformed. The failure points away from its own cause, which is
 * exactly why it survived being written, reviewed and shipped.
 *
 * Static analysis, so it runs in CI without booting anything.
 *
 *   node scripts/check-dashboard-routes.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = join(root, 'packages/dashboard-ui/src');
const serverFile = join(root, 'packages/dashboard-ui/server.ts');

/** Every .ts/.tsx under the UI source tree. */
function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

const ui = sources(uiDir).map(f => readFileSync(f, 'utf8')).join('\n');
const server = readFileSync(serverFile, 'utf8');

/**
 * The verb the call uses, read from the options object that follows the URL.
 *
 * Express registers a handler per method, so `app.get('/executions')` does not
 * answer a POST to the same path — the request falls through to the SPA
 * catch-all and returns index.html, which is the exact failure this file was
 * written to catch. Matching on the path alone therefore passed the one case it
 * most needed to fail: `POST /executions` existed in capkit, was called from
 * the browser, and had no route on the dashboard server at all.
 *
 * The options object is read from the source that follows the URL literal,
 * stopping at the next `fetch(` so one call's verb cannot be attributed to the
 * next. A call whose options are held in a variable has no readable verb; those
 * are treated as GET, which is what `fetch` itself defaults to.
 */
const verbOf = (text, index) => {
  const window = text.slice(index, index + 600);
  const nextCall = window.indexOf('fetch(', 6);
  const scope = nextCall === -1 ? window : window.slice(0, nextCall);
  const method = scope.match(/\bmethod\s*:\s*['"`](\w+)['"`]/);
  return (method ? method[1] : 'GET').toUpperCase();
};

// Paths the client asks for. A `${...}` hole becomes one wildcard segment.
const calls = new Map();
for (const m of ui.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)) {
  const raw = m[1];
  if (!raw.startsWith('/')) continue;
  const path = raw.replace(/\$\{[^}]*\}/g, 'WILDCARD').split('?')[0].replace(/\/$/, '');
  const verb = verbOf(ui, m.index);
  const key = `${verb} ${path}`;
  if (!calls.has(key)) calls.set(key, { verb, path, raw });
}

// Routes the server declares, each with the verb it answers.
const routes = [...server.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)]
  .map(m => ({ verb: m[1].toUpperCase(), path: m[2] }));

const matches = (call, route) => {
  const pattern = route
    .split('/')
    .map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}$`).test(call);
};

const missing = [...calls.values()].filter(
  call => !routes.some(route => route.verb === call.verb && matches(call.path, route.path)),
);

console.log(`dashboard: ${calls.size} client calls, ${routes.length} server routes`);

if (missing.length > 0) {
  console.error(`\n${missing.length} client call(s) have no matching server route:\n`);
  for (const call of missing) {
    const samePath = routes.filter(route => matches(call.path, route.path)).map(route => route.verb);
    const note = samePath.length > 0 ? ` (the server answers ${samePath.join(', ')} on this path, not ${call.verb})` : '';
    console.error(`  x ${call.verb} ${call.raw}${note}`);
  }
  console.error(
    '\nThe SPA catch-all serves index.html for these, so the client receives HTML' +
    '\nwhere it expects JSON and reports a parse error that blames the user.\n'
  );
  process.exit(1);
}

console.log('every client call has a server route, on the verb it uses.');

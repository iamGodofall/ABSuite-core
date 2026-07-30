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

// Paths the client asks for. A `${...}` hole becomes one wildcard segment.
const calls = new Map();
for (const m of ui.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)) {
  const raw = m[1];
  if (!raw.startsWith('/')) continue;
  const path = raw.replace(/\$\{[^}]*\}/g, 'WILDCARD').split('?')[0].replace(/\/$/, '');
  if (!calls.has(path)) calls.set(path, raw);
}

// Routes the server declares.
const routes = [...server.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map(m => m[2]);

const matches = (call, route) => {
  const pattern = route
    .split('/')
    .map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}$`).test(call);
};

const missing = [...calls].filter(([call]) => !routes.some(r => matches(call, r)));

console.log(`dashboard: ${calls.size} client calls, ${routes.length} server routes`);

if (missing.length > 0) {
  console.error(`\n${missing.length} client call(s) have no matching server route:\n`);
  for (const [, raw] of missing) console.error(`  x ${raw}`);
  console.error(
    '\nThe SPA catch-all serves index.html for these, so the client receives HTML' +
    '\nwhere it expects JSON and reports a parse error that blames the user.\n'
  );
  process.exit(1);
}

console.log('every client call has a server route.');

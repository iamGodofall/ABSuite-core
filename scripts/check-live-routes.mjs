#!/usr/bin/env node
/**
 * Every documented route must actually answer.
 *
 * `docs:check` proves the document matches the source. It cannot prove the
 * route works — a handler that throws on load, a service that never registers
 * it, or a path that only exists in a comment all pass a text comparison.
 *
 * This asks the running suite. A 4xx counts as reachable: an auth or validation
 * failure is a real answer from a real handler. Only a connection failure or a
 * 5xx means the route is not there.
 *
 *   node scripts/check-live-routes.mjs                  # all services
 *   node scripts/check-live-routes.mjs --service trust
 *
 * Exits non-zero if anything documented cannot be reached.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(root, 'docs/API.md'), 'utf8');
const adminKey = process.env.CAPKIT_ADMIN_KEY || process.env.ABSUITE_ADMIN_API_KEY || '';

const only = process.argv.includes('--service')
  ? process.argv[process.argv.indexOf('--service') + 1]
  : null;

// Section headings carry the port: "## Trust — `:8085`"
const sections = [...doc.matchAll(/^## ([^\n—]+?)\s+—\s+`:(\d+)`$/gm)].map(m => ({
  name: m[1].trim(),
  port: Number(m[2]),
  start: m.index,
}));

for (const [i, s] of sections.entries()) {
  s.body = doc.slice(s.start, sections[i + 1]?.start ?? doc.length);
}

let checked = 0;
const dead = [];

for (const section of sections) {
  if (only && section.name.toLowerCase() !== only.toLowerCase()) continue;

  // GET routes with no path parameter — those need a real id to be meaningful.
  const routes = [...section.body.matchAll(/^\| GET \| `(\/[^`]*)`/gm)]
    .map(m => m[1])
    .filter(p => !p.includes(':'));

  for (const path of routes) {
    checked += 1;
    const url = `http://127.0.0.1:${section.port}${path}`;
    try {
      const res = await fetch(url, {
        headers: adminKey ? { 'x-absuite-admin-key': adminKey } : {},
        signal: AbortSignal.timeout(5000),
      });
      // 4xx is a real handler refusing; 5xx or nothing is not.
      if (res.status >= 500) dead.push(`${section.name}${path} -> ${res.status}`);
    } catch (error) {
      dead.push(`${section.name}${path} -> ${error.name}`);
    }
  }
}

console.log(`checked ${checked} documented GET routes`);

if (dead.length > 0) {
  console.error(`\n${dead.length} documented route(s) did not answer:\n`);
  for (const d of dead) console.error(`  x ${d}`);
  console.error('\nStart the suite first, or the route is documented and not implemented.\n');
  process.exit(1);
}

console.log('every documented route answered.');

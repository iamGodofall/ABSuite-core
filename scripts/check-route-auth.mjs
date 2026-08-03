#!/usr/bin/env node
/**
 * Every dashboard route is either authenticated or deliberately public.
 *
 * ## Why this exists
 *
 * The dashboard is the most privileged process in a default deployment: it
 * holds `CAPKIT_ADMIN_KEY`, mounts the Docker socket, and can start and stop
 * services. Fifty routes, and twelve of them carried no `requireAdminAccess`.
 *
 * Twelve is not the finding. **The finding is that nobody had decided.** Some of
 * those twelve are correct and load-bearing — `/health` cannot carry credentials
 * or a platform declares the container dead, and `POST /executions/verify` being
 * open to a stranger is the entire product argument. Others were open because
 * nothing made anyone choose: `/service-health/:service` returned
 * `ABSUITE_DB_PATH` to anonymous callers, in a field the interface never read.
 *
 * `/endpoint-check` was the same accident, and it was an unauthenticated
 * localhost port scanner for however long it existed.
 *
 * ## What it requires
 *
 * Every `app.get|post|put|delete|patch` in `server.ts` must be one of:
 *
 *   - guarded by `requireAdminAccess`, or
 *   - annotated `// public-route: <reason>` on the line or in the comment block
 *     above it.
 *
 * The annotation does not make a route safe. It makes the decision explicit and
 * attributable, on the line, where the next person adding a route has to make it
 * too. That is the same mechanism as `outbound-ok:`, for the same reason: what
 * this repository keeps getting wrong is not analysis, it is *drift* — a thing
 * that was true once, was never restated, and quietly stopped being true.
 *
 * ## The reason most of them are public, stated once
 *
 * `requireAdminAccess` returns **503 when no admin key is configured**, which is
 * the default. So a route the interface needs on a fresh install cannot be
 * guarded without breaking the product for everyone who has not set a key. That
 * is a real constraint and it belongs in the annotation, not in someone's head.
 *
 *   node scripts/check-route-auth.mjs      # or: pnpm check:routeauth
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Both servers, because capkit is the more privileged of the two.
 *
 * The dashboard holds the admin key; capkit *is* the thing the admin key
 * commands — it mints tokens, holds the chain, and enrols identities. Checking
 * only the dashboard would have been checking the easier one.
 */
const FILES = ['packages/dashboard-ui/server.ts', 'packages/capkit/src/server.ts'];

/** A floor, because a check that inspects nothing reports success. */
const FLOOR = 80;

const ROUTE = /^app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/;
const ANNOTATION = /public-route:\s*\S/;
const GUARD = /requireAdminAccess|authorise\(|requireCapability|capabilityGuard/;

/** Is there a `public-route:` in the comment block directly above? */
function annotatedAbove(lines, index) {
  for (let i = index - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;
    if (!/^(\/\/|\/\*|\*)/.test(line)) return false;
    if (ANNOTATION.test(line)) return true;
  }
  return false;
}

const undecided = [];
let guarded = 0;
let declared = 0;
let total = 0;

for (const file of FILES) {
  const lines = readFileSync(join(root, file), 'utf8').split('\n');

  lines.forEach((line, index) => {
    const match = line.match(ROUTE);
    if (!match) return;
    total++;

    if (GUARD.test(line)) { guarded++; return; }
    if (ANNOTATION.test(line) || annotatedAbove(lines, index)) { declared++; return; }

    undecided.push({ file, method: match[1].toUpperCase(), path: match[2], line: index + 1 });
  });
}

/* ── Report ─────────────────────────────────────────────────────────────── */

console.log('\nAuthentication on dashboard routes\n');

if (total < FLOOR) {
  console.error(
    `\x1b[31m✗\x1b[0m found only ${total} route(s) across ${FILES.length} server(s), expected at least ${FLOOR}.\n` +
    '  The scan matched almost nothing, which is how a gate passes by checking nothing.'
  );
  process.exit(1);
}

if (undecided.length > 0) {
  console.error(`\x1b[31m✗\x1b[0m ${undecided.length} route(s) neither guarded nor declared public:\n`);
  for (const route of undecided) {
    console.error(`  ${route.file}:${route.line}`);
    console.error(`    ${route.method} ${route.path}\n`);
  }
  console.error(
    'Add `requireAdminAccess`, or say why it is public on the line above:\n' +
    '  // public-route: the interface polls this before an admin key exists\n\n' +
    'The annotation does not make a route safe. It makes somebody decide, which is\n' +
    'the step that did not happen for /endpoint-check.'
  );
  process.exit(1);
}

console.log(`\x1b[32m✓\x1b[0m ${guarded} guarded, ${declared} declared public with a reason, 0 undecided.`);
console.log(`  ${total} route(s) across ${FILES.join(', ')}.\n`);

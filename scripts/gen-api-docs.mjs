#!/usr/bin/env node
/**
 * Generate the API reference from the source.
 *
 * A hand-written API reference drifts the moment someone adds a route, and a
 * stale reference is worse than none — it is the first thing a developer reads
 * and the fastest way to lose their trust. This reads the actual route
 * registrations, so the document cannot disagree with the code.
 *
 *   node scripts/gen-api-docs.mjs           # rewrite docs/API.md
 *   node scripts/gen-api-docs.mjs --check   # fail if out of date (for CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const SERVICES = [
  { pkg: 'capkit', name: 'CapKit', port: 8081, blurb: 'Capability tokens, audit, verifiable execution, tenancy and billing.' },
  { pkg: 'edge-run', name: 'Edge-Run', port: 8082, blurb: 'Cron scheduling, task queue, retries and self-healing execution.' },
  { pkg: 'quickbench', name: 'QuickBench', port: 8083, blurb: 'LLM and HTTP benchmarking with statistical regression detection.' },
  { pkg: 'connector-starter', name: 'Connector-Starter', port: 8084, blurb: 'Connector registry, credential verification and scaffolding.' },
];

/**
 * Parse `app.<method>('<path>', <guards...>, handler)` registrations.
 *
 * Guards are matched by name rather than position, so reordering middleware or
 * adding one does not silently produce a wrong document.
 */
function extractRoutes(source) {
  const routes = [];
  const pattern = /app\.(get|post|delete|put|patch)\(\s*'([^']+)'\s*,?([\s\S]{0,220}?)(?:=>|function)/g;

  let match;
  while ((match = pattern.exec(source)) !== null) {
    const [, method, path, between] = match;

    const scope = between.match(/(?:authorise|requireCapability)\(\s*'([^']+)'\s*\)/)?.[1];
    const quota = between.match(/enforceQuota\(\s*'([^']+)'\s*\)/)?.[1];
    const adminOnly = /authorise\(\s*'tenant:manage'\s*\)/.test(between);

    routes.push({
      method: method.toUpperCase(),
      path,
      scope: scope ?? null,
      quota: quota ?? null,
      adminOnly,
    });
  }
  return routes;
}

/** Pull the JSDoc immediately above a route, when there is one. */
function describeRoute(source, method, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const at = source.search(new RegExp(`app\\.${method.toLowerCase()}\\(\\s*'${escaped}'`));
  if (at < 0) return null;

  const before = source.slice(Math.max(0, at - 700), at);
  const doc = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (!doc) return null;

  const text = doc[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trim())
    .filter(l => l && !l.startsWith('@'))
    .join(' ')
    .trim();

  return text.length > 8 ? text : null;
}

function render() {
  const lines = [
    '# ABSuite API Reference',
    '',
    '> **Generated from source** by `scripts/gen-api-docs.mjs`. Do not edit by hand —',
    '> run `pnpm docs:api` after changing a route. CI fails if this drifts.',
    '',
    '---',
    '',
    '## Authentication',
    '',
    'Three credential types, used for different purposes:',
    '',
    '| Header | Purpose |',
    '|---|---|',
    '| `Authorization: Bearer <token>` | A capability token carrying the required scope. |',
    '| `X-ABSuite-Admin-Key` | Bootstrap credential. Grants full authority — used to mint the first token and manage tenants. |',
    '| `X-ABSuite-Tenant-Key` | Identifies the billed tenant. Optional; omit for an unmetered self-hosted deployment. |',
    '',
    '**Scopes** are `resource:action`, matched segment-wise: `read:*` grants',
    '`read:users` but never `read:users:delete`. A bare `*` grants everything.',
    '',
    '**Enforcement is distributed.** Every service imports `capabilityGuard` from',
    '`@absuite/capkit`, so a request reaching a service directly is checked by the',
    'same code a gateway would have used. There is no unguarded door.',
    '',
    '---',
    '',
    '## Errors',
    '',
    'Every error has the same shape:',
    '',
    '```json',
    '{ "error": { "code": "CAPABILITY_INSUFFICIENT", "message": "Token missing required scope: queue:write" } }',
    '```',
    '',
    '| Status | Code | Meaning |',
    '|---|---|---|',
    '| 400 | `INVALID_REQUEST` | Malformed body or missing fields |',
    '| 401 | `TOKEN_MISSING` | No `Authorization` header |',
    '| 401 | `TOKEN_INVALID` | Signature verification failed |',
    '| 401 | `TOKEN_EXPIRED` | Past expiry |',
    '| 401 | `TOKEN_REVOKED` | Revoked at CapKit; applies across every service |',
    '| 401 | `TENANT_KEY_INVALID` | Tenant key supplied but not recognised |',
    '| 403 | `CAPABILITY_INSUFFICIENT` | Valid token, wrong scope |',
    '| 403 | `TENANT_SUSPENDED` | Account suspended — usually a failed payment |',
    '| 402 | `QUOTA_EXCEEDED` | Monthly plan limit reached |',
    '| 429 | `RATE_LIMITED` | Burst rate exceeded; see `Retry-After` |',
    '| 404 | `NOT_FOUND` | No such route or resource |',
    '| 503 | `REVOCATION_UNAVAILABLE` | Revocation store unreachable — fails closed, never open |',
    '',
    '---',
    '',
  ];

  let total = 0;

  for (const service of SERVICES) {
    const source = readFileSync(join(ROOT, `packages/${service.pkg}/src/server.ts`), 'utf8');
    const routes = extractRoutes(source);
    total += routes.length;

    lines.push(`## ${service.name} — \`:${service.port}\``, '', service.blurb, '');
    lines.push('| Method | Path | Required scope | Counts against |');
    lines.push('|---|---|---|---|');

    for (const route of routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) {
      const scope = route.scope ? `\`${route.scope}\`` : '_public_';
      const quota = route.quota ? `\`${route.quota}\`` : '—';
      lines.push(`| ${route.method} | \`${route.path}\` | ${scope} | ${quota} |`);
    }
    lines.push('');

    // Surface any route the author bothered to document in the source.
    const documented = routes
      .map(r => ({ ...r, doc: describeRoute(source, r.method, r.path) }))
      .filter(r => r.doc);

    if (documented.length) {
      lines.push('### Notes', '');
      for (const route of documented) {
        lines.push(`**\`${route.method} ${route.path}\`** — ${route.doc}`, '');
      }
    }
    lines.push('---', '');
  }

  lines.push(
    '## MCP server',
    '',
    '`@absuite/mcp` speaks Model Context Protocol over stdio rather than HTTP.',
    'Tool discovery is filtered by capability — an agent never sees a tool its',
    'token cannot call — and every completed call returns the signed trace that',
    'attests it. See [`packages/mcp/README.md`](../packages/mcp/README.md).',
    '',
    '---',
    '',
    `_${total} HTTP endpoints across ${SERVICES.length} services. Generated from source._`,
    ''
  );

  return lines.join('\n');
}

const output = render();
const target = join(ROOT, 'docs/API.md');

if (process.argv.includes('--check')) {
  const current = (() => { try { return readFileSync(target, 'utf8'); } catch { return ''; } })();
  if (current !== output) {
    console.error('docs/API.md is out of date. Run: pnpm docs:api');
    process.exit(1);
  }
  console.log('docs/API.md is up to date.');
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${target}`);
}

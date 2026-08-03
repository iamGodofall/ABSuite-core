import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { guardedFetch } from '@absuitecore/capkit';

const SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'trust', 'dashboard', 'absuite-db'] as const;
type ServiceName = typeof SERVICES[number];
type ServiceState = 'up' | 'down' | 'unknown' | 'starting' | 'stopping' | 'failed';

const app = express();
const server = createServer(app);
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.ABSUITE_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const adminApiKey = (process.env.ABSUITE_ADMIN_API_KEY || '').trim();

// Credential the dashboard presents to CapKit when acting on an operator's
// behalf. Separate from the key operators present to the dashboard, so the two
// can be rotated independently, but defaults to it for single-key deployments.
const capkitAdminKey = (process.env.CAPKIT_ADMIN_KEY || process.env.ABSUITE_ADMIN_API_KEY || '').trim();

const io = new Server(server, {
  /**
   * Detect a dead connection in seconds, not in most of a minute.
   *
   * Socket.io's defaults (25s ping interval, 20s timeout) mean a client can go
   * offline and keep asserting "Socket Connected" for up to 45 seconds. That
   * matters more here than in most products: the cube stops turning when the
   * socket drops, and the screen says stillness means nothing is being
   * observed. With the defaults that claim was false for the better part of a
   * minute — the interface insisting it was watching while it was not.
   *
   * 5s + 5s puts the worst case near ten seconds. The cost is a heartbeat every
   * five seconds per client, which for an operations console with few viewers
   * is a fair price for a claim that holds.
   */
  pingInterval: 5_000,
  pingTimeout: 5_000,
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) {
        const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
        return callback(null, !isProduction || isLocalOrigin);
      }

      return callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
  }
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss: http://localhost:* https:;");

  const origin = req.headers.origin;
  if (origin && (allowedOrigins.length === 0 ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) || !isProduction : allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ABSuite-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return next();
});

function createRateLimiter(windowMs: number, maxRequests: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path === '/health') {
      return next();
    }

    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= maxRequests) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000).toString());
      return res.status(429).json({ error: 'Too many requests', message: 'Please slow down and try again shortly.' });
    }

    current.count += 1;
    hits.set(key, current);
    return next();
  };
}

function requireAdminAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!adminApiKey) {
    return res.status(503).json({
      error: 'Service management is disabled',
      message: 'Configure ABSUITE_ADMIN_API_KEY to enable logs and service control in hardened production mode.'
    });
  }

  const providedKey = (req.header('x-absuite-admin-key') || '').trim();
  if (!providedKey || providedKey !== adminApiKey) {
    return res.status(403).json({
      error: 'Admin access required',
      message: 'This operation requires a valid ABSuite admin API key.'
    });
  }

  return next();
}

app.use(createRateLimiter(60_000, 180));

/**
 * A password on the whole surface, for an instance with a public address.
 *
 * The bind warning at the bottom of this file says to put an authenticating
 * proxy in front before exposing this process, because it holds the key that
 * mints capability tokens and it can control services. On a platform that
 * terminates TLS and routes straight to the container there is no proxy to put
 * anything in — so the advice, followed literally, means "do not deploy", and
 * what actually happens instead is that someone deploys it anyway.
 *
 * This is the smallest thing that makes the advice followable. Set
 * ABSUITE_PUBLIC_PASSWORD and every route, including the static bundle, needs
 * it. Leave it unset and nothing changes, which keeps `pnpm room` and the
 * compose file exactly as they were — both bind loopback, where a password
 * protects against nobody.
 *
 * Basic auth is chosen for being the only scheme a browser will prompt for
 * without a login page to maintain. It is not an identity system and does not
 * pretend to be one: it gates a demonstration instance, and the moment this
 * holds records that matter it should be replaced by the real thing.
 */
const publicPassword = (process.env.ABSUITE_PUBLIC_PASSWORD || '').trim();
if (publicPassword) {
  const expected = Buffer.from(`absuite:${publicPassword}`).toString('base64');
  app.use((req, res, next) => {
    // The health endpoint stays open: platform health checks cannot carry
    // credentials, and a gated one makes the host declare the container dead.
    if (req.path === '/health') return next();

    const header = req.header('authorization') || '';
    const provided = header.startsWith('Basic ') ? header.slice(6) : '';
    // Length is compared first because timingSafeEqual throws on a mismatch,
    // and the comparison is constant-time so a wrong password leaks nothing
    // about how much of it was right.
    const ok =
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!ok) {
      res.set('WWW-Authenticate', 'Basic realm="ABSuite", charset="UTF-8"');
      return res.status(401).send('Authentication required.');
    }
    return next();
  });
}

app.use(express.static('dist'));
app.use(express.json({ limit: '256kb' }));

const composeFileCandidates = [
  path.resolve(process.cwd(), 'docker-compose.yml'),
  path.resolve(process.cwd(), '..', 'docker-compose.yml'),
  path.resolve(process.cwd(), '..', '..', 'docker-compose.yml'),
];

const composeFilePath = composeFileCandidates.find(candidate => fs.existsSync(candidate));
const inDocker = fs.existsSync('/.dockerenv');

const SERVICE_BASE_URLS: Record<Exclude<ServiceName, 'absuite-db'>, string> = {
  capkit: process.env.CAPKIT_URL || (inDocker ? 'http://capkit:8081' : 'http://localhost:8081'),
  'edge-run': process.env.EDGE_RUN_URL || (inDocker ? 'http://edge-run:8082' : 'http://localhost:8082'),
  quickbench: process.env.QUICKBENCH_URL || (inDocker ? 'http://quickbench:8083' : 'http://localhost:8083'),
  'connector-starter': process.env.CONNECTOR_STARTER_URL || (inDocker ? 'http://connector-starter:8084' : 'http://localhost:8084'),
  'trust': process.env.TRUST_URL || (inDocker ? 'http://trust:8085' : 'http://localhost:8085'),
  dashboard: process.env.DASHBOARD_URL || (inDocker ? 'http://dashboard:3001' : 'http://localhost:3001'),
};

type ComposePsContainer = {
  Service?: string;
  Name?: string;
  State?: string;
  Health?: string;
  Status?: string;
};

function runComposeCommand(args: string): string {
  const composePrefix = composeFilePath
    ? `-p absuite-core -f "${composeFilePath}"`
    : '-p absuite-core';

  return execSync(`docker compose ${composePrefix} ${args}`, {
    stdio: 'pipe',
    encoding: 'utf8'
  });
}

function parseComposePsOutput(raw: string): ComposePsContainer[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed as ComposePsContainer[] : [];
  }

  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as ComposePsContainer];
      } catch {
        return [];
      }
    });
}

function inferLogLevel(line: string): 'info' | 'warn' | 'error' {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('refused')) return 'error';
  if (lower.includes('warn') || lower.includes('starting') || lower.includes('unknown')) return 'warn';
  return 'info';
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(index, 0)]!);
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

/**
 * The only hosts `/endpoint-check` will contact — the suite's own services.
 *
 * A list, rather than a range rule, because this route exists to answer *is my
 * own service answering?* and nothing else is a legitimate target for it.
 */
const HEALTH_HOSTS = [
  'localhost', '127.0.0.1',
  'capkit', 'edge-run', 'quickbench', 'connector-starter', 'trust', 'dashboard',
];

function isAllowedHealthUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ['http:', 'https:'].includes(parsed.protocol) && HEALTH_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function buildAgentConfig(prompt: string, model: string): string {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();
  const capabilities = new Set<string>(['read']);

  if (/(write|create|update|delete|manage|publish|save)/.test(lower)) capabilities.add('write');
  if (/(execute|run|trigger|deploy|benchmark|schedule|workflow|agent)/.test(lower)) capabilities.add('execute');
  if (/(notify|message|alert|slack|discord|email)/.test(lower)) capabilities.add('notify');

  const integrations = ['github', 'slack', 'discord', 'jira', 'notion', 'linear']
    .filter(name => lower.includes(name));

  const name = slugify(normalized) || 'absuite-agent';
  const escapedPrompt = normalized.replace(/"/g, '\\"');

  return [
    '# ABSuite Connector Starter Scaffold',
    `name: ${name}`,
    `model: ${model}`,
    `description: "${escapedPrompt}"`,
    '',
    'capabilities:',
    ...Array.from(capabilities).map(capability => `  - ${capability}`),
    '',
    'integrations:',
    ...(integrations.length > 0 ? integrations.map(integration => `  - ${integration}`) : ['  - none-detected']),
    '',
    'runtime:',
    '  mode: live',
    '  retries: 3',
    '  logging: structured',
  ].join('\n');
}

app.get('/health', (req, res) => {
  // `service` names the process in the orchestrator's service map, which is
  // still 'dashboard'; `role` says what it actually is. Renaming the key would
  // break /status, /start/:id and every caller keyed on it.
  res.status(200).json({ status: 'healthy', service: 'dashboard', role: 'trust-operations-center', timestamp: new Date().toISOString() });
});

app.get('/status', async (req, res) => {
  Object.assign(status, await suiteStatusWithHealthFallback(status));
  res.json(status);
});

app.get('/service-health/:service', async (req, res) => {
  const service = req.params.service as ServiceName;
  if (!SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service requested' });
  }

  if (service === 'absuite-db') {
    const dbStatus = suiteStatus(status)[service];
    const isHealthy = dbStatus === 'up';

    return res.status(isHealthy ? 200 : 503).json({
      service,
      status: isHealthy ? 'healthy' : 'unhealthy',
      storage: {
        path: process.env.ABSUITE_DB_PATH || '/data/absuite.db',
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS[service]}/health`);
    return res.status(response.status).json({
      service,
      ...data,
    });
  } catch (error) {
    return res.status(502).json({
      service,
      error: 'Unable to reach live service health endpoint',
      message: (error as Error).message,
    });
  }
});

app.get('/ai/providers', async (req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/ai/providers`);
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      providers: [],
      recommended: 'none',
      error: 'Unable to load AI provider availability from CapKit',
      message: (error as Error).message,
    });
  }
});

app.get('/logs/:service', requireAdminAccess, (req, res) => {
  const service = req.params.service as ServiceName;
  if (!SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service' });
  }

  try {
    const output = runComposeCommand(`logs --tail 40 ${service}`);
    const logs = output
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-40)
      .map(line => ({
        time: new Date().toLocaleTimeString(),
        level: inferLogLevel(line),
        message: line.replace(/^.*?\|\s*/, '').trim(),
      }));

    return res.json({ service, logs });
  } catch (error) {
    return res.status(500).json({
      error: 'Unable to load service logs',
      message: (error as Error).message,
      logs: []
    });
  }
});

// ─── Execution traces ────────────────────────────────────────────────────────
//
// The Proof tab is the screen this product exists for, and it called three
// endpoints that were never implemented here. Every request fell through to the
// SPA catch-all, so the UI received `<!DOCTYPE html>` and reported
// "Could not load proof data — Unexpected token '<'". The panel had never
// worked; the interface was built and the proxy behind it was not.

/** Recorded executions, newest first. Reading the audit trail needs the admin key. */
app.get('/executions', requireAdminAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions?limit=${limit}`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable', executions: [] });
  }
});

/** Aggregate counts plus a live chain verification — the global view. */
app.get('/executions/stats', requireAdminAccess, async (req, res) => {
  try {
    const windowHours = Math.min(Math.max(Number(req.query.windowHours) || 24, 1), 24 * 90);
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/stats?windowHours=${windowHours}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * ABSuite, reporting on ABSuite.
 *
 * The eight architectural layers and how far each one is actually built, read
 * from the Constitution at request time rather than typed into this file. The
 * document is the source; `check:doctrine` already fails the build if a layer
 * claims to exist without naming a file that does.
 *
 * So the console cannot flatter the project: to make this panel say "built" you
 * have to make the claim true in the document, and the document is checked
 * against the filesystem in CI. The product applies its own standard to itself,
 * which is the only way it has any standing to apply it to anyone else.
 */
app.get('/system/layers', (_req, res) => {
  const candidates = [
    path.resolve(process.cwd(), 'docs/CONSTITUTION.md'),
    path.resolve(process.cwd(), '..', '..', 'docs/CONSTITUTION.md'),
    path.resolve(process.cwd(), '..', 'docs/CONSTITUTION.md'),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));

  if (!found) {
    // No document, no claim. Inventing a layer table here would be the exact
    // failure this endpoint exists to make impossible.
    return res.status(200).json({
      available: false,
      reason: 'docs/CONSTITUTION.md was not found from this working directory, so the layer states cannot be stated.',
    });
  }

  try {
    const text = fs.readFileSync(found, 'utf8');
    const rows = [
      ...text.matchAll(
        /^\|\s*(\d)\s*\|\s*\*\*([^*]+)\*\*\s*\|([^|]*)\|\s*(Built|Partly built|Not built)\s*\|\s*([^|]*?)\s*\|$/gm
      ),
    ].map(match => ({
      number: Number(match[1]),
      layer: match[2].trim(),
      description: match[3].trim(),
      status: match[4].trim(),
      evidence: match[5].trim().replace(/^`|`$/g, ''),
    }));

    if (rows.length !== 8) {
      return res.status(200).json({
        available: false,
        reason: `Expected 8 architectural layers in the Constitution, found ${rows.length}. The table changed shape and this cannot be read honestly.`,
      });
    }

    return res.status(200).json({
      available: true,
      layers: rows,
      source: 'docs/CONSTITUTION.md',
      note: 'Read from the Constitution at request time. A layer cannot be promoted here without changing the document, and check:doctrine fails the build if a promoted layer names no file that exists.',
    });
  } catch (error) {
    return res.status(200).json({ available: false, reason: (error as Error).message });
  }
});

/** Records that failed, are unsigned, or carry no recorded authority. */
app.get('/executions/attention', requireAdminAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/attention?limit=${limit}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * Provenance — what one agent handed to another.
 *
 * Two routes existed in capkit and neither was reachable from here, so the one
 * question an investigator actually asks — *what else did that bad output
 * touch?* — could only be answered with curl.
 *
 * `coverage` comes back with the graph and is not decoration: a graph with two
 * edges across four hundred records is not a tidy system, it is one whose
 * handoffs are going unrecorded, and drawing the edges without that reading
 * would hide it.
 */
app.get('/executions/provenance', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/provenance`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/** One record's ancestry, descendants, and anything it inherited from a failure. */
app.get('/executions/:id/lineage', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/${encodeURIComponent(String(req.params.id))}/lineage`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * Layer 1 — Identity. The base of the ascent, and it had no interface at all.
 *
 * Seven routes existed and none were reachable from here, which meant the only
 * way to enrol a subject was curl. Every condition report reads
 * `Identity: UNKNOWN` until one is enrolled, so the layer everything else rests
 * on was the one nobody could operate.
 *
 * Enrolment takes a *public* key. This proxy never sees a private half and must
 * never be given a path that could carry one — capkit refuses a PEM containing
 * PRIVATE KEY outright, and that refusal is the thing keeping this honest.
 */
app.get('/identities', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/identities`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

app.post('/identities', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/identities`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * Suspend and reinstate, kept as separate paths rather than one with a flag.
 *
 * A single `status` endpoint would make withdrawing an identity's authority the
 * same shape as restoring it, and those are not the same act. Suspension needs a
 * reason; reinstatement is a decision somebody made about a suspension that is
 * already in the record.
 */
for (const action of ['suspend', 'reinstate'] as const) {
  app.post(`/identities/:subject/${action}`, requireAdminAccess, async (req, res) => {
    try {
      const { response, data } = await fetchJson(
        `${SERVICE_BASE_URLS.capkit}/identities/${encodeURIComponent(String(req.params.subject))}/${action}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
          },
          body: JSON.stringify(req.body ?? {}),
        }
      );
      return res.status(response.status).json(data);
    } catch {
      return res.status(502).json({ error: 'CapKit is unreachable' });
    }
  });
}

/**
 * Layer 5 — the approvals a person owes a decision on.
 *
 * Proxied rather than reimplemented, like everything else here: this process
 * holds a credential and forwards, it does not decide. Deciding is a POST
 * because it changes something, and the reason a decision needs a basis is
 * enforced in CapKit rather than in this file — a validation that lives only in
 * the interface is a validation any other client skips.
 */
app.get('/approvals', requireAdminAccess, async (req, res) => {
  try {
    const state = String(req.query.state ?? '');
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/approvals${state ? `?state=${encodeURIComponent(state)}` : ''}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

app.post('/approvals/:id/decide', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/approvals/${encodeURIComponent(String(req.params.id))}/decide`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
        },
        body: JSON.stringify(req.body ?? {}),
      }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * Layer 6 — what the watch has seen, and how much of the record that covers.
 *
 * `coverage` is forwarded untouched and the panel is required to render it. An
 * empty notice list from a watch that never ran looks identical to one from a
 * clean sweep, and only the coverage sentence tells them apart.
 */
app.get('/watch', requireAdminAccess, async (req, res) => {
  try {
    const state = String(req.query.state ?? '');
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/watch${state ? `?state=${encodeURIComponent(state)}` : ''}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

app.post('/watch/notices/:id/acknowledge', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/watch/notices/${encodeURIComponent(String(req.params.id))}/acknowledge`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
        },
        body: JSON.stringify(req.body ?? {}),
      }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * The console's own audit trail, and its integrity.
 *
 * CapKit has hash-chained every authorisation decision since the first commit —
 * who asked, for what, allowed or denied, each entry sealed against the one
 * before it. None of it was reachable from here. A console that shows you a
 * tamper-evident log of what the agents did, while keeping no visible record of
 * who has been reading it, is asking for a trust it does not extend.
 *
 * Two routes, because two different questions: what is in the log, and whether
 * the log has been altered.
 */
app.get('/audit', requireAdminAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const params = new URLSearchParams({ limit: String(limit) });
    for (const key of ['subject', 'action', 'result'] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
    }
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/audit?${params.toString()}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

app.get('/audit/verify', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/audit/verify`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * Trust's live obligations, contracts and disputes.
 *
 * These exist and are exercised by tests, and a reader had no way to see any of
 * them. Obligations in particular are the one place the system says what it
 * owes rather than what it observed.
 */
app.get('/trust/obligations', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.trust}/obligations`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Trust is unreachable' });
  }
});

app.get('/trust/contracts', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.trust}/contracts`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Trust is unreachable' });
  }
});

app.get('/trust/disputes', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.trust}/disputes`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Trust is unreachable' });
  }
});

/** Agent-to-agent chains — the AI-watching-AI story, which had no picture. */
app.get('/trust/chains', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.trust}/chains`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Trust is unreachable' });
  }
});

/**
 * The Act layer's actual work: the queue and the schedule.
 *
 * This layer showed service tiles — a deployment detail — where it should have
 * shown what is running. Edge-Run holds both, and neither had a route here.
 */
app.get('/edge/queue', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS['edge-run']}/queue`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Edge-Run is unreachable' });
  }
});

app.get('/edge/schedule', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS['edge-run']}/schedule`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Edge-Run is unreachable' });
  }
});

/** The connector registry — what this instance can reach at all. */
app.get('/edge/connectors', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS['connector-starter']}/connectors`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Connector-Starter is unreachable' });
  }
});

/** Everything this instance could know and does not, grouped by the fix. */
app.get('/executions/unknowns', requireAdminAccess, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/unknowns?limit=${limit}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/** Which subject acted under which scope, counted from records. */
app.get('/executions/authority', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions/authority`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/** Spend attributed to the subject that caused it, with the coverage beside it. */
app.get('/executions/cost', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions/cost`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * The trace-signing public key.
 *
 * Deliberately unauthenticated, mirroring CapKit: the entire argument is that a
 * third party can verify a record without holding any credential of yours. A
 * public key that needed a password to fetch would defeat the point.
 */
app.get('/executions/public-key', async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions/public-key`);
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/** Verify a trace. Also unauthenticated, for the same reason. */
app.post('/executions/verify', async (req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * Replay: compare supplied payloads against the recorded hashes.
 *
 * Payloads are hashed and never stored, so this cannot show anyone what ran —
 * it can only answer whether what you hand it hashes to the same thing.
 */
app.post('/executions/:id/replay', requireAdminAccess, async (req, res) => {
  try {
    const id = encodeURIComponent(String(req.params.id));
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions/${id}/replay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

// ─── Trust: AI monitoring AI ─────────────────────────────────────────────────
//
// Correlation-aware arbitration and chain monitoring are the most
// differentiated things this project does, and — like replay before it — they
// had no interface. The engines work; nobody could reach them.

/** Anomalies across agent chains: cycles, runaways, stalls, observer disagreement. */
app.get('/trust/anomalies', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.trust}/anomalies`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Trust is unreachable', anomalies: [] });
  }
});

/**
 * Arbitrate without storing anything.
 *
 * Agreement between models of the same family is discounted to a single voice,
 * because correlated participants fail together and their agreement is not
 * corroboration.
 */
app.post('/trust/arbitrate', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.trust}/arbitrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Trust is unreachable' });
  }
});

/**
 * A plain-language explanation of one record.
 *
 * Derived, never generated. Every sentence names the signed field it came from,
 * so a reader can check the prose against the trace instead of believing it.
 */
app.get('/executions/:id/explain', requireAdminAccess, async (req, res) => {
  try {
    const id = encodeURIComponent(String(req.params.id));
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions/${id}/explain`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/** Walk the whole chain and report the first record that fails. */
/** The five necessary conditions for one execution. Inputs, never a score. */
app.get('/executions/:id/conditions', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/${encodeURIComponent(String(req.params.id))}/conditions`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

/**
 * One record, whole.
 *
 * The record is the product and had no route of its own — everything happened
 * in panels beside lists. Registered after the specific paths above so that
 * /executions/stats is never matched as an id.
 */
app.get('/executions/:id', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(
      `${SERVICE_BASE_URLS.capkit}/executions/${encodeURIComponent(String(req.params.id))}`,
      { headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {} }
    );
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

app.get('/executions-verify-chain', requireAdminAccess, async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions-verify-chain`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'CapKit is unreachable' });
  }
});

app.get('/capkit/token/generate', requireAdminAccess, async (req, res) => {
  try {
    const name = String(req.query.name || 'absuite-agent');
    const permissions = String(req.query.permissions || 'read,execute');
    const expiry = String(req.query.expiry || '24h');

    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
      },
      body: JSON.stringify({
        actor: name,
        action: permissions,
        resource: 'absuite',
        expires: expiry,
      }),
    });

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const token = typeof data.capability === 'string'
      ? data.capability
      : JSON.stringify(data.capability, null, 2);

    return res.json({ token, capability: data.capability });
  } catch (error) {
    return res.status(502).json({
      error: 'CapKit token generation failed',
      message: (error as Error).message,
    });
  }
});

app.post('/ai/policy/generate', async (req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/ai/policy/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: 'Policy generation service unavailable',
      message: (error as Error).message,
    });
  }
});

// ─── ABSuite's own performance ───────────────────────────────────────────────
//
// The Learn layer. These are the only numbers the product is allowed to publish
// about itself, and they come from a benchmark that ran on a stated machine.
// When nothing has been measured the UI shows that, rather than a zero that
// reads like a measurement.

/** The last recorded core benchmark, or an honest "not measured". */
app.get('/bench/core', async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.quickbench}/bench/core`);
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'QuickBench is unreachable', measured: false });
  }
});

/** This run against the previous one on the same machine. */
app.get('/bench/core/regression', async (_req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.quickbench}/bench/core/regression`);
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'QuickBench is unreachable', compared: false });
  }
});

/** Run it here, now, on this machine. Costs CPU, which is why it needs the key. */
app.post('/bench/core', requireAdminAccess, async (req, res) => {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.quickbench}/bench/core`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {}),
      },
      body: JSON.stringify({
        iterations: Number(req.body?.iterations ?? 500),
        chainLength: Number(req.body?.chainLength ?? 200),
      }),
    });
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: 'Core benchmark failed',
      message: (error as Error).message,
      measured: false,
    });
  }
});

app.post('/benchmark/run', requireAdminAccess, async (req, res) => {
  try {
    const { service, requests = 25 } = req.body ?? {};
    if (!service || !(service in SERVICE_BASE_URLS)) {
      return res.status(400).json({ error: 'A valid service is required' });
    }

    const count = Math.max(1, Math.min(Number(requests) || 25, 100));
    const latencies: number[] = [];
    let successCount = 0;
    const startedAt = performance.now();

    for (let i = 0; i < count; i++) {
      const requestStartedAt = performance.now();
      const response = await fetch(`${SERVICE_BASE_URLS[service as keyof typeof SERVICE_BASE_URLS]}/health`);
      const elapsed = performance.now() - requestStartedAt;
      latencies.push(elapsed);
      if (response.ok) {
        successCount += 1;
      }
    }

    if (successCount === 0) {
      return res.status(503).json({ error: `${service} did not respond successfully during the live benchmark.` });
    }

    const durationMs = performance.now() - startedAt;
    return res.json({
      service,
      requests: count,
      successRate: Math.round((successCount / count) * 100),
      latency_p50: percentile(latencies, 50),
      latency_p95: percentile(latencies, 95),
      latency_p99: percentile(latencies, 99),
      rps: Math.round((successCount / durationMs) * 1000),
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Live benchmark failed',
      message: (error as Error).message,
    });
  }
});

app.post('/connectors/test', requireAdminAccess, (req, res) => {
  const connectorId = String(req.body?.connectorId || '').toLowerCase();
  const envByConnector: Record<string, string[]> = {
    github: ['GITHUB_TOKEN'],
    slack: ['SLACK_BOT_TOKEN', 'SLACK_WEBHOOK_URL'],
    discord: ['DISCORD_BOT_TOKEN', 'DISCORD_WEBHOOK_URL'],
    jira: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
    notion: ['NOTION_TOKEN'],
    linear: ['LINEAR_API_KEY'],
  };

  if (!connectorId || !envByConnector[connectorId]) {
    return res.status(400).json({ error: 'Unknown connector requested' });
  }

  const present = envByConnector[connectorId].filter(variable => Boolean(process.env[variable]));
  if (present.length === 0) {
    return res.status(503).json({
      ok: false,
      configured: false,
      message: `${connectorId} is not configured in this environment yet.`,
    });
  }

  return res.json({
    ok: true,
    configured: true,
    message: `${connectorId} has configuration present: ${present.join(', ')}`,
  });
});

app.post('/connector-starter/generate', async (req, res) => {
  const { prompt, model = 'gpt-4o' } = req.body;
  
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Valid prompt required' });
  }

  const serviceUrl = inDocker 
    ? 'http://connector-starter:8084/generate' 
    : 'http://localhost:8084/generate';

  try {
    const response = await fetch(serviceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt, model })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      // Fallback YAML for demo/compatibility
      return res.status(response.status).json({
        success: false,
        source: 'fallback',
        error: data.error || 'Service temporarily unavailable',
        config: buildAgentConfig(prompt, model)
      });
    }

    const data = await response.json();
    res.json(data);

  } catch (error: any) {
    console.error('Connector proxy failed:', error);
    // Graceful fallback
    res.status(503).json({
      success: false,
      source: 'fallback',
      error: 'Connector service unreachable',
      config: buildAgentConfig(prompt, model)
    });
  }
});

/**
 * Is one of our own services answering?
 *
 * ## Two things this route got wrong
 *
 * **It was unauthenticated**, alone among the routes that reach anything. Every
 * sibling that touches a service carries `requireAdminAccess`; this one did not,
 * so anyone who could reach the dashboard could use it to map which localhost
 * ports were open — the response distinguishes an answer from a refused
 * connection.
 *
 * **The hostname allowlist covered one hop.** `fetch` follows redirects, so an
 * allowlisted service answering `302 Location: http://192.0.2.2/` reached that
 * host and the route reported `ok: true`. Demonstrated, not theorised: the
 * off-allowlist server logged the request.
 *
 * `only` binds every hop, which is the difference between an allowlist and a
 * check on the first request.
 */
app.get('/endpoint-check', requireAdminAccess, async (req, res) => {
  const rawUrl = String(req.query.url || '');
  if (!rawUrl || !isAllowedHealthUrl(rawUrl)) {
    return res.status(400).json({ error: 'Endpoint URL is missing or not allowed.' });
  }

  try {
    const response = await guardedFetch(rawUrl, {}, {
      refuse: [],                  // these are our own services; ranges are not the rule
      only: HEALTH_HOSTS,          // the rule is the host list, at every hop
      protocols: ['http:', 'https:'],
      verb: 'check',
    });
    return res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      status: response.status,
      url: rawUrl,
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      url: rawUrl,
      message: (error as Error).message,
    });
  }
});

app.post('/start/:service', requireAdminAccess, (req, res) => {
  const service = req.params.service as ServiceName;
  if (!SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service' });
  }
  status[service] = 'starting';
  io.emit('status', status);
  const result = startService(service);
  status[service] = result.status === 'up' ? 'up' : 'failed';
  io.emit('status', status);
  res.json({ success: result.status === 'up', service });
});

app.post('/stop/:service', requireAdminAccess, (req, res) => {
  const service = req.params.service as ServiceName;
  if (!SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service' });
  }
  status[service] = 'stopping';
  io.emit('status', status);
  try {
    runComposeCommand(`stop ${service}`);
    status[service] = 'down';
  } catch (e) {
    console.error(`Stop failed for ${service}:`, e);
    status[service] = 'failed';
  }
  io.emit('status', status);
  res.json({ success: true, service });
});

function startService(service: ServiceName) {
  console.log(`Starting ${service}...`);
  try {
    runComposeCommand(`up -d --no-deps ${service}`);
    console.log(`✅ ${service} started`);
    return { status: 'up' as const, service };
  } catch (e: unknown) {
    console.error(`❌ ${service} failed:`, (e as Error).message);
    return { status: 'down' as const, service, error: (e as Error).message };
  }
}

function suiteStatus(previousStatus: Partial<Record<ServiceName, ServiceState>> = {}): Record<ServiceName, ServiceState> {
  const nextStatus: Record<ServiceName, ServiceState> = {} as Record<ServiceName, ServiceState>;
  SERVICES.forEach(service => {
    const previous = previousStatus[service];
    nextStatus[service] = previous === 'starting' || previous === 'stopping' || previous === 'failed'
      ? previous
      : 'unknown';
  });

  // We are serving this request, so the dashboard is by definition up.
  nextStatus.dashboard = 'up';

  try {
    const raw = runComposeCommand('ps --format json');

    const containers = parseComposePsOutput(raw);

    if (raw.trim() && containers.length === 0) {
      throw new Error('Unable to parse docker compose ps output');
    }

    SERVICES.forEach(service => {
      const match = containers.find(container => {
        const serviceName = String(container.Service || container.Name || '').toLowerCase();
        return serviceName === service.toLowerCase() || serviceName.includes(service.toLowerCase());
      });

      if (!match) {
        nextStatus[service] = 'down';
        return;
      }

      const healthText = `${String(match.State || '')} ${String(match.Health || '')} ${String(match.Status || '')}`.toLowerCase();
      const isHealthy = (healthText.includes('running') || healthText.includes('up'))
        && !healthText.includes('unhealthy')
        && !healthText.includes('restarting')
        && !healthText.includes('exited');

      nextStatus[service] = isHealthy ? 'up' : 'down';
    });
  } catch (e) {
    // Docker or compose is unavailable. Leave the other services 'unknown' so
    // the HTTP fallback below can decide, rather than reporting them 'down'
    // on the strength of a missing Docker daemon.
    console.error('Status check via docker compose failed:', (e as Error).message);
  }

  nextStatus.dashboard = 'up';
  return nextStatus;
}

/**
 * Resolve any service Docker could not tell us about by asking the service
 * itself over HTTP. This is what makes the dashboard useful when the modules
 * run outside Docker (local dev, or a partial deployment).
 */
async function suiteStatusWithHealthFallback(
  previousStatus: Partial<Record<ServiceName, ServiceState>> = {}
): Promise<Record<ServiceName, ServiceState>> {
  const nextStatus = suiteStatus(previousStatus);

  const unresolved = SERVICES.filter(
    service => nextStatus[service] === 'unknown' && service !== 'absuite-db' && service !== 'dashboard'
  );

  await Promise.all(
    unresolved.map(async service => {
      const baseUrl = SERVICE_BASE_URLS[service as Exclude<ServiceName, 'absuite-db'>];
      if (!baseUrl) return;

      try {
        const response = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        nextStatus[service] = response.ok ? 'up' : 'down';
      } catch {
        nextStatus[service] = 'down';
      }
    })
  );

  return nextStatus;
}

let status: Record<ServiceName, ServiceState> = suiteStatus();

/**
 * Stream real executions to every connected client.
 *
 * The socket carried service health and nothing else, so the one screen that
 * exists to show a recorder recording never moved. Records appeared when a
 * human pressed refresh, which is the opposite of what a flight recorder is.
 *
 * This polls CapKit for records newer than the last one seen and pushes them.
 * Polling rather than a push from CapKit on purpose: the dashboard is an
 * observer, and an observer that requires the observed system to know about it
 * is not an observer — it is a dependency. CapKit does not learn that a
 * dashboard exists.
 */
let lastSeenExecutionId: string | null = null;
let streamingStarted = false;

async function pollExecutions() {
  try {
    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/executions?limit=25`, {
      headers: capkitAdminKey ? { 'X-ABSuite-Admin-Key': capkitAdminKey } : {},
    });
    if (!response.ok || !Array.isArray(data.executions)) return;

    const executions = data.executions as Record<string, unknown>[];
    if (executions.length === 0) return;

    // Newest first from CapKit. On the first pass we only take a bearing —
    // replaying history as "just arrived" would be a lie told by animation.
    if (lastSeenExecutionId === null) {
      lastSeenExecutionId = String(executions[0]!.id);
      io.emit('executions:snapshot', { executions });
      return;
    }

    const index = executions.findIndex(execution => String(execution.id) === lastSeenExecutionId);
    const arrived = index === -1 ? executions : executions.slice(0, index);
    if (arrived.length === 0) return;

    lastSeenExecutionId = String(executions[0]!.id);
    // Oldest first, so a client animating arrivals shows them in the order they
    // actually happened.
    for (const execution of [...arrived].reverse()) {
      io.emit('execution', execution);
    }
  } catch {
    // CapKit down or unreachable. The status stream already reports that; a
    // second alarm saying the same thing is noise.
  }
}

function startExecutionStream() {
  if (streamingStarted) return;
  streamingStarted = true;
  void pollExecutions();
  setInterval(() => void pollExecutions(), 2000);
}

io.on('connection', (socket: Socket) => {
  startExecutionStream();
  void suiteStatusWithHealthFallback(status).then(next => {
    Object.assign(status, next);
    socket.emit('status', status);
  });
  socket.emit('status', status);

  socket.on('start', (service: string) => {
    const serviceName = service as ServiceName;
    if (!SERVICES.includes(serviceName)) return;

    status[serviceName] = 'starting';
    io.emit('status', status);
    const result = startService(serviceName);
    status[serviceName] = result.status === 'up' ? 'up' : 'failed';
    io.emit('status', status);
  });

  socket.on('stop', (service: string) => {
    const serviceName = service as ServiceName;
    if (!SERVICES.includes(serviceName)) return;

    status[serviceName] = 'stopping';
    io.emit('status', status);
    try {
      runComposeCommand(`stop ${serviceName}`);
      status[serviceName] = 'down';
    } catch (e) {
      console.error(`Stop failed for ${serviceName}:`, e);
      status[serviceName] = 'failed';
    }
    io.emit('status', status);
  });

  socket.on('refresh', () => {
    void suiteStatusWithHealthFallback().then(next => {
      Object.assign(status, next);
      io.emit('status', status);
    });
  });
});

setInterval(() => {
  void suiteStatusWithHealthFallback(status).then(next => {
    Object.assign(status, next);
    io.emit('status', status);
  });
}, 30000);

app.get('*', (req, res, next) => {
  const internalPrefixes = ['/socket.io', '/health', '/status', '/service-health', '/ai/', '/logs/', '/capkit/', '/benchmark/', '/connectors/', '/connector-starter/', '/endpoint-check', '/start/', '/stop/'];
  if (internalPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next();
  }

  return res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

// Loopback by default, and PORT is honoured.
//
// `server.listen(3001)` with no host binds every interface. This container
// holds CAPKIT_ADMIN_KEY — the credential that mints capability tokens — and
// mounts the Docker socket, so running it directly on a machine with a public
// address published an admin console to the network. Inside a container that
// binding is required for Docker's own port mapping to reach it, and the
// compose file already restricts the published port to 127.0.0.1; outside one,
// there is no reason to listen beyond the loopback interface.
//
// ABSUITE_BIND overrides it deliberately, for anyone fronting this with a proxy
// that terminates TLS and authenticates.
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.ABSUITE_BIND || (inDocker ? '0.0.0.0' : '127.0.0.1');

server.listen(PORT, HOST, () => {
  console.log(`ABSuite Dashboard Orchestrator on ${HOST}:${PORT}`);
  if (HOST !== '127.0.0.1') {
    console.warn(
      `[dashboard] Listening on ${HOST}. This process holds CAPKIT_ADMIN_KEY and can control services — ` +
        'put it behind an authenticating proxy before exposing it.'
    );
  }
});

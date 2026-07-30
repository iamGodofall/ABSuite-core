import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

function isAllowedHealthUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ['localhost', '127.0.0.1', 'capkit', 'edge-run', 'quickbench', 'connector-starter', 'trust', 'dashboard'].includes(parsed.hostname);
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
  res.status(200).json({ status: 'healthy', service: 'dashboard', timestamp: new Date().toISOString() });
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

app.get('/endpoint-check', async (req, res) => {
  const rawUrl = String(req.query.url || '');
  if (!rawUrl || !isAllowedHealthUrl(rawUrl)) {
    return res.status(400).json({ error: 'Endpoint URL is missing or not allowed.' });
  }

  try {
    const response = await fetch(rawUrl);
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

io.on('connection', (socket: Socket) => {
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

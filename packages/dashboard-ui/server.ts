import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db'] as const;
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
    return ['localhost', '127.0.0.1', 'capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard'].includes(parsed.hostname);
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

app.get('/status', (req, res) => {
  Object.assign(status, suiteStatus(status));
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

app.get('/capkit/token/generate', requireAdminAccess, async (req, res) => {
  try {
    const name = String(req.query.name || 'absuite-agent');
    const permissions = String(req.query.permissions || 'read,execute');
    const expiry = String(req.query.expiry || '24h');

    const { response, data } = await fetchJson(`${SERVICE_BASE_URLS.capkit}/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

try {
    const dockerConnected = false; // Docker daemon not running
    if (!dockerConnected) {
      console.log('Docker daemon unavailable - using direct health checks');
      return { capkit: 'unknown', 'edge-run': 'unknown', quickbench: 'unknown', 'connector-starter': 'unknown', dashboard: 'up', 'absuite-db': 'unknown' };
    }
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
    console.error('Status check failed:', e);
  }

  return nextStatus;
}

let status: Record<ServiceName, ServiceState> = suiteStatus();

io.on('connection', (socket: Socket) => {
  Object.assign(status, suiteStatus(status));
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
    Object.assign(status, suiteStatus());
    io.emit('status', status);
  });
});

setInterval(() => {
  const newStatus = suiteStatus(status);
  Object.assign(status, newStatus);
  io.emit('status', status);
}, 30000);

app.get('*', (req, res, next) => {
  const internalPrefixes = ['/socket.io', '/health', '/status', '/service-health', '/ai/', '/logs/', '/capkit/', '/benchmark/', '/connectors/', '/connector-starter/', '/endpoint-check', '/start/', '/stop/'];
  if (internalPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next();
  }

  return res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

server.listen(3001, () => {
  console.log('ABSuite Dashboard Orchestrator on :3001');
});

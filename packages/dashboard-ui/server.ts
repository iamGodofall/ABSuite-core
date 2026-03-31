import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db'] as const;
type ServiceName = typeof SERVICES[number];

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(express.static('dist'));
app.use(express.static('.'));
app.use(express.json());

const composeFileCandidates = [
  path.resolve(process.cwd(), 'docker-compose.yml'),
  path.resolve(process.cwd(), '..', 'docker-compose.yml'),
  path.resolve(process.cwd(), '..', '..', 'docker-compose.yml'),
];

const composeFilePath = composeFileCandidates.find(candidate => fs.existsSync(candidate));

function runComposeCommand(args: string): string {
  const composePrefix = composeFilePath
    ? `-p absuite-core -f "${composeFilePath}"`
    : '-p absuite-core';

  return execSync(`docker compose ${composePrefix} ${args}`, {
    stdio: 'pipe',
    encoding: 'utf8'
  });
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', service: 'dashboard', timestamp: new Date().toISOString() });
});

app.get('/status', (req, res) => {
  res.json(status);
});

app.get('/ai/providers', (req, res) => {
  res.json({
    providers: [
      { name: 'ollama', type: 'local', available: true },
      { name: 'openai', type: 'cloud', available: false },
      { name: 'anthropic', type: 'cloud', available: false }
    ]
  });
});

app.post('/start/:service', (req, res) => {
  const service = req.params.service as ServiceName;
  if (!SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service' });
  }
  status[service] = 'starting...';
  io.emit('status', status);
  const result = startService(service);
  status[service] = result.status === 'up' ? 'up' : 'failed';
  io.emit('status', status);
  res.json({ success: result.status === 'up', service });
});

app.post('/stop/:service', (req, res) => {
  const service = req.params.service as ServiceName;
  if (!SERVICES.includes(service)) {
    return res.status(400).json({ error: 'Invalid service' });
  }
  status[service] = 'stopping...';
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
    runComposeCommand(`restart ${service}`);
    console.log(`✅ ${service} restarted`);
    return { status: 'up' as const, service };
  } catch (e: unknown) {
    console.error(`❌ ${service} failed:`, (e as Error).message);
    return { status: 'down' as const, service, error: (e as Error).message };
  }
}

function suiteStatus(): Record<ServiceName, 'up' | 'down'> {
  const status: Record<ServiceName, 'up' | 'down'> = {} as Record<ServiceName, 'up' | 'down'>;
  SERVICES.forEach(s => status[s] = 'down');
  try {
    const output = runComposeCommand('ps --format "{{.Names}}"');
    SERVICES.filter(s => s !== 'absuite-db').forEach(s => {
      if (output.includes(s)) status[s] = 'up';
    });
    const dbStatus = runComposeCommand('ps absuite-db --format "{{.Status}}"').trim();
    status['absuite-db'] = dbStatus.includes('Up') ? 'up' : 'down';
  } catch (e) {
    console.error('Status check failed:', e);
  }
  return status;
}

let status: Record<string, string> = {
  'absuite-db': 'down',
  'capkit': 'down',
  'edge-run': 'down',
  'dashboard': 'up',
  'quickbench': 'down',
  'connector-starter': 'down'
};

io.on('connection', (socket: Socket) => {
  socket.emit('status', status);

  socket.on('start', (service: string) => {
    status[service] = 'starting...';
    io.emit('status', status);
    const result = startService(service as ServiceName);
    status[service] = result.status === 'up' ? 'up' : 'failed';
    io.emit('status', status);
  });

  socket.on('stop', (service: string) => {
    status[service] = 'stopping...';
    io.emit('status', status);
    try {
      runComposeCommand(`stop ${service}`);
      status[service] = 'down';
    } catch (e) {
      console.error(`Stop failed for ${service}:`, e);
      status[service] = 'failed';
    }
    io.emit('status', status);
  });

  socket.on('refresh', () => {
    Object.assign(status, suiteStatus());
    io.emit('status', status);
  });
});

setInterval(() => {
  const newStatus = suiteStatus();
  Object.assign(status, newStatus);
  io.emit('status', status);
}, 30000);

server.listen(3001, () => {
  console.log('ABSuite Dashboard Orchestrator on :3001');
});

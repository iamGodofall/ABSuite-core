import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';

const SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db'] as const;
type ServiceName = typeof SERVICES[number];

function startService(service: ServiceName) {
  console.log(`Starting ${service}...`);
  try {
    execSync(`docker compose -f /docker-compose.yml restart ${service}`, { stdio: 'inherit' });
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
    // Better: use docker compose ps for consistency
    const output = execSync('docker compose -f /docker-compose.yml ps --format "{{.Names}}"').toString();
    SERVICES.filter(s => s !== 'absuite-db').forEach(s => {
      if (output.includes(s)) status[s] = 'up';
    });
    // Check absuite-db
execSync('docker compose -f /docker-compose.yml ps absuite-db --format "{{.Status}}" > /tmp/db_status 2>/dev/null || echo "down" > /tmp/db_status');
    const dbStatus = fs.readFileSync('/tmp/db_status', 'utf8').trim();
    status['absuite-db'] = dbStatus.includes('Up') ? 'up' : 'down';
  } catch (e) {
    console.error('Status check failed:', e);
  }
  return status;
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(express.static('dist'));
app.use(express.static('.'));

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
    const result = startService(service as any);
    status[service] = result.status === 'up' ? 'up' : 'failed';
    io.emit('status', status);
  });

    socket.on('stop', (service: string) => {
      status[service] = 'stopping...';
      io.emit('status', status);
      try {
        execSync(`docker compose -f /docker-compose.yml stop ${service}`, { stdio: 'pipe' });
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

// Status poll every 30s to reduce load
setInterval(() => {
  const newStatus = suiteStatus();
  Object.assign(status, newStatus);
  io.emit('status', status);
}, 30000);

server.listen(3001, () => {
  console.log('ABSuite Dashboard Orchestrator on :3001');
});

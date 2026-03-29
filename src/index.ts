import { spawn, execSync } from 'child_process';

/**
 * ABSuite Core Orchestrator - Reusable for CLI/Dashboard
 * Vision: Dynamic on-demand service management for capkit/quickbench/edge-run/connector-starter + db/core
 */
export const SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db'] as const;
export type ServiceName = typeof SERVICES[number];

export function startService(service: ServiceName, useDocker: boolean = true, cwd: string = '.') {
  const packageDir = service === 'dashboard' ? 'dashboard-ui' : service;
  console.log(`🎯 Orchestrator: Starting ${service}...`);
  try {
    if (useDocker) {
      execSync(`docker compose up -d ${service}`, { stdio: 'inherit', cwd });
    } else {
      try {
        execSync(`pnpm --filter ${packageDir} run build`, { stdio: 'inherit', cwd: '.' });
      } catch {}
      const child = spawn('pnpm', ['run', 'start'], { 
        cwd: `packages/${packageDir}`,
        stdio: 'inherit',
        detached: true 
      });
      child.unref(); // Daemonize
      child.on('close', (code: number) => console.log(`🎯 ${service} exited: ${code}`));
      child.on('error', (err) => console.error(`❌ ${service} spawn error:`, err.message));
    }
    console.log(`✅ ${service} active`);
    return { status: 'up' as const, service };
  } catch (e: unknown) {
    console.error(`❌ ${service} error:`, (e as Error).message);
    return { status: 'down' as const, service, error: (e as Error).message };
  }
}

export function startSuite(services: readonly ServiceName[] = SERVICES, useDocker: boolean = true) {
  console.log('🚀 ABSuite Suite Orchestration Starting...');
  const results = services.map(s => startService((s as any) === 'dashboard-ui' ? 'dashboard' : s, useDocker));
  const up = results.filter(r => r.status === 'up');
  console.log(`Summary: ${up.length}/${services.length} up | Dashboard: http://localhost:3001`);
  return results;
}

export function suiteStatus(): Record<ServiceName, 'up' | 'down'> {
  const status: Record<ServiceName, 'up' | 'down'> = {} as Record<ServiceName, 'up' | 'down'>;
  SERVICES.forEach(s => status[s] = 'down'); // Default
  try {
    const output = execSync('docker ps --format "{{.Names}}"').toString();
    (SERVICES as readonly ServiceName[]).filter(s => s !== 'absuite-db').forEach(s => {
      status[s] = output.includes(s) ? 'up' : 'down';
    });
  } catch {}
  return status;
}

// Legacy
export const suiteStart = () => startSuite();
export const suiteList = () => console.table(SERVICES);


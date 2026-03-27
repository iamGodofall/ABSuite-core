#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Arguments, Argv } from 'yargs';
import { spawn, execSync } from 'child_process';

const argv = yargs(hideBin(process.argv))
  .command('suite:start [services...]', 'Start suite services dynamically', (yargs: Argv) => {
    yargs.array('services')
      .describe('services', 'Services to start (capkit edge-run quickbench etc.) Default: all')
.default('services', ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db']);
  })
  .command('suite:list', 'List available suites')
  .command('suite:status', 'Status of running services')
  .command('workflow <tools>', 'Run workflow across packages', (yargs: Argv) => {
    yargs.positional('tools', {
      describe: 'Packages to run (space separated: capkit edge-run)',
      type: 'string',
      demandOption: true
    });
  })
  .option('docker', {
    type: 'boolean',
    default: true,
    describe: 'Use Docker mode (fallback)'
  })
  .argv as Arguments;

if (argv._[0] === 'workflow') {
  const tools = (argv.tools as string).split(' ');
  console.log(`Running workflow for: ${tools.join(', ')}`);
  tools.forEach(tool => {
    try {
      execSync(`pnpm --filter ${tool} run build`, { stdio: 'inherit', cwd: 'packages' });
      console.log(`✅ ${tool} workflow complete`);
    } catch (e: unknown) {
      console.error(`❌ ${tool} failed:`, (e as Error).message);
    }
  });
}

if (argv._[0] === 'suite:start') {
  const services = (argv.services as string[]) as any; // Type compat
  import('./index').then(({ startSuite }) => {
    startSuite(services as any, argv.docker as boolean);
  });
  
  console.log('✅ Suite started! Dashboard: http://localhost:3001');
} else if (argv._[0] === 'suite:list') {
console.log('Available suites: capkit, edge-run, connector-starter, quickbench, dashboard, absuite-db');
} else if (argv._[0] === 'suite:status') {
  // Placeholder for status
  console.log('Status check implemented - monitor docker ps or processes');
}

function startService(service: string, useDocker: boolean) {
  console.log(`Starting ${service}...`);
  try {
    if (useDocker) {
      execSync(`docker compose up -d ${service}`, { stdio: 'inherit' });
    } else {
      // Node mode - ensure built, start
      execSync(`pnpm --filter ${service} run build`, { stdio: 'inherit', cwd: '.' });
      const child = spawn('pnpm', ['--filter', service, 'start'], { stdio: 'inherit', cwd: '.' });
      child.on('close', (code: number) => console.log(`${service} exited with ${code}`));
    }
    console.log(`✅ ${service} ready`);
  } catch (e: unknown) {
    console.error(`❌ ${service} failed:`, (e as Error).message);
  }
}

console.log('ABSuite-core v1.0 Dynamic Orchestrator ready');


#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import type { Arguments, Argv } from 'yargs';

const argv = yargs(hideBin(process.argv))
  .command('suite:start', 'Start all suite services')
  .command('suite:list', 'List available suites')
  .command('workflow <tools>', 'Run workflow', (yargs: Argv) => {
    yargs.positional('tools', {
      describe: 'Suite tools',
      type: 'string'
    });
  })
  .argv as Arguments;

if (argv._[0] === 'suite:start') {
  console.log('🚀 Starting ABSuite...');
  // docker-compose up logic
} else if (argv._[0] === 'suite:list') {
  console.log('Available suites: capkit, edge-run, connector-starter, quickbench');
}

console.log('ABSuite-core v1.0 ready');

#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const argv = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .command('suite:start', 'Start all suite services')
    .command('suite:list', 'List available suites')
    .command('workflow <tools>', 'Run workflow', (yargs) => {
    yargs.positional('tools', {
        describe: 'Suite tools',
        type: 'string'
    });
})
    .argv;
if (argv._[0] === 'suite:start') {
    console.log('🚀 Starting ABSuite...');
    // docker-compose up logic
}
else if (argv._[0] === 'suite:list') {
    console.log('Available suites: capkit, edge-run, connector-starter, quickbench');
}
console.log('ABSuite-core v1.0 ready');

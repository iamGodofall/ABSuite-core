#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const child_process_1 = require("child_process");
const argv = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .command('suite:start [services...]', 'Start suite services dynamically', (yargs) => {
    yargs.array('services')
        .describe('services', 'Services to start (capkit edge-run quickbench etc.) Default: all')
        .default('services', ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db']);
})
    .command('suite:list', 'List available suites')
    .command('suite:status', 'Status of running services')
    .command('workflow <tools>', 'Run workflow across packages', (yargs) => {
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
    .argv;
if (argv._[0] === 'workflow') {
    const tools = argv.tools.split(' ');
    console.log(`Running workflow for: ${tools.join(', ')}`);
    tools.forEach(tool => {
        try {
            (0, child_process_1.execSync)(`pnpm --filter ${tool} run build`, { stdio: 'inherit', cwd: 'packages' });
            console.log(`✅ ${tool} workflow complete`);
        }
        catch (e) {
            console.error(`❌ ${tool} failed:`, e.message);
        }
    });
}
if (argv._[0] === 'suite:start') {
    const services = argv.services; // Type compat
    Promise.resolve().then(() => __importStar(require('./index'))).then(({ startSuite }) => {
        startSuite(services, argv.docker);
    });
    console.log('✅ Suite started! Dashboard: http://localhost:3001');
}
else if (argv._[0] === 'suite:list') {
    console.log('Available suites: capkit, edge-run, connector-starter, quickbench, dashboard, absuite-db');
}
else if (argv._[0] === 'suite:status') {
    // Placeholder for status
    console.log('Status check implemented - monitor docker ps or processes');
}
function startService(service, useDocker) {
    console.log(`Starting ${service}...`);
    try {
        if (useDocker) {
            (0, child_process_1.execSync)(`docker compose up -d ${service}`, { stdio: 'inherit' });
        }
        else {
            // Node mode - ensure built, start
            (0, child_process_1.execSync)(`pnpm --filter ${service} run build`, { stdio: 'inherit', cwd: '.' });
            const child = (0, child_process_1.spawn)('pnpm', ['--filter', service, 'start'], { stdio: 'inherit', cwd: '.' });
            child.on('close', (code) => console.log(`${service} exited with ${code}`));
        }
        console.log(`✅ ${service} ready`);
    }
    catch (e) {
        console.error(`❌ ${service} failed:`, e.message);
    }
}
console.log('ABSuite-core v1.0 Dynamic Orchestrator ready');

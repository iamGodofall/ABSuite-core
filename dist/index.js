"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suiteList = exports.suiteStart = exports.SERVICES = void 0;
exports.startService = startService;
exports.startSuite = startSuite;
exports.suiteStatus = suiteStatus;
const child_process_1 = require("child_process");
/**
 * ABSuite Core Orchestrator - Reusable for CLI/Dashboard
 * Vision: Dynamic on-demand service management for capkit/quickbench/edge-run/connector-starter + db/core
 */
exports.SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db'];
function startService(service, useDocker = true, cwd = '.') {
    console.log(`🎯 Orchestrator: Starting ${service}...`);
    try {
        if (useDocker) {
            (0, child_process_1.execSync)(`docker compose up -d ${service}`, { stdio: 'inherit', cwd });
        }
        else {
            try {
                (0, child_process_1.execSync)(`pnpm --filter ${service} run build`, { stdio: 'inherit', cwd });
            }
            catch { }
            const child = (0, child_process_1.spawn)('npm', ['run', 'start'], {
                cwd: `packages/${service}`,
                stdio: 'inherit',
                detached: true
            });
            child.unref(); // Daemonize
            child.on('close', (code) => console.log(`🎯 ${service} exited: ${code}`));
        }
        console.log(`✅ ${service} active`);
        return { status: 'up', service };
    }
    catch (e) {
        console.error(`❌ ${service} error:`, e.message);
        return { status: 'down', service, error: e.message };
    }
}
function startSuite(services = exports.SERVICES, useDocker = true) {
    console.log('🚀 ABSuite Suite Orchestration Starting...');
    const results = services.map(s => startService(s === 'dashboard-ui' ? 'dashboard' : s, useDocker));
    const up = results.filter(r => r.status === 'up');
    console.log(`Summary: ${up.length}/${services.length} up | Dashboard: http://localhost:3001`);
    return results;
}
function suiteStatus() {
    const status = {};
    exports.SERVICES.forEach(s => status[s] = 'down'); // Default
    try {
        const output = (0, child_process_1.execSync)('docker ps --format "{{.Names}}"').toString();
        exports.SERVICES.filter(s => s !== 'absuite-db').forEach(s => {
            status[s] = output.includes(s) ? 'up' : 'down';
        });
    }
    catch { }
    return status;
}
// Legacy
const suiteStart = () => startSuite();
exports.suiteStart = suiteStart;
const suiteList = () => console.table(exports.SERVICES);
exports.suiteList = suiteList;

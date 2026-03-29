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
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const SERVICES = ['capkit', 'edge-run', 'quickbench', 'connector-starter', 'dashboard', 'absuite-db'];
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*'
    }
});
app.use(express_1.default.static('dist'));
app.use(express_1.default.static('.'));
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'dashboard', timestamp: new Date().toISOString() });
});
function startService(service) {
    console.log(`Starting ${service}...`);
    try {
        (0, child_process_1.execSync)(`docker compose -p absuite-core -f /docker-compose.yml restart ${service}`, { stdio: 'inherit' });
        console.log(`✅ ${service} restarted`);
        return { status: 'up', service };
    }
    catch (e) {
        console.error(`❌ ${service} failed:`, e.message);
        return { status: 'down', service, error: e.message };
    }
}
function suiteStatus() {
    const status = {};
    SERVICES.forEach(s => status[s] = 'down');
    try {
        const output = (0, child_process_1.execSync)('docker compose -p absuite-core -f /docker-compose.yml ps --format "{{.Names}}"').toString();
        SERVICES.filter(s => s !== 'absuite-db').forEach(s => {
            if (output.includes(s))
                status[s] = 'up';
        });
        (0, child_process_1.execSync)('docker compose -p absuite-core -f /docker-compose.yml ps absuite-db --format "{{.Status}}" > /tmp/db_status 2>/dev/null || echo "down" > /tmp/db_status');
        const dbStatus = fs.readFileSync('/tmp/db_status', 'utf8').trim();
        status['absuite-db'] = dbStatus.includes('Up') ? 'up' : 'down';
    }
    catch (e) {
        console.error('Status check failed:', e);
    }
    return status;
}
let status = {
    'absuite-db': 'down',
    'capkit': 'down',
    'edge-run': 'down',
    'dashboard': 'up',
    'quickbench': 'down',
    'connector-starter': 'down'
};
io.on('connection', (socket) => {
    socket.emit('status', status);
    socket.on('start', (service) => {
        status[service] = 'starting...';
        io.emit('status', status);
        const result = startService(service);
        status[service] = result.status === 'up' ? 'up' : 'failed';
        io.emit('status', status);
    });
    socket.on('stop', (service) => {
        status[service] = 'stopping...';
        io.emit('status', status);
        try {
            (0, child_process_1.execSync)(`docker compose -p absuite-core -f /docker-compose.yml stop ${service}`, { stdio: 'pipe' });
            status[service] = 'down';
        }
        catch (e) {
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

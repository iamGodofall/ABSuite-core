"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*'
    }
});
app.use(express_1.default.static('dist'));
app.use(express_1.default.static('.'));
const status = {
    'absuite-db': 'down',
    'capkit': 'down',
    'edge-run': 'down',
    'dashboard': 'up',
    'quickbench': 'down',
    'connector-starter': 'down'
};
io.on('connection', (socket) => {
    socket.emit('status', status);
    socket.on('restart', (service) => {
        status[service] = 'restarting...';
        io.emit('status', status);
        setTimeout(() => {
            status[service] = 'up';
            io.emit('status', status);
        }, 2000);
    });
});
// Health check every 5s
setInterval(() => {
    try {
        const output = (0, child_process_1.execSync)('docker compose ps --format json', { cwd: path_1.default.resolve(process.cwd(), '..', '..') }).toString();
        const services = JSON.parse(output);
        Object.keys(status).forEach((service) => {
            const matching = services.find((s) => s.Name.includes(service));
            status[service] = matching && matching.State === 'running' ? 'up' : 'down';
        });
        io.emit('status', status);
    }
    catch (error) {
        console.log('Docker status check failed:', error);
        // Fallback
        io.emit('status', status);
    }
}, 5000);
server.listen(3000, () => {
    console.log('ABSuite Dashboard on :3000');
});

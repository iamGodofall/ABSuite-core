# ABSuite — Agent Builder Suite

> The complete infrastructure platform for building, deploying, and scaling production AI agents.

![ABSuite](https://img.shields.io/badge/ABSuite-v1.0.0-7C3AED?style=for-the-badge&labelColor=1E1B4B)
[![MIT License](https://img.shields.io/badge/license-MIT-7C3AED?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

---

## 🎯 What Is ABSuite?

ABSuite is a **vertical AI Agent PaaS** — everything you need to build, run, monitor, and scale AI agents in production, packaged as a single coherent platform.

Think of it as the infrastructure layer that means you never have to stitch together separate solutions for security, scheduling, benchmarking, and observability. It's purpose-built for teams building AI-powered products who need enterprise-grade reliability without the enterprise-grade complexity.

### The Five Core Modules

| Module | What It Does |
|--------|-------------|
| **CapKit** | Security layer — JWT validation, capability tokens, AI content filtering, audit logs, rate limiting |
| **Edge-Run** | Execution layer — cron jobs, queues, event streams, process spawning, self-healing recovery |
| **QuickBench** | Performance validation — LLM inference benchmarking, KV cache analysis, A/B testing, throughput profiling |
| **Connector-Starter** | Integration scaffold — build connectors for GitHub, Slack, Jira, and any other platform your agents need |
| **Dashboard** | Unified control plane — real-time monitoring, AI studio, system overview across all modules |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ (or use `nvm`)
- [Docker](https://www.docker.com/) 24+ with Docker Compose
- [pnpm](https://pnpm.io/) 9+ (`npm install -g pnpm`)

### One-Command Setup

```bash
# Clone the repo
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core

# Install everything
pnpm install

# Start all services
pnpm start

# Open the dashboard
open http://localhost:3001
```

That's it. Every service starts, the dashboard comes up, and you're ready to build.

### Using the CLI

```bash
# Check service status
pnpm cli status

# Start a specific service
pnpm cli start capkit

# Stop everything
pnpm cli stop

# Run a benchmark
pnpm cli benchmark --model ollama/llama3

# Generate a capability token
pnpm cli token create --capabilities "read,write,execute" --expires 24h
```

---

## 📁 Project Structure

```
ABSuite-core/
├── packages/
│   ├── capkit/              # Security & capability validation
│   │   └── src/
│   │       ├── index.ts     # Public API exports
│   │       ├── server.ts    # HTTP API server
│   │       ├── jwt.ts       # JWT creation & validation
│   │       ├── capability.ts # Capability token system
│   │       ├── ai-policy-generator.ts # AI content policy
│   │       └── llm-provider.ts  # Multi-LLM provider abstraction
│   │
│   ├── edge-run/            # Agent execution & scheduling
│   │   └── src/
│   │       ├── index.ts     # Public API exports
│   │       ├── server.ts    # HTTP API server
│   │       ├── scheduler.ts # Cron & queue scheduler
│   │       ├── runtime.ts   # Process spawning & management
│   │       └── self-healing.ts # Automatic recovery
│   │
│   ├── quickbench/          # Performance benchmarking
│   │   └── src/
│   │       ├── index.ts     # Public API exports
│   │       ├── server.ts    # HTTP API server
│   │       ├── runner.ts    # Benchmark orchestration
│   │       ├── benchmark-runner.ts # Per-test runners
│   │       └── report.ts    # Report generation
│   │
│   ├── connector-starter/   # AI agent connector scaffold
│   │   └── src/
│   │       ├── index.ts     # Public API exports
│   │       └── server.ts    # HTTP API server
│   │
│   ├── dashboard-ui/        # Web dashboard (React + Vite)
│   │   └── src/
│   │       ├── App.tsx      # Main application
│   │       ├── components/  # UI components
│   │       └── hooks/       # React hooks for service integration
│   │
│   └── apps/                # SaaS / multi-tenant layer
│       └── frontend/        # Customer-facing web app
│
├── docker-compose.yml       # All services in Docker
├── package.json             # Workspace root (pnpm)
└── tsconfig.json            # Shared TypeScript config
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard (:3001)                 │
│         React + Vite + Socket.io live updates        │
└────────────────────┬────────────────────────────────┘
                     │ HTTP + WebSocket
┌────────────────────▼────────────────────────────────┐
│              ABSuite Orchestrator                    │
│    CLI · Service Manager · Docker Integration       │
└──────┬──────────────┬──────────────┬────────────────┘
       │              │              │
┌──────▼──────┐ ┌─────▼──────┐ ┌────▼───────┐
│  CapKit     │ │  Edge-Run  │ │  QuickBench │
│  :8081      │ │  :8082     │ │  :8083      │
│             │ │            │ │             │
│ · JWT       │ │ · Scheduler│ │ · Benchmarks│
│ · Capability│ │ · Runtime  │ │ · Profiling │
│ · AI Policy │ │ · Healing  │ │ · A/B tests │
└─────────────┘ └────────────┘ └─────────────┘
       │              │              │
       └──────────────▼──────────────┘
              ┌─────────────┐
              │  absuite-db │
              │  (SQLite)   │
              └─────────────┘
```

---

## 🔑 Key Features

### CapKit — Security Without Compromise

```typescript
import { CapabilityToken, createHMAC } from '@absuite/capkit'

// Create a capability token with scoped permissions
const token = CapabilityToken.create({
  kid: 'service-key-1',
  sub: 'agent-001',
  scope: ['read:users', 'write:tasks', 'execute:scripts'],
  expiresIn: '8h',
 aud: 'absuite://production'
}, hmacKey)

// Validate incoming requests
const result = CapabilityToken.validate(token, hmacKey)
if (!result.valid) {
  throw new SecurityError('Capability token invalid', result.error)
}
```

### Edge-Run — Agents That Run Reliably

```typescript
import { AgentScheduler } from '@absuite/edge-run'

const scheduler = new AgentScheduler()

// Schedule a recurring agent task
scheduler.schedule({
  id: 'data-sync',
  cron: '*/15 * * * *',
  task: async (ctx) => {
    const data = await fetchLatestData()
    await processAndStore(data)
    ctx.log(`Synced ${data.length} records`)
  },
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

// One-off delayed task
scheduler.delay('welcome-email', 30_000, async () => {
  await sendWelcomeEmail()
})
```

### QuickBench — Know Before You Deploy

```typescript
import { QuickBench } from '@absuite/quickbench'

const bench = new QuickBench({
  providers: ['ollama'],
  models: ['llama3', 'mistral'],
  metrics: ['latency', 'throughput', 'kv_cache_hit_rate']
})

const report = await bench.runSuite('model-comparison')
console.table(report.results)
```

---

## 📊 Dashboard

The dashboard gives you a real-time unified view of your entire ABSuite deployment:

- **System Overview** — All services at a glance, live health metrics
- **AI Studio** — Configure AI providers, test prompts, inspect responses
- **Service Control** — Start, stop, and restart any module from one place
- **Live Logs** — Streaming logs from all services via WebSocket
- **Benchmark Results** — Historical performance data with trend charts

Access it at `http://localhost:3001` after running `pnpm start`.

---

## 🐳 Docker Deployment

Every module ships as a Docker container. Deploy everything at once:

```bash
# Start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f

# Stop everything
docker compose down
```

Or run individual services:

```bash
docker compose up -d capkit edge-run
```

---

## 🔧 Configuration

ABSuite is configured via environment variables:

```env
# Core
ABSUITE_ENV=development          # development | production
ABSUITE_DB_PATH=./data/absuite.db  # SQLite database path
ABSUITE_LOG_LEVEL=info           # debug | info | warn | error

# CapKit
CAPKIT_PORT=8081
CAPKIT_HMAC_SECRET=your-secret-key
CAPKIT_JWT_SECRET=your-jwt-secret

# Edge-Run
EDGERUN_PORT=8082
EDGERUN_MAX_CONCURRENT=10
EDGERUN_QUEUE_LIMIT=100

# QuickBench
QUICKBENCH_PORT=8083
QUICKBENCH_OLLAMA_URL=http://localhost:11434

# Dashboard
DASHBOARD_PORT=3001
```

---

## 🧪 Running Tests

```bash
# All packages
pnpm test

# Individual package
pnpm --filter capkit test
pnpm --filter edge-run test
pnpm --filter quickbench test
```

---

## 📖 Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [API Reference](./docs/API.md)
- [Security Model](./docs/SECURITY.md)

---

## 🌍 Open Source Strategy

ABSuite is **mostly open source** under the MIT license:

- ✅ **Core modules** (CapKit, Edge-Run, QuickBench, Dashboard) — MIT, free forever
- ✅ **Connector templates** — MIT, community-contributed connectors welcome
- 🔒 **Enterprise features** — Advanced auth, SSO, audit log aggregation, team management (planned)

The goal is to be the **standard infrastructure layer** for AI agents in the same way that Express is the standard for web frameworks. Open, extensible, and community-built.

---

## 🤝 Contributing

We welcome contributions from engineers of all skill levels. Please read our [Contributing Guide](./CONTRIBUTING.md) before submitting PRs.

**The fast path to getting your PR merged:** open an issue first to discuss what you're planning to build. This avoids wasted work and ensures your contribution aligns with the project direction.

---

## 📝 License

ABSuite Core is [MIT licensed](./LICENSE). Copyright © 2025–2026 ABSuite Contributors.

---

## 🌟 Acknowledgments

Built with: TypeScript · React · Vite · Express · Socket.io · Docker · SQLite

---

<p align="center">
  <strong>ABSuite — Build agents. Not infrastructure.</strong>
</p>

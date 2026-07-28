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

| Module | What It Does | Status |
|--------|-------------|--------|
| **CapKit** | Security layer — capability tokens, JWT validation, audit log, access-policy generation | ✅ **Implemented** |
| **Dashboard** | Unified control plane — live service status, AI studio, token issuance, latency benchmarks | ✅ **Implemented** |
| **Edge-Run** | Execution layer — cron jobs, queues, event streams, process spawning, self-healing recovery | 🚧 **Planned — not built** |
| **QuickBench** | Performance validation — LLM inference benchmarking, KV cache analysis, A/B testing | 🚧 **Planned — not built** |
| **Connector-Starter** | Integration scaffold — connectors for GitHub, Slack, Jira and others | 🚧 **Planned — not built** |

> **Implementation status.** CapKit and the Dashboard are real, tested and runnable
> today. Edge-Run, QuickBench and Connector-Starter are specified in
> [`docs/API.md`](./docs/API.md) but contain no source yet — their packages are
> empty. They are held behind the `planned` Docker Compose profile so a default
> `docker compose up` starts only what genuinely works. Anything below that
> refers to those three modules describes intended, not shipped, behaviour.

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

# Set the secrets CapKit needs (see .env.example)
cp .env.example .env
# Then edit .env — at minimum set CAPKIT_HMAC_SECRET and ABSUITE_ADMIN_API_KEY:
#   openssl rand -hex 32

# Start the implemented services (absuite-db, capkit, dashboard)
pnpm start

# Open the dashboard
open http://localhost:3001
```

This starts the database, CapKit and the Dashboard. The dashboard reports live
service status, issues real capability tokens through CapKit, and runs latency
benchmarks against any running service.

### Running without Docker

```bash
# Terminal 1 — CapKit
CAPKIT_HMAC_SECRET=$(openssl rand -hex 32) CAPKIT_ADMIN_KEY=dev-admin-key \
  pnpm --filter @absuite/capkit dev

# Terminal 2 — Dashboard
ABSUITE_ADMIN_API_KEY=dev-admin-key pnpm --filter dashboard-ui start
```

The dashboard falls back to direct HTTP health checks when Docker is not
available, so service status stays accurate either way.

### Using the CLI

```bash
# Check service status
pnpm cli status

# Start a specific service
pnpm cli start capkit

# Stop everything
pnpm cli stop
```

> The CLI's `bench` and `token` subcommands shell into the QuickBench and CapKit
> containers. `bench` depends on QuickBench, which is not implemented yet. Issue
> tokens through the dashboard or CapKit's HTTP API instead (see below).

---

## 📁 Project Structure

```
ABSuite-core/
├── packages/
│   ├── capkit/              # ✅ Security & capability validation
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts     # Public API exports
│   │       ├── server.ts    # HTTP API server (:8081)
│   │       ├── jwt.ts       # HS256 sign/verify on node:crypto
│   │       ├── capability.ts # Capability tokens, scopes, revocation
│   │       ├── audit.ts     # Append-only audit log (memory + JSONL)
│   │       ├── ai-policy-generator.ts # Rule-based access policies
│   │       ├── llm-provider.ts  # Provider configuration inspection
│   │       └── capkit.test.ts   # 27 tests
│   │
│   ├── dashboard-ui/        # ✅ Web dashboard (React + Vite)
│   │   ├── Dockerfile
│   │   ├── server.ts        # Orchestrator + API proxy (:3001)
│   │   └── src/
│   │       ├── App.tsx      # Main application
│   │       ├── components/  # UI components
│   │       └── hooks/       # React hooks for service integration
│   │
│   ├── cli/                 # ✅ Command-line interface
│   │   └── src/index.ts
│   │
│   ├── edge-run/            # 🚧 Empty — planned
│   ├── quickbench/          # 🚧 Empty — planned
│   └── connector-starter/   # 🚧 Empty — planned
│
├── src/                     # Shared orchestrator helpers
├── docker-compose.yml       # Implemented services by default
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
import { CapabilityToken, hasCapability } from '@absuite/capkit'

// Create a capability token with scoped permissions
const created = CapabilityToken.create({
  sub: 'agent-001',
  scope: ['read:users', 'write:tasks', 'execute:scripts'],
  expiresIn: '8h',
  aud: 'absuite://production',
  kid: 'service-key-1',
}, hmacKey)

// Validate an incoming request, requiring a specific scope
const result = CapabilityToken.validate(created.token, hmacKey, {
  requiredScope: 'write:tasks',
})

if (!result.valid) {
  // 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'CAPABILITY_INSUFFICIENT' | ...
  throw new Error(`Capability rejected: ${result.error}`)
}

console.log(result.claims.sub) // 'agent-001'
```

Scopes match segment-wise, so `read:*` grants `read:users` but never
`read:users:delete`. Tokens are HS256 JWTs signed with `node:crypto` — no
third-party JWT dependency on the security-critical path.

### Edge-Run — Agents That Run Reliably

> 🚧 **Not implemented.** The example below is the intended API.

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

> 🚧 **Not implemented.** The example below is the intended API.

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
CAPKIT_HMAC_SECRET=your-secret-key   # REQUIRED in production (min 32 chars)
CAPKIT_JWT_SECRET=your-jwt-secret    # Fallback if HMAC secret is unset
CAPKIT_ADMIN_KEY=your-admin-key      # Bootstrap key for issuing the first token
CAPKIT_AUDIENCE=absuite://production # Optional; enforced at validation
CAPKIT_AUDIT_LOG=/data/capkit-audit.jsonl

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
# All packages (31 tests)
pnpm test

# CapKit only (27 tests — JWT, scopes, revocation, audit, policy)
pnpm --filter @absuite/capkit test
```

CapKit's suite covers the security-critical paths directly: signature
tampering, the `alg: none` downgrade, expiry, audience mismatch, scope
escalation and revocation.

---

## 🔐 CapKit HTTP API

CapKit runs on `:8081`. Every endpoint except `/health` requires either a
capability token carrying the right scope, or the bootstrap admin key.

```bash
# Health — no auth
curl localhost:8081/health

# Issue a token (bootstrap with the admin key)
curl -X POST localhost:8081/auth/token \
  -H 'Content-Type: application/json' \
  -H "X-ABSuite-Admin-Key: $CAPKIT_ADMIN_KEY" \
  -d '{"sub":"agent-1","scope":["read:users","audit:read"],"expiresIn":"8h"}'

# Validate a token
curl -X POST localhost:8081/auth/token/validate \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"token\":\"$TOKEN\"}"

# Revoke a token
curl -X POST localhost:8081/auth/token/revoke \
  -H 'Content-Type: application/json' \
  -H "X-ABSuite-Admin-Key: $CAPKIT_ADMIN_KEY" \
  -d "{\"token\":\"$TOKEN\"}"

# Read the audit trail
curl -H "Authorization: Bearer $TOKEN" 'localhost:8081/audit?limit=20'

# Generate a least-privilege access policy from a description
curl -X POST localhost:8081/ai/policy/generate \
  -H 'Content-Type: application/json' \
  -d '{"description":"read and delete customer credentials"}'
```

Every allow and deny is written to the audit log with subject, action,
resource and reason.

**Known limitation:** the revocation list is process-local, so a multi-replica
CapKit deployment needs a shared store before revocation is reliable.

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

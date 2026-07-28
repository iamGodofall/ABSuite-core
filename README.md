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

| Module | Port | What It Does |
|--------|------|-------------|
| **CapKit** | 8081 | Security — capability tokens, JWT validation, tamper-evident audit log, shared revocation, policy generation |
| **Edge-Run** | 8082 | Execution — cron scheduling, priority queue, retries with jitter, circuit-breaker self-healing, live log stream |
| **QuickBench** | 8083 | Performance — LLM and HTTP benchmarking, nearest-rank percentiles, statistical regression detection |
| **Connector-Starter** | 8084 | Integrations — connector registry, read-only credential verification, deterministic scaffolding |
| **Dashboard** | 3001 | Control plane — live service status, AI studio, token issuance, latency benchmarks |
| **MCP** | stdio | Model Context Protocol server — puts ABSuite inside the agent tool-calling path |

All modules are implemented, tested and runnable. **246 tests** cover the
security-critical and correctness-critical paths.

### Production & commercial layer

Everything needed to run this as a paid service, not just as code:

| Capability | Detail |
|---|---|
| **Multi-tenancy** | Tenants with SHA-256 hashed API keys, one-time issuance, rotation |
| **Usage metering** | Per tenant, per metric, per month — the basis of an invoice |
| **Quota enforcement** | `402` when a plan limit is hit, `403` when an account is suspended |
| **Billing** | Stripe webhook with signature verification and replay protection |
| **Durable state** | SQLite via Node's built-in driver; schedules and queued work survive restart |
| **Tamper-evident audit** | Hash-chained entries; `/audit/verify` names the first broken entry |
| **Observability** | `/metrics` (Prometheus), `/health` and `/ready` on every service |
| **Graceful shutdown** | SIGTERM drains in-flight requests and flushes state |
| **Verifiable execution** | Ed25519-signed, hash-chained traces of every real action |
| **Self-serve signup** | `/signup` creates a tenant and shows its key once |
| **Key rotation** | Retired keys keep verifying, so rotating never logs agents out |
| **MCP server** | Agents get capability-checked, attested tool calls with no integration work |

See [`docs/LAUNCH.md`](./docs/LAUNCH.md) for the pre-launch checklist and
[`docs/openapi.yaml`](./docs/openapi.yaml) for the full API spec.

### What makes it a suite, not five services

CapKit is the shared authorisation layer. Edge-Run, QuickBench and
Connector-Starter all import `capabilityGuard` from `@absuite/capkit` and enforce
the same capability model, so **one token works across every service, and
revoking it at CapKit locks it out of all of them**:

```bash
# One token, scoped for the whole suite
TOKEN=$(curl -sX POST localhost:8081/auth/token \
  -H "X-ABSuite-Admin-Key: $CAPKIT_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"sub":"agent","scope":["queue:read","bench:read"],"expiresIn":"1h"}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" localhost:8082/queue    # Edge-Run   -> 200
curl -H "Authorization: Bearer $TOKEN" localhost:8083/history  # QuickBench -> 200

curl -sX POST localhost:8081/auth/token/revoke \
  -H "X-ABSuite-Admin-Key: $CAPKIT_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"

curl -H "Authorization: Bearer $TOKEN" localhost:8082/queue    # -> 401 TOKEN_REVOKED
curl -H "Authorization: Bearer $TOKEN" localhost:8083/history  # -> 401 TOKEN_REVOKED
```

Set `ABSUITE_DB_PATH` to a database every service can read, and revocation
propagates across processes and replicas.

### Provable, not just traceable

Every real action produces a hash-chained trace signed with **Ed25519** — so an
auditor can verify your records holding *only a public key*, without also being
able to forge them. Payloads are hashed, never stored, so a trace proves what
happened without ABSuite retaining your customers' data.

```bash
# An auditor needs no ABSuite credentials at all
curl localhost:8081/executions/public-key

curl -X POST localhost:8081/executions/verify \
  -H 'Content-Type: application/json' -d "{\"trace\": $TRACE}"
# -> {"valid":true,"contentIntact":true,"signatureValid":true}
```

Tampering is caught at both levels. Edit a field and the content hash fails.
Recompute the hash to match your edit and the **signature** fails, because you
were never able to sign it:

```json
{"valid":false,"reason":"Signature does not verify against the supplied key",
 "contentIntact":true,"signatureValid":false}
```

`GET /executions-verify-chain` walks the whole log and names the sequence number
of the first record that breaks.

**Try it without installing anything:** [`docs/verify.html`](./docs/verify.html)
is a standalone page that verifies a trace entirely in your browser using
WebCrypto — no server, no account, no trust in us required. Open it, click
*Load a valid example*, then click *Tamper with it* and verify again.

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

> The CLI's `bench` and `token` subcommands shell into running containers. When
> running outside Docker, use the QuickBench and CapKit HTTP APIs directly
> (see below).

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
│   ├── edge-run/            # ✅ Scheduling, queue, retries, self-healing (:8082)
│   │   └── src/
│   │       ├── cron.ts      # Cron parsing & next-run calculation
│   │       ├── queue.ts     # Priority queue, retries with jitter
│   │       ├── runtime.ts   # HTTP & script executors (scripts opt-in)
│   │       ├── scheduler.ts # Cron -> queue handoff
│   │       └── self-healing.ts # Circuit breaker per target
│   │
│   ├── quickbench/          # ✅ LLM & service benchmarking (:8083)
│   │   └── src/
│   │       ├── stats.ts     # Percentiles, Welch's t-test
│   │       ├── providers.ts # Ollama, OpenAI, Anthropic, HTTP
│   │       ├── runner.ts    # Job orchestration & comparison
│   │       └── report.ts    # Markdown & CSV reports
│   │
│   └── connector-starter/   # ✅ Connectors & scaffolding (:8084)
│       └── src/
│           ├── connectors.ts # Registry, verification, actions
│           └── scaffold.ts   # Manifest + TypeScript generation
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

```typescript
import { TaskQueue, TaskRuntime, AgentScheduler, nextRun } from '@absuite/edge-run'

const runtime = new TaskRuntime({ allowedHosts: ['api.example.com'] })
const queue = new TaskQueue({ runtime, concurrency: 10 })
const scheduler = new AgentScheduler(queue)

// Recurring task, retried with exponential backoff and jitter
scheduler.schedule({
  id: 'data-sync',
  cron: '*/15 * * * *',
  task: { type: 'http', url: 'https://api.example.com/sync', method: 'POST' },
  retry: { maxAttempts: 3, backoff: 'exponential' },
})

// One-off delayed task
queue.enqueue(
  { type: 'http', url: 'https://api.example.com/welcome', method: 'POST' },
  { id: 'welcome-email', delay: 30_000, priority: 'high' },
)

queue.start()      // drain the queue
scheduler.start()  // fire schedules as they come due

nextRun('0 0 29 2 *')  // -> the next 29 February, computed without brute force
```

The circuit breaker groups failures by target host, so one failing dependency
never takes the whole queue down with it.

### QuickBench — Know Before You Deploy

```typescript
import { BenchmarkRunner, summarise, compareRuns } from '@absuite/quickbench'

const runner = new BenchmarkRunner()

const job = runner.submit({
  name: 'llama3 latency',
  provider: 'ollama',
  model: 'llama3',
  warmupRuns: 3,   // discarded: measures cold cache, not steady state
  testRuns: 20,
  concurrency: 4,
})

// Later, once both runs have completed:
runner.compare(baselineJobId, job.jobId)
// -> { deltaPercent: 42.3, significant: true, verdict: 'regression' }
```

`summarise()` reports min/mean/stddev and p50/p90/p95/p99 using nearest-rank,
so every figure is a latency that was actually observed.

### Connector-Starter — Integrations You Can Trust

```typescript
import { describeConnectors, verifyConnector, generate } from '@absuite/connector-starter'

// What is available, and what is actually configured?
describeConnectors()
// -> [{ id: 'github', configured: true, missing: [], actions: [...] }, ...]

// Verify credentials without any side effect — never posts or creates anything
await verifyConnector('github')

// Turn a description into a manifest and compilable TypeScript
const { manifest, typescript, spec } = generate(
  'Read GitHub issues and post them to Slack every 15 minutes'
)
spec.schedule  // '*/15 * * * *' — ready to hand to Edge-Run
```

Generation is deterministic and rule-based: no API key required, and the same
description always produces identical output — which matters when the result is
committed to a repository.

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

# Shared revocation store — set to a path every service can read so a
# revocation at CapKit locks the token out of the whole suite.
CAPKIT_REVOCATION_FILE=/data/capkit-revocations.jsonl

# Edge-Run
EDGERUN_PORT=8082
EDGERUN_MAX_CONCURRENT=10
EDGERUN_QUEUE_LIMIT=100
EDGERUN_SCRIPT_ROOT=              # unset = script tasks disabled (default)
EDGERUN_ALLOWED_HOSTS=            # unset = any host allowed
EDGERUN_FAILURE_THRESHOLD=5       # failures before the breaker opens
EDGERUN_COOLDOWN_MS=30000

# QuickBench
QUICKBENCH_PORT=8083
QUICKBENCH_OLLAMA_URL=http://localhost:11434

# Connector-Starter (all optional — each connector reports its own state)
CONNECTOR_STARTER_PORT=8084
GITHUB_TOKEN=
SLACK_BOT_TOKEN=
NOTION_TOKEN=
LINEAR_API_KEY=

# Dashboard
DASHBOARD_PORT=3001
```

---

## 🧪 Running Tests

```bash
# All packages (246 tests)
pnpm test

# A single module
pnpm --filter @absuite/capkit test
pnpm --filter @absuite/edge-run test
pnpm --filter @absuite/quickbench test
pnpm --filter @absuite/connector-starter test
```

The suites target the paths where being wrong actually costs something:

| Module | Covered |
|---|---|
| CapKit | Signature tampering, `alg: none` downgrade, expiry, audience mismatch, scope escalation, revocation, audit-chain tampering and deletion |
| Edge-Run | Cron ranges/steps/aliases, leap-year schedules, day-of-month OR day-of-week, backoff jitter and caps, breaker transitions, script path escapes, host allowlist |
| QuickBench | Nearest-rank percentiles, zero-variance comparison, noise rejection, run-count clamping |
| Connector-Starter | `anyOf` credential groups, input validation, non-https rejection, deterministic generation, brace balance in generated code |
| Commercial | API keys stored only as hashes, quota boundaries, suspension, plan monotonicity, Stripe signature tampering and replay, metering period isolation |
| Persistence | Schedule and task round-trip, interrupted tasks resumed, finished work not resurrected, corrupt rows skipped rather than fatal |

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

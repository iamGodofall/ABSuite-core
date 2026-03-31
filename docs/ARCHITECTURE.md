# ABSuite Architecture

> How the pieces fit together.

---

## System Overview

ABSuite is structured as a **modular monorepo** — each package is an independent, composable unit that can run alone or together as a full platform.

```
                    ┌──────────────────────────────────────┐
                    │           Developer / CLI             │
                    │    (absuite CLI or direct HTTP)      │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │           ABSuite Dashboard            │
                    │        React + Vite + Socket.io       │
                    │           Port :3001                  │
                    └──────────────────┬───────────────────┘
                                       │ HTTP + WebSocket
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
┌─────────▼─────────┐     ┌────────────▼──────────┐    ┌──────────▼──────────┐
│     CapKit       │     │      Edge-Run         │    │     QuickBench       │
│  Security Layer   │     │  Execution Layer      │    │  Benchmarking Layer  │
│                  │     │                       │    │                      │
│ · JWT validation │     │ · Cron scheduling     │    │ · Latency profiling  │
│ · Capability     │     │ · Task queues        │    │ · Throughput testing  │
│   tokens         │     │ · Process spawning   │    │ · KV cache analysis   │
│ · AI content     │     │ · Self-healing       │    │ · A/B model comparison│
│   policy         │     │                       │    │                      │
│ · Rate limiting  │     │                       │    │                      │
│ · Audit logging  │     │                       │    │                      │
│   Port :8081     │     │   Port :8082          │    │    Port :8083         │
└─────────┬─────────┘     └────────────┬──────────┘    └──────────┬──────────┘
          │                            │                            │
          └────────────────────────────┼────────────────────────────┘
                                       │
                        ┌──────────────▼─────────────┐
                        │       absuite-db           │
                        │   SQLite (shared volume)   │
                        │  · Audit logs              │
                        │  · Benchmark results       │
                        │  · Capability tokens       │
                        │  · Task metadata           │
                        └────────────────────────────┘
```

---

## Modules

### CapKit — Security Layer

CapKit is the **policy enforcement point** for the entire platform. Every request that enters ABSuite passes through CapKit's validation layer.

**Responsibilities:**
- **JWT creation and validation** — Issued by CapKit, validated on every request
- **Capability tokens** — Scoped, time-limited permissions for agents and services
- **AI content policy** — Filters prompts and responses using configurable policy rules
- **Audit logging** — Every request logged with timestamp, identity, and action
- **Rate limiting** — Per-token, per-IP, and per-endpoint rate limits
- **LLM provider abstraction** — Unified interface across OpenAI, Anthropic, Ollama, etc.

**Data model:**
```typescript
interface AuditEntry {
  id: string
  timestamp: Date
  subject: string        // Who
  action: string         // What
  resource: string       // On what
  result: 'allow' | 'deny'
  reason?: string        // Why denied
  metadata?: Record<string, unknown>
}

interface CapabilityToken {
  kid: string            // Key ID used for HMAC
  sub: string            // Subject (agent/user ID)
  scope: string[]         // Permissions granted
  exp: number            // Expiration unix timestamp
  iat: number            // Issued at
  aud: string            // Audience (absuite://production)
  jti: string            // Unique token ID
}
```

**Threat model:** CapKit assumes network isolation is not guaranteed. All capability tokens are HMAC-signed so they cannot be forged even if an attacker has read access to the database.

---

### Edge-Run — Execution Layer

Edge-Run is the **runtime engine** for scheduled and event-driven agent tasks.

**Responsibilities:**
- **Cron scheduling** — Calendar-based recurring tasks (every 15 min, daily at midnight, etc.)
- **Task queues** — FIFO and priority queues with dead-letter handling
- **Process spawning** — Runs agent scripts as isolated child processes with resource limits
- **Self-healing** — Detects crashes, retries with exponential backoff, and alerts on repeated failures
- **Event streams** — Pub/sub for agent-to-agent communication

**Scheduler design:**
```typescript
interface ScheduledTask {
  id: string
  cron: string            // 6-field cron expression
  task: AgentTask         // Async function to run
  retry: RetryPolicy
  timeout: number         // Max execution time in ms
  enabled: boolean
}

interface RetryPolicy {
  maxAttempts: number
  backoff: 'linear' | 'exponential' | 'jitter'
  baseDelay: number       // ms
  maxDelay: number        // cap
}
```

**Recovery workflow:**
1. Task fails or times out
2. Scheduler logs the failure with attempt count
3. If attempts < maxAttempts → re-queue with backoff delay
4. If attempts exhausted → move to dead-letter queue, emit alert
5. Health check monitors dead-letter queue depth

---

### QuickBench — Performance Layer

QuickBench is the **validation engine** for LLM performance before production deployment.

**Responsibilities:**
- **Inference benchmarking** — Measure tokens/sec, latency, throughput per model
- **KV cache analysis** — Measure cache hit rates and their impact on cost/latency
- **A/B testing** — Compare two models or configurations head-to-head
- **Report generation** — HTML and JSON reports with charts and statistical summaries

**Benchmark types:**
| Type | What it measures |
|------|-----------------|
| `latency` | Time to first token and total response time |
| `throughput` | Tokens generated per second under load |
| `kv-cache` | Cache hit rate and eviction frequency |
| `comparison` | Side-by-side A/B of two model configurations |

**Design principle:** Benchmarks run in isolated containers with controlled resources so results are reproducible and not affected by neighboring services.

---

### Connector-Starter — Integration Layer

Connector-Starter is a **scaffold generator** that produces production-ready adapter code for connecting AI agents to external platforms.

**What it generates:**
- Authentication handlers (OAuth2, API keys, JWT)
- Rate limiters (token bucket, sliding window)
- Retry logic with exponential backoff
- Audit logging hooks
- Health checks

**Built-in templates:** GitHub, Slack, Jira, Mastodon (more added by community)

**Usage:**
```bash
npx @absuite/connector-starter

# Or from the repo:
pnpm --filter connector-starter run dev
```

---

### Dashboard — Unified Control Plane

The Dashboard is a **React + Vite** single-page application that provides:

- **System Overview** — Live health status of all modules
- **AI Studio** — Configure LLM providers, test prompts
- **Service Control** — Start/stop individual services
- **Live Logs** — Streaming logs via WebSocket
- **Benchmark Results** — Historical performance with trend charts

It communicates with all modules via REST APIs and receives live updates via Socket.io.

**Architecture note:** The dashboard is intentionally thin — it aggregates data but doesn't implement business logic. All intelligence lives in the module services. The dashboard is just a better UI.

---

## Data Flow

### Starting a scheduled agent task

```
1. Dashboard → POST /edge-run/schedule { cron, task }
2. Edge-Run → validates request, stores task in SQLite
3. Edge-Run scheduler → adds cron job to internal scheduler
4. At scheduled time → scheduler spawns child process
5. Child process → runs agent task, emits events
6. Edge-Run → logs execution to SQLite, emits WebSocket event
7. Dashboard → receives WebSocket event, updates UI
```

### Benchmarking a model

```
1. Dashboard → POST /quickbench/run { model, provider, metrics }
2. QuickBench → validates config, creates benchmark job
3. QuickBench → spawns isolated benchmark runner container
4. Runner → measures latency/throughput, writes results to SQLite
5. QuickBench → generates HTML report, stores in /reports
6. Dashboard → polls for completion, fetches report
```

---

## Security Model

### Defense in depth

1. **Network level** — Docker networks isolate services; only the dashboard port is exposed to host
2. **Transport level** — All inter-service communication can be TLS-encrypted (configured via env vars)
3. **Application level** — CapKit validates every inbound request
4. **Capability level** — Even valid requests are scoped to specific resources and actions

### Token security

Capability tokens use HMAC-SHA256 with per-tenant keys. Tokens are:
- **Unforgeable** — HMAC prevents tampering
- **Time-limited** — Expire automatically
- **Scope-restricted** — Can only access explicitly granted resources
- **Revocable** — Token ID tracked in database for immediate revocation

### Audit trail

Every request goes through CapKit → audit entry written to SQLite → dashboard displays live.

---

## Deployment Modes

### Development (local)

```bash
pnpm install
pnpm start
# All services on localhost via Docker
```

### Production (single host)

```bash
docker compose -f docker-compose.yml up -d
# All services in containers on a single Docker host
```

### Production (multi-host)

Each module runs on separate hosts, communicating over HTTPS:
```
                    ┌─────────────┐
  Load Balancer ───►│  Dashboard  │ ◄── Browser
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌─────▼────┐     ┌─────▼────┐
    │ CapKit  │      │Edge-Run  │     │QuickBench│
    │ Host A  │      │ Host B   │     │  Host C  │
    └─────────┘      └──────────┘     └──────────┘
```

---

## Configuration Reference

See [Configuration](./CONFIG.md) for the full environment variable reference.

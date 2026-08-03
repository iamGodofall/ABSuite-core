# ABSuite Architecture

> How the pieces fit together.

---

## System Overview

ABSuite is a **modular monorepo**. One package is the core; every other package
depends on it and on nothing else in the repo.

```
  CLIENTS      Dashboard :3001      MCP client       curl / SDK / library
               React · Socket.io    agents           any HTTP client
                      │                  │                  │
                      └──────────────────┼──────────────────┘
                                         │  Authorization: Bearer <capability token>
 ════════════════════════════════════════▼════════════════════════════════════
  @absuitecore/capkit — THE CORE          library + service on :8081
  Imported by every service below. Depends on nothing else in this repo.

    capability.ts  scopes, expiry, audience  │  trace.ts    Ed25519 traces
    jwt.ts         HS256 on node:crypto      │  audit.ts    hash chain
    keyring.ts     rotation without downtime │  tenancy.ts  tenants, metering
    revocation-store.ts  shared across all services, fails closed
    middleware.ts  capabilityGuard()  ◄──── the enforcement point
 ════════════════════════════════════════╤════════════════════════════════════
                                         │ every service imports capabilityGuard
     ┌─────────────┬─────────────┬───────┴─────┬─────────────┐
     ▼             ▼             ▼             ▼             ▼
 ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐  ┌──────────┐
 │ edge-run│  │quickbench│  │ connector-│  │  trust  │  │   mcp    │
 │  :8082  │  │  :8083   │  │  starter  │  │  :8085  │  │  stdio   │
 │         │  │          │  │   :8084   │  │         │  │          │
 │ cron    │  │percentile│  │ registry  │  │evidence │  │ tools    │
 │ queue   │  │providers │  │ verify    │  │chains   │  │ filtered │
 │ retries │  │regression│  │ scaffold  │  │arbitrate│  │ by scope │
 │ breaker │  │ reports  │  │           │  │contracts│  │ attested │
 └────┬────┘  └────┬─────┘  └─────┬─────┘  └────┬────┘  └────┬─────┘
      │            │              │             │            │
      └────────────┴──────┬───────┴─────────────┴────────────┘
              every mutating route guarded by a required scope
                                 ▼
                ┌────────────────────────────────────┐
                │   absuite-db   SQLite in WAL mode  │
                │   one source of truth              │
                │                                    │
                │   tenants · usage · revocations    │
                │   executions (signed, chained)     │
                │   audit · schedules · queue        │
                │   trust events · appeals · chains  │
                └────────────────┬───────────────────┘
                                 │  public key only — nothing secret leaves
                                 ▼
                ┌────────────────────────────────────┐
                │   ANY THIRD PARTY OR AUDITOR       │
                │   docs/verify.html, in a browser   │
                │                                    │
                │   No account. No server.           │
                │   No ability to forge.             │
                └────────────────────────────────────┘
```

### The seven layers, and what implements each

The diagram above is the deployment. This is the same system by function — the
order trust is built, and the code that does each part. The console's navigation
is these seven words, in this order.

| | Layer | Implemented by | Entry point |
|---|---|---|---|
| 1 | **Observe** | `capkit/trace.ts` — `TraceStore.record()` | `POST /executions` |
| 2 | **Verify** | `capkit/trace.ts` — `verifyTrace()`, `verifyChain()`, `compareReplay()` | `POST /executions/verify`, `GET /executions-verify-chain` |
| 3 | **Explain** | `capkit/explain.ts` — derived from signed fields, no model | `GET /executions/:id/explain` |
| 4 | **Govern** | `capkit/capability.ts`, `capkit/middleware.ts`, `capkit/ai-policy-generator.ts` | `POST /auth/token`, `capabilityGuard()` |
| 5 | **Arbitrate** | `trust/` — correlation discounting, evidence weighting | `POST /arbitrate`, `GET /anomalies` |
| 6 | **Act** | `edge-run/`, `connector-starter/`, `mcp/` | `POST /schedule`, `POST /queue`, MCP stdio |
| 7 | **Learn** | `quickbench/measure.ts`, `quickbench/core-suite.ts` | `GET /bench/core`, `pnpm bench:core` |

Two layers carry constraints that are architectural, not stylistic:

**Layer 3 uses no language model.** A generated explanation is a second
unauditable system stacked on the first. `explain.ts` derives every sentence from
a signed field and names the field, so the prose can be checked against the
record and disagreed with.

**Layer 7 publishes nothing it did not measure.** `measure.ts` records the CPU,
core count, memory, platform and Node version alongside every figure; throughput
comes from elapsed wall-clock time rather than a mean, and warmup is discarded
and stated. `docs/PERFORMANCE.md` is generated from the benchmark output, and CI
fails if the two disagree.

---

### Why enforcement is a library, not a gateway

A common design routes every request through a central orchestrator, with the
services stripped of authority. It looks tidy on a diagram and is worse in
practice:

- **Single point of failure.** The orchestrator goes down, everything stops.
- **Throughput bottleneck.** All traffic funnels through one process.
- **It leaves a bypass.** If services carry no authority, anything that reaches
  a service directly — a misconfigured network, a container on the same host, a
  developer with curl — executes unchecked.

ABSuite distributes the *same* guard to every service instead. `capabilityGuard`
comes from `@absuitecore/capkit`, so a request arriving at Edge-Run directly is
checked by exactly the same code that would have checked it at a gateway.
**There is no unguarded door.**

The trade-off is honest: enforcement logic is deployed in several places, so a
fix must be released to all of them. Sharing one library rather than
reimplementing per service is what keeps that manageable.

### The one invariant

```
@absuitecore/capkit            → (no workspace dependencies)
@absuitecore/edge-run          → @absuitecore/capkit
@absuitecore/quickbench        → @absuitecore/capkit
@absuitecore/connector-starter → @absuitecore/capkit
@absuitecore/mcp               → @absuitecore/capkit
```

The core depends on nothing; everything depends on the core. Never invert that
arrow. Folder names do not matter; this direction does.

### Request lifecycle

```
request → capability verified (signature, expiry, audience, scope, revocation)
        → tenant resolved, quota checked        402 if exceeded, 403 if suspended
        → execution                             real API call, real process
        → trace recorded                        hash-chained, Ed25519-signed
        → result returned with its attestation
```

---

## Modules

### CapKit — Security Layer

CapKit is both a **library** and a **service**, and the distinction matters.

As a **library**, it is imported by every other package. `capabilityGuard()` is
the enforcement point, and it runs *inside each service* — so a request reaching
Edge-Run directly is checked by the same code that would check it anywhere else.

As a **service** on `:8081`, it issues and revokes tokens, stores the audit chain
and execution traces, and serves the public key auditors verify with.

Traffic does **not** route through CapKit-the-service to be authorised. That
would be a bottleneck and a single point of failure, and it would leave services
unguarded to anything that reached them directly.

**Responsibilities:**
- **JWT creation and validation** — Issued by CapKit, validated on every request
- **Capability tokens** — Scoped, time-limited permissions for agents and services
- **Access-policy generation** — turns a description of what an agent should be allowed to do into a policy *document*: scopes, a rate limit, a filter level, an audit setting. Deterministic and rule-based, and it reports `source: 'rule-based'` so nobody mistakes it for a model. It emits text and **enforces nothing** — ABSuite does not inspect prompts or responses, and [SECURITY-MODEL.md](SECURITY-MODEL.md) says why that is a position rather than a gap
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
npx @absuitecore/connector-starter

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
3. **Application level** — every service enforces `capabilityGuard()` from `@absuitecore/capkit` on its own routes; there is no unguarded door
4. **Capability level** — Even valid requests are scoped to specific resources and actions

### Token security

Capability tokens are HS256 JWTs signed with `node:crypto` — no third-party JWT
dependency on the security-critical path. Tokens are:
- **Unforgeable** — signature verified in constant time; `alg: none` and tampered payloads rejected
- **Time-limited** — expiry enforced, with optional audience binding
- **Scope-restricted** — segment-wise matching, so `read:*` grants `read:users` but never `read:users:delete`
- **Revocable** — `jti` recorded in a store every service reads, so revocation is immediate across the suite
- **Rotatable** — `KeyRing` keeps recently retired keys verifying, so rotating a secret never logs running agents out

### Audit trail

Two records exist, and they answer different questions.

**The audit log** answers *"was this permitted?"* — every allow and deny, with
subject, action, resource and reason. Hash-chained, so editing history breaks
the chain and `/audit/verify` names the first broken entry.

**The execution trace** answers *"what actually happened, and can you prove
it?"* — hash-chained *and* Ed25519-signed. Verification needs only the public
key, and a public key cannot produce a signature, so the operator cannot
fabricate history and an auditor cannot fabricate an accusation.

Inputs and outputs are stored as **hashes, never content** — a trace proves what
happened without retaining the underlying data.

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

See [Configuration](../README.md#-configuration) for the full environment variable reference.

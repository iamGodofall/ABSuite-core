# ABSuite API Reference

> REST API endpoints for each ABSuite module.

---

## CapKit — `:8081`

### Authentication

All CapKit endpoints require a capability token in the Authorization header:

```
Authorization: Bearer <capability-token>
```

Capabilities required for each endpoint are listed below.

---

### `POST /auth/token`

Create a new capability token.

**Required capabilities:** `auth:token:create`

**Request:**
```json
{
  "sub": "agent-001",
  "scope": ["read:users", "write:tasks"],
  "expiresIn": "8h",
  "aud": "absuite://production"
}
```

**Response `200`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "kid": "key-2026-03-a",
  "jti": "uuid-of-token",
  "exp": 1743369600,
  "iat": 1743345600
}
```

---

### `POST /auth/token/validate`

Validate a token (used by other services to check incoming requests).

**Required capabilities:** `auth:token:validate`

**Request:**
```json
{
  "token": "<capability-token>"
}
```

**Response `200`:**
```json
{
  "valid": true,
  "sub": "agent-001",
  "scope": ["read:users", "write:tasks"],
  "exp": 1743369600
}
```

**Response `400` (invalid token):**
```json
{
  "valid": false,
  "error": "TOKEN_EXPIRED"
}
```

---

### `GET /audit`

Query audit log entries.

**Required capabilities:** `audit:read`

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 50 | Max results (1-500) |
| `offset` | int | 0 | Pagination offset |
| `subject` | string | — | Filter by subject |
| `action` | string | — | Filter by action |
| `result` | string | — | Filter by result (allow/deny) |
| `from` | ISO date | — | Start date |
| `to` | ISO date | — | End date |

**Response `200`:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "timestamp": "2026-03-30T12:00:00Z",
      "subject": "agent-001",
      "action": "POST /tasks",
      "resource": "/tasks",
      "result": "allow",
      "durationMs": 12
    }
  ],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

---

### `GET /health`

Health check — no authentication required.

**Response `200`:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600
}
```

---

## Edge-Run — `:8082`

### `POST /schedule`

Schedule a recurring task.

**Required capabilities:** `schedule:create`

**Request:**
```json
{
  "id": "data-sync",
  "cron": "*/15 * * * *",
  "task": {
    "type": "http",
    "url": "https://api.example.com/sync",
    "method": "POST"
  },
  "retry": {
    "maxAttempts": 3,
    "backoff": "exponential",
    "baseDelay": 1000
  },
  "timeout": 30000
}
```

**Response `201`:**
```json
{
  "id": "data-sync",
  "nextRun": "2026-03-30T12:15:00Z",
  "status": "scheduled"
}
```

---

### `GET /schedule`

List all scheduled tasks.

**Required capabilities:** `schedule:read`

**Response `200`:**
```json
{
  "tasks": [
    {
      "id": "data-sync",
      "cron": "*/15 * * * *",
      "status": "active",
      "nextRun": "2026-03-30T12:15:00Z",
      "lastRun": "2026-03-30T12:00:00Z",
      "runCount": 4,
      "failureCount": 0
    }
  ]
}
```

---

### `POST /queue`

Add a task to the queue.

**Required capabilities:** `queue:write`

**Request:**
```json
{
  "id": "email-welcome",
  "priority": "high",
  "delay": 0,
  "task": {
    "type": "script",
    "script": "./scripts/send-welcome.js"
  }
}
```

---

### `GET /queue/:id/status`

Get status of a queued task.

**Required capabilities:** `queue:read`

**Response `200`:**
```json
{
  "id": "email-welcome",
  "status": "completed",
  "result": { "emailed": 1 },
  "queuedAt": "2026-03-30T12:00:00Z",
  "startedAt": "2026-03-30T12:00:05Z",
  "completedAt": "2026-03-30T12:00:12Z"
}
```

---

### `GET /runtime/logs`

Stream live logs from all running tasks (Server-Sent Events).

**Required capabilities:** `runtime:read`

**Response:** `text/event-stream`

```
data: {"task":"data-sync","timestamp":"...","level":"info","message":"Task started"}

data: {"task":"data-sync","timestamp":"...","level":"info","message":"Sync complete"}
```

---

### `GET /health`

Health check — no authentication required.

**Response `200`:**
```json
{
  "status": "healthy",
  "activeTasks": 3,
  "queuedTasks": 1,
  "failedTasks": 0,
  "uptime": 7200
}
```

---

## QuickBench — `:8083`

### `POST /run`

Run a benchmark suite.

**Required capabilities:** `bench:run`

**Request:**
```json
{
  "name": "llama3-vs-mistral",
  "provider": "ollama",
  "model": "llama3",
  "metrics": ["latency", "throughput", "kv_cache"],
  "warmupRuns": 3,
  "testRuns": 10,
  "concurrency": 1
}
```

**Response `202`:**
```json
{
  "jobId": "bench-2026-03-30-001",
  "status": "queued",
  "estimatedDuration": "60s"
}
```

---

### `GET /run/:jobId`

Get benchmark job status.

**Required capabilities:** `bench:read`

**Response `200`:**
```json
{
  "jobId": "bench-2026-03-30-001",
  "status": "running",
  "progress": 0.4,
  "currentMetric": "latency"
}
```

---

### `GET /run/:jobId/report`

Get completed benchmark report.

**Required capabilities:** `bench:read`

**Response `200`:**
```json
{
  "jobId": "bench-2026-03-30-001",
  "name": "llama3-vs-mistral",
  "completedAt": "2026-03-30T12:05:00Z",
  "results": {
    "latency": {
      "p50": 120,
      "p95": 240,
      "p99": 380,
      "unit": "ms"
    },
    "throughput": {
      "value": 47.2,
      "unit": "tokens/sec"
    },
    "kv_cache_hit_rate": {
      "value": 0.823,
      "unit": "ratio"
    }
  }
}
```

---

### `GET /history`

List historical benchmark results.

**Required capabilities:** `bench:read`

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | Max results |
| `model` | string | — | Filter by model |
| `provider` | string | — | Filter by provider |

**Response `200`:**
```json
{
  "benchmarks": [
    {
      "jobId": "bench-2026-03-30-001",
      "name": "llama3-vs-mistral",
      "model": "llama3",
      "provider": "ollama",
      "completedAt": "2026-03-30T12:05:00Z",
      "summary": {
        "latency_p50_ms": 120,
        "throughput_tokens_per_sec": 47.2
      }
    }
  ]
}
```

---

### `GET /health`

Health check — no authentication required.

**Response `200`:**
```json
{
  "status": "healthy",
  "uptime": 1800,
  "availableProviders": ["ollama", "openai"]
}
```

---

## Capability Reference

### Scope format

`resource:action` or `resource:action:sub-resource`

Examples:
- `read:users` — Read users
- `write:tasks:execute` — Write + execute tasks
- `*:*` — Full access (use sparingly)

### Default service capabilities

| Service | Capabilities |
|---------|-------------|
| Dashboard | `*` (all) |
| Edge-Run scheduler | `schedule:read`, `schedule:create`, `queue:read`, `queue:write` |
| QuickBench runner | `bench:run`, `bench:read` |
| External API clients | Minimal scoped tokens issued by dashboard |

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": {
    "code": "CAPABILITY_INSUFFICIENT",
    "message": "Token missing required scope: schedule:create",
    "requestId": "uuid"
  }
}
```

### Error codes

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | `INVALID_REQUEST` | Malformed JSON or missing fields |
| 401 | `TOKEN_MISSING` | No Authorization header |
| 401 | `TOKEN_INVALID` | Signature verification failed |
| 401 | `TOKEN_EXPIRED` | Token past expiration |
| 403 | `CAPABILITY_INSUFFICIENT` | Token lacks required scope |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

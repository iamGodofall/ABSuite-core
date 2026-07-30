# ABSuite API Reference

> **Generated from source** by `scripts/gen-api-docs.mjs`. Do not edit by hand —
> run `pnpm docs:api` after changing a route. CI fails if this drifts.

---

## Authentication

Three credential types, used for different purposes:

| Header | Purpose |
|---|---|
| `Authorization: Bearer <token>` | A capability token carrying the required scope. |
| `X-ABSuite-Admin-Key` | Bootstrap credential. Grants full authority — used to mint the first token and manage tenants. |
| `X-ABSuite-Tenant-Key` | Identifies the billed tenant. Optional; omit for an unmetered self-hosted deployment. |

**Scopes** are `resource:action`, matched segment-wise: `read:*` grants
`read:users` but never `read:users:delete`. A bare `*` grants everything.

**Enforcement is distributed.** Every service imports `capabilityGuard` from
`@absuitecore/capkit`, so a request reaching a service directly is checked by the
same code a gateway would have used. There is no unguarded door.

---

## Errors

Every error has the same shape:

```json
{ "error": { "code": "CAPABILITY_INSUFFICIENT", "message": "Token missing required scope: queue:write" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed body or missing fields |
| 401 | `TOKEN_MISSING` | No `Authorization` header |
| 401 | `TOKEN_INVALID` | Signature verification failed |
| 401 | `TOKEN_EXPIRED` | Past expiry |
| 401 | `TOKEN_REVOKED` | Revoked at CapKit; applies across every service |
| 401 | `TENANT_KEY_INVALID` | Tenant key supplied but not recognised |
| 403 | `CAPABILITY_INSUFFICIENT` | Valid token, wrong scope |
| 403 | `TENANT_SUSPENDED` | Account suspended — usually a failed payment |
| 402 | `QUOTA_EXCEEDED` | Monthly plan limit reached |
| 429 | `RATE_LIMITED` | Burst rate exceeded; see `Retry-After` |
| 404 | `NOT_FOUND` | No such route or resource |
| 503 | `REVOCATION_UNAVAILABLE` | Revocation store unreachable — fails closed, never open |

---

## CapKit — `:8081`

Capability tokens, audit, verifiable execution, tenancy and billing.

| Method | Path | Required scope | Counts against |
|---|---|---|---|
| GET | `/admin/tenants` | `tenant:manage` | — |
| POST | `/admin/tenants` | `tenant:manage` | — |
| GET | `/admin/tenants/:id` | `tenant:manage` | — |
| POST | `/admin/tenants/:id/plan` | `tenant:manage` | — |
| POST | `/admin/tenants/:id/rotate-key` | `tenant:manage` | — |
| POST | `/admin/tenants/:id/status` | `tenant:manage` | — |
| POST | `/ai/policy/generate` | _public_ | — |
| GET | `/ai/providers` | _public_ | — |
| GET | `/audit` | `audit:read` | — |
| GET | `/audit/verify` | `audit:read` | — |
| POST | `/auth/token` | `auth:token:create` | `agents` |
| POST | `/auth/token/revoke` | `auth:token:revoke` | — |
| POST | `/auth/token/validate` | `auth:token:validate` | `validations` |
| POST | `/billing/webhook` | _public_ | — |
| GET | `/executions` | `execution:read` | — |
| POST | `/executions` | `execution:record` | — |
| GET | `/executions-verify-chain` | `execution:read` | — |
| GET | `/executions/:id` | `execution:read` | — |
| GET | `/executions/:id/conditions` | `execution:read` | — |
| GET | `/executions/:id/explain` | `execution:read` | — |
| GET | `/executions/:id/replay` | `execution:read` | — |
| POST | `/executions/:id/replay` | `execution:read` | — |
| GET | `/executions/attention` | `execution:read` | — |
| GET | `/executions/authority` | `execution:read` | — |
| GET | `/executions/public-key` | _public_ | — |
| GET | `/executions/stats` | `execution:read` | — |
| GET | `/executions/unknowns` | `execution:read` | — |
| POST | `/executions/verify` | _public_ | — |
| GET | `/health` | _public_ | — |
| POST | `/issue` | `auth:token:create` | — |
| GET | `/metrics` | _public_ | — |
| GET | `/plans` | _public_ | — |
| GET | `/ready` | _public_ | — |
| GET | `/signup` | _public_ | — |
| POST | `/signup` | _public_ | — |
| GET | `/usage` | _public_ | — |

### Notes

**`POST /auth/token/validate`** — Validate a token, optionally against a specific capability. `requiredScope` is honoured. It was accepted and silently ignored until 1.1.0, which meant asking "is this token good for payment:refund?" about a token holding only `payment:approve` answered `{"valid": true}` — a false allow produced by an unrecognised field, in the endpoint whose entire job is to answer that question. The response now echoes `requiredScope` back, so a caller can see the check was performed rather than assume it.

**`POST /billing/webhook`** — Stripe webhook. Verified against the raw body before anything is trusted. Without a configured secret the endpoint refuses outright rather than accepting unsigned plan changes.

**`GET /executions/:id/conditions`** — The five necessary conditions, assessed for one execution. Trust := f(Identity, Capability, Evidence, Governance, Time) `f` is not implemented, here or anywhere. This returns the inputs — each demonstrated, unproven or absent, each naming its source field — and a conclusion in words. There is no score, and the absence is deliberate: a number replaces evidence with something nobody audits.

**`GET /executions/:id/explain`** — Explain a record in plain language. Derived from signed fields, never generated by a model: an explanation produced by a system nobody can inspect, about a record whose value is that it *can* be inspected, would be the least trustworthy thing on the page.

**`GET /executions/attention`** — What a person should look at, with the field that says so. Deliberately not called "incidents". An incident is a judgement about meaning; this is the narrower claim ABSuite is entitled to make — these records are failed, unproven or unauthorised on their face. Whether any of it matters is the reader's call, and the response says so.

**`GET /executions/authority`** — Authority actually exercised, per subject. Built from records of what happened rather than tokens that were issued: an unused token grants nothing observable, and an access review needs behaviour, not intent.

**`GET /executions/public-key`** — The public half of the trace signing key. Deliberately unauthenticated: verification is meant to be possible by an auditor or customer who holds no ABSuite credentials at all.

**`GET /executions/stats`** — Aggregate counts across everything recorded, plus a live chain verification. This is what a control plane opens on, so it is also the easiest screen in the product to lie on. Every field is a count of records that exist; the verification result comes from actually walking the chain on this request rather than from a cached "healthy". `unverifiable` names what we deliberately do not track, so an absent number reads as absent rather than as zero.

**`GET /executions/unknowns`** — Everything this instance could know and does not, grouped by what would fix it. An UNKNOWN is not a destination; it is a queue of work. Every unknown in the system already carries its own route out, and once you have thousands of records those routes collapse into a handful of distinct actions — supply the public key, record output hashes, attach a policy reference. This groups them and counts how many records each one would resolve. Counts, not priorities. Which of these matters is a judgement, and ordering them by importance would be ABSuite making it.

**`POST /executions/verify`** — Verify a single trace, or the whole chain. Unauthenticated by design: a customer or regulator must be able to check a trace they were handed without holding an ABSuite credential.

**`POST /issue`** — The dashboard issues tokens with an {actor, action, resource, expires} shape. Map it onto the capability model rather than making the dashboard speak two dialects.

**`GET /ready`** — Readiness differs from liveness: it fails if storage is unusable.

**`GET /usage`** — A tenant's own usage and quota position, for a billing page.

---

## Edge-Run — `:8082`

Cron scheduling, task queue, retries and self-healing execution.

| Method | Path | Required scope | Counts against |
|---|---|---|---|
| GET | `/health` | _public_ | — |
| GET | `/metrics` | _public_ | — |
| GET | `/queue` | `queue:read` | — |
| POST | `/queue` | `queue:write` | — |
| GET | `/queue/:id/status` | `queue:read` | — |
| GET | `/ready` | _public_ | — |
| GET | `/runtime/health` | `runtime:read` | — |
| GET | `/runtime/logs` | `runtime:read` | — |
| GET | `/schedule` | `schedule:read` | — |
| POST | `/schedule` | `schedule:create` | — |
| DELETE | `/schedule/:id` | `schedule:create` | — |
| POST | `/schedule/:id/pause` | `schedule:create` | — |
| POST | `/schedule/:id/resume` | `schedule:create` | — |

---

## QuickBench — `:8083`

LLM and HTTP benchmarking with statistical regression detection.

| Method | Path | Required scope | Counts against |
|---|---|---|---|
| GET | `/bench/core` | _public_ | — |
| POST | `/bench/core` | `bench:run` | — |
| GET | `/bench/core/regression` | _public_ | — |
| GET | `/compare` | `bench:read` | — |
| GET | `/health` | _public_ | — |
| GET | `/history` | `bench:read` | — |
| GET | `/metrics` | _public_ | — |
| GET | `/providers` | _public_ | — |
| GET | `/ready` | _public_ | — |
| POST | `/run` | `bench:run` | — |
| GET | `/run/:jobId` | `bench:read` | — |
| GET | `/run/:jobId/report` | `bench:read` | — |

### Notes

**`GET /bench/core/regression`** — This run against the previous one — the step that closes the loop. A measurement on its own is a number on a screen. Compared against the last run on the same machine it becomes a signal, which is what makes Learn feed back into the system instead of terminating in a dashboard tile.

---

## Connector-Starter — `:8084`

Connector registry, credential verification and scaffolding.

| Method | Path | Required scope | Counts against |
|---|---|---|---|
| GET | `/connectors` | _public_ | — |
| GET | `/connectors/:id` | _public_ | — |
| POST | `/connectors/:id/actions/:action` | `connector:execute` | — |
| POST | `/connectors/:id/verify` | `connector:read` | — |
| POST | `/generate` | _public_ | — |
| GET | `/health` | _public_ | — |
| GET | `/metrics` | _public_ | — |
| GET | `/ready` | _public_ | — |

### Notes

**`POST /connectors/:id/verify`** — Read-only credential check — never performs a write.

---

## Trust — `:8085`

Trust events and appeals, explainable scoring, output grounding checks, agent-chain monitoring, arbitration and reciprocal contracts.

| Method | Path | Required scope | Counts against |
|---|---|---|---|
| GET | `/anomalies` | `trust:read` | — |
| POST | `/appeals/:appealId/decide` | `trust:manage` | — |
| POST | `/arbitrate` | `trust:arbitrate` | — |
| POST | `/breaches/:breachId/remediate` | `trust:write` | — |
| GET | `/chains` | `trust:read` | — |
| GET | `/chains/:chainId` | `trust:read` | — |
| GET | `/contracts` | `trust:read` | — |
| POST | `/contracts` | `trust:manage` | — |
| GET | `/contracts/:contractId` | `trust:read` | — |
| POST | `/contracts/:contractId/breach` | `trust:write` | — |
| GET | `/contracts/:contractId/health` | `trust:read` | — |
| POST | `/contracts/:contractId/reinstate` | `trust:manage` | — |
| POST | `/contracts/:contractId/suspend` | `trust:manage` | — |
| GET | `/disputes` | `trust:read` | — |
| POST | `/disputes` | `trust:arbitrate` | — |
| GET | `/disputes/:disputeId` | `trust:read` | — |
| POST | `/disputes/:disputeId/arbitrate` | `trust:arbitrate` | — |
| POST | `/disputes/:disputeId/decide` | `trust:manage` | — |
| GET | `/disputes/pending` | `trust:read` | — |
| POST | `/events` | `trust:write` | — |
| POST | `/events/:eventId/appeal` | `trust:appeal` | — |
| GET | `/events/:eventId/appeals` | `trust:read` | — |
| GET | `/events/:subjectId` | `trust:read` | — |
| GET | `/evidence/:subjectId` | `trust:read` | — |
| GET | `/health` | _public_ | — |
| POST | `/interactions` | `trust:write` | — |
| POST | `/interactions/:interactionId/observe` | `trust:write` | — |
| GET | `/metrics` | _public_ | — |
| GET | `/obligations` | _public_ | — |
| GET | `/ready` | _public_ | — |
| GET | `/score/:subjectId` | `trust:read` | — |
| POST | `/score/:subjectId/check` | `trust:read` | — |
| GET | `/scores` | `trust:read` | — |
| POST | `/verify` | `trust:verify` | — |

### Notes

**`GET /anomalies`** — Every structural anomaly across recent chains — cycles, runaways, stalls, disagreement.

**`POST /arbitrate`** — Arbitrate without storing anything — for callers evaluating the thresholds.

**`POST /contracts/:contractId/breach`** — Record a breach by either party. An operator breach is never charged to the agent's score — attributing a failure to the component that cannot fix it is the exact defect this framework exists to remove.

**`GET /contracts/:contractId/health`** — Whose fault the failures actually are. Usually the most useful call here.

**`POST /disputes/:disputeId/arbitrate`** — Arbitrate. Agreement between participants of the same model family is discounted, and an irreversible dispute always escalates to a human.

**`GET /disputes/pending`** — Disputes waiting on a human decision.

**`POST /events`** — Record a trust event. Every event should point at an artefact that proves it.

**`POST /events/:eventId/appeal`** — Appeal an event. Contestability is not a feature flag — a score nobody can challenge is a blacklist.

**`GET /evidence/:subjectId`** — What was recorded about a subject, as facts — no score, no ranking, no conclusion. Available for every subject type including humans, because counting what happened is not the same act as rating someone.

**`POST /interactions/:interactionId/observe`** — Attach an observer's opinion. Stored as an opinion, never promoted to truth.

**`POST /score/:subjectId/check`** — Ask whether a subject clears a threshold. Returns `allowed: true` whenever gating is disabled — advisory scores must never deny anyone access.

**`POST /verify`** — Check an output against the sources it was meant to be grounded in. Returns risk signals, not a truth verdict — see the disclaimer in the body.

---

## MCP server

`@absuitecore/mcp` speaks Model Context Protocol over stdio rather than HTTP.
Tool discovery is filtered by capability — an agent never sees a tool its
token cannot call — and every completed call returns the signed trace that
attests it. See [`packages/mcp/README.md`](../packages/mcp/README.md).

---

_103 HTTP endpoints across 5 services. Generated from source._

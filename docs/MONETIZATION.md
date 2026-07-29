# ABSuite Monetization Strategy

> **Historical — superseded 29 July 2026.**
> Written when there were five modules and 119 tests; there are now seven
> published packages and 412 tests. The pricing reasoning still stands; the
> inventory does not.
> The current state of the project is in
> [`docs/ROADMAP.md`](./ROADMAP.md); the current numbers are whatever
> `pnpm test` and `pnpm docs:check` print. This document is kept for the
> reasoning, not for its facts.

> Updated 2026-07-28, after building out the full suite. Every capability claim
> below was verified by running the code, not read off a README.

---

## 1. Where things actually stand

### Verified working

All five modules are implemented, tested (119 tests) and were run together
end-to-end:

| Module | Verified behaviour |
|---|---|
| **CapKit** | Issues signed capability tokens; rejects `alg: none`, tampered payloads, expired tokens, audience mismatch and insufficient scope; tamper-evident audit chain; shared revocation store |
| **Edge-Run** | Cron scheduling (including leap-year and OR-semantics cases), priority queue, retries with jittered backoff, per-target circuit breaker, SSE log stream |
| **QuickBench** | Real latency percentiles against a live service (p50 3.97ms, p95 9.64ms, 217 req/s measured), Welch's t-test regression verdicts, Markdown/CSV reports |
| **Connector-Starter** | 6 connectors with honest configuration reporting, read-only verification, deterministic manifest + TypeScript generation |
| **Dashboard** | Live service status, token issuance through CapKit, live latency benchmarks |

### The proof that it is a suite

One capability token was issued by CapKit and accepted by Edge-Run and
QuickBench. Revoking it at CapKit caused **both** other services to return
`401 TOKEN_REVOKED` on the next request.

That single behaviour is the commercial centre of gravity. It is what a
competitor cannot trivially replicate by publishing another JWT library, and it
is what justifies the suite existing rather than four separate tools.

### Now built: the commercial layer

The gaps listed in the previous revision of this document have been closed:

- **Multi-tenancy** — tenants with hashed API keys, rotation, suspension.
- **Usage metering** — per tenant, per metric, per month. Invoices can be built.
- **Quota enforcement** — verified live: a free-plan tenant is cut off with
  `402` after 3 agents; a suspended tenant gets `403`.
- **Billing** — Stripe webhooks with signature verification and replay
  protection. A failed payment suspends; a cancellation downgrades to free
  rather than deleting the tenant's data.
- **Durable state** — SQLite via Node's built-in driver. Verified: schedules
  survive a `SIGTERM` and restart (`Restored 2 schedule(s)`).
- **Observability** — Prometheus `/metrics`, `/health`, `/ready`.

### Remaining gaps

- **Single-node SQLite.** Durable and correct for one node; horizontal scaling
  needs Postgres. The `Storage` and `RevocationStore` interfaces make this a
  swap rather than a rewrite.
- **No backup automation.** One file to snapshot, but nothing does it yet.
- **No per-tenant rate limiting.** Monthly quotas exist; burst rate does not.
- **No hosted infrastructure.** No accounts UI, deploy pipeline or support rota.
- **No signing-key rotation.** `kid` is issued but only one key is active.

---

## 2. A necessary word on timelines

You have said money is urgent. I would be doing you a disservice if I implied
this repository converts to cash quickly, so plainly:

**Infrastructure software is one of the slowest-converting things to sell.**
Buyers are engineers, evaluation cycles run weeks, and the first paying customer
typically comes months after the first release — not days. The work now exists
and is genuinely good, but the gating factor is no longer code. It is
distribution, billing, and conversations with users.

Two implications worth acting on:

1. **Do not let this be the only iron in the fire** while it matures. The
   sections below are ordered to get to revenue as fast as this category
   realistically allows, which is still not fast.
2. **The fastest money adjacent to this work is services, not licences.** The
   skills demonstrated here — agent authorization, scheduling, benchmarking —
   are billable as contract work *now*, at rates that do not require anyone to
   buy a product. See §5.

---

## 3. What to sell

### Primary: agent authorization (CapKit)

Teams deploying AI agents must answer: *what is this agent allowed to do, for
how long, and can I prove what it did?* The common answer today is a long-lived
API key in an environment variable with full account access.

CapKit replaces that with scoped, expiring, revocable, auditable grants. It has
a real buyer (the engineer shipping agents to production) and a compliance
angle (the hash-chained audit log).

### The natural paywall, already built

The free tier is genuinely production-usable on one node. The paid trigger is a
boundary customers hit by growing, not one manufactured by crippling the free
tier:

| Limitation | Free | Paid |
|---|---|---|
| Revocation | File-based, one volume | Hosted, multi-region |
| Audit retention | Local JSONL | Queryable, retained, exportable |
| Schedules/queue | In memory, lost on restart | Durable |
| Key rotation | Single key | Multiple keys with `kid` |

### Pricing

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Self-hosted, all five modules, MIT |
| Team | $49/mo | Hosted revocation, 25 agents, 90-day audit retention |
| Business | $299/mo | 250 agents, 1-year retention, SAML SSO, audit export, SLA |
| Enterprise | Custom | Unlimited, on-prem, compliance support |

### Positioning

Not "a platform" — that competes with funded companies on breadth. Lead with the
primitive and let the suite be the depth behind it:

> **ABSuite — scoped, expiring, auditable credentials for AI agents.
> Stop handing your agents your root API key.**

---

## 4. Build order from here

Metering, tenancy, billing and durability are done. What remains, ranked by
revenue impact per unit of effort:

1. **Publish to npm and Docker Hub** — not a feature, but nothing sells while
   nobody can install it. Hours of work, and it gates everything else.
2. **A signup page** — a form that calls `POST /admin/tenants` and shows the API
   key once. Without it, every customer must be onboarded by hand.
3. **Per-tenant rate limiting** — quotas cap the month; nothing caps the minute.
   One tenant can still saturate a node.
4. **Backup automation** — snapshot the SQLite volume on a schedule and *test a
   restore*. Required before promising anyone an SLA.
5. **Postgres storage adapter** — implement the existing `Storage` interface.
   Only needed when a customer's scale actually demands it.
6. **Framework middleware packages** — `capabilityGuard` adapters for Fastify
   and Hono. Removes adoption friction entirely.
7. **Audit export to SIEM** — Splunk/Datadog sinks. The enterprise wedge.

Note the shape of this list: the top two items are **distribution**, not
engineering. That is the honest state of the project now.

---

## 5. Faster revenue paths, ranked by speed

Ordered by realistic time-to-first-payment:

### Days to weeks — consulting on the strength of this work

This repository is now a credible portfolio piece: a working authorization
layer, a correct cron implementation, a statistically literate benchmark
harness. That evidences senior infrastructure capability, and it is billable
immediately as contract work. Agent-infrastructure consulting is in demand and
prices well. **This is the only path here that can pay inside a month.**

### Weeks — sponsorship and open-source support

Publish to npm under MIT, add GitHub Sponsors, offer paid installation and
support. Small amounts, but real, and it builds the audience the product tier
needs.

### Months — the hosted product

Everything in §3 and §4. Real, larger, and genuinely slower. Build it, but do
not budget against it.

---

## 6. The 30-day plan

| Week | Focus | Deliverable |
|---|---|---|
| 1 | Ship | Publish all five packages to npm; launch post on the specific problem |
| 1 | Earn | Start contract outreach using this repo as the portfolio piece |
| 2 | Listen | 5+ conversations with teams running agents; log every objection verbatim |
| 3 | Meter | Usage metering + Redis revocation store |
| 4 | Charge | Stripe + hosted beta; onboard the warmest conversations |

**Success at day 30 is not a large number.** It is one contract signed, plus
three serious product conversations. If the contract lands and the product does
not, that is still a win — and it buys the runway for the product to mature.

---

## 7. Risks, stated plainly

- **Commodity risk.** Capability tokens are not novel. The moat is the audit
  chain, cross-service revocation, and being the default in an agent framework —
  not the crypto.
- **Market timing.** Agent authorization is early. Some buyers do not yet feel
  the pain. Open-source-first is the correct hedge: be present when it arrives.
- **Single-maintainer risk.** Enterprise buyers will ask about bus factor. MIT
  licensing and clear docs partially answer it.
- **Financial-pressure risk.** The most expensive mistake available here is
  spending months on the hosted product with no income while waiting for it.
  The consulting path in §5 exists specifically to de-risk that, and it should
  run in parallel from week one — not after the product fails to convert.

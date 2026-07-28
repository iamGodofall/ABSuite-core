# ABSuite Monetization Strategy

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

### Honest gaps

These matter more than the feature list, so they are stated first:

- **No billing, metering or multi-tenancy.** There is no way to charge anyone
  today. This is the single largest gap between the code and revenue.
- **State is in memory.** Edge-Run schedules and QuickBench history do not
  survive a restart. Fine for a single node; disqualifying for a paid SLA.
- **Revocation is file-based.** Correct for replicas on a shared volume; needs
  Redis or Postgres for a real hosted deployment.
- **No hosted infrastructure.** No accounts, no deploy pipeline, no support process.

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

Ranked by revenue impact per unit of effort. Note that items 1–2 are not
features; they are the difference between software and a business.

1. **Usage metering** — count token validations per tenant. *You cannot bill
   without this.* Smallest change with the largest revenue consequence.
2. **Accounts and Stripe** — tenant model, API keys per tenant, subscription
   webhooks.
3. **Redis revocation store** — the `RevocationStore` interface already exists;
   this is one implementation class, and it is the Team-tier feature.
4. **Durable Edge-Run state** — Postgres-backed schedules and queue. Required
   before any SLA promise.
5. **Framework middleware packages** — publish `capabilityGuard` adapters for
   Fastify and Hono. Removes adoption friction entirely.
6. **Audit export to SIEM** — Splunk/Datadog sinks. The enterprise wedge.

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

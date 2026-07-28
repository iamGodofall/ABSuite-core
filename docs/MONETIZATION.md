# ABSuite Monetization Strategy

> Written 2026-07-28, against a verified audit of what the codebase actually
> does. Every claim about current capability was tested, not read off the README.

---

## 1. The honest starting position

Before deciding what to sell, here is what was actually verified by running it:

| Claim in README | Reality |
|---|---|
| "Five core modules" | **Two** exist. CapKit and Dashboard. |
| Edge-Run, QuickBench, Connector-Starter | Empty directories. Zero source files. |
| `pnpm start` starts everything | Compose referenced four Dockerfiles that did not exist. |
| Dashboard shows live service status | Status was **hardcoded off** — `const dockerConnected = false` short-circuited every check. |
| Dashboard AI Studio / benchmarks / tokens | All proxied to services that did not exist → 502/503 on every call. |

**This matters commercially more than technically.** Selling a "five-module
platform" that is two modules is the fastest possible route to chargebacks, a
public refund thread, and a dead brand. The single most valuable thing done in
this pass was making the repo's claims match the repo's behaviour.

### What changed in this pass

- **CapKit is now real** — capability tokens, HS256 JWT on `node:crypto`, scope
  matching, revocation, append-only audit log, rule-based policy generation.
  27 tests covering the security-critical paths.
- **Dashboard status bug fixed** — it now genuinely detects running services,
  with an HTTP health-check fallback when Docker is unavailable.
- **Compose actually starts** — unimplemented services moved behind a `planned`
  profile, so `docker compose up` brings up a working stack.
- **README tells the truth** — implementation status is stated per module.

Verified working end-to-end: dashboard → CapKit → signed capability token,
with 401 for missing auth, 403 for insufficient scope, and every allow/deny
recorded in the audit trail.

---

## 2. What is actually sellable today

Be ruthless here. One thing is sellable, and it is not "an agent platform".

### The asset: agent authorization

**CapKit solves a problem people have right now.** Teams deploying AI agents
have to answer: *what is this agent allowed to do, for how long, and can I
prove what it did?* The current answer in most codebases is a long-lived API
key in an environment variable with full account access.

CapKit replaces that with scoped, expiring, revocable, auditable grants. That
is a real problem, with a real buyer (the engineer shipping agents to prod),
and a real compliance angle (the audit log).

### Why this and not the dashboard

The dashboard is well-built and looks credible, but a dashboard that monitors
one service is not worth money. Its value is as a **sales surface** for CapKit
— it makes the token flow visible and demoable in a way a library never can.

### Deliberately not selling

Do not sell Edge-Run, QuickBench or Connector-Starter, or take pre-orders
against them. Each is a substantial build (a distributed scheduler and an
LLM benchmark harness are not weekend projects), and each competes with mature
free tooling — Temporal, BullMQ, Sidekiq for scheduling. Fighting on that
ground with zero code is not a plan.

---

## 3. Fastest path to first revenue

Ordered by time-to-cash, not by ambition.

### Tier 1 — Days: open-source distribution, paid support (Week 1–2)

Publish `@absuite/capkit` to npm under MIT. Revenue is zero directly; this is
the top of the funnel and it is the only way to earn the credibility that the
paid tiers require. The package is genuinely useful standalone, has no runtime
dependencies beyond Express for the server, and installs in one command.

**Action:** `npm publish`, write one strong launch post on the specific problem
("stop giving your agents your root API key"), post to Hacker News, r/LocalLLaMA,
and the agent-framework Discords.

**Realistic outcome:** hundreds of installs, a handful of GitHub issues, and
three or four conversations with teams who have the problem. Those conversations
are the actual product of this phase.

### Tier 2 — Weeks: CapKit Cloud (Week 3–8)

The self-hosted version has a limitation documented in the README: **the
revocation list is process-local.** Multi-replica deployments cannot revoke
reliably without a shared store. That is not a flaw to hide — it is the natural
product boundary.

**Hosted CapKit** sells: a shared revocation store, key rotation, a persistent
queryable audit log, and a team UI. Priced per-agent or per-token-validation.

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Self-hosted, single replica, local audit log |
| Team | $49/mo | Hosted, 25 agents, shared revocation, 90-day audit retention, SSO-lite |
| Business | $299/mo | 250 agents, 1-year audit retention, SAML SSO, audit export, SLA |
| Enterprise | Custom | Unlimited, on-prem option, compliance support |

**Why this converts:** the free tier is genuinely production-usable for a single
instance, so adoption is frictionless. The paid trigger is the moment a customer
scales past one replica — a moment they hit naturally, not one manufactured by
crippling the free tier.

### Tier 3 — Months: compliance as the wedge (Month 3+)

The audit log is the highest-margin asset in the codebase. Every regulated
buyer deploying AI agents needs to prove which agent did what, under what
authority. Package the audit trail as a compliance product — tamper-evident
hash chaining, export to SIEM, retention policies, evidence bundles for
auditors.

This is where enterprise contracts live, and it is a far shorter build than
Edge-Run or QuickBench because the data is already being captured.

---

## 4. Positioning

**Do not position as a platform.** "Vertical AI Agent PaaS" competes with
funded companies on breadth, which is the one axis a two-module project cannot
win.

**Position as a primitive:**

> *ABSuite CapKit — scoped, expiring, auditable credentials for AI agents.
> Stop handing your agents your root API key.*

Narrow, credible, and true. It also leaves room to grow into the platform story
later, once the other modules exist.

### Who to sell to

1. **Teams running agents in production** — the acute pain, the fastest close.
2. **AI agent framework authors** — integration partnerships; being the default
   auth layer for one popular framework is worth more than a hundred direct sales.
3. **Regulated industries** — slowest cycle, largest contracts, needs Tier 3.

---

## 5. What to build next, in order

Ranked by revenue impact per unit of effort:

1. **Shared revocation store (Redis/Postgres)** — small change, and it is
   *the* paywall for Tier 2. Highest leverage item in the repo.
2. **Tamper-evident audit log** — hash-chain each entry. Small change, unlocks
   the compliance story.
3. **Framework middleware** — drop-in Express/Fastify/Hono middleware that
   validates a capability on a route. Removes adoption friction entirely.
4. **Key rotation with `kid`** — the `kid` claim is already issued but only one
   key is supported. Enterprise requirement.
5. **Edge-Run** — only after CapKit has paying customers, and only if they ask
   for it.

Note that items 1–4 are all CapKit. **Depth on the one thing that works beats
breadth across four things that do not.**

---

## 6. Risks, stated plainly

- **Commodity risk.** Capability tokens are not novel; a competitor can build
  this. The moat is the audit trail, the integrations, and being first to be
  the default in an agent framework — not the crypto.
- **Market timing.** Agent authorization is early. Some buyers will not yet feel
  the pain. This argues for open-source-first: be present when the pain arrives.
- **Single-maintainer risk.** Enterprise buyers will ask about bus factor.
  Open-source licensing and clear docs partially answer it.
- **Credibility debt.** The repo previously claimed five working modules. If
  that version reached anyone, correct it directly. Overclaiming to technical
  buyers is not recoverable through marketing.

---

## 7. The 30-day plan

| Week | Focus | Deliverable |
|---|---|---|
| 1 | Ship the primitive | `@absuite/capkit` on npm; README honest; launch post live |
| 2 | Listen | 5+ conversations with teams running agents; log every objection |
| 3 | Build the paywall | Shared revocation store; hash-chained audit log |
| 4 | Charge | Hosted beta with Stripe; onboard the 3 warmest conversations at Team tier |

**Success at day 30 is not a large number.** It is three paying customers and a
clear, evidenced reason why they paid. That signal is what makes the rest of
the roadmap worth building.

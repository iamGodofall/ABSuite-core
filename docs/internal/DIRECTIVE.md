# ABSuite — Strategic Development Directive

> **Purpose.** This is the handoff document. Give it to any AI agent or engineer
> starting fresh on ABSuite. It contains the mission, the verified technical
> inventory, the decision framework, and — most importantly — the list of things
> **not** to build.
>
> Last verified: 2026-07-28. Every technical claim below was checked against
> source or by running the code, not inferred.

---

## PART I — WHY

### 1. The thesis

**Intelligence is becoming cheap. Trust is becoming expensive.**

Within a few years there will be billions of AI agents taking real actions —
sending money, changing records, contacting customers. The scarce resource will
not be capability. It will be the ability to answer, credibly and to a hostile
auditor:

- Who performed this action?
- Were they authorised to?
- What exactly did they do?
- Can it be proven the record has not been altered?

ABSuite exists to answer those four questions. Not more than four. The
discipline of that narrowness is the product.

### 2. What ABSuite is

**ABSuite is the accountability layer around AI, not an AI.**

| Models do | ABSuite does |
|---|---|
| Generate | Govern |
| Predict | Verify |
| Execute | Provide evidence |

The system never assumes intelligence equals correctness.

### 3. What ABSuite is not

It is not a model, an agent framework, an observability platform, or a
general-purpose PaaS. Each of those has funded incumbents. Claiming to be all of
them is how this project dies.

---

## PART II — WHERE IT STANDS (verified)

### 4. Packages

Six workspace packages. Five are publishable.

| Package | Purpose | State |
|---|---|---|
| `@absuitecore/capkit` | Capability tokens, audit, traces, tenancy, billing, metrics | Complete |
| `@absuitecore/edge-run` | Cron, queue, retries, circuit breaker | Complete |
| `@absuitecore/quickbench` | LLM/HTTP benchmarking, regression detection | Complete |
| `@absuitecore/connector-starter` | Connector registry, scaffolding | Complete |
| `@absuitecore/mcp` | MCP server — capability-checked, attested tool calls | Complete |
| `dashboard-ui` | Web control plane (not published) | Complete |

**246 tests pass. All packages typecheck and pack cleanly.**

### 5. Architecture — the rule that matters

```
@absuitecore/capkit            → (no workspace dependencies)
@absuitecore/edge-run          → @absuitecore/capkit
@absuitecore/quickbench        → @absuitecore/capkit
@absuitecore/connector-starter → @absuitecore/capkit
@absuitecore/mcp               → @absuitecore/capkit
```

**The core depends on nothing. Everything depends on the core.** This is the
single architectural invariant. Never violate it. Never let CapKit import from a
sibling.

Folder names do **not** matter and must not be refactored to match any diagram.
Dependency direction is the constraint; it is already correct.

### 6. What is built, precisely

**Authorization**
- HS256 capability tokens on `node:crypto`, no third-party JWT dependency
- Segment-wise scope matching: `read:*` grants `read:users`, never `read:users:delete`
- Rejects `alg: none`, tampered payloads, expiry, audience mismatch
- `KeyRing` — rotation without invalidating tokens in flight
- Revocation propagates across every service via shared storage

**Verifiable execution — the differentiator**
- Every real action produces a hash-chained trace
- Signed with **Ed25519**, not HMAC. This is deliberate and load-bearing:
  HMAC is symmetric, so anyone who can verify could also forge. An auditor must
  be able to check without being able to write. Never change this to HMAC.
- Public key served unauthenticated at `/executions/public-key`
- Payloads are **hashed, never stored** — proof without retaining customer data
- Both tamper classes caught: editing a field fails the content hash; editing
  and recomputing the hash fails the signature

**Commercial**
- Tenants with SHA-256 hashed API keys, shown once, rotatable
- Usage metering per tenant / metric / month
- Quotas: `402` when exceeded, `403` when suspended
- Stripe webhooks with signature verification and replay protection
- Self-serve signup, rate-limited, off by default

**Operations**
- SQLite via `node:sqlite` — zero dependencies, durable
- `/health`, `/ready`, `/metrics` (Prometheus) on every service
- Graceful shutdown drains in-flight work
- Schedules and queued tasks survive restart

### 7. Known limitations — state these, never hide them

- **Single-node SQLite.** `Storage` and `RevocationStore` are interfaces, so
  Postgres/Redis is a swap, not a rewrite. Do it when a customer needs it.
- **No backup automation.** One file to snapshot. Untested backups are not backups.
- **No per-tenant rate limiting.** Monthly quotas exist; burst does not.
- **Bespoke token model**, not OAuth 2.1/OIDC. If the industry standardises on
  OAuth delegation for agents, ABSuite must interoperate or become niche.
- **No SOC 2.** Enterprise procurement will ask.
- **`node:sqlite` is flagged experimental** upstream. Pin the Node minor version.

### 8. Two bugs found by running, not by testing

Recorded because they generalise:

1. **Concurrent startup crash.** Two services migrating at once hit
   `SQLITE_BUSY`. Docker Compose starts everything simultaneously, so this
   failed on every deploy. Fixed with `busy_timeout`.
2. **60% of attestations silently lost.** A bare `BEGIN` starts a *deferred*
   transaction; SQLite cannot apply `busy_timeout` when it upgrades to a write,
   so it failed instantly under concurrency — and the error was swallowed.
   Fixed with `BEGIN IMMEDIATE`. A regression test pins this.

**Lesson for any future agent: all 246 tests passed the entire time both bugs
were live. Run the system. Trust behaviour over green checkmarks.**

---

## PART III — THE MARKET (researched, not assumed)

### 9. The problem is real and regulated

- Gartner ranks agentic-AI oversight and agent IAM as top 2026 trends
- **EU AI Act Article 12** mandates tamper-evident logging for high-risk systems;
  Article 99 penalties reach €35M or 7% of global turnover
- Deadline moved (Digital Omnibus, May 2026) to **2 Dec 2027** / **2 Aug 2028**.
  Buyers evaluate now, purchase later. Do not price for panic.

### 10. Competitors exist — an earlier claim in this repo was wrong

A previous document claimed verifiable execution was "the one thing no
competitor offers." **False.** Correct picture:

| Competitor | Does | Gap |
|---|---|---|
| **AgentLens** (MIT) | MCP-native observability, SHA-256 hash chain | Hash chain only — **no asymmetric signature**; observes, does not enforce |
| **Attestix** | EU AI Act compliance, W3C Verifiable Credentials | Identity-focused |
| **nono** | Merkle-tree action log | Does not enforce |
| **Arcade.dev** (funded) | Agent auth, token vault, hosted execution, $25/mo | Does not cryptographically attest execution |
| **Token Security / Aembit** | Enterprise non-human identity | Enterprise-only, no attestation |

### 11. The real differentiation — three claims that survive scrutiny

1. **Enforce *and* attest with one credential.** Arcade enforces without
   attesting. AgentLens attests without enforcing. ABSuite refuses an
   unauthorised call *before it runs* and signs what did run.

2. **Asymmetric signatures, not hash chains alone.** This is subtle and it is
   the sharpest technical argument available:
   > A hash chain proves a record was not edited *after* it was written. It does
   > **not** prove who wrote it. Anyone — including the operator being audited —
   > can construct a valid hash chain containing anything they like. Ed25519
   > means the auditor verifies with a key they cannot sign with.

3. **Self-hosted, MIT, zero runtime deps, payload-hashing.** Answers data
   residency and GDPR objections that hosted competitors must argue around.

### 12. Positioning

> **ABSuite — cryptographic proof of what your AI agents were allowed to do and
> what they actually did. Self-hosted, MIT, EU AI Act Article 12 ready.**

Do **not** lead with "AI agent platform." That fights Arcade on their ground with
none of their resources.

### 13. Customers

- **Primary:** compliance-driven engineering teams, EU exposure, regulated data.
  Trigger: a security questionnaire or audit finding.
- **Secondary:** platform teams running agents that currently share one root API
  key. Trigger: a near-miss.
- **Tertiary:** MCP tool builders needing per-tool authorization. Highest-intent
  audience; reachable through MCP registries.
- **Not yet:** large enterprises. They need SOC 2 and an MSA. Revisit after ten
  paying users.

### 14. Pricing note

`billing.ts` sets Team at $49/mo; Arcade's comparable tier is $25/mo. **Do not
compete on price with a funded company.** Reposition $49 as the *compliance*
tier — audit retention, export, chain verification — rather than an agent-count
tier. Compliance budgets are less price-sensitive than developer-tool budgets.

---

## PART IV — HOW TO DECIDE

### 15. The filter for every proposed feature

Ask, in order:

1. Does it help answer *who did what, were they allowed, can we prove it*?
2. Would a customer pay for it, or does it only sound impressive?
3. Does it keep the core dependency-free?
4. Can it be verified by running it, not just by tests?

Two or more "no" answers means do not build it.

### 16. Build order

1. **Publish to npm.** Nothing sells while nobody can install it.
2. **Make the GitHub repo public.**
3. **List `@absuitecore/mcp` in MCP registries.** Highest-intent audience.
4. **Dashboard trace-verification view.** The demo that closes deals — show an
   auditor pasting a trace and getting a green tick.
5. **Per-tenant rate limiting.** One tenant can still saturate a node.
6. **Backup automation** with a *tested* restore.
7. **Postgres adapter** — only when a customer's scale demands it.
8. **OAuth 2.1 interop** — hedge against the standard shifting.

### 17. Do NOT build these

Each has appeared in a vision document. Each would consume months and serve
nobody who exists today:

- Distributed execution network
- Capability marketplace / tradable capabilities
- Protocol standardisation body
- Mobile app
- Cloud-marketplace listings
- Folder restructure to match an architecture diagram
- **Multi-AI arbitration, hallucination detection, trust scores** — see §18

### 18. On trust scores — a deliberate caution

The "reciprocal trust" idea (scoring humans as well as AI) is intellectually
strong and the reciprocity insight is genuinely right: trust *is* maintained,
not granted once.

But scoring **humans** carries real hazards that must be designed for before any
line is written:

- **Surveillance.** A human trust score is an employee-monitoring system. That
  is a different product with different buyers, different regulation (GDPR
  Article 22 on automated decision-making) and different ethics.
- **Bias laundering.** A numeric score gives arbitrary judgement false
  objectivity. "Trust: 62" feels like measurement; it is usually a proxy for
  something nobody wrote down.
- **Gaming.** Any score becomes a target and stops measuring what it measured.
- **Contestability.** A person scored down must be able to see why and appeal.
  Without that, it is not governance, it is a blacklist.

**Recommendation:** ABSuite should record **evidence**, not issue **verdicts**.
Traces, approvals, overrides and policy violations are facts. Let the customer's
own policy compute a score if they want one. Selling evidence is defensible;
selling judgement about people is a liability.

This is not a refusal to build it. It is the condition under which it could be
built well.

### 19. Honesty standard

This project's entire asset is credibility. Therefore:

- Never claim a capability that is not verified by running it
- State known limitations in the README, not just internally
- Never move an already-open feature behind the paywall
- If a competitor does something better, say so
- Correct errors explicitly — this document exists partly to correct one

---

## PART V — THE LONG VIEW

### 20. Three futures

1. **Infrastructure company** (Auth0, HashiCorp). Very good outcome.
2. **AI governance company.** Where the money likely is, given the regulation.
3. **A standard** — "does your AI support ABSuite?" Unlikely, but the only path
   to it is adoption first, standardisation last. Standards are recognised, not
   declared.

All three run through the same near-term work: publish, get users, learn.

### 21. The honest constraint

Capital follows momentum, and momentum here means downloads, stars, and users —
none of which exist yet. The gap between this repository and a business is not
architecture. It is distribution.

Infrastructure also sells slowly: evaluation cycles run weeks, and first revenue
typically arrives months after first release. Build accordingly. Do not stake
survival on this converting quickly.

### 22. The one question

Everything above collapses to this. Answer it better than anyone else for a
decade and the rest follows:

> **How do we make it possible to prove what an intelligent system actually did?**

---

## Appendix — Quick reference

```bash
pnpm install
pnpm test                    # 246 tests
pnpm publish:packages        # requires npm org 'absuite'
docker compose up -d

# Prove it works
curl localhost:8081/executions/public-key
curl -X POST localhost:8081/executions/verify \
  -H 'Content-Type: application/json' -d "{\"trace\": $TRACE}"
```

| Document | Contents |
|---|---|
| `docs/MARKET.md` | Competitive landscape with sources |
| `docs/LAUNCH.md` | Distribution channels, pre-launch checklist |
| `docs/MONETIZATION.md` | Revenue strategy |
| `docs/ARCHITECTURE-REVIEW.md` | Vision vs. codebase gap analysis |
| `docs/openapi.yaml` | Full API specification |

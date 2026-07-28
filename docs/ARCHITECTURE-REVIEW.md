# Architecture Review — Vision vs. Codebase

> Written 2026-07-28, measuring the ABSuite architectural vision against what
> the repository actually contains. Every "present" and "missing" below was
> checked against source, not inferred.

---

## 1. The contradiction to resolve first

Two documents inform the current vision. They give **opposite instructions**,
and the reversal happened at a specific moment.

**Document A — architectural discipline:**
> "You do not build everything into the core. A minimal, brutal core. If
> anything enters here that is not essential, you weaken the entire system."

**Document B — the "supreme vision", written immediately after the question
"can we be more?":**
> Distributed execution networks, capability marketplaces, tradable
> capabilities, cross-organisation interoperability, "the layer that cannot be
> removed."

Document B is precisely the unbounded scope Document A warns is fatal. The
advice did not change because the project changed; it changed because the
question invited escalation.

**Document A is the correct one.** Document B is a description of what ABSuite
might look like after a decade of adoption, not a build plan. Treated as a build
plan it produces an overbuilt system with no users — the exact failure Document
A names.

Keep Document B as a north star. Do not schedule any of it.

---

## 2. What the vision gets right

These are genuinely correct and worth holding to:

| Principle | Verdict |
|---|---|
| Minimal core, modular expansion | Correct. Already followed. |
| Core must never depend on modules | Correct. **Already true** — verified below. |
| Open-core licensing | Correct. Already the implicit model. |
| Capability-based authority, no implicit roles | Correct. Implemented. |
| "Biggest risk is trying to build everything at once" | The single most valuable line in either document. |
| Position between AI systems and backends is a choke point | Directionally true — but *because it is narrow*, not because it is everything. |

---

## 3. Dependency direction — already correct

The vision's hardest architectural rule is "core never depends on modules."
Checked against `package.json` and imports:

```
@absuite/capkit            -> (no workspace dependencies)
@absuite/edge-run          -> @absuite/capkit
@absuite/quickbench        -> @absuite/capkit
@absuite/connector-starter -> @absuite/capkit
```

CapKit imports nothing from its siblings. The arrows point modules → core, which
is the rule the vision cares about.

**Implication: do not restructure the folders.** The vision sketches a layout of
`core/ agent/ capability/ execution/ verification/ modules/ runtime/ cli/`. The
current layout differs in *names* while already satisfying the *constraint*.
Renaming directories to match a diagram would cost weeks and deliver no customer
value. Dependency direction is the thing that matters, and it is already right.

---

## 4. Gap analysis — vision components vs. reality

Checked directly against source:

| Vision component | Status | Where |
|---|---|---|
| Identity / signing | **Present** | `capkit/jwt.ts` |
| Capability model | **Present** | `capkit/capability.ts` |
| Audit logging | **Present** | `capkit/audit.ts` (hash-chained) |
| Execution engine | **Present** | `edge-run/runtime.ts`, `queue.ts` |
| **Verification layer** | **Missing** | — nothing validates an output before acceptance |
| **Replayable trace** | **Missing** | audit records *decisions*, not re-runnable executions |
| **Signed results** | **Missing** | results are returned unsigned |
| **Deterministic execution mode** | **Missing** | (only deterministic *policy/scaffold generation* exists) |
| **Protocol package** | **Missing** | contracts live inside CapKit, not a standalone package |
| **Unified runtime / control plane** | **Missing** | four services, four ports, no single enforced pipeline |

### The one gap that matters

The vision's central claim is:

> Every action is permitted, traceable, and **provable**.

Two of three are real today. **Provable is not.** A caller receives a result with
no cryptographic evidence of what was authorised, what ran, or what came back.

Everything else on the missing list is optional. This one is the differentiator —
and it is the thing no competitor ships.

---

## 5. What "verifiable execution" would concretely mean

Not a rewrite. A focused addition, mostly in CapKit, reusing what exists:

1. **Execution trace** — a record per execution: capability presented, inputs
   hashed, module invoked, outputs hashed, timing, outcome.
2. **Hash-chain the trace** — the audit log already does exactly this
   (`hashEntry`, `verifyChain`). Same technique, applied per execution.
3. **Sign the result** — HMAC over the trace head with the CapKit key. The
   signing primitives already exist in `jwt.ts`.
4. **A verify endpoint** — hand back a trace and a signature, get a yes/no plus
   the index of the first broken link.

That yields a sentence no competitor can currently say:

> Here is cryptographic proof of what your agent was allowed to do, what it
> actually did, and that the record has not been altered.

That is the compliance wedge, the enterprise wedge, and the reason a regulated
buyer picks ABSuite over a JWT library. Estimated scope: days, not months.

---

## 6. Open source vs. closed — already decided by what is built

The recommendation of **open core** is correct, and the codebase already draws
the line in the right place:

**Open (MIT) — the whole suite as it stands:**
capability tokens, scope matching, audit chain, cron/queue/self-healing,
benchmarking, connectors, the guard middleware, single-node SQLite.

**Commercial — the boundary customers reach by growing:**
hosted multi-region revocation, retained and exportable audit history, Postgres
for horizontal scale, SSO, SLA, support.

This works because the free tier is genuinely production-usable on one node. The
paywall is a scaling boundary, not a crippled feature. Do not move anything from
the first list into the second — trust is the whole asset, and open-core projects
that retroactively close features lose it permanently.

Licence stays MIT. A source-available licence (BSL/SSPL) would be worth revisiting
only if a cloud provider ever resells the hosted product, which is a problem that
requires success first.

---

## 7. Honest position

- **Architecture:** sound. Dependency direction correct, core pure, modules
  substitutable. No restructuring warranted.
- **Category claim ("trusted execution infrastructure"):** defensible *as a
  narrow claim about agent authorization and audit*. Not defensible as a claim
  to sit above AWS and OpenAI. Make the narrow claim; it is true and it sells.
- **Distance from the vision:** one feature — verifiable execution. Not a
  platform rewrite.
- **Distance from revenue:** unchanged, and it is not architectural. Nothing is
  published to npm and there is no signup page. Both are days of work and both
  gate everything downstream.

---

## 8. Recommended order

1. **Publish to npm.** Nothing sells while nobody can install it.
2. **Verifiable execution.** Signed, replayable traces. The one thing that makes
   the vision literally true and no competitor offers.
3. **Signup page.** A form calling `POST /admin/tenants`.
4. Everything else in `docs/MONETIZATION.md`.

Note that items 1 and 3 are distribution, not engineering. That remains the
honest bottleneck.

**Explicitly not now:** distributed execution network, capability marketplace,
protocol standardisation, cloud-marketplace listings, mobile client. Each needs
adoption that does not yet exist. Building them first is how the project dies.

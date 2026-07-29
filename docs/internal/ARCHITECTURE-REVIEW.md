# Architecture Review — Vision vs. Codebase

> **Historical — superseded 29 July 2026.**
> A point-in-time comparison of vision against code. The gaps it names have
> since been closed.
> The current state of the project is in
> [`docs/ROADMAP.md`](../ROADMAP.md); the current numbers are whatever
> `pnpm test` and `pnpm docs:check` print. This document is kept for the
> reasoning, not for its facts.

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
@absuitecore/capkit            -> (no workspace dependencies)
@absuitecore/edge-run          -> @absuitecore/capkit
@absuitecore/quickbench        -> @absuitecore/capkit
@absuitecore/connector-starter -> @absuitecore/capkit
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
| **Verification layer** | **Present** | `capkit/trace.ts` — `verifyTrace`, `verifyChain` |
| **Replayable trace** | **Present** | `capkit/trace.ts` — `replayManifest`, `compareReplay` |
| **Signed results** | **Present** | Ed25519 signatures over every execution trace |
| **Deterministic execution mode** | **Missing** | (only deterministic *policy/scaffold generation* exists) |
| **Protocol package** | **Missing** | contracts live inside CapKit, not a standalone package |
| **Unified runtime / control plane** | **Missing** | four services, four ports, no single enforced pipeline |

### The gap that mattered — now closed

The vision's central claim is:

> Every action is permitted, traceable, and **provable**.

All three are now real. Every execution produces a hash-chained trace signed
with Ed25519, verifiable by a third party holding only a public key. Verified
live: a tampered field fails on the content hash; a tamper that also recomputes
the hash fails on the signature.

The remaining "missing" items — deterministic execution mode, a standalone
protocol package, a unified control plane — are architecture aesthetics. None
changes what a customer can do or prove. Do not build them speculatively.

---

## 5. Verifiable execution — as built

Implemented in `capkit/trace.ts`, with one deliberate upgrade on the original
sketch.

The first plan was to sign traces with HMAC using the existing CapKit secret.
That was rejected: HMAC is symmetric, so anyone who can *verify* a trace can
also *forge* one. For a compliance artefact that is the wrong property — the
auditor must be able to check the record without being able to write it.

Signing is therefore **Ed25519**. The private key signs; the public key is served
unauthenticated at `/executions/public-key`, so a customer or regulator can
verify holding no ABSuite credentials at all.

What ships:

1. **Execution trace** — subject, capability `jti`, scopes, module, action,
   input hash, output hash, timing, steps, outcome.
2. **Hash chain** — each trace links to its predecessor; insertion is
   transactional so concurrent executions cannot fork the chain.
3. **Ed25519 signature** over the trace hash.
4. **Verification** — `POST /executions/verify` for one trace,
   `GET /executions-verify-chain` for the whole log, which names the sequence
   number of the first record that breaks.
5. **Replay** — `replayManifest` and `compareReplay` confirm a re-run produced
   the same output. Payloads are hashed, never stored, so proof does not require
   retaining customer data.

Verified live, both tamper classes:

| Attack | Result |
|---|---|
| Edit a field | `contentIntact: false` — content hash fails |
| Edit a field *and* recompute the hash | `signatureValid: false` — never signed by us |

That supports the sentence no competitor can currently say:

> Here is cryptographic proof of what your agent was allowed to do, what it
> actually did, and that the record has not been altered.

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
- **Distance from the vision:** closed. Permitted, traceable and provable are
  all real. What remains unbuilt is architecture aesthetics, not capability.
- **Distance from revenue:** one action, and it is not code. The packages are
  publish-ready and pack cleanly; running `pnpm publish:packages` needs an npm
  account and 2FA, which only the owner can supply.

---

## 8. Recommended order

1. ~~Verifiable execution~~ — **done.** Ed25519-signed, hash-chained traces.
2. ~~Signup page~~ — **done.** `GET/POST /signup`, rate-limited, off by default.
3. ~~npm publish readiness~~ — **done.** Metadata, licences, READMEs and
   `pnpm publish:packages` in place; all four pack cleanly.
4. **Run `pnpm publish:packages`.** Requires an npm account and 2FA, so it is
   the owner's action, not an automatable one.
5. Everything else in `docs/MONETIZATION.md`.

Step 4 is the only remaining bottleneck, and it needs credentials rather than
code.

**Explicitly not now:** distributed execution network, capability marketplace,
protocol standardisation, cloud-marketplace listings, mobile client. Each needs
adoption that does not yet exist. Building them first is how the project dies.

# ABSuite

> **The black box for AI systems.** A flight recorder — not an opaque model.

ABSuite records what your AI systems did, proves it cryptographically, and tells
you whether the evidence supports what they claimed.

```bash
npm install @absuitecore/capkit
```

```js
import { SigningKey, TraceStore, Storage, verifyTrace } from '@absuitecore/capkit';

const { key, publicKeyPem } = SigningKey.createPair();
const traces = new TraceStore(new Storage('./audit.db'), key);

const trace = traces.record({
  subject: 'agent:invoicing', scope: ['payment:approve'],
  module: 'payments', action: 'approve_batch', outcome: 'success',
  input: { batch: 'BATCH-8891', total: 250000 },   // hashed here, never stored
});

verifyTrace(trace, publicKeyPem).valid;   // true — Ed25519, not a log line
traces.verifyChain(publicKeyPem);         // names the first tampered record
```

Every action is signed and hash-chained, so anyone can check the record —
including people with no reason to trust you. Payloads are hashed, never stored:
the record proves what happened without becoming a copy of your data.

**[Getting started →](./GETTING-STARTED.md)** · **[Run the full incident investigation →](./examples/incident-forensics.mjs)**

[![npm](https://img.shields.io/npm/v/%40absuitecore%2Fcapkit?label=%40absuitecore%2Fcapkit&color=7C3AED)](https://www.npmjs.com/package/@absuitecore/capkit)
[![npm](https://img.shields.io/npm/v/%40absuitecore%2Ftrust?label=%40absuitecore%2Ftrust&color=7C3AED)](https://www.npmjs.com/package/@absuitecore/trust)
[![downloads](https://img.shields.io/npm/dm/%40absuitecore%2Fcapkit?label=downloads&color=1E1B4B)](https://www.npmjs.com/package/@absuitecore/capkit)
[![provenance](https://img.shields.io/badge/provenance-signed-1E1B4B)](https://www.npmjs.com/package/@absuitecore/capkit#provenance)
[![CI](https://github.com/iamGodofall/ABSuite-core/actions/workflows/ci.yml/badge.svg)](https://github.com/iamGodofall/ABSuite-core/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-7C3AED)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-3178C6)](https://nodejs.org/)

---

## Questions ABSuite answers

| | |
|---|---|
| **What happened?** | A signed, hash-chained execution trace of every real action |
| **Who or what did it?** | The subject of the capability token that authorised it |
| **Was it authorised?** | Segment-wise scope matching, enforced in every service |
| **What evidence supports the output?** | Claims checked against sources — `SUPPORTED`, `UNVERIFIED` or `CONTRADICTED` |
| **Has the record been modified?** | Chain verification names the sequence number of the first broken record |
| **Can it be reproduced?** | Replay compares a re-run against the recorded hashes |
| **Should someone investigate?** | Counts you can contest line by line, never a score |

None of these answers require trusting the operator. That is the whole design.

---

## Verify it yourself, right now

[**iamgodofall.github.io/ABSuite-core/verify.html**](https://iamgodofall.github.io/ABSuite-core/verify.html)
checks a real signed execution trace entirely in your browser using WebCrypto.
No install, no account, no server, no trust in this project. Click *Load a valid
example*, then *Tamper with it*, and verify again.

<img src="docs/images/verifier-valid.png" alt="The browser verifier reporting a trace as genuine and unaltered, with content hash, Ed25519 signature, action, subject and authorising scopes each checked" width="49%"> <img src="docs/images/verifier-tampered.png" alt="The same page after one field was edited: tampering detected, showing the expected hash against the computed one" width="49%">

One field edited is all it takes. The page names the expected hash and the
computed one, so the disagreement is visible rather than asserted.

---

## Why this exists

Most AI governance products ask *can we trust the model?* ABSuite asks the
question that has an answer: **can we trust the evidence around the model?**

### A hash chain is not a signature

This is the distinction the whole project turns on, and it is worth being
precise about because plenty of audit tools stop one step short of it.

Hash-chaining links each record to the one before it, the way git commits are
linked. Edit history and verification fails. That is genuinely useful, and it is
what most tamper-evident audit logs provide.

**It proves a record was not edited afterwards. It does not prove who wrote
it.** Anyone holding the log — including the operator being audited — can
construct a perfectly valid hash chain containing whatever they like. If the
question is *"did this company fabricate its own audit trail?"*, a hash chain
cannot answer it.

ABSuite hash-chains **and** signs each record with **Ed25519**. Verification
needs only the public key, and a public key cannot produce a signature. So the
operator cannot fabricate history, and the auditor cannot fabricate an
accusation. That asymmetry is the product.

### Four things that only work together

| | Without it |
|---|---|
| **Attestation** | You have logs, not evidence |
| **Enforcement** | You record violations you could have prevented |
| **Replay** | You cannot show what actually happened, only what was written down |
| **Independent verification** | You have proof for yourself and nobody else |

ABSuite does all four. Other projects in this space do some of them, several do
them well, and the category moves fast enough that a scorecard published here
would be out of date within weeks — so this page does not keep one. Compare it
against whatever you are considering on those four axes and on the signature
question above; those are the criteria that matter, whoever wins them.

---

## What it refuses to do

Most projects document what they do. This one also documents what it will not
build, because the refusals are the design.

**No hallucination detection.** Deciding whether an arbitrary statement is true
is open-domain fact-checking. Nobody can do it, and a product claiming to is a
classifier with a confident voice. ABSuite reports whether a claim traces to a
supplied source — `UNVERIFIED` means the evidence is absent, **not** that the
claim is false.

**No trust scores for people.** ABSuite will not tell you John scores 42. It
reports events recorded, policy violations, manual overrides and audit findings
— facts he can check and contest, line by line. The record object has no `score`
field and cannot be given one.

**No confidence as proof.** Agreement between models is not evidence. Arbitration
discounts correlated agreement, and a leader that only wins because three
witnesses share a model family does not win.

**No hidden verification.** The verification path is free, offline-capable and
permanently open. A proof you must pay to check is not a proof.

The reasoning is in [`PRINCIPLES.md`](./PRINCIPLES.md) and
[`docs/CONSTITUTION.md`](./docs/CONSTITUTION.md).

---

## Packages

All seven are published with signed Sigstore provenance attestations — you can
verify which commit and workflow produced each tarball without trusting us
(`npm audit signatures`).

| Package | What it does |
|---|---|
| [`@absuitecore/capkit`](https://www.npmjs.com/package/@absuitecore/capkit) | Capability tokens, tamper-evident audit, signed execution traces, tenancy |
| [`@absuitecore/trust`](https://www.npmjs.com/package/@absuitecore/trust) | Evidence validation, chain monitoring, arbitration, reciprocal contracts |
| [`@absuitecore/edge-run`](https://www.npmjs.com/package/@absuitecore/edge-run) | Scheduling, priority queue, retries with jitter, circuit-breaker self-healing |
| [`@absuitecore/quickbench`](https://www.npmjs.com/package/@absuitecore/quickbench) | LLM and HTTP benchmarking, nearest-rank percentiles, regression detection |
| [`@absuitecore/connector-starter`](https://www.npmjs.com/package/@absuitecore/connector-starter) | Connector registry, read-only credential verification, deterministic scaffolding |
| [`@absuitecore/mcp`](https://www.npmjs.com/package/@absuitecore/mcp) | MCP server — puts ABSuite inside the tool-calling path |
| [`@absuitecore/cli`](https://www.npmjs.com/package/@absuitecore/cli) | The `absuite` command |

Code for each is in [`docs/MODULES.md`](./docs/MODULES.md).

### What makes it a suite, not six services

CapKit is the shared authorisation layer. Every other service imports
`capabilityGuard` from `@absuitecore/capkit` and enforces the same capability
model, so **one token works everywhere, and revoking it at CapKit locks it out
of all of them**. Enforcement lives in a library distributed to every service
rather than in a gateway, because a gateway leaves each service unguarded to
anything that reaches it directly.

As services, they listen on 8081 (CapKit), 8082 (Edge-Run), 8083 (QuickBench),
8084 (Connector-Starter), 8085 (Trust) and 3001 (Dashboard). Full design in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## The path an action takes

```text
Input
  ↓  capability check          ← refused here, or it never runs
  ↓  execution
  ↓  evidence collection       ← claims checked against sources
  ↓  hashing and signing       ← Ed25519, payloads hashed and dropped
  ↓  chain append              ← linked to its predecessor
  ↓  independent verification  ← public key only; no credentials, no server
  ↓  human review              ← where a person should look, and why
  → audit history
```

---

## Status

```text
410 tests                     94 API endpoints
7 npm packages on npm         6 HTTP services + MCP server
API docs drift-checked in CI  published from CI with provenance
```

Numbers are generated, not claimed: run `pnpm test` and `pnpm docs:check`.

It is installable. Nobody outside the project has used it yet — that is the
honest state, and [`docs/ROADMAP.md`](./docs/ROADMAP.md) says so plainly.

---

## Documentation

| | |
|---|---|
| [Getting started](./GETTING-STARTED.md) | Library, HTTP API and Docker — every command verified |
| [Modules in code](./docs/MODULES.md) | What each package looks like to use |
| [API reference](./docs/API.md) | Every route, generated from source |
| [Architecture](./docs/ARCHITECTURE.md) | How the pieces fit together |
| [Principles](./PRINCIPLES.md) | The rules the code is held to |
| [Constitution](./docs/CONSTITUTION.md) | What this will never become |
| [Security model](./docs/SECURITY-MODEL.md) | Threat model and defence in depth |
| [Reporting a vulnerability](./SECURITY.md) | Private disclosure |
| [Roadmap](./docs/ROADMAP.md) | What is next, and what is deliberately refused |
| [Changelog](./CHANGELOG.md) | Including the bugs, and how they were found |

---

## Contributing

Open an issue before writing anything beyond a small fix — it avoids duplicate
work and makes disagreement about design cheap. Every command in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) has been run against this repository; if
one does not work, that is a bug and a PR fixing it needs no issue.

Contributions are held to the principles above. Anything that scores a person,
or treats model agreement as evidence, will be declined however well argued.

Security vulnerabilities go to [private disclosure](./SECURITY.md), never the
issue tracker.

---

## License

[MIT](./LICENSE). Copyright © 2025–2026 ABSuite Contributors.

The verification path stays free and open, permanently. That is a commitment in
[the Constitution](./docs/CONSTITUTION.md), not a pricing decision.

---

<p align="center">
  <strong>Record what happened. Prove it happened. Preserve the evidence.</strong>
</p>

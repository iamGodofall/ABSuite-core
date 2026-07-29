# Changelog

All notable changes to ABSuite. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/).

## [Unreleased]

## [trust 1.1.0] — 2026-07-29

### Added

- `EvidenceRecord.eventsRecorded`, which counts what the field has always
  counted: events, not actions. Recording that an agent made an unsupported
  claim about an action is a *second event about the same action*, so the number
  was never a count of things the subject did.

### Deprecated

- `EvidenceRecord.actionsRecorded`. It is a misnomer and always was. It still
  returns exactly `eventsRecorded` and will be removed in 2.0. A package whose
  entire argument is that names must match evidence cannot ship a field that
  overstates what a subject did — the demo printed "Actions recorded 2" after
  one action, which is how this was caught.

## [capkit 1.1.0] — 2026-07-29

Nothing new to demo. This release exists because writing
`examples/incident-forensics.mjs` against the published packages surfaced four
steps a newcomer had to perform by hand, none of which carried information the
library did not already have. Every addition is backwards compatible — the 1.0
call sites in this repository were left untouched and still compile.

### Added

- `TraceStore.record()` accepts `input` and `output` payloads directly and
  hashes them itself. Payloads are still hashed and discarded, never stored;
  `inputHash` / `outputHash` remain fully supported for callers who hash their
  own. Supplying both forms for one field is a type error — two sources for one
  fact is how records end up disagreeing with reality.
- `TraceStore.record()` defaults `startedAt` to now and `steps` to `[]`, and
  derives `durationMs` when both timestamps are given. An explicitly measured
  `durationMs` always wins, and a duration that would come out negative is
  omitted rather than recorded — a clock that ran backwards is a symptom, not a
  measurement.
- `SigningKey.createPair()` returns the `SigningKey` **and** both PEMs in one
  call. `SigningKey.generate()` returns the PEMs alone and is unchanged.

### Changed

- `TraceStore.record()` now throws when neither `input` nor `inputHash` is
  supplied. Previously the field was required by the type alone; the runtime
  would have written `undefined` into the chain. Defaulting to an empty payload
  was rejected — it would put a hash in the chain attesting to something nobody
  ever processed.

### Fixed

- Cross-package dependencies used `workspace:*`, which resolves to an **exact**
  version at publish time. `@absuitecore/trust@1.0.0` therefore pinned
  `@absuitecore/capkit@1.0.0` precisely, so consumers could not deduplicate and
  would never receive patch releases. Now `workspace:^`, published as `^1.0.0`.

### Added

- `SECURITY.md` — reporting process, supported versions, what counts as a
  vulnerability, and the design decisions that are deliberate rather than bugs.
- `CHANGELOG.md`.
- `examples/README.md`.

## [1.0.0] — 2026-07-29

First public release. Seven packages on npm, each published from CI with a
signed Sigstore provenance attestation.

### Added

- **`@absuitecore/capkit`** — capability tokens (HS256, segment-wise scope
  matching), hash-chained tamper-evident audit, Ed25519-signed execution traces,
  replay comparison, multi-tenancy, usage metering, quotas, Stripe billing,
  per-tenant rate limiting, key rotation, and a browser verifier requiring no
  server or account.
- **`@absuitecore/trust`** — evidence validation reporting
  `SUPPORTED` / `UNVERIFIED` / `CONTRADICTED` rather than a probability;
  explainable, decaying, confidence-bounded trust scores that are advisory by
  default; evidence records for human subjects that carry counts and no score;
  agent-chain monitoring for cycles, runaways, stalls and observer
  disagreement; correlation-aware arbitration; reciprocal contracts with
  five obligations each way.
- **`@absuitecore/edge-run`** — cron scheduling, priority queue, retries with
  jitter, circuit-breaker self-healing, durable state.
- **`@absuitecore/quickbench`** — LLM and HTTP benchmarking with nearest-rank
  percentiles and Welch's t-test regression detection.
- **`@absuitecore/connector-starter`** — connector registry, read-only
  credential verification, deterministic scaffolding.
- **`@absuitecore/mcp`** — Model Context Protocol server with
  capability-filtered tool discovery and attested tool calls.
- **`@absuitecore/cli`** — command-line interface.

### Notes

- Requires Node 22.5+ for `node:sqlite`, except `@absuitecore/cli` (Node 20+).
- `@absuitecore/cli@1.0.0` and `@1.0.1` are superseded; use `1.0.2` or later.
  `1.0.0` could not run at all — the package is ESM and the source used
  `__dirname`.

[Unreleased]: https://github.com/iamGodofall/ABSuite-core/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/iamGodofall/ABSuite-core/releases/tag/v1.0.0

# Changelog

All notable changes to ABSuite. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/).

## [Unreleased]

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

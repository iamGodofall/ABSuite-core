# Changelog

All notable changes to ABSuite. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/).

## [Unreleased]

### Changed — the dashboard leads with evidence, not infrastructure

It opened on six service-health tiles: the same first screen as every other ops
console, and not the reason anyone would choose this one. The question ABSuite
alone can answer — *what did the agent do, was it allowed, and has the record
been altered?* — was four tabs away, behind a panel that had never worked.

- **Evidence is the landing tab**, renamed from "Proof" and moved to the top of
  the navigation. Service health became "System" and sits below it. Nothing was
  removed; the ordering now matches what the product is for.
- **The headline question is answered on arrival**, without a click. A status
  strip reports chain integrity (intact, or broken at record *n*), how many
  records are held, and which key signed them. The chain verifies itself on
  load — making a reader press a button to learn whether their audit trail is
  intact is the wrong default for a forensics console, because a silent chain
  is exactly as informative as a broken one until somebody checks.
- **The "Live mode enabled" banner is scoped to the tabs it describes.** It is a
  statement about service health, and on the Evidence tab it pushed the answer
  the reader came for below a line telling them something they had not asked.
  Demo mode and real errors still announce themselves everywhere, because both
  change what the numbers mean.

### Fixed — the Proof tab had never worked

The screen this product exists for called four endpoints the dashboard server
never implemented. Every request fell through to the SPA catch-all, so the UI
received `<!DOCTYPE html>` where it expected JSON and reported
*"Could not load proof data — Unexpected token '<'"*. The interface was built;
the proxy behind it was not.

- Added `GET /executions`, `GET /executions/public-key`,
  `POST /executions/verify` and `GET /executions-verify-chain`, forwarding to
  CapKit. The two verification routes are deliberately unauthenticated, mirroring
  CapKit itself: the entire argument is that a third party can check a record
  without holding any credential of yours, and a public key that needed a
  password would defeat it.
- The failure message now names the cause and the fix. Reading the audit trail
  needs the admin key, which lives in Settings; "Could not load executions" told
  the reader neither what was wrong nor what to do, on the one screen that
  matters most. A `403` now says to add the key under Settings, and a `502` says
  CapKit is not running.

Verified end to end against the live suite: three signed executions recorded
through CapKit, listed in the tab, one selected and inspected (action, subject,
outcome, authorising scope), and the chain verified — *"Chain intact — 3
record(s) verified."*

### Fixed — found by running the whole suite at once

Docker has no daemon in this environment, so all five services were started as
plain Node processes against one shared database — the same thing
`docker compose up -d` does. Two of the five died at boot.

- **`database is locked` on cold start.** Switching journal mode to WAL takes a
  brief exclusive lock, and `PRAGMA busy_timeout` was set on the line *below*
  it — the mitigation was present, its comment described this exact failure,
  and it was applied one statement too late to protect the only statement that
  needed it. `busy_timeout` now comes first, and losing the WAL race is
  tolerated because journal mode is persistent database state: once any
  connection sets it, the file stays in WAL.

  This is the shipped deployment path. Anyone running the compose stack on a
  cold volume had a coin-flip chance of two services failing to start.

- **The dashboard listened on every interface and ignored `PORT`.**
  `server.listen(3001)` with no host binds `0.0.0.0`. That process holds
  `CAPKIT_ADMIN_KEY` and mounts the Docker socket, so running it outside a
  container put an admin console on the network. It now defaults to `127.0.0.1`,
  binds `0.0.0.0` only inside a container where Docker's port mapping needs it,
  honours `PORT`, and warns when bound beyond loopback. `ABSUITE_BIND`
  overrides it deliberately.

- A regression test spawns five processes opening the same database
  simultaneously. Nothing in the unit suite could have caught this: one
  `Storage` in one process never contends with anything.

Verified afterwards by starting all five services at once and loading the
dashboard against them: six services up, zero down, console clean.

### Changed — one visual identity across every surface

The campaign artwork established a real language — a green-tinted near-black
ground, a single emerald accent, red reserved for failure, monospace technical
labels. The verifier, the landing page and the dashboard each looked like a
different product.

- `docs/verify.html` and the Pages landing page rebuilt in that language. The
  verifier's WebCrypto block was preserved byte-for-byte and both outcomes
  re-checked in a real browser afterwards; a redesign that quietly broke
  verification would be the worst possible failure for this particular page.
- The dashboard palette now starts from the same `#040706` ground and `#2DE9A5`
  accent. Blue is gone entirely — fourteen utility classes and the `info` notice
  tone. A blue "Restart" beside an emerald "Start" implied a category
  distinction that does not exist, and a blue information banner is the default
  admin-template look this project is not.
- Amber survives in exactly one role: genuinely indeterminate state. Collapsing
  "unknown" into either emerald or red would assert something that is, by
  definition, not known.

### Fixed — dashboard

- **The Trust service was invisible in the control plane.** `:8085` was absent
  from the service list in `server.ts`, from `SERVICE_PORTS` and
  `DEFAULT_SERVICES` in `useServices.ts`, and from the proxy's allowed-host
  list. A shipped flagship service could not be seen, started, stopped or
  health-checked from the dashboard that exists to do exactly that. The same
  omission had also left it out of the architecture diagram.
- **A Google Fonts stylesheet that never loaded.** `index.html` requested Inter
  from `fonts.googleapis.com`, which the content security policy blocked on
  every page load — so the font always fell through to the system stack anyway,
  while attempting a third-party request on each visit of a tool whose whole
  argument is that your data stays yours. The link is gone and the CSS font
  stacks are self-sufficient.
- **Two banners saying the same thing.** The Overview tab rendered "Live mode
  enabled — showing the real ABSuite service state" directly above "Live mode is
  active — this reflects the real orchestrator state." One is enough.
- **A hardcoded version that had drifted.** The dashboard reported `v2.0.0` in
  its title, its settings panel and its exported config while the package was
  `1.1.0`, and claimed "5 Active" services next to a grid of six. Vite now
  injects the version from the manifest at build time and the service count is
  derived.

Verified by building the dashboard, serving it, and loading it in a real
browser: the console is now clean, where it previously reported a CSP violation
on every load.

### Added

- A **Security** section in the README. A trust-infrastructure project whose
  front page never mentioned its own security posture was a gap that should not
  have needed pointing out: guarantees, the deliberate trade-offs behind them,
  what the dashboard is granted, and `npm audit signatures` for checking what
  you installed.
- **`CODE_OF_CONDUCT.md`**, the last item missing from GitHub's community
  profile. Written in this project's voice rather than pasted, and honest that a
  one-person project has no neutral party to hear a conflict involving the
  maintainer.
- A **"Part of ABSuite"** footer on all seven package READMEs. Four of the seven
  npm pages had no link back to the repository, the verifier, or the security
  policy — for most people, that page *is* the project, and it was a dead end.
- An **evaluation checklist** replacing the competitor scorecard rather than
  leaving a hole where the differentiation argument had been. Six questions to
  put to any tool in this space, including this one, each answerable from public
  documentation. It does the same job without grading anyone, and it stays true
  when the category moves.

### Fixed

- The **Trust service was missing entirely** from the system diagram in
  `docs/ARCHITECTURE.md` — a whole flagship service absent from the picture of
  the system — and the package boxes were misaligned because `@absuitecore/` is
  wider than the box it was drawn in. Redrawn with all six services and the
  trust tables in the database box.
- The README's execution-flow diagram ended with "human review", implying a
  review queue that does not exist. It now names the mechanisms that do:
  `GET /anomalies` for where to look, `POST /events/:id/appeal` for contesting a
  record. Every step names the function or route that performs it.

### Security

- **The dashboard container published port 3001 on every interface** while every
  other service bound to `127.0.0.1`. That container receives
  `CAPKIT_ADMIN_KEY` — the credential that mints capability tokens — and mounts
  the Docker socket read-only. On any host with a public address,
  `docker compose up -d` therefore exposed an admin console to the internet,
  while `GETTING-STARTED.md` stated that nothing was reachable from outside the
  host and `docs/SECURITY-MODEL.md` stated that services were isolated.

  The binding is now `127.0.0.1:3001:3001`. Both documents have been corrected
  rather than quietly fixed, and the security model now states plainly what the
  dashboard is granted and how to drop each grant.

  No published npm package is affected — this is deployment configuration in
  this repository only.

### Removed

- The dead prototype CLI at `src/`. It duplicated `@absuitecore/cli`, omitted
  the Trust service from its service list, carried a `// Placeholder for status`
  and contributed two tests to the advertised test count. The root `dev` script
  pointed at it and `yargs` was carried as a dependency for it alone. Test count
  is 410, down from 412, because two of those tests exercised code nobody runs.
- The competitor scorecard from the README. It rated four named products on four
  axes this project defined, which makes it unfalsifiable marketing wearing the
  costume of evidence — and checking the ratings found at least one that
  understated a competitor in our favour. Replaced with the distinction that is
  actually checkable and actually matters: a hash chain proves a record was not
  edited, it does not prove who wrote it; only an asymmetric signature does.

### Changed

- Strategy memos moved from `docs/` to `docs/internal/`, with a README stating
  they are dated working notes rather than project claims. They sat alongside
  the maintained documentation and read as official positions.
- `SECURITY.md` supported-versions table replaced. It said "1.0.x — Yes" while
  capkit was on 1.1.2, and listed no deprecations.
- `packages/dashboard-ui` was named `dashboard-ui` at version `2.0.0` with the
  description "Production-Ready React Application" — unscoped, ahead of every
  other package, and making a claim in a manifest.

## [trust 1.1.1, capkit 1.1.2, mcp 1.0.3, cli 1.0.3] — 2026-07-29

Package metadata only. No code changed in any of these.

### Fixed

- `@absuitecore/trust` listed **`hallucination`** as an npm keyword, while its
  own README says on line 38 that it does not detect hallucinations and
  `docs/CONSTITUTION.md` refuses to build such a thing. Someone searching npm
  for "hallucination" was being offered a package whose documentation declines
  the job. The keyword is gone.
- `trust`'s description led with "explainable scores". Scores are not the
  argument — evidence is. It now states what the package actually returns:
  `SUPPORTED`, `UNVERIFIED` or `CONTRADICTED`, never a probability. The
  `trust-score` keyword went with it.
- `capkit`, `mcp` and `cli` descriptions said what they contain rather than what
  they are for, and `cli`'s was one clause long. Keywords now carry the terms
  someone would actually search — `ed25519`, `execution-trace`,
  `tamper-evident`, `provenance` — each of which the code does.

### Deprecated on npm

- `@absuitecore/capkit@<1.1.1` — the `requiredScope` false allow.
- `@absuitecore/cli@<1.0.2` — 1.0.0 could not run at all; 1.0.1 had broken
  `--help` and `status` for global installs.

## [capkit 1.1.1, mcp 1.0.2] — 2026-07-29

### Fixed — capkit

- **`POST /auth/token/validate` accepted `requiredScope` and silently ignored
  it.** Asking whether a token holding only `payment:approve` was good for
  `payment:refund` answered `200 {"valid": true}` — a false allow, from the
  endpoint whose entire job is to answer that question. The field is now
  honoured, an insufficient scope returns `400 CAPABILITY_INSUFFICIENT`, and a
  successful response echoes `requiredScope` and `scopeSatisfied` back so a
  caller can see the check ran rather than assume it.

  The library API (`CapabilityToken.validate(token, secret, { requiredScope })`)
  was always correct. Only the HTTP route dropped the field, and it dropped it
  in silence — nothing in the response distinguished "checked and allowed" from
  "never checked".

  If you relied on this endpoint for authorisation decisions, tokens may have
  been accepted for scopes they do not carry. Re-check any code that sends
  `requiredScope` and treats `valid: true` as an authorisation.

- **`/health` reported a hardcoded `1.0.0`.** It now reads the version from the
  package manifest, so an operator debugging a deployment is not told the wrong
  thing with complete confidence. The MCP server's `initialize` response had the
  same hardcoded string and the same fix.

- **The server started with an ephemeral trace-signing key in silence.** With a
  durable `ABSUITE_DB_PATH` and no `CAPKIT_TRACE_PRIVATE_KEY`, every trace
  recorded before a restart stops verifying afterwards, and
  `/executions-verify-chain` then reports the whole chain broken —
  indistinguishable from tampering. A tamper-evidence product must not raise its
  own false alarm quietly. Startup now says so, and says it twice when the
  database is durable.

### Added

- `packages/capkit/src/server.smoke.test.ts` — spawns the built server and talks
  to it over HTTP. Every unit in the package was tested and none of the routes
  were, which is exactly how the `requiredScope` bug shipped. No amount of
  reading the handler would have found it; something had to send the request.

### Changed

- `GETTING-STARTED.md` rewritten. Every command in it was run against this
  release first. The previous version required Node 18, pointed at a Discord and
  a support address that do not exist, referenced an unpublished
  `absuite-core` CLI package and a `DEPLOYMENT.md` that was never written, and
  omitted the Trust service entirely.
- `README-docker.md` deleted. It contradicted the real compose file — a
  `docker-compose.full.yml` that does not exist, a missing Trust service, wrong
  ports — and duplicated onboarding that now lives in one place.
- `CONTRIBUTING.md` rewritten against the actual repository. It had promised
  issue templates that did not exist; they exist now.

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

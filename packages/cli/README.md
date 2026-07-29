# @absuitecore/cli

The unified command-line interface for [ABSuite](https://github.com/iamGodofall/ABSuite-core) —
trust infrastructure for intelligent systems.

```bash
npm install -g @absuitecore/cli
absuite --help
```

Requires Node 20+.

## What it does

Drives an ABSuite deployment from the terminal: check service health, issue and
revoke capability tokens, inspect the audit chain, and verify execution traces
without opening the dashboard.

```bash
absuite status                 # health of every service
absuite token issue --scope 'queue:write'
absuite verify <trace-id>      # check a signed execution trace
```

Run `absuite --help` for the full command list.

## The rest of the suite

| Package | Purpose |
|---|---|
| [`@absuitecore/capkit`](https://www.npmjs.com/package/@absuitecore/capkit) | Capability tokens, audit, signed execution traces |
| [`@absuitecore/trust`](https://www.npmjs.com/package/@absuitecore/trust) | Evidence validation, arbitration, reciprocal contracts |
| [`@absuitecore/edge-run`](https://www.npmjs.com/package/@absuitecore/edge-run) | Scheduling, queueing, self-healing execution |
| [`@absuitecore/quickbench`](https://www.npmjs.com/package/@absuitecore/quickbench) | LLM and HTTP benchmarking |
| [`@absuitecore/connector-starter`](https://www.npmjs.com/package/@absuitecore/connector-starter) | Connector registry and scaffolding |
| [`@absuitecore/mcp`](https://www.npmjs.com/package/@absuitecore/mcp) | Model Context Protocol server |

---

## Part of ABSuite

**The black box for AI systems** — record what happened, prove it happened,
preserve the evidence.

| | |
|---|---|
| Source | <https://github.com/iamGodofall/ABSuite-core> |
| Verify a trace in your browser | <https://iamgodofall.github.io/ABSuite-core/verify.html> |
| Getting started | [GETTING-STARTED.md](https://github.com/iamGodofall/ABSuite-core/blob/main/GETTING-STARTED.md) |
| Reporting a vulnerability | [SECURITY.md](https://github.com/iamGodofall/ABSuite-core/blob/main/SECURITY.md) — never a public issue |
| What this project refuses to build | [PRINCIPLES.md](https://github.com/iamGodofall/ABSuite-core/blob/main/PRINCIPLES.md) |

Published from CI with a signed Sigstore provenance attestation — check it with
`npm audit signatures` rather than taking our word for it.

MIT licensed.

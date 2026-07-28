# @absuite/quickbench — Planned, not implemented

This package has **no implementation**. It is a placeholder for the LLM
benchmarking module described in [`docs/API.md`](../../docs/API.md): latency and
throughput profiling, KV-cache analysis and A/B comparison across providers.

It is excluded from the default Docker Compose stack via the `planned` profile,
so `docker compose up` will not attempt to build it.

The CLI's `absuite bench` command shells into this service and therefore does
not work yet.

For live latency measurement against a running service today, the dashboard's
`POST /benchmark/run` endpoint performs real request timing (p50/p95/p99, RPS).

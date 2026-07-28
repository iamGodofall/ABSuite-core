# @absuite/edge-run — Planned, not implemented

This package has **no implementation**. It is a placeholder for the execution
layer described in [`docs/API.md`](../../docs/API.md): cron scheduling, queues,
process spawning and self-healing recovery.

It is excluded from the default Docker Compose stack via the `planned` profile,
so `docker compose up` will not attempt to build it.

**Do not treat the Edge-Run examples in the root README or `docs/API.md` as
shipped behaviour** — they describe the intended API only.

See [`docs/MONETIZATION.md`](../../docs/MONETIZATION.md) for why this module is
deliberately not the current priority.

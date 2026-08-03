# @absuitecore/edge-run

Cron scheduling, task queueing, retries and self-healing execution for AI agents.

Every mutating endpoint is guarded by a CapKit capability token, so authority is
issued and revoked centrally rather than per service.

## What it does

- **Cron scheduling** — full 5-field cron with ranges, steps, lists, names and
  `@daily`-style aliases. Correct day-of-month/day-of-week OR semantics.
- **Priority queue** — `high`/`normal`/`low`, delayed tasks, bounded concurrency
  and a queue limit.
- **Retries** — fixed or exponential backoff with full jitter, so a batch of
  tasks that fail together does not retry in lockstep.
- **Self-healing** — a circuit breaker per target. After repeated failures it
  opens, then half-opens after a cooldown and admits a single probe.
- **Live logs** — Server-Sent Events at `/runtime/logs`.

## Running

```bash
CAPKIT_HMAC_SECRET=$(openssl rand -hex 32) pnpm --filter @absuitecore/edge-run dev
```

## API

```bash
# Schedule a recurring task
curl -X POST localhost:8082/schedule -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"sync","cron":"*/15 * * * *","task":{"type":"http","url":"https://api.example.com/sync","method":"POST"}}'

# Queue a one-off task
curl -X POST localhost:8082/queue -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"probe","priority":"high","task":{"type":"http","url":"https://example.com/health"}}'

curl -H "Authorization: Bearer $TOKEN" localhost:8082/queue/probe/status
curl -H "Authorization: Bearer $TOKEN" localhost:8082/runtime/health   # breaker state
```

Required scopes: `schedule:create`, `schedule:read`, `queue:write`,
`queue:read`, `runtime:read`.

## Security

**Script tasks are disabled by default.** An HTTP API that spawns processes is a
remote-code-execution vector, so `script` tasks only run when
`EDGERUN_SCRIPT_ROOT` is set, and only for paths that resolve inside that
directory — `../` escapes are rejected. Scripts are spawned without a shell.

`EDGERUN_ALLOWED_HOSTS` restricts which hosts an `http` task may call. **Unset
means any host** — a wide-open default, not a neutral one. Only `http:` and
`https:` are ever permitted.

**Link-local addresses are refused whether or not an allowlist is set.**
`169.254.0.0/16` and IPv6 `fe80::/10` are where every major cloud puts instance
metadata, so an `http` task pointed there is a way to read the machine's IAM
credentials — and AWS IMDSv1 is HTTP-only, so requiring https would not have
stopped it. `metadata.google.internal` is refused by name as well, because it
resolves only inside GCP.

**Redirects are checked hop by hop.** Checking only the URL you queued is not
partial protection against a redirect — it is none. A permitted host answering
`302 Location: http://169.254.169.254/…` reached the metadata service and
returned the body in `output`, past a check that had classified the first hop
correctly. Every hop is now classified, and the refusal says which one failed.

**The metadata endpoints are refused even when allowlisted.** AWS also serves
IMDS over IPv6 at `fd00:ec2::254`, which is *unique-local* — a range this
package allows on purpose — so these are tracked as endpoints rather than as a
range. `EDGERUN_ALLOWED_HOSTS` scopes which hosts may be called; that is a
different statement from *yes, read this machine's cloud credentials*, and it no
longer makes it. `EDGERUN_ALLOW_METADATA=true` does, and says so.

Private and loopback addresses still work: calling `http://10.0.0.5/reindex` on
a schedule is what this package is for, and naming a host in
`EDGERUN_ALLOWED_HOSTS` still wins for every ordinary internal address.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `EDGERUN_PORT` | `8082` | Listen port |
| `EDGERUN_MAX_CONCURRENT` | `10` | Tasks in flight |
| `EDGERUN_QUEUE_LIMIT` | `100` | Max pending tasks |
| `EDGERUN_TASK_TIMEOUT_MS` | `30000` | Per-task timeout |
| `EDGERUN_SCRIPT_ROOT` | _unset_ | Enables script tasks under this directory |
| `EDGERUN_ALLOWED_HOSTS` | _unset_ | Comma-separated host allowlist |
| `EDGERUN_ALLOW_METADATA` | `false` | Permit the cloud metadata endpoints |
| `EDGERUN_FAILURE_THRESHOLD` | `5` | Failures before the breaker opens |
| `EDGERUN_COOLDOWN_MS` | `30000` | Time before a half-open probe |
| `CAPKIT_HMAC_SECRET` | — | Shared with CapKit to validate tokens |
| `CAPKIT_REVOCATION_FILE` | _unset_ | Shared revocation store |

## Known limitations

Schedules and queued tasks are held **in memory**. A restart loses pending work
and registered schedules. Durable storage is the next step for multi-replica
deployments.

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

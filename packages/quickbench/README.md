# @absuitecore/quickbench

LLM and HTTP service benchmarking with percentile latency, throughput and
statistically grounded regression detection.

## What it does

- **Providers** — Ollama, OpenAI, Anthropic and a generic HTTP provider for
  benchmarking your own services.
- **Correct percentiles** — nearest-rank, so every reported number is a value
  that was actually measured. No interpolation.
- **Warmup** — warmup iterations are discarded so results reflect steady state,
  not cold caches.
- **True concurrency** — a fixed worker pool keeps exactly N requests in flight
  rather than running lockstep batches.
- **Regression detection** — Welch's t-test, which does not assume equal
  variance, because a regressed build is often both slower *and* noisier.
- **Reports** — JSON, Markdown (for PR comments) and CSV (for spreadsheets).

## Running

```bash
CAPKIT_HMAC_SECRET=$(openssl rand -hex 32) pnpm --filter @absuitecore/quickbench dev
```

## API

```bash
# Benchmark a local model
curl -X POST localhost:8083/run -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"ollama","model":"llama3","testRuns":20,"warmupRuns":3,"concurrency":4}'

# Benchmark any HTTP service
curl -X POST localhost:8083/run -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"http","url":"http://localhost:8081/health","testRuns":50}'

curl -H "Authorization: Bearer $TOKEN" localhost:8083/run/$JOB_ID
curl -H "Authorization: Bearer $TOKEN" "localhost:8083/run/$JOB_ID/report?format=markdown"
curl -H "Authorization: Bearer $TOKEN" "localhost:8083/history?format=csv"

# Did this change make things slower?
curl -H "Authorization: Bearer $TOKEN" \
  "localhost:8083/compare?baseline=$BEFORE&candidate=$AFTER"
```

Required scopes: `bench:run`, `bench:read`.

`/compare` returns a verdict of `regression`, `improvement` or
`no significant change`, so it can gate a deploy directly.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `QUICKBENCH_PORT` | `8083` | Listen port |
| `QUICKBENCH_OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `OPENAI_API_KEY` | _unset_ | Enables the OpenAI provider |
| `ANTHROPIC_API_KEY` | _unset_ | Enables the Anthropic provider |
| `CAPKIT_HMAC_SECRET` | — | Shared with CapKit to validate tokens |

Run counts are clamped (max 500 runs, concurrency 32) so a single request
cannot ask for unbounded work.

## Security

The `http` provider takes its URL from the request body, so a `bench:run` scope
would otherwise also mean *send traffic wherever I say*. **Link-local addresses
are refused** — `169.254.0.0/16` and IPv6 `fe80::/10`, plus
`metadata.google.internal` by name — because that is where every major cloud puts
instance metadata and it is never a benchmark target.

Redirects are checked hop by hop. Checking only the URL you submitted is no
protection at all against a `302`, which was demonstrated rather than assumed.
The metadata endpoints are refused regardless of range — AWS serves IMDS over
IPv6 at `fd00:ec2::254`, which is unique-local and would otherwise have been
allowed.

Private and loopback addresses still work. Benchmarking your own service is the
entire point of this provider, and a guard that broke it would be switched off.

## Known limitations

Job history is in memory and capped at 100 jobs. Results do not survive a
restart; export to CSV to retain them.

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

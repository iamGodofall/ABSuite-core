# @absuite/quickbench

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
CAPKIT_HMAC_SECRET=$(openssl rand -hex 32) pnpm --filter @absuite/quickbench dev
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

## Known limitations

Job history is in memory and capped at 100 jobs. Results do not survive a
restart; export to CSV to retain them.

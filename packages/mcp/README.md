# @absuitecore/mcp

**Capability-checked, cryptographically attested tool calls for AI agents — over the Model Context Protocol.**

MCP is how agents discover and call tools. This server puts ABSuite *inside*
that path: every tool call is authorised against a capability token before it
runs, and every completed call produces an Ed25519-signed execution trace that
anyone can verify independently.

```bash
npm install -g @absuitecore/mcp
```

## Claude Desktop / any MCP client

```json
{
  "mcpServers": {
    "absuite": {
      "command": "absuite-mcp",
      "env": {
        "ABSUITE_TOKEN": "<capability token from CapKit>",
        "CAPKIT_HMAC_SECRET": "<shared signing secret>",
        "ABSUITE_DB_PATH": "/var/lib/absuite/absuite.db"
      }
    }
  }
}
```

## What the agent sees

Tool discovery is **filtered by capability**. An agent holding a token scoped to
`queue:write` never sees the benchmarking or connector tools — advertising tools
it cannot call would waste its context and invite failed attempts.

| Tool | Required scope |
|---|---|
| `absuite_schedule_task` | `schedule:create` |
| `absuite_queue_task` | `queue:write` |
| `absuite_run_benchmark` | `bench:run` |
| `absuite_list_connectors` | `connector:read` |
| `absuite_verify_execution` | `execution:read` |

A call outside the token's scope is refused **before any network request is
made**:

```
{"error":{"code":-32001,"message":"Not permitted: bench:run (CAPABILITY_INSUFFICIENT)"}}
```

## Attestation

Every completed call returns the trace that attests it:

```json
{
  "content": [{ "type": "text", "text": "{ \"id\": \"task-1\", \"status\": \"queued\" }" }],
  "_absuiteTrace": {
    "id": "exec_4c35d902c1394dafabb53cfaafa16abe",
    "hash": "6217d46894eb4a...",
    "signature": "qwlL7FQiyW2RoyuBhQdKHV/cEOu1..."
  }
}
```

Hand that trace to anyone with the public key and they can confirm it has not
been altered — without being able to forge one. Inputs and outputs are hashed,
never stored, so the proof does not retain your data.

## Why this matters

The hard question about agents in production is not "can it do the task" but
**"what was it allowed to do, what did it actually do, and can you prove it?"**

Most MCP servers answer none of those. This one answers all three, and does it
without the agent framework needing to know ABSuite exists.

## Configuration

| Variable | Purpose |
|---|---|
| `ABSUITE_TOKEN` | The capability token the agent presents. |
| `CAPKIT_HMAC_SECRET` | Verifies the token locally, so refusals never reach the network. |
| `CAPKIT_PREVIOUS_SECRETS` | Comma-separated retired secrets, so rotation does not break running agents. |
| `ABSUITE_DB_PATH` | Enables attestation. Without it calls still work, unattested. |
| `CAPKIT_TRACE_PRIVATE_KEY` | Ed25519 PEM for signing traces. |
| `CAPKIT_URL`, `EDGE_RUN_URL`, `QUICKBENCH_URL`, `CONNECTOR_STARTER_URL` | Service endpoints. |

## Notes

Transport is stdio, per the MCP spec — **nothing is written to stdout except
protocol messages**; diagnostics go to stderr. Attestation failures are logged
to stderr rather than swallowed, so a deployment cannot silently lose its
attestation trail.

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

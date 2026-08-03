# ABSuite Security Model

> How ABSuite protects your AI agents and infrastructure.
>
> **Found a vulnerability?** Do not open a public issue — see
> [`SECURITY.md`](../SECURITY.md) for private disclosure.
>
> Note that two different primitives are in play, deliberately: **capability
> tokens are HMAC-signed** (symmetric, simple to operate, described below),
> while **execution traces are Ed25519-signed** (asymmetric, so a verifier
> needs only the public key and cannot forge). That is not an inconsistency —
> a trace has to be checkable by someone who is not trusted to issue one.

---

## Overview

ABSuite uses defense-in-depth at four levels: network isolation, transport encryption, application-level authentication, and capability scoping. No single layer depends on another — if one fails, the others still hold.

---

## Capability Token System

The core security primitive in ABSuite is the **capability token** — a scoped, time-limited, HMAC-signed permission grant.

### Why HMAC instead of RSA/JWT?

RSA JWTs require a public key infrastructure. You need to distribute, rotate, and revoke public keys across every service that validates tokens. This is operational complexity that becomes a real attack surface.

HMAC tokens avoid this: the signing key and the validating key are the same. Any service that has the shared secret can validate any token. This makes the system simpler to operate while retaining equivalent security properties for the threat model we care about.

**Tradeoff:** If the HMAC key is compromised, all tokens signed with it are forgeable. Mitigations:
- Keys are never logged or transmitted in cleartext
- Keys are rotated regularly (automatically via the key rotation system)
- Tokens have short expiration windows (default: 8 hours)

### Token structure

```typescript
interface CapabilityToken {
  // Identify the signing key (for key rotation support)
  kid: string                    // "key-2026-03-rotation-a"

  // Who this grants access to
  sub: string                    // "agent-42" or "user:enock"

  // What this allows (principle of least privilege)
  scope: [
    'read:users',                // Read access to users resource
    'write:tasks',               // Write access to tasks
    'execute:scripts',           // Can run scheduled scripts
  ]

  // Time bounds
  iat: number                    // Unix timestamp: issued at
  exp: number                    // Unix timestamp: expires at

  // Audience binds token to a specific deployment
  aud: 'absuite://production'   // Tokens only work in intended environment

  // Unique ID for revocation
  jti: string                    // UUID: track in DB for revocation
}
```

### Validation flow

```
Client → sends token in Authorization header
       → CapKit extracts kid, looks up signing key
       → CapKit computes HMAC-SHA256(header.payload, key)
       → Compares computed MAC with received MAC (timing-safe)
       → Checks exp < now
       → Checks aud matches
       → Returns capability set or rejection
```

### Key rotation

CapKit maintains a key ring — the current key plus previous keys (for in-flight tokens). Key rotation is idempotent: new key added, old tokens with previous key still validate for their remaining lifetime.

```typescript
// Rotate to new key
await capkit.rotateKey()
// Old tokens still valid until expiration
// New tokens issued with new key
```

---

## AI Content Policy

CapKit's AI content policy engine filters prompts and responses based on configurable rules.

### Policy structure

```typescript
interface AIPolicyRule {
  id: string
  action: 'allow' | 'deny' | 'flag'
  resource: string              // e.g., "prompt", "response"
  conditions: {
    patterns?: string[]         // Regex patterns to match
    maxLength?: number          // Max character length
    maxTokens?: number          // Max token count
    blockedDomains?: string[]   // URLs to block
    requireApproval?: boolean  // Human-in-the-loop
  }
  severity: 'low' | 'medium' | 'high' | 'critical'
  audit: boolean               // Log even if allowed
}
```

### Default policy

Out of the box, ABSuite ships with:
- **Low severity:** Rate limiting (100 req/min per token)
- **Medium severity:** Content length limits (prompt < 128k tokens)
- **High severity:** Blocked prompt injection patterns (markdown injection, system prompt extraction)
- **Critical severity:** Configurable sensitive data detection (PII patterns)

---

## Rate Limiting

ABSuite implements layered rate limiting:

| Level | Scope | Default |
|-------|-------|---------|
| Per token | By capability token ID | 100 req/min |
| Per IP | By client IP address | 500 req/min |
| Per endpoint | Per API route | 1000 req/min |

Rate limit state is stored in SQLite with a sliding window algorithm. Redis support planned for multi-instance deployments.

---

## Audit Logging

Every request that passes through CapKit generates an audit entry:

```typescript
interface AuditEntry {
  id: string                    // UUID
  timestamp: Date
  subject: string               // Token subject (who)
  action: string               // HTTP method + path
  resource: string            // Normalized resource path
  result: 'allow' | 'deny' | 'flag'
  reason?: string              // Denial reason if applicable
  severity: string
  durationMs: number            // Request processing time
  metadata: {
    ip?: string
    userAgent?: string
    requestId?: string         // For distributed tracing
  }
}
```

Audit logs are:
- Written synchronously (no async batching that could lose events)
- Stored in SQLite (can be exported to external SIEM)
- Queryable via dashboard in real-time
- Immutable (no UPDATE or DELETE operations)

---

## Network Security

### Docker network isolation

Each ABSuite service runs in its own container on a private bridge network
(`absuite-net`). Six ports are published to the host, **every one bound to
`127.0.0.1`** — reachable from the machine itself, not from the network.

```
Host machine (loopback only)
    │
    ├── 127.0.0.1:3001 ──► dashboard            ┐
    ├── 127.0.0.1:8081 ──► capkit               │
    ├── 127.0.0.1:8082 ──► edge-run             │ all on absuite-net,
    ├── 127.0.0.1:8083 ──► quickbench           │ talking to each other
    ├── 127.0.0.1:8084 ──► connector-starter    │ over the bridge
    ├── 127.0.0.1:8085 ──► trust                ┘
    │
    └── absuite-db — no published port at all; reachable only on the bridge
```

An earlier version of this document claimed only 3001 was exposed, and an
earlier `docker-compose.yml` published 3001 on **every** interface rather than
loopback. On a host with a public address that put the dashboard — which holds
`CAPKIT_ADMIN_KEY` and mounts the Docker socket — on the open internet, while
this page said it was isolated. Both are fixed; it is recorded here because a
security document that quietly corrects itself is worth less than one that says
what was wrong.

### What the dashboard is granted

The dashboard container is the most privileged part of a default deployment:

| Grant | Why | How to drop it |
|---|---|---|
| `CAPKIT_ADMIN_KEY` | Issues capability tokens from the UI | Omit it; the rest of the dashboard still works |
| `/var/run/docker.sock` (read-only) | Reports and controls service state | Delete the `volumes:` entry; you lose start/stop/restart |

Neither is needed by any other service. A deployment that only needs the trust
guarantees can run CapKit alone and skip the dashboard entirely.

### Inter-service communication

Services communicate over the Docker bridge network using HTTP. In production, enable TLS by configuring certificates in each service's environment.

### Outbound requests

Three services take a URL from a caller and fetch it: `webhook.send` in
connector-starter, `http` tasks in edge-run, and the `http` provider in
quickbench. Each holds a capability scope that means *send a webhook*, *queue a
task*, *run a benchmark* — none of which mean *read this machine's cloud
credentials*, which is what an unguarded fetch of `169.254.169.254` returns on a
cloud VM.

Address classification is shared, in `@absuitecore/capkit`'s `outbound` module,
so there is one table rather than three copies that agree today. **Policy is not
shared**, because it genuinely differs:

| Service | Refuses | Rationale |
|---|---|---|
| connector-starter | loopback, private, link-local, unique-local, CGNAT, unspecified | posts to third parties; an internal address is never a legitimate webhook target |
| edge-run | link-local | calling your own `10.0.0.5` on a schedule is the product |
| quickbench | link-local | benchmarking your own service is the use case |

All three refuse link-local, because `169.254.0.0/16` is where every major cloud
puts instance metadata. `metadata.google.internal` is refused **by name** as well
as by address — including with a trailing dot — because it resolves only inside
GCP, so a resolution-based check would work only where it cannot be tested.

### Every hop, not just the first

Classifying the caller's URL is not enough, and the gap is total rather than
partial: `fetch` follows redirects by default and does not re-check. A permitted
host answering `302 Location: http://169.254.169.254/…` was demonstrated to
reach the metadata service with the body returned, past a guard that had
classified hop one correctly.

All outbound calls go through `guardedFetch`, which follows redirects itself and
applies three rules `fetch` cannot be asked to apply:

1. **Every hop is classified.** A redirect chain is checked link by link, and
   the refusal names which hop failed.
2. **Known metadata endpoints are refused whatever the range policy is.** These
   are tracked as endpoints rather than a range, because they are not one:
   `169.254.169.254` is link-local, `169.254.170.2` (ECS task role credentials)
   is link-local, `100.100.100.200` (Alibaba) is carrier-grade NAT, and AWS
   serves IMDS over IPv6 at `fd00:ec2::254`, which is **unique-local** — a range
   edge-run and quickbench allow on purpose.
3. **`Authorization` and `Cookie` are dropped when the origin changes**, so a
   redirect cannot be used to harvest the caller's own credentials.

Addresses are classified numerically rather than by text. `new URL()`
re-serialises IPv6 to its shortest form, so `[::ffff:169.254.169.254]` arrives
as `::ffff:a9fe:a9fe`; a pattern looking for a dotted quad sees none. IPv4-mapped,
IPv4-compatible and NAT64-embedded forms are all resolved to the IPv4 address
they reach.

### Escape hatches, and what they are allowed to open

Each control can be turned off by the operator, on the principle that a control
which breaks a legitimate deployment gets patched out and then protects nobody:

| Variable | Opens |
|---|---|
| `ABSUITE_ALLOW_PRIVATE_WEBHOOKS` | internal addresses for connector-starter |
| `EDGERUN_ALLOWED_HOSTS` | scopes which hosts edge-run may call at all |
| `EDGERUN_ALLOW_METADATA` | the instance metadata endpoints, for edge-run |

**A host allowlist does not open the metadata endpoints.** *Restrict which hosts
this may call* and *yes, read this machine's cloud credentials* are different
statements, and the knob named for the first is not the one that does the
second. This is a deliberate change from edge-run's earlier behaviour.

**This raises the cost of SSRF; it does not eliminate it.** See the DNS rebinding
note under *What ABSuite does NOT protect against*.

---

## Secret Management

ABSuite uses environment variables for configuration. In production:

1. **Never commit secrets to git** — Use `.env.example` as a template with placeholder values
2. **Use Docker secrets** — For Docker Swarm deployments, use `FILE` syntax: `CAPKIT_HMAC_SECRET_FILE=/run/secrets/hmac_secret`
3. **Use vault integrations** — Planned support for HashiCorp Vault and Azure Key Vault

Minimum secrets required for production:
```env
CAPKIT_HMAC_SECRET=<random-256-bit-secret>
CAPKIT_JWT_SECRET=<random-256-bit-secret>
ABSUITE_DB_ENCRYPTION_KEY=<random-256-bit-secret>
```

---

## Threat Model

### What ABSuite protects against

| Threat | Mitigation |
|--------|------------|
| Token forgery | HMAC-SHA256 with timing-safe comparison |
| Token theft / replay | Short expiration (8h default) + revocation list |
| Prompt injection | AI content policy regex patterns |
| Unauthorized access | Capability scoping (least privilege) |
| Resource exhaustion | Rate limiting + process timeouts |
| Data exfiltration | Audit logging of all requests |
| Privilege escalation | No privilege inheritance between scopes |
| SSRF to cloud metadata | Outbound address classification, link-local refused by every service that fetches a caller-supplied URL |

### What ABSuite does NOT protect against

- **Compromised host machine** — If Docker daemon is compromised, container isolation fails
- **Malicious insiders with HMAC key access** — Key management is the operator's responsibility
- **DDoS attacks** — Rate limiting helps but is not a substitute for network-level DDoS protection (use a CDN/WAF)
- **Model-level prompt injection** — CapKit filters known patterns but cannot catch sophisticated jailbreaks
- **DNS rebinding** — the outbound guard resolves a hostname, then `fetch` resolves it again. A hostile resolver can answer differently between the two. Redirects no longer widen this (every hop is re-checked), so the window is one hop rather than unbounded — but closing it requires an HTTP agent that connects to the address it checked. Until then the class is made expensive, not removed, and claiming otherwise would be the kind of overstatement this project exists to prevent

---

## Security Reporting

Found a security issue? **Do not open a public GitHub issue.**

Email: `security@absuite.dev` with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes

We aim to acknowledge within 48 hours and resolve critical issues within 7 days. We follow responsible disclosure and will credit reporters (unless anonymity is requested).

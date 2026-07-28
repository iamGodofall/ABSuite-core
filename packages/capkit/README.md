# @absuite/capkit

**Scoped, expiring, auditable credentials for AI agents. Stop handing your agents your root API key.**

[![MIT License](https://img.shields.io/badge/license-MIT-7C3AED)](./LICENSE)

Most agent deployments authenticate with a long-lived API key that has full
account access. CapKit replaces that with capability tokens: narrow, expiring,
revocable grants, with a tamper-evident record of everything they were used for.

```bash
npm install @absuite/capkit
```

## Capability tokens

```typescript
import { CapabilityToken } from '@absuite/capkit'

const created = CapabilityToken.create({
  sub: 'agent-001',
  scope: ['read:users', 'write:tasks'],
  expiresIn: '8h',
}, process.env.CAPKIT_HMAC_SECRET!)

const result = CapabilityToken.validate(created.token, secret, {
  requiredScope: 'write:tasks',
})

if (!result.valid) {
  // 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'CAPABILITY_INSUFFICIENT' | 'TOKEN_REVOKED'
  throw new Error(result.error)
}
```

Scopes match segment-wise: `read:*` grants `read:users` but never
`read:users:delete`. Tokens are HS256 JWTs signed with `node:crypto` — no
third-party JWT dependency on the security-critical path, and `alg: none`
downgrades and tampered payloads are rejected.

## Guarding a route

```typescript
import express from 'express'
import { capabilityGuard, revocationStoreFromEnv } from '@absuite/capkit'

const requireCapability = capabilityGuard({ revocations: revocationStoreFromEnv() })

app.post('/tasks', requireCapability('write:tasks'), handler)
```

Returns `401` for a missing or invalid token, `403` for insufficient scope. If
the revocation store is unreachable it returns `503` rather than failing open.

## Verifiable execution

Every real action can produce a signed, hash-chained trace. Signatures are
**Ed25519**, so an auditor can verify your records holding only a public key —
without also being able to forge them.

```typescript
import { TraceStore, SigningKey, verifyTrace, getStorage } from '@absuite/capkit'

const traces = new TraceStore(getStorage(), new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY))

const trace = traces.record({
  subject: 'agent-001',
  scope: ['write:tasks'],
  module: 'my-service',
  action: 'http:POST https://api.example.com/sync',
  inputHash: hashPayload(input),
  outputHash: hashPayload(output),
  outcome: 'success',
  startedAt, completedAt, steps: [],
})

// Anyone holding the public key can check it — no ABSuite credentials needed.
verifyTrace(trace, publicKeyPem)  // { valid: true, contentIntact: true, signatureValid: true }

traces.verifyChain(publicKeyPem)  // names the sequence number of any broken record
```

Payloads are **hashed, never stored**, so a trace proves what happened without
retaining your customers' data.

## Tamper-evident audit log

```typescript
import { AuditLog } from '@absuite/capkit'

const audit = new AuditLog('/data/audit.jsonl')
audit.record({ subject: 'agent-001', action: 'POST /tasks', resource: '/tasks', result: 'allow' })

audit.verifyChain()  // { valid: false, brokenAt: 3, reason: 'Entry content does not match its hash' }
```

Editing or deleting a historical entry breaks every subsequent link, and the
verifier names the first record that fails.

## Multi-tenancy, metering and quotas

```typescript
import { Storage, TenantService } from '@absuite/capkit'

const tenancy = new TenantService(new Storage('/data/absuite.db'))
const tenant = tenancy.tenants.create('Acme Corp', 'team')
// tenant.apiKey is returned exactly once and stored only as a SHA-256 hash.

tenancy.consume(tenant, 'validations')
tenancy.usageReport(tenant)  // usage, quotas, and which limits are being approached
```

## Configuration

| Variable | Purpose |
|---|---|
| `CAPKIT_HMAC_SECRET` | Token signing secret. Required in production (32+ chars). |
| `CAPKIT_ADMIN_KEY` | Bootstrap key for issuing the first token. |
| `CAPKIT_AUDIENCE` | Optional audience enforced at validation. |
| `ABSUITE_DB_PATH` | SQLite database. Enables durable revocation, tenancy and traces. |
| `CAPKIT_TRACE_PRIVATE_KEY` | Ed25519 PEM for signing traces. Generated ephemerally if unset. |

Generate secrets with `openssl rand -hex 32`, and a trace keypair with
`SigningKey.generate()`.

## Known limitations

- Only one signing key is active at a time; rotating `CAPKIT_HMAC_SECRET`
  invalidates existing tokens.
- SQLite is single-node. The `Storage` and `RevocationStore` interfaces exist so
  a Postgres or Redis backend drops in without callers changing.

## Part of ABSuite

`@absuite/edge-run` (scheduling), `@absuite/quickbench` (benchmarking) and
`@absuite/connector-starter` (integrations) all enforce CapKit capabilities, so
one token works across the suite and revoking it locks it out everywhere.

MIT licensed. [Source](https://github.com/iamGodofall/ABSuite-core).

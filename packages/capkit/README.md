# @absuitecore/capkit

**Scoped, expiring, auditable credentials for AI agents. Stop handing your agents your root API key.**

[![MIT License](https://img.shields.io/badge/license-MIT-7C3AED)](https://github.com/iamGodofall/ABSuite-core/blob/main/LICENSE)

Most agent deployments authenticate with a long-lived API key that has full
account access. CapKit replaces that with capability tokens: narrow, expiring,
revocable grants, with a tamper-evident record of everything they were used for.

```bash
npm install @absuitecore/capkit
```

## Capability tokens

```typescript
import { CapabilityToken } from '@absuitecore/capkit'

const created = CapabilityToken.create({
  sub: 'agent-001',
  scope: ['read:users', 'write:tasks'],
  expiresIn: '8h',
}, process.env.CAPKIT_HMAC_SECRET!)

const result = CapabilityToken.validate(created.token, secret, {
  requiredScope: 'write:tasks',
})

if (!result.valid) {
  // 'TOKEN_MISSING' | 'TOKEN_MALFORMED' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED'
  // | 'TOKEN_NOT_ACTIVE' | 'TOKEN_AUDIENCE_MISMATCH' | 'TOKEN_REVOKED'
  // | 'CAPABILITY_INSUFFICIENT'
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
import { capabilityGuard, revocationStoreFromEnv } from '@absuitecore/capkit'

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
import { TraceStore, SigningKey, verifyTrace, getStorage } from '@absuitecore/capkit'

const traces = new TraceStore(getStorage(), new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY))

const trace = traces.record({
  subject: 'agent-001',
  scope: ['write:tasks'],
  module: 'my-service',
  action: 'http:POST https://api.example.com/sync',
  input,          // hashed here and discarded — pass `inputHash` if you hashed it yourself
  output,
  outcome: 'success',
})

// Anyone holding the public key can check it — no ABSuite credentials needed.
verifyTrace(trace, publicKeyPem)  // { valid: true, contentIntact: true, signatureValid: true }

traces.verifyChain(publicKeyPem)  // names the sequence number of any broken record
```

Payloads are **hashed, never stored**, so a trace proves what happened without
retaining your customers' data. `startedAt` defaults to now, `steps` to none,
and `durationMs` is derived when you supply both timestamps — a default is only
ever taken where the library already knows the answer.

## Tamper-evident audit log

```typescript
import { AuditLog } from '@absuitecore/capkit'

const audit = new AuditLog('/data/audit.jsonl')
audit.record({ subject: 'agent-001', action: 'POST /tasks', resource: '/tasks', result: 'allow' })

audit.verifyChain()  // { valid: false, brokenAt: 3, reason: 'Entry content does not match its hash' }
```

Editing or deleting a historical entry breaks every subsequent link, and the
verifier names the first record that fails.

## Human approvals, bound to what actually ran

An approval is tied to a **hash of the payload**, not to a request id. Every
field it binds — subject, module, action, inputHash — is also on the finished
execution record, so *"was this approved?"* is answerable from the record alone,
with no approval id written onto it.

```typescript
import { ApprovalRegistry, Storage } from '@absuitecore/capkit'

const approvals = new ApprovalRegistry(new Storage('/data/absuite.db'))

const request = approvals.request({
  action: { subject: 'agent:payments', module: 'payments',
            action: 'approve_batch', inputHash },     // the hash of what will run
  context: 'batch B-1 is over the human-approval threshold',
  policyRef: 'payments.batch-approval', policyVersion: '1',
  requestedBy: 'ops:alice',
})

approvals.decide(request.id, {
  decision: 'GRANTED', decidedBy: 'ops:bob',
  basis: 'CFO confirmed the batch against the ledger.',   // required, never optional
})
```

An approval granted for one input does not cover a different one. The requester
may not decide, and a decision with no stated basis is refused — recorded
reasoning is the only part of an approval that helps anybody six months later.

**Signed versus named.** A decision signed with an enrolled key reads `PROVEN`; a
decision attributed by a name the operator supplied reads `ASSERTED`, and says
so. Set `ABSUITE_REQUIRE_SIGNED_APPROVALS=true` to make that a gate rather than a
label — an `ASSERTED` decision then turns Governance `FAILED` on a record whose
policy demanded a person. **Set it if you rely on approvals for a regulated
obligation.**

## Watch — findings, and how much of the record they cover

```typescript
import { Watch } from '@absuitecore/capkit'

const watch = new Watch(storage, traces, approvals, { publicKeyPem })

watch.coverage()   // everRun: false — nothing has looked yet, and it says so
watch.sweep()

watch.notices()    // CHAIN_BROKEN, UNAPPROVED_EXECUTION, DENIED_BUT_SUCCEEDED, …
watch.coverage()   // everRun, sweeps, highWaterSeq, behind, and why
```

`coverage()` exists because **an empty notice list means two opposite things** —
*we looked and found none*, or *nothing has ever looked* — and those must not
appear identical. Before the first sweep it says exactly which one you have:

> This watch has never run. There are no notices because nothing has looked,
> which is not the same as nothing being wrong.

After a sweep it stops making that excuse and tells you how far it got, including
how many records it has not reached yet.

## Multi-tenancy, metering and quotas

```typescript
import { Storage, TenantService } from '@absuitecore/capkit'

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
| `ABSUITE_REQUIRE_SIGNED_APPROVALS` | `true` makes an unsigned (`ASSERTED`) approval fail rather than pass with a label. Off by default; the server says which mode it is in at boot, both ways. |

Generate secrets with `openssl rand -hex 32`, and a trace keypair with
`SigningKey.createPair()` — it hands back the key to sign with plus both PEMs,
the public one to give auditors and the private one for your secret manager.
`SigningKey.generate()` returns the PEMs alone and remains supported.

## Where an outbound request is going

Three services in this suite take a URL from a caller and fetch it. Rather than
three copies of one address table — the drift this project keeps catching in
itself — classification lives here, and so does the fetch that uses it:

```ts
import { guardedFetch } from '@absuitecore/capkit';

const response = await guardedFetch(url, init, {
  refuse: ['link-local'],   // your policy; metadata endpoints are always refused
  allow: allowedHosts,      // hosts an operator named explicitly
  verb: 'call',             // used in the error: "Refusing to call …"
});
```

`guardedFetch` follows redirects itself, because `fetch` follows them without
asking again — a permitted host answering `302 Location:
http://169.254.169.254/…` was demonstrated to reach the metadata service past a
guard that had classified hop one correctly. Against a redirect, checking only
the caller's URL is not partial protection; it is none. Every hop is classified,
`Authorization` and `Cookie` are dropped when the origin changes, and a
`BlockedTargetError` names which hop failed.

`allow` and `only` are different questions, and the difference is load-bearing.
`allow` exempts a host from the range check; `only` restricts **every hop** to a
list and refuses anything else. Passing an allowlist as `allow` restricts the
first request and nothing after it.

**Known metadata endpoints are refused whatever your `refuse` list says.** They
are not a range: `169.254.169.254` is link-local, `100.100.100.200` is
carrier-grade NAT, and AWS serves IMDS over IPv6 at `fd00:ec2::254`, which is
unique-local — a range services that call their own infrastructure allow on
purpose. `allowMetadata: true` overrides it, and a host allowlist deliberately
does not.

The classifier is exported on its own for callers that need to decide before
fetching:

```ts
import { resolveRanges, inAnyRange } from '@absuitecore/capkit';

const blocked = inAnyRange(await resolveRanges(url.hostname), ['link-local']);
if (blocked) throw new Error(`Refusing to call ${url.hostname}: it is ${blocked.why}.`);
```

`resolveRanges` returns every address a hostname resolves to, each tagged
`loopback | private | link-local | carrier-grade-nat | unique-local |
unspecified | public`, with a `why` string naming the specific thing that
matched — `169.254.169.254` is described as the metadata service, `fe80::1` is
not. It returns `undefined` for a name that will not resolve, because reporting a
DNS outage as a security event teaches operators to ignore security events.

Addresses are compared numerically, not as text. `new URL()` re-serialises IPv6
to its shortest form, so `[::ffff:169.254.169.254]` arrives as
`::ffff:a9fe:a9fe`; a pattern looking for a dotted quad sees none and calls it
public. IPv4-mapped, IPv4-compatible and NAT64-embedded forms all classify as
the IPv4 address they reach.

**It classifies and does not decide.** There is no `isAllowed()`, because
`webhook.send` posts to third parties and must refuse private ranges, while
edge-run and quickbench exist to call your own internal services. A shared
decision would have had to pick a side and be wrong somewhere.

## Known limitations

- Only one signing key is active at a time; rotating `CAPKIT_HMAC_SECRET`
  invalidates existing tokens.
- `guardedFetch` pins the connection to the address it classified, which closes
  DNS rebinding. `resolveRanges` on its own does not — a caller that resolves and
  then hands the hostname to `fetch` is resolving twice, which is the window.
- SQLite is single-node. The `Storage` and `RevocationStore` interfaces exist so
  a Postgres or Redis backend drops in without callers changing.

## One token, every service

`@absuitecore/edge-run` (scheduling), `@absuitecore/quickbench` (benchmarking),
`@absuitecore/connector-starter` (integrations) and `@absuitecore/trust`
(evidence) all import `capabilityGuard` from this package, so one token works
across the suite and revoking it at CapKit locks it out everywhere.

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

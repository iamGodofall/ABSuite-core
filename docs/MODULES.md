# The modules, in code

Each package works alone. Import the one you need; nothing here requires the
others or a running service.

For getting a service up, see [`GETTING-STARTED.md`](../GETTING-STARTED.md).
For every HTTP route, see [`API.md`](./API.md).

---

## CapKit — capability tokens

```typescript
import { CapabilityToken } from '@absuitecore/capkit'

const created = CapabilityToken.create({
  sub: 'agent-001',
  scope: ['read:users', 'write:tasks', 'execute:scripts'],
  expiresIn: '8h',
  aud: 'absuite://production',
  kid: 'service-key-1',
}, hmacKey)

const result = CapabilityToken.validate(created.token, hmacKey, {
  requiredScope: 'write:tasks',
})

if (!result.valid) {
  // 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'CAPABILITY_INSUFFICIENT' | …
  throw new Error(`Capability rejected: ${result.error}`)
}
```

Scopes match segment-wise, so `read:*` grants `read:users` but never
`read:users:delete`. Tokens are HS256 JWTs signed with `node:crypto` — no
third-party JWT dependency on the security-critical path.

## CapKit — signed execution traces

```typescript
import { SigningKey, TraceStore, Storage, verifyTrace } from '@absuitecore/capkit'

const { key, publicKeyPem } = SigningKey.createPair()
const traces = new TraceStore(new Storage('./audit.db'), key)

const trace = traces.record({
  subject: 'agent:invoicing',
  scope: ['payment:approve'],
  module: 'payments',
  action: 'approve_batch',
  input: { batch: 'BATCH-8891', total: 250000 },  // hashed here, never stored
  outcome: 'success',
})

verifyTrace(trace, publicKeyPem)   // { valid: true, contentIntact: true, signatureValid: true }
traces.verifyChain(publicKeyPem)   // { valid: true, checked: 1, headHash: '…' }
```

Signing is **Ed25519**, not HMAC. An auditor who can verify your records must
not also be able to forge them; a shared secret cannot make that distinction.

`verifyChain()` returns `brokenAt` — the sequence number of the first record
that fails — rather than a bare boolean.

## Trust — evidence validation

```typescript
import { verifyOutput, renderReport, evidenceRecord } from '@absuitecore/trust'

const report = verifyOutput(
  'The CEO approved this batch. Total exposure is $250,000, under the $300,000 limit.',
  ['Q3 policy: automated approval permitted up to $300,000 per batch.'],
)

console.log(renderReport(report))
// Claim:    The CEO approved this batch
// Evidence: none
// Status:   UNVERIFIED
```

`UNVERIFIED` means the evidence is absent — **not** that the claim is false.
Only `CONTRADICTED` asserts a defect, because there the output disagrees with
itself and no external truth is needed to see it.

```typescript
evidenceRecord('person:j.smith', 'human', events)
// { eventsRecorded: 1042, policyViolations: 2, manualOverrides: 1,
//   auditFindings: 0, note: 'These are recorded facts, not an assessment…' }
```

No `score` field, and it cannot be given one.

## Edge-Run — scheduling and retries

```typescript
import { TaskQueue, TaskRuntime, AgentScheduler, nextRun } from '@absuitecore/edge-run'

const runtime = new TaskRuntime({ allowedHosts: ['api.example.com'] })
const queue = new TaskQueue({ runtime, concurrency: 10 })
const scheduler = new AgentScheduler(queue)

scheduler.schedule({
  id: 'data-sync',
  cron: '*/15 * * * *',
  task: { type: 'http', url: 'https://api.example.com/sync', method: 'POST' },
  retry: { maxAttempts: 3, backoff: 'exponential' },
})

queue.enqueue(
  { type: 'http', url: 'https://api.example.com/welcome', method: 'POST' },
  { id: 'welcome-email', delay: 30_000, priority: 'high' },
)

queue.start()
scheduler.start()

nextRun('0 0 29 2 *')  // the next 29 February, computed without brute force
```

The circuit breaker groups failures by target host, so one failing dependency
never takes the whole queue down with it.

## QuickBench — benchmarking

```typescript
import { BenchmarkRunner, summarise } from '@absuitecore/quickbench'

const runner = new BenchmarkRunner()

const job = runner.submit({
  name: 'llama3 latency',
  provider: 'ollama',
  model: 'llama3',
  warmupRuns: 3,   // discarded: measures cold cache, not steady state
  testRuns: 20,
  concurrency: 4,
})

runner.compare(baselineJobId, job.jobId)
// { deltaPercent: 42.3, significant: true, verdict: 'regression' }
```

`summarise()` reports min/mean/stddev and p50/p90/p95/p99 using **nearest-rank**,
so every figure is a latency that was actually observed rather than interpolated
between two that were.

## Connector-Starter — integrations

```typescript
import { describeConnectors, verifyConnector, generate } from '@absuitecore/connector-starter'

describeConnectors()
// [{ id: 'github', configured: true, missing: [], actions: [...] }, …]

await verifyConnector('github')   // read-only: never posts or creates anything

const { manifest, typescript, spec } = generate(
  'Read GitHub issues and post them to Slack every 15 minutes'
)
spec.schedule  // '*/15 * * * *' — ready to hand to Edge-Run
```

Generation is deterministic and rule-based: no API key required, and the same
description always produces identical output — which matters when the result is
committed to a repository.

## MCP — ABSuite inside the tool-calling path

`@absuitecore/mcp` speaks Model Context Protocol over stdio. Any agent runtime
that speaks MCP gets capability-checked, attested tool calls with no integration
work: every call is authorised against a capability token before it runs, and
every completed call produces a signed execution trace.

Tools are filtered by the caller's actual scopes, so an agent is never shown a
tool it cannot use — advertising one wastes its context and invites a failed
attempt.

## CLI — the deployment from a terminal

`@absuitecore/cli` installs the `absuite` command.

```bash
npm install -g @absuitecore/cli

absuite status                 # health of every service
absuite token issue --scope 'queue:write'
absuite verify <trace-id>      # check a signed execution trace
absuite doctor                 # what is wrong with this deployment
```

`absuite doctor` is the one worth knowing. Against a fresh instance, with
`CAPKIT_ADMIN_KEY` set so it can read past the auth wall, it reports two failures
unprompted:

```
✗ Signing key  Generated for this process. Every record written since the last
               restart stops verifying at the next one.
✗ Watch        Has never swept. There are no findings because nothing has
               looked, which is not the same as nothing being wrong.
· Identity     No subject is enrolled, so every condition report reads
               Identity: UNKNOWN. The name on a record is a string somebody typed.
```

Two real problems in a deployment that reports itself healthy. Without an admin
key the authenticated checks read `UNKNOWN` rather than passing — the doctor
does not quietly downgrade to the questions it is allowed to ask.

It exits non-zero only on `FAILED`, so an `UNKNOWN` stays visible without
breaking a pipeline.

## Notary — a second signature, from somebody with no stake

`@absuitecore/notary` witnesses a chain head and issues a signed receipt saying
*at this time, this chain head existed and had this value.* It never sees a
record, only a hash.

```js
import { Notary, auditAgainstReceipts } from '@absuitecore/notary';

const notary = new Notary(privateKeyPem, 'acme-notary');
const receipt = notary.witness({ chainId: 'prod', headHash: head.hash, claimedLength: 3 });

// Later, against any chain presented as the same one:
auditAgainstReceipts('prod', hashes, [receipt], notary.publicKeyPem);
// -> present: 0, and a MISSING finding naming the head that vanished
```

A chain is append-only, so a head that existed cannot stop existing. **A
rewritten chain verifies perfectly against itself and fails this audit** — which
is the gap a self-signed chain cannot close on its own.

It imports nothing from capkit, deliberately: a notary that depended on the thing
it witnesses would be a component of it. For the same reason `pnpm room` does not
start one, and a notary you run yourself proves nothing — it would be a second
signature from the same party. [NOTARY.md](NOTARY.md) is the guide for the
person who should be running it, which is somebody who is not you.

## Trust Operations Center

The interface, on port 3001. It replaced the dashboard — there is no dashboard
any more, and `src/tabs/Operations.tsx` was deleted rather than kept alongside.

A dashboard is a set of pages with a standing list of destinations down one
side. This is a room: one canvas, a cube at the centre whose eight vertices are
the eight architectural layers of `CONSTITUTION.md`, and you enter a layer by
manipulating the cube rather than by choosing it from a menu. `App.tsx` opens
with no tab selected, because a room opens on the room.

Four rules are enforced at build time by `scripts/check-ui-doctrine.mjs`, each
phrased as an absence, because an absence is far harder to satisfy by accident:
no permanent navigation, no document-flow primary layout, the cube is the
primary interaction model, and state precedes explanation on every station.
Two further checks govern what it may claim —
`check-no-fabrication.mjs` (no invented figure may reach the screen) and
`check-motion-is-evidence.mjs` (every perpetual animation must name the state
that earns it, or it fails the build).

It reads the five services and a socket, and reports `UNKNOWN` for anything it
cannot reach rather than substituting a figure. Which is why it is not a
convenience: it is the only surface on which the system's own evidence is
visible as evidence, and the doctrine it enforces is the product's argument.
Everything it *reads* remains available over the HTTP API.

# Getting started

Two paths. Pick one.

- **[The library](#the-library)** — `npm install`, no server, about sixty
  seconds. Start here.
- **[The services](#the-services)** — the HTTP API and the full stack in Docker.

Every command below was run against this version before being written down. If
one does not work, that is a bug worth reporting.

> **Node 22.5 or newer.** The persistence layer is `node:sqlite`, which does not
> exist before 22.5. On an older Node you get a module-not-found with no
> explanation of why.

---

## The library

```bash
npm install @absuitecore/capkit
```

```js
import { SigningKey, TraceStore, Storage, verifyTrace } from '@absuitecore/capkit';

const { key, publicKeyPem } = SigningKey.createPair();
const traces = new TraceStore(new Storage('./audit.db'), key);

const trace = traces.record({
  subject: 'agent:invoicing',
  scope: ['payment:approve'],
  module: 'payments',
  action: 'approve_batch',
  input: { batch: 'BATCH-8891', total: 250000 },   // hashed here, never stored
  outcome: 'success',
});

verifyTrace(trace, publicKeyPem).valid;   // true
traces.verifyChain(publicKeyPem);         // { valid: true, checked: 1, headHash: '…' }
```

Then edit a stored record behind the library's back and check again — the chain
reports `valid: false` and names the sequence number of the first record that
fails.

**Keep `privateKeyPem`.** `createPair()` returns it alongside the key. Generate
a new one and every trace you already recorded stops verifying.

### The whole thing, end to end

[`examples/incident-forensics.mjs`](./examples/incident-forensics.mjs) answers
*"our agent approved $250,000 at 2:14 AM, what happened?"* using only published
packages — signature, capability, evidence check, tamper detection, conclusion.

```bash
npm install @absuitecore/capkit@^1.1.0 @absuitecore/trust@^1.1.0
node incident-forensics.mjs
```

---

## The services

Everything above works with no server. The services exist for when several
systems need to share one authority: capability tokens issued centrally, traces
recorded from anywhere, one chain to verify.

### Run one service directly

## The whole thing, in one command

If what you want is the Trust Operations Center with everything behind it —
rather than a single service — start there and come back to the rest:

```bash
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core
corepack enable && pnpm install && pnpm build
pnpm room
```

That starts all six services and the orchestrator, waits until each one actually
answers rather than guessing at a delay, and tells you which did not come up if
any did not. Then open **http://localhost:3001**.

It sets a local `CAPKIT_ADMIN_KEY` for you, because without one CapKit refuses
to mint the first capability token — nothing can be recorded, every layer stays
empty, and it looks exactly like a bug. Override it in anything that is not your
own machine.

The room reads six services over HTTP and a socket, and shows UNKNOWN for every
figure it cannot reach. A copy opened with nothing behind it says **No instance
connected**, which is not a failure — it is a console that has not been pointed
at anything. Nothing on that screen is ever invented to fill a gap.

---

## One service, by hand

```bash
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core
corepack enable && pnpm install && pnpm build

CAPKIT_HMAC_SECRET=$(openssl rand -hex 32) \
CAPKIT_ADMIN_KEY=$(openssl rand -hex 32) \
ABSUITE_DB_PATH=./absuite.db \
node packages/capkit/dist/server.js
```

```
[capkit] listening on :8081 (storage: ./absuite.db)
[capkit] CAPKIT_TRACE_PRIVATE_KEY is not set — traces are signed with an ephemeral key that is regenerated on every restart.
[capkit] Traces are persisted to ./absuite.db but the key is not. After a restart every existing trace will fail verification and the chain will report as broken.
```

**Read that second warning.** It is the one mistake that looks like a security
incident later: the database survives a restart, the signing key does not, and
`/executions-verify-chain` then reports the entire chain broken — which is
exactly what tampering looks like. Set `CAPKIT_TRACE_PRIVATE_KEY` before
recording anything you care about.

### The whole stack, in Docker

```bash
cp .env.example .env      # then fill in the secrets it lists
docker compose up -d
docker compose ps
```

| Service | Port | What it does |
|---|---|---|
| CapKit | 8081 | Capability tokens, audit, execution traces, tenancy |
| Edge-Run | 8082 | Scheduling, task queue, retries, self-healing |
| QuickBench | 8083 | LLM and HTTP benchmarking |
| Connector-Starter | 8084 | Connector registry and scaffolding |
| Trust | 8085 | Evidence validation, trust events, arbitration |
| Dashboard | 3001 | React UI |
| absuite-db | — | Shared SQLite volume, not exposed |

Every port binds to `127.0.0.1`, so nothing is reachable from outside the host
until you deliberately publish it behind a proxy that terminates TLS and
authenticates.

Two things about the dashboard worth knowing before you run it, because neither
is obvious from the compose file:

- It receives **`CAPKIT_ADMIN_KEY`**, the bootstrap credential that mints
  capability tokens. Anyone who reaches the dashboard can issue them.
- It mounts **`/var/run/docker.sock` read-only** so it can report and control
  service state. That is a real grant on the host. If you do not want it,
  delete the `volumes:` entry on the `dashboard` service — everything except
  start/stop/restart still works.

The rest of the suite needs neither. If you only want the trust guarantees, run
CapKit alone.

---

## Five minutes with the API

The `x-absuite-admin-key` header is the bootstrap credential: it exists so you
can mint the first token when you do not yet have one. After that, issue a token
and use the token.

### 1. Issue a capability

```bash
curl -s -X POST http://localhost:8081/auth/token \
  -H 'Content-Type: application/json' \
  -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d '{"sub":"agent:invoicing","scope":["payment:approve","execution:record"],"expiresIn":"1h"}'
```

```json
{"token":"eyJhbGciOiJIUzI1NiIs…","kid":"capkit-default","jti":"8acf0e63-…"}
```

### 2. Ask what it is good for

```bash
curl -s -X POST http://localhost:8081/auth/token/validate \
  -H 'Content-Type: application/json' \
  -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d "{\"token\":\"$TOKEN\",\"requiredScope\":\"payment:approve\"}"
```

```json
{"valid":true,"sub":"agent:invoicing","scope":["payment:approve","execution:record"],
 "exp":1785321744,"requiredScope":"payment:approve","scopeSatisfied":true}
```

Ask about something it does not hold and the answer is no:

```json
{"valid":false,"error":"CAPABILITY_INSUFFICIENT"}
```

`requiredScope` is echoed back on success on purpose. A response that only says
`valid: true` cannot tell you whether the scope was checked or ignored — and in
1.0 it was ignored.

### 3. Record what the agent did

```bash
curl -s -X POST http://localhost:8081/executions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"subject":"agent:invoicing","scope":["payment:approve"],
       "module":"payments","action":"approve_batch",
       "input":{"batch":"BATCH-8891","total":250000},"outcome":"success"}'
```

```json
{"id":"exec_dc1279c006224f538ed0e177f2c87fab","inputHash":"88a6250d…",
 "prevHash":"880101e0…","hash":"544ae8bc…","signature":"2tpaX84eLo7x…",
 "keyId":"absuite-trace-key"}
```

The payload is hashed on arrival and dropped. The record proves what was
processed without becoming a copy of it.

### 4. Prove nobody edited the log

```bash
curl -s http://localhost:8081/executions-verify-chain -H "Authorization: Bearer $TOKEN"
```

```json
{"valid":true,"checked":1,"headHash":"7f57bfaaab3b02d8…"}
```

When it fails it does not just say so — it names the record:

```json
{"valid":false,"checked":1,"brokenAt":1,"brokenId":"exec_1d90b235…",
 "reason":"Signature does not verify against the supplied key","headHash":"…"}
```

### 5. Let someone else check your work

```bash
curl -s http://localhost:8081/executions/public-key
```

```json
{"keyId":"absuite-trace-key","algorithm":"Ed25519","publicKey":"-----BEGIN PUBLIC KEY-----\n…","ephemeral":true}
```

That endpoint needs no credential, because the entire point is that an auditor
can verify your records without one. Signing is **Ed25519**, not HMAC: whoever
can verify must not also be able to forge.

`"ephemeral": true` means the startup warning above applies to you.

[**iamgodofall.github.io/ABSuite-core/verify.html**](https://iamgodofall.github.io/ABSuite-core/verify.html)
runs the same check in a browser using WebCrypto — no install, no account, no
server, no trust in this project. The source is
[`docs/verify.html`](./docs/verify.html); it is one file and reads in a sitting.

---

## Configuration

| Variable | When you need it | Purpose |
|---|---|---|
| `CAPKIT_HMAC_SECRET` | Production | Token signing secret, 32+ characters |
| `CAPKIT_ADMIN_KEY` | Bootstrap | Mints the first token; stop using it afterwards |
| `ABSUITE_DB_PATH` | For durability | SQLite path. Without it nothing survives a restart |
| `CAPKIT_TRACE_PRIVATE_KEY` | Whenever traces matter | Ed25519 PEM. Ephemeral if unset — see above |
| `CAPKIT_AUDIENCE` | Optional | Audience enforced at validation |
| `EDGERUN_SCRIPT_ROOT` | Optional | Script execution stays off until this is set |
| `ABSUITE_SIGNUP_ENABLED` | Optional | Public signup stays off until `true`; it mints credentials |

Secrets: `openssl rand -hex 32`. Trace keypair: `SigningKey.createPair()`.
[`.env.example`](./.env.example) lists the full set.

---

## When something is wrong

**`Cannot find module 'node:sqlite'`** — Node is older than 22.5.

**The chain reports broken and you did not touch anything** — check the startup
log for the ephemeral-key warning. A restart without `CAPKIT_TRACE_PRIVATE_KEY`
invalidates every earlier signature. Real tampering and a rotated key look
identical from the outside, which is why the key belongs in your secret manager.

**`TOKEN_MISSING`** — no `Authorization: Bearer` header, and no admin key.

**`CAPABILITY_INSUFFICIENT`** — the token is genuine but does not carry the scope
the route requires. `POST /auth/token/validate` will tell you what it does carry.

**A service exits immediately under Docker** — `docker compose logs <service>`.
The usual cause is a missing variable from `.env`.

---

## Where to go next

- [`README.md`](./README.md) — what this is and why
- [`PRINCIPLES.md`](./PRINCIPLES.md) — the rules the code is held to
- [`docs/API.md`](./docs/API.md) — every route, generated from the source
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — how the pieces fit together
- [`docs/SECURITY-MODEL.md`](./docs/SECURITY-MODEL.md) — threat model
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — building and testing it yourself
- [`SECURITY.md`](./SECURITY.md) — reporting a vulnerability

Questions go in [GitHub issues](https://github.com/iamGodofall/ABSuite-core/issues).
There is no Discord and no support address — one maintainer, one place to ask.

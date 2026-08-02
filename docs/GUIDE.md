# The guide

Everything ABSuite does, in the order you would actually do it, with a working
command for each step. `GETTING-STARTED.md` gets the stack running; this is what
to do once it is.

Every block below is copy-pasteable and every response shown is real output from
a seeded instance, not an illustration. Where a figure would differ on your
machine it says so.

**Contents**

1. [Install](#1-install)
2. [Record your first execution](#2-record-your-first-execution)
3. [Verify it — as somebody who does not trust you](#3-verify-it--as-somebody-who-does-not-trust-you)
4. [Give an agent a real identity](#4-give-an-agent-a-real-identity)
5. [Say what an action cost](#5-say-what-an-action-cost)
6. [Trace what one agent handed to another](#6-trace-what-one-agent-handed-to-another)
7. [Pin the model you approved](#7-pin-the-model-you-approved)
8. [Record the rule that permitted it](#8-record-the-rule-that-permitted-it)
9. [Read the room](#9-read-the-room)
10. [Going to production](#10-going-to-production)

---

## 1. Install

As a library, in an existing project:

```bash
npm install @absuitecore/capkit
```

As a running service, with everything wired together:

```bash
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core
pnpm install && pnpm build
pnpm room          # all five services plus the interface, on :3001
```

`pnpm room` waits until each service actually answers rather than guessing at a
delay, and tells you which one did not come up if something fails.

To see it with data in it:

```bash
pnpm seed          # nine signed executions across four agents
```

The events are fictional. The signatures are not — edit any record afterwards
and the chain names the sequence number that broke.

---

## 2. Record your first execution

The shortest honest record, in code:

```ts
import { TraceStore, SigningKey, Storage } from '@absuitecore/capkit';

const key = new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY);
const traces = new TraceStore(new Storage('./absuite.db'), key);

const trace = traces.record({
  subject: 'agent:invoicing',
  scope: ['payment:approve'],
  module: 'payments',
  action: 'approve_batch',
  input: { batch: 'BATCH-8891', total: 250_000 },   // hashed here, then dropped
  output: { approved: true },
  outcome: 'success',
});
```

Two things happened that are easy to miss.

**The payload was hashed and discarded.** `trace.inputHash` exists; the batch
number does not. You can prove later what was processed without having retained
your customer's data.

**The record was chained and signed.** `trace.prevHash` links to the record
before it and `trace.signature` is an Ed25519 signature over the whole thing.

Over HTTP, the same record:

```bash
TOKEN=$(curl -sX POST localhost:8081/auth/token \
  -H 'content-type: application/json' \
  -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d '{"sub":"agent:invoicing","scope":["execution:record"]}' | jq -r .token)

curl -sX POST localhost:8081/executions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"subject":"agent:invoicing","scope":["payment:approve"],
       "module":"payments","action":"approve_batch",
       "input":{"batch":"BATCH-8891"},"output":{"approved":true},
       "outcome":"success"}' | jq
```

---

## 3. Verify it — as somebody who does not trust you

This is the part that matters, so do it from the outside.

```bash
curl -s localhost:8081/executions/public-key | jq -r .publicKey > absuite.pub
curl -s localhost:8081/executions-verify-chain \
  -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" | jq
```

```json
{ "valid": true, "checked": 9, "headHash": "6198e710e1…" }
```

Now break something on purpose. Open the database and change one field:

```bash
sqlite3 absuite.db "UPDATE executions SET outcome='success' WHERE outcome='failure'"
curl -s localhost:8081/executions-verify-chain -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" | jq
```

```json
{ "valid": false, "brokenAt": 3, "reason": "Trace content does not match its hash",
  "contentIntact": false }
```

It names the sequence number. Restore it and it passes again, because the record
was never the problem — the edit was.

> **`contentIntact` is worth understanding.** `false` means somebody edited a
> record. `true` alongside `valid: false` means nothing was edited and the
> signature was checked against a *different key* — a rotation, or a dev server
> that restarted with an ephemeral one. Those must never read the same, or the
> alarm gets muted and the real one is missed too.

**No credentials needed:** `/executions/public-key` is deliberately
unauthenticated, and [docs/verify.html](verify.html) checks a record in a browser
with no server at all. An auditor who has to ask you for access is not an
independent auditor.

---

## 4. Give an agent a real identity

Without this, `subject` is a string you typed. Anyone with an admin key could
record `subject: "agent:cfo"`, and the condition report will honestly say so:
`Identity: UNKNOWN`.

**Generate a keypair.** The private half never leaves the agent:

```ts
import { generateIdentityKeypair } from '@absuitecore/capkit';
const { publicKeyPem, privateKeyPem } = generateIdentityKeypair();
```

**Enrol the public half:**

```bash
curl -sX POST localhost:8081/identities \
  -H 'content-type: application/json' -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d "{\"subject\":\"agent:invoicing\",\"kind\":\"agent\",
       \"publicKeyPem\":\"$(cat agent.pub | sed ':a;N;$!ba;s/\n/\\n/g')\"}"
```

**From now on, a token in that name requires the key.** This is the point:

```bash
# Admin key alone is no longer enough.
curl -sX POST localhost:8081/auth/token -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -H 'content-type: application/json' -d '{"sub":"agent:invoicing","scope":["x:y"]}'
# → 401 PROOF_REQUIRED
```

Prove possession — request a nonce, sign it, present it once:

```ts
import { sign, createPrivateKey } from 'node:crypto';

const { nonce } = await (await fetch(
  `${base}/identities/agent:invoicing/challenge`, { method: 'POST' })).json();

const signature = sign(null, Buffer.from(nonce, 'utf8'),
  createPrivateKey(privateKeyPem)).toString('base64');

const token = await fetch(`${base}/auth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-absuite-admin-key': adminKey },
  body: JSON.stringify({ sub: 'agent:invoicing', scope: ['payment:approve'],
                         proof: { nonce, signature } }),
});
```

Every execution under that token now reports `Identity: DEMONSTRATED`.

**Enrolment is optional; enforcement is not.** A deployment that enrols nobody
behaves exactly as before and honestly reports UNKNOWN. But once a subject *is*
enrolled, its authority cannot be obtained without its key — an identity you can
bypass by simply not proving anything is not an identity.

**Suspending** stops new authority immediately and changes nothing that already
happened:

```bash
curl -sX POST localhost:8081/identities/agent:invoicing/suspend \
  -H 'content-type: application/json' -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d '{"reason":"Key suspected compromised 2026-08-01"}'
```

A reason is required. Access removed without a stated cause cannot be reviewed
by anyone later.

---

## 5. Say what an action cost

ABSuite meters nothing, so a cost is a *claim* — and `source` is required
because a number with no author is a rumour.

```ts
traces.record({
  subject: 'agent:research',
  scope: ['llm:call'],
  module: 'llm',
  action: 'completion',
  input: { prompt: '…' },
  output: { tokens: 8_200_000 },
  outcome: 'success',
  cost: {
    amount: 1420,               // integer minor units — 1420 is $14.20
    currency: 'USD',            // ISO-4217, uppercase
    source: 'provider-usage-api',
    unit: 'tokens',
    quantity: 8_200_000,
  },
});
```

Rules that will reject your input, and why:

| Refused | Reason |
|---|---|
| `amount: 14.2` | Money is never a float. Round it yourself, so the rounding is your decision. |
| `amount: -100` | A refund is its own execution, not a negative one. |
| `currency: 'usd'` | ISO-4217, uppercase. An amount with no currency cannot be added to anything. |
| no `source` | ABSuite measured nothing. An unattributed figure would be a rumour carrying a signature. |
| `unit` without `quantity` | A unit of no amount states nothing. |

Then ask the question this exists for:

```bash
curl -s localhost:8081/executions/cost -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" | jq
```

```json
{ "coverage": { "records": 9, "priced": 3, "unpriced": 6,
    "meaning": "These totals cover 3 of 9 records. The other 6 may have cost something; nothing here knows." },
  "totals": [ { "currency": "ZAR", "amount": 3450 }, { "currency": "USD", "amount": 1896 } ],
  "subjects": [ { "subject": "agent:research", "priced": 2, "unpriced": 0, … } ] }
```

**Coverage comes before the total, always.** A spend figure covering 3 of 9
records is not a small number, it is an unknown one. And currencies are never
summed — no record carries an exchange rate, so a combined figure would be
invented at read time.

---

## 6. Trace what one agent handed to another

The failure no per-record log can show:

```
agent:research   fails, returns partial results anyway
agent:analyst    consumes those results, SUCCEEDS
agent:buyer      acts on that, SUCCEEDS
```

Three records, three signatures, two of them perfectly clean. To make this
traceable you need to do exactly one thing: **pass the producer's output object
as the consumer's input.**

```ts
const findings = { results: 12, note: 'partial: two sources timed out' };

const a = traces.record({ …, output: findings, outcome: 'failure' });
const b = traces.record({ …, input: findings, output: summary });   // ← same object
const c = traces.record({ …, input: summary,  output: { ordered: true } });
```

The hashes do the rest:

```bash
curl -s localhost:8081/executions/$C_ID/lineage -H "x-absuite-admin-key: $KEY" | jq '.inheritedFailures'
```

```json
[ { "id": "exec_…", "subject": "agent:research", "outcome": "failure" } ]
```

A clean record, naming the failure two hops behind it. And from the other end:

```bash
curl -s localhost:8081/executions/$A_ID/lineage -H "x-absuite-admin-key: $KEY" | jq '.blastRadius'
```

> **What an edge claims.** The consumer's input hash equals the producer's
> output hash, and the consumer started no earlier. That shows the same content
> moved between them. It is **not** proof of causation — two agents reading the
> same file produce the same hash without either feeding the other. Evidence of
> flow, never of intent.

---

## 7. Pin the model you approved

Providers roll snapshots silently. Quantisations change numerics. A proxy can be
repointed. None of it appears in an execution log.

```bash
curl -sX POST localhost:8081/models \
  -H 'content-type: application/json' -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d '{"name":"refunds-classifier",
       "fingerprint":{"provider":"anthropic","model":"claude-sonnet-4-5","version":"20250929"},
       "approvedBy":"risk@example.com",
       "basis":"Passed the refunds evaluation set 2026-07-14, 412/412."}'
```

Later, check what is actually answering:

```bash
curl -sX POST localhost:8081/models/refunds-classifier/attest \
  -H 'content-type: application/json' -H "x-absuite-admin-key: $CAPKIT_ADMIN_KEY" \
  -d '{"fingerprint":{"provider":"anthropic","model":"claude-sonnet-4-5","version":"20260115"}}' | jq
```

```json
{ "state": "FAILED",
  "drift": [ { "field": "version", "approved": "20250929", "observed": "20260115" } ],
  "finding": "What is answering is not what was approved. … This is a governance
              finding, not a judgement about the new model — it may be better.
              It was not the one approved." }
```

`approvedBy` and `basis` are both required. An approval nobody stands behind
cannot be reviewed, revoked or defended. Replacing a baseline is a deliberate
`supersede`, never a side effect of re-running setup — that is precisely how a
model swap goes unnoticed.

**What this does not do:** it makes no claim about what a model thinks. See
[INTERPRETABILITY.md](internal/INTERPRETABILITY.md) for why that refusal is
permanent.

---

## 8. Record the rule that permitted it

A scope answers *was this allowed*. It cannot answer *should it have been*,
because a capability is the result of a governing decision, not the decision.

```ts
traces.record({
  …,
  governance: {
    policyRef: 'finance.refunds.max-10000',
    policyVersion: '2.1.4',
    decision: 'PERMITTED',
    evidence: ['amountCents 4500 <= 10000', 'subject holds pay:approve'],
    evaluatedBy: 'finance-policy-service',
  },
});
```

ABSuite records the decision. It does not make it, and it never asserts the
decision was correct — only which rule produced it, so a person can ask whether
that rule should have existed.

Then, per record:

```bash
curl -s localhost:8081/executions/$ID/conditions -H "x-absuite-admin-key: $KEY" | jq
```

Five necessary conditions, each DEMONSTRATED / FAILED / UNKNOWN / ABSENT, each
naming the field it was read from. **There is no score**, and the absence is the
point: a number replaces evidence with something nobody audits.

---

## 9. Read the room

```bash
pnpm room   # → http://localhost:3001
```

| Key | What it does |
|---|---|
| `1`–`7` | Enter a layer |
| `` ` `` | Back to the overview |
| `/` | Command palette — every view, searchable |
| `Esc` | Close |
| drag | Steer the core |
| double-click | Dive into the core |

The core carries **the strongest claim the instance can presently defend**. An
empty instance has a dark core, and that is correct rather than broken. Green is
DEMONSTRATED, turquoise UNKNOWN, red FAILED, near-black ABSENT.

Nothing moves unless something is happening. A station animates only while its
layer reports DEMONSTRATED; during a replay the room stops entirely and says
`WITNESSING` — it has stopped watching so it can remember.

---

## 10. Going to production

**The one secret that matters.** `CAPKIT_TRACE_PRIVATE_KEY` signs every record.
Lose it and every record you have ever signed becomes unverifiable — the chain
reports as broken and there is no way back. Back it up outside the platform that
runs the service.

```bash
pnpm deploy:secrets # prints all five, with what each one does
```

| Variable | If it is missing |
|---|---|
| `CAPKIT_TRACE_PRIVATE_KEY` | An ephemeral key is generated and every record fails verification after a restart. |
| `CAPKIT_HMAC_SECRET` | The service refuses to start in production rather than issuing tokens nobody can validate after a restart. |
| `CAPKIT_ADMIN_KEY` | Nothing can be recorded, so every layer is honestly empty. |
| `ABSUITE_ADMIN_API_KEY` | The interface cannot read the log. |
| `ABSUITE_PUBLIC_PASSWORD` | A public instance is open to the world. |

**Storage is one writer, on purpose.** SQLite, one replica, `Recreate` strategy,
a ReadWriteOnce volume. The record is a chain and a chain has one head. Do not
scale this horizontally expecting it to work — it will fork.

**Back up the database file.** It is a single file; copy it. `pnpm backup` does
this with a consistency check.

---

## When something says UNKNOWN

It is not an error. It is the system declining to claim something it has not
checked, and it is the most valuable word in the product.

| Reading | What to do |
|---|---|
| `Identity: UNKNOWN` | The subject is a name nobody enrolled. See [§4](#4-give-an-agent-a-real-identity). |
| `Capability: ABSENT` | No scope was recorded, so nothing shows the action was permitted. |
| `Governance: ABSENT` | No rule was recorded. Add `governance` — see [§8](#8-record-the-rule-that-permitted-it). |
| `Evidence: UNKNOWN` | The record was not verified on this request. Pass a public key. |
| Everything UNKNOWN | The interface cannot reach the services. Check `pnpm room` output and your admin key in Settings. |

## Where to go next

- [API.md](API.md) — every route, generated from source
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit
- [CONSTITUTION.md](CONSTITUTION.md) — the eight layers and what is honestly not built
- [SECURITY-MODEL.md](SECURITY-MODEL.md) — threat model
- [SERVICES.md](SERVICES.md) — what can be sold, and what must stay free
- [system.html](system.html) — the map, generated from this repository

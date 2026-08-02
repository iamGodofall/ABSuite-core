# Running a notary

The one thing this project cannot do for itself.

---

## What a notary is for

A hash chain proves that a record has not been altered **since it was written**.
It does not prove *when* it was written. An operator who controls the whole
system could in principle have produced any chain at any time and presented it as
history — every record would verify, because they signed all of them.

A notary closes that gap with one small, checkable claim:

> At 14:02 on this date, this chain head existed and had this value.

That is all it says. It never sees a record, only a hash. Its worth is not that
you trust it — it is that **a chain is append-only, so a head that existed cannot
stop existing.** Any chain you present later must still contain every head the
notary ever saw, at the same position. A rewritten chain verifies perfectly
against itself and fails that audit.

---

## Why it must not be yours

**A notary deployed alongside the system it witnesses, signing with a key the
same operator holds, is a second signature from the same party. It proves
nothing.**

This is why `pnpm room` does not start one, and why `docker-compose.yml` does not
include one. That absence is the design, not an omission — and
`@absuitecore/notary` is built with no dependency on capkit for the same reason:
a notary that imported the thing it witnesses would be a component of it.

So the useful version of this document is the one read by somebody who is **not
running ABSuite**. If that is you, running a notary costs almost nothing — it
stores thirty-two bytes and a timestamp — and it is the entire
[Collective Intelligence](CONSTITUTION.md) layer's first honest step.

---

## Run one

```bash
npm install @absuitecore/notary
CAPKIT_NOTARY_PRIVATE_KEY="$(node -e "
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey } = generateKeyPairSync('ed25519');
  process.stdout.write(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
")" npx @absuitecore/notary
```

Or as a container, which needs no Node and no clone:

```bash
docker run -p 8086:8086 \
  -e CAPKIT_NOTARY_PRIVATE_KEY="$(cat notary-key.pem)" \
  ghcr.io/iamgodofall/absuite-notary:latest
```

Or from a clone, `pnpm notary`. Installed globally the command is
`absuite-notary`.

| | |
|---|---|
| `CAPKIT_NOTARY_PRIVATE_KEY` | Ed25519 PKCS#8 PEM. **Set it.** Without it a key is generated per process, and every receipt this notary has issued becomes unverifiable the moment it restarts — receipts already handed out will look valid until somebody checks them. |
| `NOTARY_KEY_ID` | Names the key in each receipt. Defaults to `absuite-notary`. |
| `NOTARY_PORT` | Defaults to `8086`. |

It tells you when the key is ephemeral, at boot and in `/health`:

```
[notary] CAPKIT_NOTARY_PRIVATE_KEY is not set — a key was generated for this process.
[notary] Every receipt issued will stop verifying when this process restarts, and
[notary] receipts already handed out will look valid until somebody checks them.
```

```json
{ "status": "healthy", "witnessed": 0, "keyId": "absuite-notary", "ephemeralKey": true }
```

---

## The four endpoints

| | | |
|---|---|---|
| `GET` | `/health` | Including `ephemeralKey`, because a notary that quietly lost its key is worse than one that is down. |
| `GET` | `/notary/public-key` | Unauthenticated. Anyone verifying a receipt needs it. |
| `POST` | `/witness` | `{ chainId, headHash, claimedLength }` → a signed receipt. |
| `GET` | `/receipts?chainId=` | Every receipt this notary has issued for a chain. Public, and meant to be. |
| `POST` | `/audit` | `{ chainId, hashes }` — the chain's record hashes in order — checked against the receipts. |

**Witnessing is deliberately unauthenticated.** Anyone may submit any hash. A
receipt is worth exactly as much as the chain that later matches it, so there is
nothing to gain by witnessing a value nobody can produce a chain for — and
requiring a credential would mean a notary could *refuse to witness somebody*,
which is precisely the power a disinterested party must not have.

---

## What it looks like when it catches something

Three records written, the head witnessed, then the chain rewritten — record 2
replaced and everything re-signed with a fresh key, so the new chain verifies
perfectly against itself.

```
chain head at length 3: 99e1aad4035ee2b3…
receipt issued: true | keyId: absuite-notary

audit of the rewritten chain:
  receipts: 3 | present: 0
  -> MISSING - The notary witnessed head 99e1aad4035e… at 2026-08-02T11:39:59.004Z,
     and it does not appear anywhere in this chain. A chain is append-only, so a
     head that existed cannot stop existing. This chain is not a continuation of
     the one that was witnessed.
```

`present: 0`. The rewritten chain is internally flawless and is not the chain
that was witnessed, and the finding says which head is missing and when it was
seen.

## What it refuses to say

Every audit response carries these, unprompted:

| | |
|---|---|
| `validity` | A notary never sees a record, so it cannot say a chain was valid — only whether this is the same chain it saw. |
| `submitter` | Witnessing is open. A receipt does not identify who presented the head. |
| `time` | `seenAt` is this notary's clock. It is a claim by the notary, checkable only against other notaries. |

That last one is the honest limit of a single notary, and the reason the layer is
marked **not built** in the [Constitution](CONSTITUTION.md): one notary is a
mechanism, and the layer is a network. What it needs is not code.

---

## What would make this real

Somebody who is not us, running one, and telling us the URL. That is the whole
list — see [SERVICES.md](SERVICES.md) §2.2.

# @absuitecore/notary

A disinterested witness to a chain head.

```bash
npm install @absuitecore/notary
```

## The gap it closes

A hash chain proves nobody edited a record *after it was written*. It does not
prove **when** it was written — and the operator being audited holds the signing
key. In principle they could produce a perfectly valid chain today and claim it
was written last year. Every record would verify. Every link would hold. The
whole thing could still be a reconstruction.

Nothing inside one deployment can close that, because everything inside it is
signed by the same party. It needs somebody else.

A notary is the smallest possible somebody else. It receives thirty-two bytes of
hash and returns a signed receipt saying *I saw this value at this time*.

## Why a series of receipts is stronger than one

One receipt is a timestamp. A series is an external, ordered witness.

A chain is append-only, so **every head a notary ever saw must still be in it, at
the same position, forever.** An operator who rewrites history produces a chain
that verifies perfectly against itself and fails here — against evidence held by
somebody with no stake in the answer.

```ts
import { Notary, auditAgainstReceipts } from '@absuitecore/notary';

const receipt = notary.witness({ chainId, headHash: head, claimedLength: 5 });

// …later, presented with a chain that claims to be the same one
const audit = auditAgainstReceipts(chainId, recordHashes, [receipt], notaryPublicKey);
audit.consistent;          // false
audit.findings[0].state;   // 'MISSING'
```

| State | Meaning |
|---|---|
| `PRESENT` | The witnessed head is in the chain, where it should be. |
| `MISSING` | Not in the chain at all. This is not a continuation of what was witnessed. |
| `MISPLACED` | Present, but not at the position its claimed length implies — records were inserted or removed before it. |
| `UNVERIFIABLE` | The receipt does not verify. A finding about the witness, not the chain. |

## What it must never claim

The notary **never sees a record**. It cannot verify a chain and does not try. A
receipt says one thing:

> this value existed at this time, and I had no interest in it

It does **not** say the chain was valid, that the records were true, or that the
submitter is who they claim. Anyone may submit any hash — which is why witnessing
is unauthenticated. A notary able to refuse to witness somebody would have
exactly the power a disinterested party must not have.

A receipt is worth as much as the chain that later matches it. **The value is in
the audit, not the receipt.**

An unwitnessed chain is reported as unwitnessed, never as suspicious. Punishing
anyone who has not started would be the wrong incentive and the wrong claim.

## Running one

```bash
CAPKIT_NOTARY_PRIVATE_KEY="$(node -e "console.log(require('@absuitecore/notary').Notary.generate().privateKeyPem)")" \
  npx @absuitecore/notary
```

| Route | |
|---|---|
| `POST /witness` | `{ chainId, headHash, claimedLength? }` → a signed receipt |
| `GET /notary/public-key` | Unauthenticated, and must stay so |
| `GET /receipts?chainId=` | Every receipt issued for a chain |
| `POST /audit` | A convenience — the audit is a pure function anyone can run |
| `GET /health` | Including `ephemeralKey`, because a notary that quietly lost its key is worse than one that is down |

Installed globally the command is `absuite-notary`. The full guide, including a
worked audit of a rewritten chain, is
[NOTARY.md](https://github.com/iamGodofall/ABSuite-core/blob/main/docs/NOTARY.md).

Without `CAPKIT_NOTARY_PRIVATE_KEY` a key is generated per process, and every
receipt stops verifying on restart. It warns loudly at boot, because receipts
already handed out keep looking valid until somebody checks them.

## It depends on nothing

Not even on `capkit`. A notary that imported the thing it witnesses would be a
component of it, and the whole value on offer is that it is a *different party*.
It has no idea what a trace is and must never need one.

That is also why it is the first honest step toward
[Collective Intelligence](https://github.com/iamGodofall/ABSuite-core/blob/main/docs/CONSTITUTION.md) rather than a wait for it:
the layer needs deployments verifying each other, and a notary is the smallest
version of one deployment checking another that is worth running.

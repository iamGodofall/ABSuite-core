# The Agent Trust Record — protocol specification v1

**Status:** Draft. Implemented by `@absuitecore/capkit`; not yet reviewed by any
second implementation.

This document specifies a record format and a verification procedure. It is
deliberately independent of ABSuite: everything below can be implemented in any
language, and an implementation that produces records passing §7 interoperates
with every other one without either party running the same software.

That independence is the point. A record whose meaning depends on the program
that wrote it is a log. A record whose meaning is fully determined by a published
canonical form is evidence.

---

## 1. What this specifies, and what it refuses to

**Specified:** how to serialise an execution record to an unambiguous byte
string, how to hash it, how to chain it, how to sign it, and how a third party
holding only a public key checks all of that.

**Not specified, and deliberately:**

- **Whether a record is true.** The protocol proves a record has not changed
  since it was signed. It cannot prove the events happened. Any implementation
  claiming otherwise is misrepresenting it.
- **Transport.** HTTP, a queue, a file on a disk — none of it matters.
- **Storage.** Records may live anywhere.
- **A score.** There is no trust number in this protocol and none may be added
  by an implementation while calling it conformant. See §6.

---

## 2. Terms

| Term | Meaning |
|---|---|
| **Record** | One execution, in the form of §3. |
| **Subject** | The identity that acted. A string; §5 covers proving it. |
| **Canonical form** | The exact byte string a record hashes to. §4. |
| **Chain** | Records ordered so each carries the hash of its predecessor. |
| **Verifier** | Any party checking records. Needs no credential beyond a public key. |

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as in
RFC 2119.

---

## 3. The record

```
Record := {
  id             : string          -- unique within the chain
  tenantId       : string | null
  subject        : string          -- who acted
  jti            : string | null   -- the credential that authorised it
  scope          : string[]        -- what it was permitted to do
  module         : string
  action         : string
  inputHash      : hex(32)         -- SHA-256 of the input
  outputHash     : hex(32) | null
  outcome        : "success" | "failure"
  error          : string | null
  startedAt      : RFC3339
  completedAt    : RFC3339 | null
  durationMs     : integer | null
  steps          : Step[]
  governance     : Governance | null
  cost           : Cost | null     -- v2 only
  canonicalVersion : integer | null -- absent means 1
  prevHash       : hex(32)
  hash           : hex(32)         -- of the canonical form
  signature      : base64 | null   -- Ed25519 over `hash`
  keyId          : string | null
}

Step       := { seq: integer, name: string, at: RFC3339, detail: string | null }
Governance := { policyRef, policyVersion, decision, evidence[], evaluatedBy | null }
Cost       := { amount: integer, currency: ISO4217, source: string,
                unit: string | null, quantity: number | null }
```

**Payloads are never carried.** `inputHash` and `outputHash` are SHA-256 over the
canonical JSON of the payload (§4.1). An implementation MUST NOT store or
transmit the payload as part of a record. This is what allows a record to be
published to a party who must not see the data it describes.

**`cost.amount` is an integer in the minor unit of `currency`.** Implementations
MUST reject fractional amounts rather than rounding. Rounding is the caller's
decision and must not be made silently by a library.

**`cost.source` is REQUIRED when `cost` is present.** The protocol makes no
claim to have measured anything; a cost is an attributed assertion, and an
unattributed one is a number with a signature on it.

---

## 4. Canonical form

The canonical form is the byte string that gets hashed. Two implementations that
disagree here do not interoperate, so this section is normative in every detail.

### 4.1 Canonical JSON

Payload hashing and canonical form both use JSON with:

1. Object keys sorted by Unicode code point, recursively.
2. No insignificant whitespace.
3. Arrays in their given order — array order is significant.

`hash(payload) = SHA-256( canonicalJSON(payload) )`, lowercase hex.

`undefined` serialises as the literal string `undefined`; `null` as `null`.

### 4.2 Version 1

A record with no `canonicalVersion`, or `canonicalVersion = 1`, canonicalises to
a JSON array of exactly **sixteen** elements, in this order:

```
[ id, tenantId, subject, jti, sort(scope), module, action,
  inputHash, outputHash, outcome, error,
  startedAt, completedAt, durationMs,
  steps.map(s => [s.seq, s.name, s.at, s.detail]),
  prevHash ]
```

Absent optional fields are `null`. `scope` is sorted ascending by code point.

**If and only if `governance` is present**, a seventeenth element is appended:

```
[ policyRef, policyVersion, decision, evidence, evaluatedBy ]
```

The conditional append is a compatibility artefact and MUST be reproduced
exactly. A `null` placeholder would change the canonical form of every v1 record
ever written.

**v1 cannot express a cost.** An implementation encountering a record with
`cost` and canonical version 1 MUST refuse to hash it and report the record as
unreadable — not as tampered. Hashing it as v1 would leave the cost outside the
signature.

### 4.3 Version 2

`canonicalVersion = 2` canonicalises to a JSON array of exactly **nineteen**
elements. Every slot is always present; absent values are `null`.

```
[ 2, id, tenantId, subject, jti, sort(scope), module, action,
  inputHash, outputHash, outcome, error,
  startedAt, completedAt, durationMs,
  steps.map(s => [s.seq, s.name, s.at, s.detail]),
  prevHash,
  governance ? [policyRef, policyVersion, decision, evidence, evaluatedBy] : null,
  cost ? [amount, currency, source, unit, quantity] : null ]
```

The version number is the first element **so that it is inside the hash and
therefore inside the signature**. An unsigned version marker would let anyone
change how a record is verified by editing one integer.

### 4.4 Choosing a version when writing

A writer MUST use the **oldest** canonical version capable of expressing the
record's fields. A record without a cost is therefore v1 even when written by a
v2-capable implementation.

This rule is what keeps upgrades safe. Without it, adopting a new library
version silently begins producing records that existing verifiers cannot read,
for records that use nothing new.

### 4.5 Unknown versions

A verifier meeting a canonical version it does not implement MUST report the
record as **unreadable by this implementation**, and MUST NOT report it as
invalid or tampered. "I could not check this" and "this failed the check" are
different statements, and collapsing them causes an old verifier to accuse a
newer record of forgery.

---

## 5. Chaining, signing, identity

### 5.1 Chain

`hash = SHA-256(canonicalForm)`, lowercase hex.

The first record in a chain has `prevHash` = sixty-four `0` characters. Every
subsequent record's `prevHash` MUST equal the immediately preceding record's
`hash`.

Appending MUST be atomic with reading the current head, or two concurrent writers
fork the chain.

### 5.2 Signature

`signature = Ed25519( privateKey, utf8(hash) )`, base64.

The signature is over the **hex string** of the hash, not over the raw bytes.
This is a fixed choice; implementations MUST follow it.

Ed25519 rather than an HMAC is required by the threat model: a verifier must be
able to check a record without also being able to forge one. A shared secret
cannot make that distinction.

### 5.3 Identity of the subject

`subject` is a string, and on its own it is a **label**, not a proof. A
conformant implementation MUST NOT report a subject as demonstrated on the
strength of the record's own signature — that signature proves who wrote the
record, not who acted.

An implementation MAY support proof of possession, in which case:

1. The subject enrols an Ed25519 **public** key. The private half MUST NOT be
   transmitted to the recording system.
2. Before a credential is issued in that subject's name, the subject signs a
   single-use, server-generated nonce.
3. The nonce is consumed whether or not the signature verifies.
4. Once a subject is enrolled, a credential in its name MUST NOT be issuable
   without proof. An identity that can be bypassed by not proving anything is
   not an identity.

---

## 6. Verification, and what a verdict may say

A verifier holding a chain and, optionally, a public key performs:

1. **Readability** — is the canonical version implemented? If not, stop and
   report unreadable (§4.5).
2. **Content** — recompute the canonical form and hash. Compare to `hash`.
3. **Linkage** — `prevHash` equals the predecessor's `hash`.
4. **Signature** — Ed25519 verify, when a public key is supplied.

A verdict MUST distinguish these outcomes and MUST NOT collapse them:

| Outcome | Meaning |
|---|---|
| content mismatch | The record was edited. |
| linkage mismatch | A record was inserted, removed or reordered. |
| signature mismatch, content intact | Not an edit — a different key. A rotation, or an ephemeral dev key. |
| unreadable version | This verifier is too old. Not a finding against the record. |
| signature not checked | No key was supplied. **MUST NOT** be reported as verified. |

The last two rows are where implementations go wrong. Reporting an unchecked
signature as checked, or a key rotation as tampering, are both failures of the
protocol's purpose — the first overstates, and the second trains operators to
ignore the alarm.

When content fails, an implementation SHOULD report the signature as **not
checked** rather than as passing: the signature covers the hash, and a hash that
no longer describes the content proves nothing about it.

**No score.** A conformant implementation MUST NOT emit a number purporting to
summarise trustworthiness. Reporting per-condition determinations —
`DEMONSTRATED`, `FAILED`, `UNKNOWN`, `ABSENT` — is the intended output, and a
weakest-condition rule is the intended aggregation: four demonstrated conditions
and one failure is a record with a failure in it, not a mostly-trustworthy one.

---

## 7. Conformance

An implementation is conformant if it:

1. Verifies every record in `packages/capkit/src/fixtures/frozen-chain.json`
   (three v1 records, one of them governed) and
   `frozen-chain-v2.json` (one v1 and two v2, in one chain), using only the
   public key stored beside them.
2. Produces byte-identical hashes for those records from their own fields.
3. Reports a record with an unknown canonical version as unreadable, not invalid.
4. Refuses to hash a costed record as v1.
5. Emits no score.

Those fixtures were signed once and are never regenerated; they are the
conformance suite. A change to this specification that breaks them is a breaking
change to every record ever written under it, and the reference implementation
fails its build if they stop verifying.

---

## 8. Why this exists in this form

Three properties were chosen over more convenient alternatives, and each cost
something:

**Verification requires no credential.** The public key is published
unauthenticated. An auditor who must ask the audited party for access is not
independent. The cost is that anyone can verify records they were given —
accepted, because the payloads are not in them.

**The canonical form is frozen, not versioned loosely.** Adding a field is a new
version with a new number, and old versions are never dropped. The cost is that
the format cannot be tidied. The benefit is that evidence does not expire when
software improves.

**Absence is a first-class answer.** `UNKNOWN` is not an error state and must not
be rendered as one. Most systems in this space report a green tick for
"nothing checked", and that single decision is what makes their output
worthless.

---

## 9. Open questions

Honest gaps, recorded rather than omitted:

- **No second implementation exists.** Until one does, this document is a
  description of one codebase, however carefully it is written. That is the main
  thing standing between this and being a protocol.
- **Cross-chain verification is unspecified.** Two organisations each holding a
  chain cannot currently verify each other's records without merging them. A
  counter-signature format for chain heads is the obvious next section and is
  not written.
- **Model identity** is implemented in the reference implementation but not
  specified here, because the fingerprint's field set is not yet stable.
- **Revocation of an enrolled identity** is specified as immediate for future
  credentials; the effect on in-flight credentials is left to implementations.

---

## 10. Reference implementation

`@absuitecore/capkit` — MIT. `verifyTrace()`, `verifyChain()`, `canonicalTrace()`.

Implementing this specification requires no permission and no licence, and
producing records that pass §7 is the only thing that makes an implementation
interoperable. Nothing in this document may be read as restricting that.

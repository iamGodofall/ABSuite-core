# What can be sold, and what must stay free

A working document. Written because the project needs to produce a living, and
a vision that produces no income eventually stops being worked on — which is a
worse outcome for the open-source part than charging for something would be.

Two rules hold everything below together.

**The core stays open, and stays genuinely useful without paying.** Not a
crippled tier. `@absuitecore/capkit` records, signs, chains and verifies for
nothing, forever, with no account. That is not charity; it is the distribution
strategy. Nobody adopts a trust layer they cannot read, and nobody trusts an
auditing tool whose auditing they cannot audit.

**What gets sold is never the ability to verify.** The moment verification costs
money, the product contradicts itself — an auditor who has to pay to check is not
an independent auditor. Everything priced below is *convenience, scale,
integration, assurance or attention*. Never the proof itself.

Everything here names what exists today, so it can be told apart from what would
have to be built. `Built` means it runs now. `Near` means days of work on top of
what runs. `Far` means it needs something the project does not have yet — usually
customers, not code.

---

## 1. Services sold on time, starting now

These need no new product. They need a phone call and a repository. For someone
with no capital they are the only category that pays this month.

### 1.1 AI governance audit — **Built**

A fixed-scope engagement: take a company's existing agent deployment, instrument
it with ABSuite, and deliver a signed report of what their agents actually did
for two weeks.

What makes this sellable rather than generic consulting is the artifact. Most
audits end in a PDF of opinions. This one ends in a hash-chained record the
client keeps, can re-verify themselves with a public key, and can hand to their
own auditor without trusting either party.

- **What exists**: the whole recording and verification path, `/executions/*`,
  `verifyChain`, the condition report, the room.
- **What to say**: *"At the end you own the evidence, not my opinion of it."*
- **Priced as**: a fixed fee per engagement, not a day rate. The value is the
  artifact, not the hours.

### 1.2 Deployment and integration — **Built**

Standing up ABSuite inside a company's stack: the container, the secrets, the
key custody, wiring the MCP server to their agents, teaching their team the four
words. Two to five days of work.

The honest upsell is **key custody**, and it is a real service: `CAPKIT_TRACE_
PRIVATE_KEY` is the one secret whose loss destroys every record ever signed. Most
teams will not have a process for that. Setting one up — and being on the hook
for it — is worth paying for.

### 1.3 The compliance narrative — **Near**

Regulated buyers do not want "signed traces". They want a document mapping what
the system produces to what a specific regime demands: the EU AI Act's logging
and record-keeping articles, ISO 42001, SOC 2's change-management evidence.

The work is a mapping table, written once, sold many times: *this obligation ←
this endpoint ← this field ← this test that proves the field cannot be forged*.
The product already produces the evidence; nobody has yet written the sentence
that tells a compliance officer which box it fills.

**This is the highest-leverage unbuilt thing in this document.** It converts a
technical artifact into a purchase order, and it is writing, not engineering.

---

## 2. Hosted, priced on usage

The classic open-core shape: the software is free, running it for you is not.

### 2.1 ABSuite Cloud — **Near**

A hosted instance. Free tier that actually works, paid tiers on volume of
records held and retention.

The constraint is architectural and must be stated plainly: **the current
storage is SQLite with a single writer.** One instance, one disk, no horizontal
scaling — deliberately, because the record is a chain and a chain has one head.
Multi-tenant hosting at scale needs a different storage engine behind the same
interface. That is real work, and it is the gate on this whole line item.

`packages/capkit/src/tenancy.ts` and `billing.ts` already exist, so metering and
plans are not the missing piece. Storage is.

### 2.2 The notary — **Near**, and the most distinctive idea here

A tiny hosted service that does one thing: **counter-sign chain heads**.

Today a company's records are signed by that company's own key. That proves
nobody altered them *after the fact* — but the company holds the key, so it
could in principle have written anything at the time. A second signature, from a
party with no stake, closes that gap: *at 14:02 on this date, this chain head
existed and had this value.*

This is the [Collective Intelligence](CONSTITUTION.md) layer's first honest
step, sold as a service. It needs no trust in the notary beyond "it saw this
hash then" — which is exactly the kind of small, checkable claim this project is
built around.

- Priced per counter-signature, or flat per month.
- Costs almost nothing to run: it stores 32 bytes and a timestamp.
- Cannot read anything. It never sees a payload, only a hash.

### 2.3 Long-term evidence custody — **Far**

Keeping a client's chain verifiable for seven years, including through key
rotations and canonical-form migrations. The product is already built for this —
frozen fixtures, additive canonical versions, `checkable: false` rather than a
false accusation — which is unusual and worth charging for.

Far because it requires being an institution that will still exist in seven
years, and saying so before that is true would be the exact overstatement this
project refuses.

---

## 3. Licensed capability

Where the intellectual property genuinely lives, and where it can be closed
without contradicting the open core.

### 3.1 The Trust Operations Center — **Built, and already not on npm**

`packages/dashboard-ui` is marked private and runs from the repository. It is
the single most distinctive asset in the project: a WebGL room where the cube's
core carries the strongest claim the system can presently defend, seven stations
that move only while their layer is demonstrating, and an interface that refuses
to render a number it cannot source.

Nobody else has this, and it is the thing that makes people stop scrolling.

A **source-available commercial licence** for the interface, while capkit stays
MIT, is a coherent split: verify for free forever, pay to look at it beautifully.
Companies buy interfaces. They rarely buy libraries.

### 3.2 Connector packs — **Near**

`connector-starter` scaffolds integrations. Governed connectors for the systems
that actually carry risk — payment rails, ERPs, ticketing, cloud consoles —
where each action arrives pre-wired to a capability scope and a signed trace.

Sold as packs. The scaffolding is open; the maintained, tested, kept-current
connectors are the product. This is the most conventional monetisation in the
document and probably the most reliable.

### 3.3 Policy libraries — **Near**

`ai-policy-generator.ts` exists. What does not exist is a curated set of
governance rules for real domains — refund limits, data-egress rules, model-swap
approvals — versioned, tested, and referenced by `policyRef` in the trace.

Compelling because the trace already records `policyRef` and `policyVersion`, so
a bought policy library is *cited in the evidence*. That is unusually sticky.

---

## 4. What the record makes possible that nothing else does

Ideas that only work because of what this system already stores. Speculative,
and worth writing down.

### 4.1 Agent spend attribution — **Built as of this week**

Cost now sits on the execution record, attributed to the subject and tied to the
authority that permitted it. Nobody else can answer *which governed action
consumed this, under whose authorization, producing what outcome* — a compute
dashboard shows a total, and a governance log shows a subject.

The product on top is a monthly attribution report per agent, with coverage
stated. A finance team that cannot currently allocate its AI bill by agent would
pay for that, and the coverage figure is the honest part that competitors will
not print.

### 4.2 Insurance and assurance evidence — **Far**

An insurer underwriting AI liability needs to know what an agent was permitted to
do and what it did. This system produces exactly that, in a form the insurer can
verify without trusting the insured.

Far because it needs an insurer, not a feature. But it is the clearest answer to
"who eventually pays a lot for this", and it is worth naming the direction now.

### 4.3 Model-identity attestation — **Near**

Already scoped in [INTERPRETABILITY.md](internal/INTERPRETABILITY.md) as
Verify's fourth target: *is this the model whose behaviour was approved?* An
operator who approved a model has a real interest in knowing it is still that
model, and it needs no claim about reasoning whatsoever.

Layer 1 now does this for *agents* — enrolled key, proof of possession. Doing it
for *models* is the same shape applied to a different subject.

---

## The order to do them in

Ranked by money-per-week-of-work for someone with no capital and no runway.

| | Do this | Why first |
|---|---|---|
| 1 | **Compliance mapping doc** (1.3) | Writing, not engineering. Turns what exists into something a budget holder can buy. |
| 2 | **Audit engagements** (1.1) | Sellable today with zero new code. One client funds a month. |
| 3 | **Deployment + key custody** (1.2) | Natural follow-on from every audit. Recurring. |
| 4 | **The notary** (2.2) | Small, distinctive, cheap to run, and it starts Layer 7 honestly. |
| 5 | **Connector packs** (3.2) | Conventional, reliable, and the scaffolding is done. |
| 6 | **Interface licence** (3.1) | Needs traffic first. Licensing something nobody has seen is not a business. |

The first three need no permission from anyone and no money to start. That is
the point of ranking them there.

---

## What must never be sold

Recorded so it cannot quietly erode:

- **Verification.** Checking a record must never require a licence, an account,
  or a running ABSuite. `/executions/public-key` is deliberately unauthenticated.
- **The four words.** `DEMONSTRATED / FAILED / UNKNOWN / ABSENT` are not a
  premium feature and cannot be tuned by tier.
- **Honest absence.** No paid tier may make `UNKNOWN` read as anything else.
  A plan that upgrades an unknown to a green tick is fraud with a price list.
- **The chain.** Nobody pays to have their own history remain verifiable.

If a proposed revenue line requires breaking one of these, the answer is no, and
the reason is not idealism — it is that the entire value of the product is the
claim that it does not do that.

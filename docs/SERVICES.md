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

### 1.3 The compliance narrative — **Built**

Regulated buyers do not want "signed traces". They want a document mapping what
the system produces to what a specific regime demands.

[COMPLIANCE.md](COMPLIANCE.md) is that mapping, in the shape it was specified
here: *this obligation ← this endpoint ← this field ← this test that proves the
field cannot be forged*. EU AI Act Articles 12, 13, 14, 19, 26 and 72; ISO/IEC
42001 Annex A; SOC 2's CC6, CC7, CC8 and PI1; NIST AI RMF.

Two things about it are worth keeping when it gets reused in a proposal. It
opens by refusing the sale it is closest to — *ABSuite produces evidence, it does
not confer compliance* — and §5 lists every obligation the product does nothing
for. A mapping document that only names the boxes it fills is a brochure, and a
compliance officer has read a hundred of those.

The strongest row is **Article 14, human oversight**. Almost anybody can show
that a human clicked approve; very few can show *what exactly* was approved,
because the approval and the action are usually linked by a foreign key the
operator controls. Here they are linked by a hash of the payload.

What remains is not writing either. It is a first regulated customer to take it
to, and their questions are what turn a good document into a used one.

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

### 2.2 The notary — **Built**, and the most distinctive idea here

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

**Now built** as `@absuitecore/notary`, with no dependency on capkit — a notary
that imported the thing it witnesses would be a component of it. `witness()`
issues a signed receipt; `auditAgainstReceipts()` is where the value is, because
a chain is append-only and every head a notary ever saw must still be in it, at
the same position, forever. A rewritten chain verifies perfectly against itself
and fails that audit.

What remains before it earns money is not code. It is somebody other than us
running one — and [NOTARY.md](NOTARY.md) is now the document that tells them how,
which was itself missing for as long as the notary existed.

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

### 4.3 Model-identity attestation — **Built**

Already scoped in [INTERPRETABILITY.md](internal/INTERPRETABILITY.md) as
Verify's fourth target: *is this the model whose behaviour was approved?* An
operator who approved a model has a real interest in knowing it is still that
model, and it needs no claim about reasoning whatsoever.

Layer 1 does this for *agents* — enrolled key, proof of possession. `ModelRegistry`
now does it for models: a fingerprint recorded at approval with `approvedBy` and
`basis` both required, compared afterwards, and a silent provider version roll
reported as `FAILED` rather than going unnoticed. `supersede()` is separate from
`approve()` so that swapping a model is never something that happens by re-running
a setup script.

What is unbuilt is the *product* on top: a standing attestation report an operator
receives without asking. That is packaging, and it needs somebody who wants it.

---

## The order to do them in

Ranked by money-per-week-of-work for someone with no capital and no runway.

| | Do this | Why first |
|---|---|---|
| 1 | **Audit engagements** (1.1) | Sellable today with zero new code, and [COMPLIANCE.md](COMPLIANCE.md) is now the document you open the conversation with. One client funds a month. |
| 2 | **Deployment + key custody** (1.2) | Natural follow-on from every audit. Recurring, and the one thing a client cannot safely do badly. |
| 3 | **Policy libraries** (3.3) | The last thing in this document that is writing rather than engineering, and `policyRef` already cites it from inside the evidence. |
| 4 | **The notary** (2.2) | Small, distinctive, cheap to run, and it starts Layer 7 honestly. |
| 5 | **Connector packs** (3.2) | Conventional, reliable, and the scaffolding is done. |
| 6 | **Interface licence** (3.1) | Needs traffic first. Licensing something nobody has seen is not a business. |

The first three need no permission from anyone and no money to start. That is
the point of ranking them there.

**What changed since this was first written.** The compliance mapping was ranked
first and is now written; the notary was speculative and is now a package; agent
spend attribution, model-identity attestation and the approval workflow have all
moved from *Near* to *Built*. Nothing left in this document is blocked on code
that one person can write in a week. Everything remaining is blocked on somebody
else — a customer, an insurer, a second deployment — which is a better problem
and a slower one.

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

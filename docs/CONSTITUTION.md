# The ABSuite Constitution

> This document describes what ABSuite is *for*, and what it must never become.
> It is measured in decades.
>
> It is **not** a plan. The plan lives in [`ROADMAP.md`](./ROADMAP.md), it is
> measured in days, and confusing the two is how projects die — either by
> shipping nothing while contemplating 2050, or by shipping something that
> betrays the reason it existed.
>
> Think in decades. Execute in days. Never let one document do the other's job.

---

## The premise

**Intelligence is becoming abundant. Trust is becoming scarce.**

Model capability is commoditising fast, and the cost of generating a plausible
answer is heading toward zero. The cost of knowing whether to *believe* one is
not. Every marginal increase in AI capability increases the value of being able
to prove what a system actually did.

If that premise holds, infrastructure for verifying AI behaviour becomes
necessary rather than optional. If it does not hold, ABSuite is a well-built
answer to a question nobody asked. The whole bet is on that sentence.

---

## What ABSuite is

**The trust layer for autonomous systems. It observes everything, proves what
happened, and explains it to whoever has the right to ask.**

ABSuite is not the intelligence. It is the witness — present at every action,
party to none of them. When a decision made by an AI system matters — legally,
financially, medically — ABSuite is what lets someone answer:

- Which model generated this?
- Can we replay the decision?
- Was the evidence verified?
- Who approved this?
- Was the output modified?
- Is the audit trail intact?

Six questions. The day a seventh is routinely asked — *is this
ABSuite-compliant?* — the project has succeeded.

---

## What ABSuite must never become

These are not features postponed. They are refusals, and they are permanent.
Each one is a thing a competitor will build, sell profitably, and be right about
commercially. ABSuite will still not build it.

### It must never claim to detect truth

No hallucination detector, no truthfulness score, no probability that a
statement is false. ABSuite reports what is **supported** by evidence and what
is **unverified**. The gap between those two words is the entire product, and
closing it for a better demo would be the end of the project's reason to exist.

### It must never rate a human being

Counting what a person did is infrastructure. Reducing them to a number is a
social credit system. ABSuite reports facts about people — actions recorded,
violations, overrides, findings — and refuses to reduce those to a score. When
someone eventually offers real money for the score, the answer is no.

### It must never deny access on evidence it cannot show

Any gate ABSuite applies must be explainable, contestable, and refusable on thin
evidence. A subject who cannot see why they were denied, and cannot challenge
it, has been blacklisted rather than assessed.

### It must never decide what should happen

ABSuite is the witness. A witness that decides outcomes is a party to the
events, and the question immediately becomes who witnesses the witness.

The boundary is narrow and it matters: ABSuite may decide **what a human should
look at** — that is triage, and refusing to do it just buries people in
undifferentiated records. It may not decide **what should be done about it**.
Escalating a dispute is inside the line. Resolving one on the subject's behalf
is outside it.

Arbitration is the closest this comes to the edge, and the shape of it is the
rule: it reports which answer holds the most independent support and says
plainly when consensus was not reached. It never executes the answer.

### It must never learn what to distrust

ABSuite may improve how it *works*. It may not learn who to *suspect*.

Learning which alerts operators dismissed is process improvement, and the
subject of the record is unaffected by it. Learning which agents, vendors or
people tend to be suspicious produces a judgement whose reasoning lives in
training data nobody can inspect — which fails the test three refusals above:
explainable, contestable, refusable on thin evidence. You cannot contest a
model's intuition. You can only disagree with it, which is not the same thing
and is worth much less.

Every conclusion ABSuite reaches must be re-derivable from stored records by
someone who does not trust ABSuite. A learned weight is not re-derivable, and a
system whose judgements cannot be checked has become the thing it was built to
audit.

### It must never make the record convenient

Appeals neutralise events; they never delete them. The record of what happened —
including ABSuite's own mistakes — survives. A system that can quietly erase its
errors is not an evidence system.

### It must never fail open

When the revocation store is unreachable, ABSuite returns 503 and authorises
nothing. Availability is worth less than the guarantee.

---

## What ABSuite owes its users

A reciprocal obligation, and it is not decorative — it is the same principle the
`ReciprocalTrust` module enforces between agents and operators, applied to this
project and the people who install it.

1. **It will be honest about what it cannot do.** Documentation states limits
   before capabilities.
2. **It will be verifiable without trusting us.** The browser verifier requires
   no server, no account, and no faith in ABSuite's own infrastructure.
3. **It will not hold data hostage.** SQLite file, documented schema, working
   backup and restore. Leaving must always be possible.
4. **The core will stay open and stay MIT.** Commercial offerings may exist
   around it. The verification path never becomes a paid feature — a proof you
   have to pay to check is not a proof.

---

## The two models

ABSuite is described by two things at once, and confusing them has cost this
project clarity more than once. They are different axes, and both are needed:

- **Eight architectural layers** — what ABSuite *becomes*. They ascend. Identity
  at the bottom, civilisation at the top, each resting on the one below. This is
  the building, and it is a destination measured in years.
- **A seven-stage operational loop** — what ABSuite *does*, every second it runs.
  It recurses. Observe, verify, explain, govern, arbitrate, act, learn, and back
  to observe. This is the heartbeat, and it is running today.

Without the eight layers there is no destination. Without the seven stages there
is no behaviour. The canonical picture is one inside the other:

```text
              Civilization                     ▲
        Collective Intelligence                │
              Autonomy                         │
              Governance          ┌─────────────────────────┐
                Trust             │  Observe → Verify →     │   the loop,
              Evidence            │  Explain → Govern →     │   running now
             Capability           │  Arbitrate → Act →      │
              Identity            │  Learn ──┐              │
                  ▲               │     ▲    │              │
                  │               │     └────┘              │
            the building          └─────────────────────────┘
             (a decade)
```

**Architecture defines capability. Runtime defines behaviour.**

The two are never zipped together. Seven stages and eight layers is not an
accident of counting to be corrected — a building and a heartbeat don't need the
same number of floors. Governance is a layer; Govern is an operation. Trust is a
property; Arbitrate is an operation. Autonomy is a state; Act is an operation.
Related, not identical, and forcing a one-to-one mapping would be a tidy diagram
that lies.

The honest relationship is a matrix. **Every layer participates in the loop
according to its nature** — some layers touch two stages, some touch all seven:

| Layer | Observe | Verify | Explain | Govern | Arbitrate | Act | Learn |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Identity | ● | ● | ● | ● | | | |
| Capability | ● | ● | ● | | | | |
| Evidence | ● | ● | ● | | | | |
| Trust | | ● | ● | | ● | | ● |
| Governance | | | | ● | ● | | |
| Autonomy | | | | | | ● | ● |
| Collective Intelligence | ◐ | ◐ | ◐ | ○ | ● | ◐ | ○ |
| Civilization | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

**●** built and running · **◐** partly built · **○** planned · blank: not this
layer's business

Three states rather than two, because two forced a false choice. Collective
Intelligence is the clearest case: correlation-discounted arbitration between
disagreeing agents is *built and running today*, which is why that cell is a
filled dot — but the property that actually defines the layer, **independent
deployments verifying each other's records without merging them**, does not
exist in any form. Marking the whole row planned would understate what runs;
marking it built would be a lie about federation. The row is mixed because the
layer is mixed, and saying so is more useful than either tidy answer.

Civilization stays entirely planned. Not the question — the question is live
already, at every scale from one agent upward — but nothing in this repository
operates at that scale, and the difference between *the question is real* and
*we have built the answer* is the whole distinction this document exists to
protect.

**These marks are doctrine, not telemetry.** "Capability participates in
Explain" is an architectural opinion, arrived at by argument, and someone could
reasonably disagree. "trace.verify +5.56% mean latency" is a measurement,
arrived at by running something, and disagreement means re-running it. The two
kinds of claim must never be printed in the same voice. The layer table below
carries a build-status column with a file or route beside every claim, and
`pnpm check:doctrine` fails if any of those paths stops existing — so the
boundary between aspiration and implementation is itself drift-checked.

The two models also evolve independently, which is the practical reason to keep
them apart. The loop may one day gain stages — simulate, negotiate, coordinate —
without a single layer changing. Civilization may split into planetary and
beyond without the loop changing at all.

---

## The loop

Seven things this system does, in the order trust is built, returning to the
start. Each is a screen in the console, because a product whose navigation does
not match its architecture is telling two different stories.

| | | |
|---|---|---|
| 1 | **Observe** | Capture what an agent did — the subject, the authority it held, its steps, and hashes of what it processed |
| 2 | **Verify** | Ed25519 signatures, hash chains, provenance, capability tokens. Checkable by someone holding only a public key |
| 3 | **Explain** | Turn a record into plain language derived from signed fields, deterministically, with every sentence naming its source |
| 4 | **Govern** | Policies, permissions, organisational rules, and the constitutional refusals enforced in code |
| 5 | **Arbitrate** | Resolve disagreement between agents with correlation discounting and stated evidence weight |
| 6 | **Act** | Execute — MCP, edge execution, connectors — only under a capability that was granted |
| 7 | **Learn** | Measure the system against itself: baselines, regression detection, and numbers that came from a benchmark |

It is a loop, not a pipeline, and the difference is the whole point:

```text
                    Observe
                   ↗       ↘
             Learn           Verify
               ↑               ↓
              Act            Explain
               ↑               ↓
          Arbitrate  ←──────  Govern
```

The clearest demonstration is the benchmark, because there the system runs the
loop on itself:

| Stage | What the benchmark does |
|---|---|
| Observe | Time every iteration of the real signing and verification paths |
| Verify | Confirm the two runs are comparable — same machine, same runtime, same workload |
| Explain | State the change with the field it came from: mean latency, iteration count, machine |
| Govern | Refuse comparisons that are not permitted, rather than producing a number anyway |
| Arbitrate | Welch's t-test decides signal from noise; a change inside the spread is called noise |
| Act | Write the result, fail the build on regression when asked to |
| Learn | The run becomes the baseline the next one is judged against |

Then it observes again. That is not a description of the product; it is the
product running on itself, which is the only demonstration this project considers
worth much.

**Learn returns to Observe, or it is not a loop.** A measurement that terminates
in a dashboard tile has taught nobody anything. Every benchmark run is compared
against the previous run on the same machine, with Welch's t-test deciding
whether a change is real; the comparison refuses to run across different hardware,
different runtimes, or an operation whose workload changed, because a regression
alert that fires on a machine swap gets muted within a week — and then the real
regression arrives and nobody looks.

Stage 3 carries a rule that looks like a limitation and is the opposite of one.
**Explanation is derived, never generated.** Using a language model to explain a
record would place a second unauditable system on top of the first: a new claim,
produced by reasoning nobody can inspect, about a record whose entire value is
that its reasoning *can* be inspected. The explanation would be the least
trustworthy thing on the screen. A generated explanation would be more
impressive. A derived one is checkable, and this project chooses checkable over
impressive every time the two conflict.

Stage 7 carries the matching rule. **No number is published that a measurement
did not produce.** Throughput, latency, record counts, verification rates — every
figure names the machine it was measured on, or it does not appear. A system that
says "trust must be verifiable" and then advertises an unverifiable number has
refuted itself in its own marketing, and one fabricated figure costs more than
ten honest ones are worth.

---

## The shape of the decade

The black box is the first capability people understand immediately, and it is
the front door — one package, sixty seconds, no account. It is not the whole
building. What it grows into, in order, each layer resting on the one below:

| | Layer | | Status | Evidence |
|---|---|---|---|---|
| 1 | **Identity** | Every agent, model and human has one that survives restarts | Built | `packages/capkit/src/identity.ts` |
| 2 | **Capability** | Authority is granted narrowly, expires, and is revocable centrally | Built | `packages/capkit/src/capability.ts` |
| 3 | **Evidence** | Claims are checked against sources and reported as supported, unverified or contradicted | Built | `packages/trust/src/verification.ts` |
| 4 | **Trust** | Records accumulate into facts about behaviour — counts, never scores about people | Built | `packages/trust/src/scoring.ts` |
| 5 | **Governance** | Policies, obligations, approvals and the workflows humans use to run all of it | Built | `packages/capkit/src/approval.ts` |
| 6 | **Autonomy** | ABSuite's own agents watch the record continuously and raise what a person should see | Built | `packages/capkit/src/watch.ts` |
| 7 | **Collective Intelligence** | Independent deployments verify each other's records without merging them *(accrues with adoption — one mechanism now exists, `@absuitecore/notary`, but the layer is the network and the network needs deployments that are not ours)* | Not built | — |
| 8 | **Civilization** | Millions of agents, autonomous economies, planetary-scale accountability *(accrues with use — nothing here is a feature that can be written; it is what the lower seven become at scale)* | Not built | — |

The last two columns are not decoration. A roadmap that does not mark what is
shipped is a wish list wearing an architecture diagram, and this project does not
get to publish one of those. Every layer claimed as built or partly built names a
file you can open; `pnpm check:doctrine` fails the build if one of those files
stops existing, and fails equally if a layer marked *not built* starts claiming
evidence — a promotion has to be a deliberate act, not a drift.

The layers are an ascent, and each transition is load-bearing:

```text
Identity        enables    Capability      — you cannot grant to nobody
Capability      produces   Evidence        — an authorised action leaves a record
Evidence        establishes Trust          — records accumulate into facts
Trust           permits    Governance      — you cannot govern what you cannot establish
Governance      enables    Autonomy        — unsupervised action needs a rule that held
Autonomy (×N)   becomes    Collective Intelligence
Collective Intelligence at scale becomes   Civilization
```

Read downward, it is also a list of what breaks: govern without evidence and you
are enforcing opinions; grant autonomy without governance and you have built the
thing this project exists to make unnecessary.

Layer 7 is marked not built on the strength of its own definition. Multi-agent
arbitration runs today and is real; *federated verification between independent
deployments* is what the layer means, and none of it exists.

**Layer 8 is a claim about a question, not about us.** At civilisation scale
somebody has to be able to answer *who did what, under whose authority, using
what evidence, according to which rules* — when a city allocates electricity
between autonomous systems at three in the morning and a person asks, years
later, which agent decided and whether it was allowed to. That question does not
go away as autonomy grows; it gets larger, and it gets harder to answer after the
fact than during. Building the answer now is the entire bet. Whether ABSuite is
what answers it is not something this document is entitled to assert.

**Layer 8 is not something you build.** Civilisation is a scale, not a feature.
No commit makes it true. It becomes true only if the seven layers beneath it are
good enough that people use them at that scale — which is a fact about the world,
arrived at over decades, not a milestone anyone here can close.

Most projects open by claiming civilisation-scale impact. This one ends its
roadmap by declining to. Civilisation is not built; it happens to things that
survive, and marking this layer complete would be the single clearest violation
of the root that governs everything above: nothing may look more complete than it
actually is.

Layer 7 is where the design decision lives that determines what this project
becomes. Verification between deployments must be **federated, never
centralised**: a million recorders that can each prove their own history, with
no one holding all of them.

The temptation at that scale is a single vantage point over everything — and
that is the difference between a flight recorder and a camera network. A flight
recorder is scoped to one aircraft, read after an incident, by an accountable
investigator. A camera network is unscoped, watched continuously, by whoever
holds it. Humanity has built both. Only one of them is what this is.

### Autonomous observation, triggered action

The two halves are not in tension, and getting the line right is the whole
design:

- **Observation is automatic.** Nobody switches trust on. An agent starts, an
  identity is assigned, capabilities are issued, every action is recorded and
  signed. The moment a human has to remember to enable trust, trust has already
  failed — and a record that depends on someone remembering is not a record.
- **Action is granted.** Humans decide what an AI may do. ABSuite enforces that
  boundary before the action runs and never widens it on its own.

Humans govern. ABSuite makes governing possible by never forgetting.

### What that looks like when it works

If the premise holds and the execution is adequate: installed broadly, used
where the stakes are real — enterprises, governments, health, finance — a
recognised standard for AI attestation, an open core with an ecosystem around
it, thousands of contributors, none of whom need permission.

Not guaranteed. **Plausible.** That distinction is itself constitutional: this
document describes a direction, not a prediction, and a project that cannot tell
those apart has already started lying to itself.

---

## What trust is made of

Trust is not a thing ABSuite has. It is what is left over once five other things
are answerable:

```text
Trust := f(
    Identity,     who?
    Capability,   allowed?
    Evidence,     what actually happened?
    Governance,   should it have?
    Time          when, in what order, and after what?
)
```

**`f` is intentionally undefined.** ABSuite supplies the inputs. A person
performs the judgement. That is not a gap to be filled in a later release; it is
the position, and `packages/capkit/src/conditions.ts` is where it is implemented
rather than merely stated.

Time is the one people leave out, and it is the one that makes the rest hold:
identity without history is an assertion, evidence without ordering cannot be
replayed, and a capability that cannot be shown to have been valid *at the moment
it was used* proves nothing afterwards. The hash chain is how time enters the
calculus — not as a timestamp, which anyone can write, but as an order no one can
rewrite.

And the runtime is the loop applied to that state, over and over:

```text
Trust(t+1) = Learn(Act(Arbitrate(Govern(Explain(Verify(Observe(t)))))))
```

When every condition holds, `GET /executions/:id/conditions` concludes:

> All necessary conditions for trust have been demonstrated. Whether that is
> sufficient is a judgement, and it is yours.

It does not conclude `Trust: 97.3%`. Those are philosophically different
statements, and the difference is the entire product. A number replaces evidence
with something nobody audits — nobody interrogates a 97.3, they act on it. A list
of five conditions, each naming the field it was read from, can be disagreed with
one line at a time.

The refusal is a test, not a paragraph: *"never produces a score, a percentage or
a grade"* fails the build if a percentage, the word *score*, *grade*, *rating* or
*confidence* ever appears in that output.

**This is how the roadmap gets chosen.** The first time this ran, Governance came
back *absent* on every record — a trace stated the authority an action held and
carried nothing about the rule that decided the authority should be granted. The
tool applied to its own output named our largest gap in public, without being
asked, and that named the next piece of work.

Executions now carry an optional governing record: `policyRef`, `policyVersion`,
`decision`, the specific `evidence` conditions checked, and who evaluated them.
It is inside the signed canonical form, so deleting the policy from a record
breaks verification exactly as editing the outcome does — a policy reference
nobody could verify would be a claim about authority with no more standing than a
log line.

The question the layer answers changed with it, and the wording matters:
Governance answers **"under what rule?"**, not "should it have?". Naming the rule
that permitted an action is the furthest a record can go. Whether that rule
should have existed is a human question, and the explanation says so in the same
sentence that names the policy:

> Policy finance.refunds.max-10000 (v2.1.4) evaluated to PERMITTED, decided by
> policy-engine-1. The conditions checked were: refund < $10,000;
> customer_age > 30d; approval_872. **This is the rule that permitted the action,
> not a statement that the decision was correct.**

An ungoverned record still reports Governance as absent. It is not backfilled,
assumed, or inferred from scope, because a capability is the *result* of a
governing decision and not the decision itself.

**Under what rule, not whether the rule was right.** The record is
constitutionally neutral about the content of a policy. Given
`finance.refunds.max-10000`, ABSuite says the action was permitted under v2.1.4.
Given a policy whose content is indefensible, ABSuite says the action was
permitted under that policy, in exactly the same words. The trace does not
flinch, because a record that editorialised about which rules it approved of
would be worthless as evidence — you could not trust it about the rules it
liked either.

That neutrality has a boundary, and stating it is the difference between a
principle and an alibi:

- **The record is neutral. The project is not.** ABSuite refuses to score people,
  refuses to name what it declined, refuses to tell anyone what to do. Those
  refusals are about what this system *is built to do*, and no appeal to
  neutrality overrides them. "We are only infrastructure" is the most
  comfortable sentence in technology and it has excused a great deal.
- **Recording a rule is not endorsing it — it is exposing it.** Before this
  field existed, an indefensible policy could operate invisibly: the action
  looked authorised, and the rule behind it left no trace. Now the rule is
  named, versioned and attributable, permanently, in a record its author cannot
  edit. Neutrality of description is what makes accountability possible; it is
  not the opposite of it.

Judgement stays with people. Making sure they have something to judge is the
entire job.

**The layer was partly built until the approvals arrived, and the gap was
specific.** `REQUIRES_APPROVAL` was a decision a trace could record and nothing
in the system could act on: no way to ask, grant, refuse, expire, or show
afterwards that a person had answered before the action ran. A record could
state that human judgement was required and then satisfy that requirement by
itself — which read as governance and was its absence.

`packages/capkit/src/approval.ts` closes it, and the binding is the part worth
naming: an approval covers a hash of the subject, module, action and **input
hash**, all four of which are on the finished execution too. So *was this
approved?* is answerable from the execution record alone. There is no approval
id written onto the trace, deliberately — a link the operator adds afterwards is
a link the operator can add afterwards. Two rules are refused rather than warned
about: the requester may not decide, and one approval covers one execution. A
reusable approval is an authority, and authority is Layer 2's job.

**What is still not here is not code.** A curated library of governance rules for
real domains — refund limits, data-egress rules, model-swap approvals, versioned
and citable by `policyRef` — is writing and domain knowledge, and it is listed as
a product in [SERVICES.md](SERVICES.md) rather than a missing mechanism. ABSuite
also still does not *evaluate* policy, and will not: it records the decision
somebody else's engine made, because a system that both wrote the rule and
graded the compliance would be marking its own homework.

---

### Unknown is not the same as false

Nor the same as true — which is the half that was actually hiding in this
codebase. Two states are a lie in an evidence system, and three are not enough.
There are four:

| | Meaning | Must also carry |
|---|---|---|
| **DEMONSTRATED** | The evidence supports it | — |
| **FAILED** | The evidence contradicts it | — |
| **UNKNOWN** | The evidence is unavailable, or unreadable by this verifier | **What would resolve it** |
| **ABSENT** | The record never attempted to answer | **Why the record is silent** |

Not `true` / `false` / `null`. True and false are claims about the world; this
system only ever makes claims about *evidence*. DEMONSTRATED means the evidence
for this is present and holds — never that the thing is true. A record does not
make an action correct, and the vocabulary must stop implying otherwise.

ABSENT is the fourth because "we checked and found nothing" and "this record was
never asked" are different facts. A trace that predates governance is silent for
a reason that has nothing to do with the action it describes.

A thermometer that cannot read 10,000°C does not report `temperature: false`; it
reports out of range. A verifier that has not checked a signature has not
disproved it, and a build too old to read a record has not caught anyone
tampering. Collapsing those into "invalid" turns every limitation of the verifier
into an accusation against the evidence — and the accused record is usually the
one that is right.

### Evidence composes pessimistically

**The overall finding is never better than the weakest part of it.** Claims
shrink to fit uncertainty — not out of pessimism about the world, but because a
claim wider than its evidence is not a claim, it is a hope.

Four conditions demonstrated and one failure is not "mostly trustworthy" — it is
a record with a failure in it. Trust does not average, and it does not
accumulate: the strongest parts of a system do not compensate for the weakest,
they are limited by them.

```text
Trust is constrained by min(Identity, Capability, Evidence, Governance, Time)
```

Not numerically. There is no arithmetic here and never will be — see the refusal
to compute `f`. It means only this: if Identity is UNKNOWN, nothing that can be
claimed exceeds UNKNOWN. If Governance is ABSENT, the claim stops there.

The report therefore states the strongest claim the record supports, and names
every condition holding it down rather than the single worst one. **A system is
not defined by the evidence it possesses. It is defined by the strongest claim it
can still defend after accounting for what it does not know.**

One judgement is embedded here and is worth flagging as a judgement: UNKNOWN
ranks below ABSENT, on the reasoning that an unknown might still resolve to
FAILED — so nothing can be claimed until it is checked — whereas an absence is a
known and bounded gap. Someone could argue the reverse. `constrainedBy` lists
every condition that is not DEMONSTRATED precisely so that nobody has to accept
the ordering to read the report.

One vocabulary, in every package. `@absuitecore/trust` names claim statuses
`SUPPORTED` / `UNVERIFIED` / `CONTRADICTED` / `NOT_CHECKED` — published names,
and callers depend on them, so they stay. `determinationOf()` states the
correspondence in code rather than leaving it in a paragraph nobody finds:

| Claim status | | Carries |
|---|---|---|
| `SUPPORTED` | DEMONSTRATED | — |
| `CONTRADICTED` | FAILED | — |
| `UNVERIFIED` | UNKNOWN | *Supply a source containing it, or remove the claim* |
| `NOT_CHECKED` | UNKNOWN | *Supply the sources this output was meant to be grounded in* |

ABSENT does not arise there: the checker attempts every claim it segments, so a
claim is never simply unasked.

---

### Every unknown must carry its path to resolution

Uncertainty without a next step is paralysis. Uncertainty with one is work.

Enforced at construction rather than left to discipline: building an UNKNOWN
without a resolution throws, and so does an ABSENT without a reason for the
silence. An unknown nobody can act on is a dead end dressed as an answer, and a
reader who cannot act on it starts reading it as a pass within a week — which is
the failure the whole distinction exists to prevent.

In practice it turns a witness into a guide without making it an adviser:

> UNKNOWN — no signature was checked, so who wrote this record is unproven.
> *Resolved by: verify again with the signing key's public half.*

> UNKNOWN — this record was written in canonical form v3.
> *Resolved by: upgrade to a build that supports it.*

> ABSENT — no scope was recorded.
> *Not answered because: the record makes no claim about what was permitted.*

Saying what would settle a question is not the same as saying what someone
should do about the answer. The first is help; the second is the judgement this
system refuses to make.

**An unknown is not a destination; it is a queue of work.** Because every
unknown carries its own route out, they collapse across a whole log into a
handful of distinct actions — `GET /executions/unknowns` groups them and names
the records each would resolve:

> • Record an output hash so a replay can confirm the result, not only the input.
>   *affects: Evidence · examined 8 of 8 records*

Listed alphabetically, never ranked. Which gap matters is a judgement, and
ordering them by importance would be ABSuite making it — the same refusal as
declining to score anything else.

**What this found in our own code.** `verifyTrace()` called without a public key
returns `valid: true`. That is technically correct — the content matches its
hash, which is all it was asked — and it has been readable as "this record is
genuine" ever since, when nobody checked who wrote it.

One bit was carrying two independent questions:

| | |
|---|---|
| Integrity — has the content changed? | DEMONSTRATED |
| Authorship — who wrote it? | UNKNOWN |

They are reported separately now, and the overall finding is never better than
the weaker of the two. That also makes a distinction the old boolean could not:
a signature checked against the wrong key leaves integrity DEMONSTRATED and
authorship FAILED — nothing was edited, it was signed by someone else.

The same refusal to collapse uncertainty already runs through the codebase in
four other places, and they are all the same principle: `signatureValid: null`,
`contentIntact: null`, `checkable: false`, and Governance reported as *absent*
rather than *failed*. Evidence validation has carried it longest, in
`SUPPORTED` / `UNVERIFIED` / `CONTRADICTED` / `NOT_CHECKED` — where `UNVERIFIED`
has always meant *not found in the sources*, never *false*.

---

### Context is part of the evidence

A claim without its conditions is not a smaller claim; it is a different one.
The same pattern recurs everywhere in this system, and it is the same rule each
time:

| Statement | Must also say |
|---|---|
| Verified | against which key |
| Unknown | what would resolve it |
| Absent | why the record is silent |
| Unreadable | which canonical form, and that this is not tampering |
| Measured | on which machine, over how many iterations |
| Counted | out of how many, and whether the list was truncated |

The last row was the most recent gap. `GET /executions/attention` returned
"3 records need attention" — which reads identically whether it is 3 of 10 or
3 of ten million, and a list capped at the limit read exactly like a complete
one. Every listing now states its denominator and says when it was truncated;
the complete scan says it is complete.

Most systems answer questions. This one has to answer *under what conditions is
this answer true*, which is a harder thing to do and the only thing worth
trusting.

**A report must be readable by someone who has only the report.** Open a file in
2046 that says "3 records require attention" and you have learned almost
nothing: which build produced it, over what scope, verified under which rules?
Every report ABSuite emits now carries its own provenance —

```text
generated by capkit v1.1.2 at 2026-07-30T10:00:24.249Z
canonical form v1
scope: all flagged records among 8 held
```

— because the software will not be there to explain itself, and a report that
outlives its system has to carry its own context. The version is read from the
manifest rather than typed in: a report asserting the wrong build with complete
confidence is precisely the failure this project exists to argue against.

The scope line is prose rather than a structure, deliberately. A future reader
is a person, not a parser.

---

### History must survive improvement

Adding a field must never invalidate a record written before it existed. This is
easy to promise and easy to break: a reordered field, a new element, a "harmless"
null placeholder for consistency — any of them silently changes the canonical
form of every trace ever written, and nobody finds out until an auditor's chain
reports as tampered by a system that was only trying to be tidy.

Unit tests cannot catch it. A test that signs a record and verifies it in the
same process moves both sides together and stays green while the archive rots.

So there is a frozen chain in the repository — three records signed in January
2026 and never regenerated, two from before governance existed and one carrying
a signed policy. `frozen-chain.test.ts` verifies them against nothing but their
committed public key. If that test fails, the fixture is not what is wrong.

Verified by making the exact mistake it guards against: appending a null
governance placeholder for consistency turned three historical records
invalid immediately.

**And versions are how history keeps surviving.** Freezing v1 cannot mean the
form never changes — it means a change never orphans what came before. Records
carry the canonical form they were written with (absence means v1, so nothing
written before versioning existed moved a byte), the verifier dispatches on it,
and no supported version is ever dropped. A deployment writing v3 in 2031 must
still verify a record signed in 2026, or the evidence expired and was therefore
never evidence.

The subtle half is the other direction: a *2026 build meeting a 2031 record*. It
must not report tampering, because it has not detected any — it simply cannot
read the record. Verdicts carry `checkable: false` for exactly this, chain
verification stops without calling the chain broken, and the conditions endpoint
returns a single honest line instead of five findings against a record whose only
problem is our age:

> This record cannot be read by this build, so nothing about it has been
> demonstrated or disproven. Upgrade and ask again.

"I could not check this" and "this failed the check" are different statements.
Collapsing them is how an old verifier ends up accusing a good record — the same
false-accusation failure as calling a rotated signing key tampering, and it would
be far more damaging here.

---

**Claims are architecture. Checks are implementation.**

Both models above are claims. Everything that enforces them is a check, and the
checks are the part that is worth anything:

| Claim | The check that makes it true |
|---|---|
| No number is published that a measurement did not produce | `gen-performance-doc.mjs --check` fails CI on drift between the benchmark data, the doc and the README |
| A comparison across machines or workloads is meaningless | `compareReports()` refuses it and says why, rather than producing a number |
| These seven refusals are behaviour, not marketing | `check:constraints` fails if the test enforcing any refusal is renamed or deleted |
| The layer table distinguishes built from planned | `check:doctrine` fails if a built layer's evidence vanishes, or a planned one starts claiming some |
| History must survive improvement | `frozen-chain.test.ts` verifies records signed in 2026 against their committed public key, forever |
| Unknown is not the same as false | Four states, and the vocabulary contains no TRUE, FALSE or VALID |
| Every unknown carries its path to resolution | `finding()` throws on an UNKNOWN with no resolution, or an ABSENT with no reason |
| Evidence composes pessimistically | Overall state is the weakest condition, never an average, and names what constrains it |
| Every documented route exists | The CapKit smoke suite asks the running server for each one |
| The interface only calls things that answer | `check:routes` fails if a client call has no server route |

A principle that cannot fail a build is a preference. This table is the
difference between a project that says these things and a project that does
them, and it is the only reason any of the prose above should be believed.

There is a hierarchy here, and only the last rung has teeth:

| | | Example |
|---|---|---|
| 1 | Preference | "Documentation should be good" |
| 2 | Principle | "Claims should be verifiable" |
| 3 | Constraint | "Every claim requires evidence" |
| 4 | Check | `check:doctrine` |
| 5 | Build failure | `Claimed: Collective Intelligence = Built` · `Evidence: missing` · `Result: FAIL` |

Most projects stop at 2 and believe they are at 5. The distance between them is
where every broken promise in software lives.

**And ABSuite is subject to ABSuite.** The trust layer is not exempt from trust,
the governance system is not exempt from governance, and the evidence system does
not get to assert things without evidence. The benchmark runs the loop on itself;
the conditions check names our own missing Governance layer; the doctrine check
fails our own build when a claim outruns the code — it caught two fabricated file
paths in the commit that introduced it. A system that grants itself privileges it
denies everyone else has already decided what it is.

---

## The roots, and what derives from them

Five principles. Everything else in this document is an application of one of
them, and is written down only because the application was not obvious until
something went wrong.

| | | |
|---|---|---|
| **1** | **Trust must be verifiable** | A conclusion nobody outside can re-derive is an assertion |
| **2** | **History must survive improvement** | A change that orphans old records has destroyed evidence to tidy a schema |
| **3** | **Nothing may look more complete, more certain, or more authoritative than it actually is** | The root of most of the rest |
| **4** | **Evidence composes pessimistically** | Claims shrink to fit uncertainty; the strong parts do not compensate for the weak |
| **5** | **Every unknown must carry its path to resolution** | Uncertainty without a next step is paralysis; with one it is work |

Read the applications back and each one traces to a root:

| Application | From | Enforced by |
|---|---|---|
| Unknown is not the same as false — or true | 3 | `determination.test.ts` |
| ABSENT instead of implied, with a reason | 3 | `determination.test.ts` — construction throws |
| `checkable: false` instead of tampered | 3 | `trace.test.ts` — a record from the future |
| `complete: true` instead of silence | 3 | `server.smoke.test.ts` — denominators |
| Denominators instead of bare counts | 3 | `server.smoke.test.ts` — truncation |
| Context on every report | 3 | `server.smoke.test.ts` — provenance |
| No trust score, ever | 1, 4 | `conditions.test.ts` — no percentage, grade or score |
| Derived explanations, never generated | 1, 3 | `explain.test.ts` — determinism |
| Measured numbers only | 3 | `gen-performance-doc.mjs --check` in CI |
| Versioned canonical forms | 2 | `frozen-chain.test.ts` |
| Additive migrations only | 2 | `trace.test.ts` — a chain mixing shapes |
| The unknown queue | 5 | `server.smoke.test.ts` — listed, never ranked |
| Overall is the weakest condition | 4 | `conditions.test.ts` — nothing composes upward |
| No severity on a record or a gap | — the machine/person boundary below | `server.smoke.test.ts` |

**One exception, named rather than buried.** That last row said "no severity,
anywhere" when it was first written. It was overstated, in the table built to
stop exactly that: `@absuitecore/trust` carries `severity` on findings and a
0–100 `reviewPriority`, and the test enforcing the row only covers the CapKit
report endpoints.

The row is now narrowed to what is true and enforced. `reviewPriority` stays,
because it does something different from severity: it orders a *review queue* by
finding density when a team has ten thousand outputs and time for fifty, and it
says so in its own documentation — not a probability of falsehood, not a
judgement about the output. That is a defensible tool and a genuine tension with
the boundary below, so it is written down here instead of being quietly excluded
from a claim that said "anywhere".

Fifty years from now nobody will remember why `complete: true` exists, or why an
unknown must carry a resolution. They will understand the third line, and it
explains almost every choice here: **this system refuses to pretend.**

The greatest feature is not traceability. It is restraint — not because
restraint is elegant, but because restraint is provable.

---

## Where the machine stops and a person starts

The loop does not close inside the software. It closes through a person, and the
division of labour is the whole design:

| The system provides | A person provides |
|---|---|
| Evidence | Priorities |
| Constraints | Values |
| Unknowns, with their resolutions | Policy |
| What is unreadable, and why | Judgement |

This is why there is no severity field anywhere. Severity is context, and
context belongs to whoever holds it. "HIGH: missing governance" — according to
whom? "LOW: missing output hash" — until that missing hash is the thing
preventing a regulatory investigation ten years later. Infrastructure that
invents severity is quietly making decisions on behalf of people who never
delegated them, and it will be wrong in exactly the cases that matter most,
because those are the cases its defaults were not written for.

So the chain stops one step short, deliberately, every time:

```text
UNKNOWN → resolution → queue item → │ → human judgement → action
                                    │
                          the system stops here
```

**Careful intent produced the bug. Precise language caught it.** That sentence
is the shortest account of why this document exists. The tally-as-score problem
was written twice, in two packages, months apart, by someone actively applying
the rule against it — and both times the rule as *language* found what the rule
as *intention* had missed. Intent degrades: engineers change, teams grow, people
forget. Language, made precise enough, becomes executable, and executable
principles do not forget.

---

## The three promises

Ambition without reality becomes fantasy. Reality without ambition becomes
maintenance. The conditions for holding a decade-long view are:

1. **No sacrificing shipping for vision.** A capability nobody can install does
   not exist.
2. **No sacrificing adoption for architecture.** One install is worth more than
   ten features.
3. **No sacrificing reality for ambition.** When the premise is tested by
   evidence, the evidence wins.

---

## Amendment

This document changes only when the premise changes. Features, priorities,
timelines and tactics belong in the roadmap and are expected to change often —
that is what a roadmap is for.

The refusals above are not amendable by convenience. If one is ever removed, the
commit message must say which, why, and what it costs.

**No new principle without a failing test that proves its absence.**

A constitution should feel expensive to change. A principle that does not
deserve a test, an enforcement, a documented example and future maintenance is
not constitutional — it is a preference, and preferences belong in a style guide
where they can be argued with cheaply.

This document is now long enough that its length is itself a risk: a document
nobody finishes governs nothing. The next useful change to it is far more likely
to be subtraction than addition. Before anything is added, two questions:

1. Does it derive from one of the five roots? Then it is an application, and it
   belongs beside the code it constrains, not here.
2. Can a test fail when it is violated? If not, it is philosophy — and this
   project has spent a great deal of effort learning that philosophy without
   enforcement is decoration.

### A note for whoever inherits this

> **A constitutional line should be harder to add than code, and easier to
> remove than either.**

Addition already costs something: the two questions above, plus a test that can
fail. Removal costs nothing — which means nothing forces it, and *accumulation*
rather than bad principles is what kills a document like this over a decade.

So the applications are capped. `check:doctrine` fails at the fifteenth. It is
not forbidden; it simply cannot be free. Adding one means removing another,
promoting it to a root, or raising the budget in a commit that argues for why
this document should be longer. All three are deliberate acts, which is the
entire point.

If you are reading this years from now: the trajectory worth protecting is that
the code grew, the tests grew, the endpoints grew, and the doctrine shrank. That
is the opposite of what usually happens. Nobody will remember all fourteen
applications. They will remember the five roots — and if those no longer fit on
a single page, something has been lost that is worth more than whatever was
gained.

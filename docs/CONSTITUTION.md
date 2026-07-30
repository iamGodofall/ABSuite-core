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

## The shape of the decade

The black box is the first capability people understand immediately, and it is
the front door — one package, sixty seconds, no account. It is not the whole
building. What it grows into, in order, each layer resting on the one below:

| | | |
|---|---|---|
| 1 | **Identity** | Every agent, model and human has one that survives restarts |
| 2 | **Capability** | Authority is granted narrowly, expires, and is revocable centrally |
| 3 | **Evidence** | Claims are checked against sources and reported as supported, unverified or contradicted |
| 4 | **Trust** | Records accumulate into facts about behaviour — counts, never scores about people |
| 5 | **Governance** | Policies, obligations, approvals and the workflows humans use to run all of it |
| 6 | **Autonomy** | ABSuite's own agents watch the record continuously and raise what a person should see |
| 7 | **Collective** | Independent deployments verify each other's records without merging them |

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

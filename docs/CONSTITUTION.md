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

The trust layer for intelligent systems. When a decision made by an AI system
matters — legally, financially, medically — ABSuite is what lets someone answer:

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

## The 2030 picture

If the premise holds and the execution is adequate:

- The trust layer for intelligent systems, installed broadly
- Used where the stakes are real — enterprises, governments, health, finance
- A recognised standard for AI attestation
- An open core with a commercial ecosystem around it
- Thousands of contributors, none of whom need permission

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

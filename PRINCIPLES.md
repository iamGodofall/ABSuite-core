# ABSuite Engineering Principles

Six rules. Every one of them is enforced somewhere in the code, and every one of
them was written down after a specific decision went the other way and had to be
corrected. They are not aspirations — they are the reasons the code looks the
way it does.

---

### 1. Evidence over opinion

A judgement about a subject must trace to a recorded, verifiable artefact. No
component in ABSuite may assert something about an agent, a person or an output
that a reader cannot follow back to the event that caused it.

> `TrustScore.contributions` returns every event that moved a score and by how
> much. A score you cannot interrogate is not evidence.

### 2. Verification over confidence

Self-reported certainty is uncorrelated with accuracy and trivially gamed by
whoever writes the prompt. It may inform; it may never decide.

> In `arbitrate()`, confidence influence is capped, and the leading answer must
> hold *more independent support than the runner-up* — not merely more weight.
> A maximally confident participant cannot carry a one-against-one split.

### 3. Facts over scores

Where a count will do, report the count. Scores about people are conclusions a
machine reached about a human being, and they get used to deny things by people
who never see how they were computed.

> `evidenceRecord()` reports `eventsRecorded`, `policyViolations`,
> `manualOverrides`, `auditFindings`. It has no `score` field and cannot be
> given one. Scoring humans at all requires an explicit opt-in.

### 4. Replay over assumptions

If a claim about past behaviour cannot be re-derived from stored data, it is a
memory, not a record. Every scoring and arbitration function in ABSuite is pure:
same inputs, same clock, same answer, forever.

> `replayManifest()` and `compareReplay()` confirm a re-run produced identical
> output. Tests assert determinism directly rather than trusting it.

### 5. Trust must be earned continuously

Trust decays. A subject is judged on recent behaviour, and a past mistake does
not follow anyone forever — nor does a good record excuse a present failure.

> 30-day half-life on every event. A violation four half-lives old moves a score
> by less than two points.

### 6. Confidence never determines truth

The most important one, and the hardest to hold. A system that cannot say "I do
not know" will eventually say something false with total assurance.

> Evidence validation returns `UNVERIFIED`, never a probability. `UNVERIFIED`
> means the evidence is absent — **not** that the claim is false. Only
> `CONTRADICTED` asserts a defect, and only because there the output disagrees
> with itself and no external truth is needed to see it.

---

## The corollary

Each principle implies a thing ABSuite will not build, and those refusals are
load-bearing:

| Principle | What it forbids |
|---|---|
| Evidence over opinion | A rating with no traceable cause |
| Verification over confidence | A vote where asserting harder wins |
| Facts over scores | "John has a trust score of 42" |
| Replay over assumptions | A conclusion that cannot be re-derived |
| Trust earned continuously | A permanent mark, or a permanent pass |
| Confidence never determines truth | A hallucination detector |

The last row is the one that costs money. It is also the one that keeps a
customer from being sued after trusting a number we made up.

---

## How to use this document

When a design decision is genuinely close, these break the tie. When a feature
request conflicts with one of them, the principle wins and the feature is built
differently — as evidence validation rather than hallucination detection, as an
evidence record rather than a human trust score.

If a principle ever has to be broken, it must be broken **loudly**: in a comment,
at the point of the exception, saying which rule and why. Silent exceptions are
how a trust product becomes an untrustworthy one.

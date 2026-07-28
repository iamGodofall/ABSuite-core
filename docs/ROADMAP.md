# ABSuite Roadmap

> ## Do not build another flagship feature until 100 people have installed ABSuite.
>
> All ten flagship capabilities are built. The binding constraint is no longer
> engineering. Every hour spent on an eleventh capability is an hour not spent
> on the only problem that now matters.

This document is measured in **days**. The decade-scale view lives in
[`CONSTITUTION.md`](./CONSTITUTION.md) and does not belong here.

---

## Where the project actually is

| Capability | Status |
|---|---|
| Black Box Recorder | Complete |
| Replay Engine | Complete |
| Execution Certificates | Complete |
| Evidence Engine | Complete |
| Evidence Validation | Complete |
| Trust Analytics | Complete |
| Reciprocal Trust | Complete |
| Multi-AI Arbitration | Complete |
| Governance Components | Complete |
| Explainability | Complete |

391 tests. 93 API endpoints. 7 npm packages. 6 HTTP services and an MCP server.

And one sentence that remains true regardless of any of that:

> **Nothing is installable and nobody has used it.**

That is the entire state of the project. It is not a technology problem — those
sound like *"we don't know how to build this."* It is a distribution problem,
which sounds like *"we built it, now people need to find it."* Distribution
problems are the better kind to have, and they are not solved by building more.

---

## Phase 1 — Make it installable

Nothing in later phases is possible until this is done. It is days of work, not
weeks, and none of it is interesting — which is exactly why it keeps being
deferred in favour of building something.

- [ ] **Publish the packages to npm.** Requires the maintainer's npm token as a
      GitHub secret, then running the publish workflow. Nothing else blocks it.
- [ ] Make the GitHub repository public
- [ ] Add npm version and download badges to the README
- [ ] Add screenshots of the dashboard and the browser verifier
- [ ] Write an installation guide that works on a clean machine
- [ ] Record a five-minute demo: install → issue a token → run an action →
      verify the proof in a browser

**Exit condition:** a stranger can install ABSuite and verify an execution trace
without talking to anyone.

## Phase 2 — First hundred

- [ ] First 100 installs
- [ ] First outside contributor
- [ ] First issue filed by someone who is not the maintainer
- [ ] First person who uses it without being asked to

**Exit condition:** 100 installs. Not 100 stars, not 100 impressions — 100
installs. Until then, Phase 3 does not begin.

## Phase 3 — First revenue

- [ ] Enterprise pilot
- [ ] Hosted offering
- [ ] Commercial features around the open core

The verification path stays free and open, permanently. See the Constitution.

## Phase 4 — Standardisation

- [ ] Ecosystem of connectors and integrations built by other people
- [ ] Industry adoption
- [ ] "Is this ABSuite-compliant?" asked by someone with no connection to the project

---

## The daily question

> **Did another human install ABSuite yesterday?**

1 → 10 → 100 → 1,000 → 10,000.

Somewhere in there someone asks how it happened, and the honest answer is that
years were spent making trust infrastructure boringly reliable.

---

## Things deliberately not on this roadmap

Recorded so they are refused on purpose rather than forgotten and rediscovered:

- **An eleventh flagship capability.** See the heading.
- **A hallucination detector.** Constitutionally refused, not deprioritised.
- **Human trust scores as a headline feature.** Evidence records only.
- **A hosted-only verification path.** A proof you must pay to check is not a
  proof.

---

## Guardrail

The temptation, whenever adoption is slow, will be to build something. It always
feels productive and it is always the wrong instinct at this stage.

**One install is worth more than ten features. One GitHub star is worth more
than another architecture diagram. One enterprise pilot is worth more than
another moonshot.**

The build phase is over. The shipping phase has not started.

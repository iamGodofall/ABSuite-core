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

496 tests. 103 API endpoints. 7 npm packages on npm. 6 HTTP services and an MCP
server.

The sentence that used to sit here — *"nothing is installable and nobody has
used it"* — is now half false and half true, and the half that changed is the
easy half:

> **It is installable. Nobody outside the project has used it.**

`npm install @absuitecore/capkit` works, from any machine, with a signed
Sigstore attestation of the commit that built it. That was the whole of Phase 1
and it is done. What has not changed is the number that matters: installs by
people who are not the maintainer.

It is still not a technology problem — those sound like *"we don't know how to
build this."* It is a distribution problem, which sounds like *"we built it, now
people need to find it."* Distribution problems are the better kind to have, and
they are not solved by building more.

---

## Phase 1 — Make it installable

Nothing in later phases is possible until this is done. It is days of work, not
weeks, and none of it is interesting — which is exactly why it keeps being
deferred in favour of building something.

- [x] **Publish the packages to npm.** All seven, with provenance.
- [x] Make the GitHub repository public
- [x] Write an installation guide that works on a clean machine —
      [`GETTING-STARTED.md`](../GETTING-STARTED.md), every command run against
      the release before being written down
- [x] A runnable investigation against the published packages —
      [`examples/incident-forensics.mjs`](../examples/incident-forensics.mjs)
- [x] Host the browser verifier — <https://iamgodofall.github.io/ABSuite-core/verify.html>
- [x] Add npm version and download badges to the README — read live from the
      registry, so they cannot go stale
- [x] Screenshots of the browser verifier, valid and tampered
- [ ] Screenshot of the dashboard
- [ ] Record a five-minute demo: install → issue a token → run an action →
      verify the proof in a browser

**Exit condition:** a stranger can install ABSuite and verify an execution trace
without talking to anyone. **Met** — `npm install @absuitecore/capkit`, then
`node examples/incident-forensics.mjs`.

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

## The next session's goal

> **Make a stranger understand ABSuite in sixty seconds.**

The build question is answered: six services run, 103 endpoints are documented
and 46 documented GET routes were confirmed answering against a live suite. The
open question is a different one, and no amount of further building settles it —
*can someone else understand this in five minutes?*

Nobody adopts a project because it has 496 tests. They adopt it because they
opened the dashboard and understood what it was. That makes the interface the
highest-leverage work in the repository right now, ahead of any remaining layer.

**One scenario, end to end, watchable without reading anything:**

```text
Agent receives a request
  ↓  capability checked
  ↓  governing rule evaluated
  ↓  action performed
  ↓  trace signed and chained
  ↓  evidence verified
  ↓  an unknown identified, with its resolution
  ↓  dashboard updates
  ↓  a human clicks "Explain"
  ↓  conditions shown, trust composition shown
```

If a person can watch that and say *"oh — this is an evidence layer for
automated systems"*, the interface is doing its job. If they cannot, nothing
else on this roadmap matters yet.

**Order of work:** dashboard experience, onboarding, the demo scenario above,
then finishing layers 1–6. Layer 7 is a design exercise before it is a build
one. Layer 8 is frozen — see the Constitution for why it is not a thing that
gets built.

---

## Known limits, written down before anyone hits them

These are correct today and bounded today. They are recorded here because a
limit nobody wrote down is discovered at the worst possible moment, and because
"correct and explicitly limited" is the state this project prefers to "fast and
misleading".

- **`/executions/attention` and `/executions/unknowns` verify every record they
  examine.** Ed25519 verification per record, capped by `limit`, with the cap
  reported in the response. Correct at thousands of records; at millions it
  wants an index on the flagged predicate and a cursor rather than a limit.
  This is the first scaling wall the product will hit, ahead of anything else
  in here.
- **`verifyChain()` walks the entire chain on every call**, and several reports
  call it. Fine while a chain is thousands of records; a checkpointing scheme —
  verify from the last known-good sequence — is the obvious answer and has not
  been built.
- **Governance is recorded, not evaluated.** ABSuite stores which rule permitted
  an action; it does not evaluate policies, version policy documents, replay a
  governing decision, or run approval workflows. That is why Layer 5 is marked
  *partly built* and it is the largest single gap in the layer table.
- **The unknown queue examines a capped window** and says so. It is a sample of
  the work, not a complete inventory of it, until the cursor above exists.

None of these are correctness problems, and none of them are hidden: every
endpoint above states its scope in the response. They are the honest list of
where this stops working well, which is a different document from where it
stops working.

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

The build phase is over. The shipping phase has started, and its first day
produced no new capability at all — a version endpoint that reports the truth, a
scope check that was being silently ignored, a startup warning that prevents a
false tamper alarm, and documentation that no longer claims things the code
cannot do. That is what shipping looks like from the inside.

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

893 tests. 128 API endpoints. 8 npm packages on npm. 5 HTTP services and the room,
a notary, and an MCP server.

The sentence that used to sit here — *"nothing is installable and nobody has
used it"* — is now half false and half true, and the half that changed is the
easy half:

> **It is installable. Whether anyone outside the project has used it is
> UNKNOWN, and the registry cannot settle it.**

`npm install @absuitecore/capkit` works, from any machine, with a signed
Sigstore attestation of the commit that built it. That was the whole of Phase 1
and it is done.

What has not changed is the number that matters, and it is worth being exact
about why it cannot be read off a dashboard. Run `pnpm adoption`. On
2026-08-02 it reported 3,048 downloads across the seven published packages in
thirty days — and **all seven peaked on the same day, the day they were
published, with 11% of the total falling outside it.** That is the shape
registry mirrors, CDN caches and security scanners make. It is not evidence of
a person, and it is not evidence of nobody.

The honest signal would carry a name: a package that depends on one of these,
an issue from somebody who is not the maintainer, a deployment that is not ours
verifying a record. None of those has happened yet.

This paragraph previously read *"nobody outside the project has used it"*,
stated flatly, with no measurement behind it. It was then corrected to *"about
three thousand weekly downloads"*, which read mirror traffic as people. Both
were published without a check, in a repository whose argument is that a claim
nobody can check is not evidence — see [AUDIT.md](AUDIT.md) §3b.

It is still not a technology problem — those sound like *"we don't know how to
build this."* It is a distribution problem, which sounds like *"we built it, now
people need to find it."* Distribution problems are the better kind to have, and
they are not solved by building more.

---

## Phase 1 — Make it installable

Nothing in later phases is possible until this is done. It is days of work, not
weeks, and none of it is interesting — which is exactly why it keeps being
deferred in favour of building something.

- [x] **Publish the packages to npm.** All eight, with provenance — the eighth,
      `@absuitecore/notary`, shipped on 2026-08-02 after the publish workflow
      stopped writing its package list by hand. See [AUDIT.md](AUDIT.md) §3f.
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
- [x] **The two-minute demo** — `pnpm demo`, and
      [`docs/images/two-minute-demo.gif`](images/two-minute-demo.gif) is its
      real output, captured by running it. Fifteen seconds, no services, no
      network. The demo asserts its own result and `pnpm verify` runs it, so it
      cannot rot into a reassuring story about code that stopped working.
- [ ] Record a five-minute walkthrough of the room itself — the cube, a layer,
      a lineage. That one needs a person and a screen recorder.

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

## Where to start next

> **Building is finished. The next thing that moves this project is not in the
> repository.**

Six of eight layers are built and operable, `absuite doctor` finds real problems,
the compliance mapping exists, and every interface view renders with zero runtime
errors. The three items left in [AUDIT.md](AUDIT.md) §5 are real and **none of
them is what stands between this and a first user.**

**Do these, in this order:**

1. ~~**Record the two-minute demo.**~~ **Done** — `pnpm demo`, and the GIF in
   the README is its real output. Fifteen seconds, and it needs nothing
   installed but the package. What remains is not making it; it is putting it
   in front of somebody.
2. **Answer, do not announce.** People ask *"how do I know what my agent actually
   did"* constantly — in the Claude Code and Cursor communities, r/LocalLLaMA,
   n8n forums, HN threads on agent reliability. Reply with the demo and
   [FAQ.md](FAQ.md). Launches are for people who already have an audience.
3. **Take one audit engagement.** [SERVICES.md](SERVICES.md) §1.1 — sellable
   today with zero new code, and [COMPLIANCE.md](COMPLIANCE.md) is the document
   that opens the conversation. One client funds a month.

**Do not build a fourth thing instead.** That is what every previous session did,
and the install count has not moved.

---

## The older goal, kept because it is still the test

> **Make a stranger understand ABSuite in sixty seconds.**

The build question is answered: five services and the room run, 128 endpoints are
documented, and 52 documented GET routes were confirmed answering against a live
suite. The open question is a different one, and no amount of further building
settles it — *can someone else understand this in five minutes?*

Nobody adopts a project because it has 893 tests. They adopt it because they
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

### Dashboard audit — findings from a live snapshot pass

Full brief for the overhaul session: [`docs/UI-OVERHAUL-BRIEF.md`](./UI-OVERHAUL-BRIEF.md).

Taken against the running suite, not from memory. In severity order:

> **Partly resolved.** Identity, Approvals and Watch now have surfaces, and the
> five findings below were written before them. Check against
> [AUDIT.md](AUDIT.md) before acting on any of them.

1. **The notification bell shows fabricated events.** Three notifications are
   hardcoded in component state: *"Dashboard connected to ABSuite services"*,
   *"QuickBench health check passed"*, *"GitHub connector active"*. The second
   is a claim that a check ran and passed. It may never have run. This is
   invented evidence, in the interface of a product whose root principle is that
   nothing may look more complete or more certain than it is. **Delete it or wire
   it to real events. Nothing else on this list matters as much.**
2. **DEMO mode ships fabricated numbers.** `DEMO_BENCHMARK_HISTORY` is
   hand-written latency and throughput data. It is labelled, and the banner is
   honest — but a trust product shipping a mode that displays invented
   measurements is a standing tension with the Constitution. Either remove it, or
   make it structurally impossible to mistake for real (persistent watermark,
   different chrome, values obviously synthetic).
3. **Replay is invisible.** The third pillar the README claims is inside a
   collapsed `<details>` that only exists after a record is selected. A stranger
   never sees it. It should be a visible affordance on the Verify layer.
4. **The Verify screen is half empty** until something is clicked — a blank
   right column facing a list. The first screen of a layer should show its answer
   before any interaction, the way Observe does.
5. **The search box does nothing.** A control that looks capable and is not is
   the same failure as a number that looks measured and is not.

There is also no single overview: the global view lives inside Observe, and
System shows service health. A stranger has no screen that shows everything at
once — which is the first thing the sixty-second test needs.

**Order of work:** dashboard experience, onboarding, then the demo scenario
above. Layers 1–6 are finished — Governance and Autonomy were the last two, and
what closed them was an approval workflow and a watch that reports its own
coverage. Layer 7 is not a build task: the mechanism exists as
[`@absuitecore/notary`](../packages/notary/), and what the layer needs is a
deployment that is not ours. Layer 8 is frozen — see the Constitution for why it
is not a thing that gets built.

That is the shape of the whole project now. **Nothing left on this roadmap is
blocked on code one person can write in a week.** Everything remaining is
blocked on somebody else: an install, a customer, a second deployment. That is a
better problem and a slower one, and no amount of building shortens it.

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
  an action; it does not evaluate policies or version policy documents. That is a
  refusal rather than a gap — a system that both wrote the rule and graded the
  compliance would be marking its own homework — but it means a deployment needs
  a policy engine of its own, and most do not have one. Approval workflows are no
  longer on this list: `REQUIRES_APPROVAL` was a decision nothing could act on
  until `packages/capkit/src/approval.ts`, which is what promoted Layer 5.
- **The watch sweeps in batches and reports how far it got.** `Watch` reads
  forward from a high-water mark, so a large backlog is covered over several
  sweeps rather than in one blocking pass — and `coverage.behind` says how many
  records it has not reached yet. Correct, and slower to first finding on a big
  import than a single full pass would be. The trade is deliberate: a sweep that
  blocks the event loop for three seconds is the same defect `/executions/stats`
  already had once.
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

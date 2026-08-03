# What ABSuite produces, and which obligations it speaks to

A mapping table. For a compliance officer, an auditor, or the person who has to
fill in a questionnaire and would rather not invent the answers.

---

## Read this first, because the rest is worthless without it

**ABSuite produces evidence. It does not confer compliance.**

Nothing in this document says a deployment is compliant with anything. Every row
below says a narrower and more useful thing: *this obligation asks for X; this
endpoint produces X; this field is where X lives; this test is why the field
cannot be quietly forged.* Whether X is sufficient for your system, your
jurisdiction and your risk classification is a legal judgement, and it belongs to
your counsel.

Three consequences of that, stated up front because they are the ones a vendor
usually leaves out:

- **A row in this table is not a control.** It is an input to one. A control is
  a thing your organisation does; ABSuite records that it was done.
- **Most obligations here are only partly served.** Where that is true, the row
  says which part. Where ABSuite has nothing to offer, the obligation is listed
  anyway, in [§5](#5-what-absuite-does-not-help-with-at-all), with nothing beside
  it. A mapping document that only lists the boxes it fills is a sales brochure.
- **Article and clause numbers should be checked against the current text.**
  These were verified against the sources linked at the foot of this document,
  and regulations are consolidated and renumbered. The mapping is the durable
  part; the citation is not.

**Evidence beats assertion, and that is the entire pitch.** Most compliance
artefacts are a person's statement that a control operated. What comes out of
ABSuite is a hash-chained, Ed25519-signed record that an auditor can verify with
a public key, using [a second implementation](../implementations/python/) that
shares no code with the one that wrote it. The claim being made is not "trust
our logs". It is "do not trust our logs — check them."

---

## 1. EU AI Act (Regulation (EU) 2024/1689)

Written for the **deployer** of a high-risk system, because that is who runs
ABSuite. Provider obligations are noted where the evidence is the same.

### 1.1 Article 12 — Record-keeping

> *High-risk AI systems shall technically allow for the automatic recording of
> events (logs) over the lifetime of the system.*

Article 12(2) names three purposes for those logs: identifying situations that
create risk or a substantial modification, facilitating post-market monitoring,
and monitoring the operation of the system.

| What is asked | Where it comes from | The field | Why it cannot be quietly forged |
|---|---|---|---|
| Automatic recording of events | `POST /executions` | the whole record | `trace.test.ts` — a record's hash covers every field in a frozen canonical order |
| Over the lifetime of the system | the chain | `prevHash`, `hash`, `seq` | `frozen-chain.test.ts` — fixtures from earlier versions still verify, so history is not invalidated by an upgrade |
| Events relevant to risk | `GET /watch` | `notices[].kind`, `finding` | `watch.test.ts` — each notice names the field it was read from |
| Post-market monitoring | `GET /executions/stats`, `GET /executions/attention` | counts, with denominators | `server.smoke.test.ts` — a count with no denominator is a defect the build fails on |
| Monitoring operation | `Watch`, sweeping on an interval | `coverage.everRun`, `lastSweepAt`, `behind` | `watch.test.ts` — a watch that never ran reports that, rather than an empty list |

**The part worth showing an auditor.** Article 12 asks that the system *allow*
automatic recording. Any logging library does that. What is unusual here is that
the record is tamper-evident and independently checkable: alter one byte of a
stored execution and `verifyChain` reports the chain broken, and the auditor can
confirm this without a running ABSuite and without trusting the deployer, using
`GET /executions/public-key` and the Python verifier.

### 1.2 Article 14 — Human oversight

The strongest mapping in this document, and the newest. Article 14(4) requires
that oversight enable an assigned person to, among other things:

> *(a) … duly monitor its operation, including in view of detecting and
> addressing anomalies*
> *(d) to decide, in any particular situation, not to use the high-risk AI system
> or to otherwise disregard, override or reverse the output*

| What is asked | Where it comes from | The field | Why it cannot be quietly forged |
|---|---|---|---|
| Detecting anomalies | `GET /watch` | `notices[]`, `coverage` | `watch.test.ts` — a standing problem is one notice seen many times, so the queue stays workable |
| Addressing them | `POST /watch/notices/:id/acknowledge` | `acknowledgedBy`, `basis` | `watch.test.ts` — an acknowledgement with no stated reason is refused |
| Deciding not to proceed | `POST /approvals/:id/decide` with `REFUSED` | `decidedBy`, `basis`, `signature` | `approval.test.ts` — the requester may not decide; a decision with no basis is refused |
| Oversight by a competent, authorised person (Art. 26(2)) | the `approval:decide` scope | `signature`, `signedBy` | `approval.test.ts` — a signature is verified against an enrolled key *before* anything is stored |
| That the oversight actually preceded the action | the approval's `actionHash` | `subject`, `module`, `action`, `inputHash` | `approval.test.ts` — the hash is recomputed from the execution record, so the link is intrinsic rather than asserted |

**This is the row that is hard to buy elsewhere.** Most systems can show that a
human clicked approve. Very few can show *what exactly* was approved, because the
approval and the action are linked by a foreign key the operator controls. Here
they are linked by a hash of the payload: an approval granted for one input does
not cover a different one, and the check runs against the finished execution
record with no approval id written onto it.

An execution recorded under a policy that said `REQUIRES_APPROVAL`, with no
approval behind it, reports Governance as **FAILED** in
`GET /executions/:id/conditions` — not as a gap, and not silently.

**Set `ABSUITE_REQUIRE_SIGNED_APPROVALS=true` if you are relying on this for a
regulated obligation**, and the reason is worth stating plainly rather than
leaving in a footnote.

Separation of duties is enforced on names by default. An approval refuses
`decidedBy === requestedBy`, but one holder of an admin key can supply two
different names and play both parties. The product has always told you which
kind of decision it was — `PROVEN` for a signature checked against an enrolled
key, `ASSERTED` for a name the operator typed — but that distinction lived in a
field, and a field is something a reader has to notice.

With the variable set, it is a gate: an `ASSERTED` decision turns Governance
**FAILED** on a `REQUIRES_APPROVAL` record, and the finding names the deployment
setting that made it so rather than accusing the record of being fake. The
approval is real and recorded; what it is not is evidence of *who decided*.

It is off by default because switching it on retroactively fails every approval
recorded without a signature. Nothing about those records changed — only how
strictly this deployment reads them — and that is an operator's decision to
make, not a default to impose. capkit says which mode it is in at boot, both
ways, because an operator who believes signatures are enforced when they are not
is worse off than one who knows they are not.

### 1.3 Article 19 and Article 26(6) — keeping the logs

> *Deployers … shall keep the logs automatically generated by that high-risk AI
> system … for a period appropriate to the intended purpose … of at least six
> months.*

| What is asked | What ABSuite gives you | What is still yours |
|---|---|---|
| Logs retained ≥ 6 months | An append-only chain in a single SQLite file, with documented schema and working `backup`/`restore` | **The retention itself.** ABSuite does not delete records, and it also does not back them up for you. A lost database file is a lost record. |
| Logs under the deployer's control | The file is yours; the format is [specified](PROTOCOL.md) and implemented twice | Storage, backup schedule, and off-site copies |
| Logs that still mean something later | Canonical forms are versioned and additive; a record this build cannot read reports `checkable: false` rather than "invalid" | Custody of `CAPKIT_TRACE_PRIVATE_KEY`. Lose it and every existing record fails signature verification permanently. |

**Say this part plainly to any buyer.** Long-term retention is an operational
commitment, not a feature, and the one secret whose loss destroys the archive is
named above. It is also why key custody is [a service worth
buying](SERVICES.md#12-deployment-and-integration--built).

### 1.4 Article 26(5) — monitoring, and reporting serious incidents

| What is asked | Where it comes from | Where ABSuite stops |
|---|---|---|
| Monitor the operation of the system | `Watch`, running continuously; `GET /executions/attention` | — |
| Inform the provider when a risk arises | `GET /watch` gives you the finding, with the record it came from | **ABSuite does not notify anybody.** There is no incident, no severity and no escalation path, deliberately: deciding that something is an incident is a judgement, and the product does not make judgements. |

This refusal is written into the [constitution](CONSTITUTION.md) and enforced by
the build — `watch.test.ts` fails if the word *incident*, *severity*, *critical*
or a recommendation appears in a sweep result. It is a real gap against a real
obligation, and pretending otherwise would make every other row here less
believable.

### 1.5 Article 13 — transparency and information for deployers

| What is asked | Where it comes from |
|---|---|
| Output a deployer can interpret | `GET /executions/:id/conditions` — five conditions, each `DEMONSTRATED / FAILED / UNKNOWN / ABSENT`, each naming the field it was read from |
| Characteristics, capabilities and limitations | Every report carries an `unverifiable` list: what this answer cannot tell you, attached to the answer rather than footnoted |
| Not overstating what the system knows | No trust score is displayed anywhere in the interface. `check:fabrication` fails the build if the phrase appears in rendered text — verified by adding one and watching it name the file and line |

**The scope of that check, stated precisely**, because a compliance reader may
test it. `check:fabrication` scans the 53 source files under
`packages/dashboard-ui/src` and matches *rendered* text — a string or JSX node
containing "trust score", "confidence score", "attacks prevented" or an
intelligence rating. It exempts a match preceded by a negation, so the product's
own argument against scoring survives.

It does **not** scan the services. A score computed in `capkit` and returned by
an API would not be caught, which was confirmed by adding such a route and
watching the check pass. The doctrine holds because nothing computes one, not
because a gate would stop it — and an earlier version of this row named the
wrong gate (`check:doctrine`) and claimed a scope of "anywhere".

**Automation bias, Article 14(4)(b), is a design constraint here rather than a
feature.** A single number invites reliance; four words about specific evidence
invite a question. That is why `Trust := f(Identity, Capability, Evidence,
Governance, Time)` is stated with `f` deliberately undefined.

### 1.6 Article 72 — post-market monitoring (providers)

If you are a *provider* rather than a deployer, the same record serves the
monitoring plan: `GET /executions/stats`, `GET /executions/unknowns` and
`GET /watch` are what a monitoring system reads. ABSuite does not write the plan,
and the plan is the obligation.

---

## 2. ISO/IEC 42001:2023 — AI management systems

Annex A holds 38 controls across nine objectives (A.2–A.10). ABSuite is
*evidence for* a subset. Certification is an audit of your management system, and
no tool passes it for you.

| Control | What the auditor wants to see | What ABSuite produces |
|---|---|---|
| **A.2** — AI policy | That a policy exists, is documented, and is applied | `policyRef` and `policyVersion` on every governed execution — the rule is *cited in the evidence*, versioned, and attributable |
| **A.6** — AI system life cycle | Impact and risk handled across the life cycle | `provenance.ts` — which execution's output became which execution's input, stated as evidence of flow rather than proof of intent |
| **A.6** — model changes | That the model in production is the one that was assessed | `model-identity.ts` — a fingerprint recorded at approval, compared afterwards. A silent provider version roll is a `FAILED` attestation, not a surprise |
| **A.9** — use of AI systems | Usage limits and safeguards against misuse | Capability scopes (`capability.ts`), approvals (`approval.ts`), and a record of every action taken under both |
| **A.9** — human oversight | That people oversee, and that oversight is recorded | The approval workflow, with `decidedBy`, `basis` and an optional signature verified against an enrolled key |
| **A.10** — third-party relationships | What your suppliers' systems did on your behalf | Cost and provenance attributed to a subject, under a named authority |

**Where ABSuite is genuinely useful for 42001 is the audit, not the build.** The
standard asks you to demonstrate that controls operated. Most organisations
demonstrate this with screenshots and attestations. A signed, hash-chained record
that an auditor can verify independently is a materially stronger artefact, and
it is the same artefact for every control above.

---

## 3. SOC 2 — Trust Services Criteria

| Criterion | What it asks | What ABSuite produces |
|---|---|---|
| **CC6** — logical access | That access is granted narrowly and removed | Capability tokens: scoped, expiring, centrally revocable, with `GET /executions/authority` reporting authority *that was actually used*, not authority that was issued |
| **CC7** — system operations, anomaly detection | That anomalies are detected and evaluated | `Watch`, sweeping continuously, with coverage stated so an empty queue cannot be mistaken for a healthy one |
| **CC8** — change management | That changes are authorised before they take effect | The approval workflow — request, decision, basis, and a hash binding the decision to exactly what changed |
| **PI1** — processing integrity | That processing is complete, valid, accurate, timely and **authorised** | The execution record: input hash, output hash, outcome, duration, and the authority it ran under |
| **PI1** — integrity of stored records | That stored records and logs are protected | The hash chain. Altering a stored record breaks it, and the break names the record it broke at |

**The word to bring to a SOC 2 auditor is *authorised*.** Processing integrity
criteria ask for it explicitly, and it is the hardest of the five to evidence for
an autonomous agent, because the usual answer — a user id in a log line — is a
string the system wrote about itself.

---

## 4. NIST AI RMF 1.0 — where the evidence lands

The framework is voluntary and organised as four functions. ABSuite serves two of
them and barely touches the others, which is worth saying rather than claiming
alignment across the board.

| Function | ABSuite's contribution |
|---|---|
| **GOVERN** | Policies are cited in the record (`policyRef`, `policyVersion`) and approvals are attributable to a named, optionally key-backed person |
| **MEASURE** | Everything measurable here is a count over records that exist. Nothing is sampled, projected or annualised — see [PERFORMANCE.md](PERFORMANCE.md), where every number was measured on a stated machine |
| **MANAGE** | The watch raises; a person decides. ABSuite records the decision and the reason |
| **MAP** | **Nothing.** Context, purpose and impact framing are organisational work that happens before any of this |

---

## 5. What ABSuite does not help with at all

Listed because a mapping document that omits its gaps cannot be trusted on the
rows it does fill.

- **Conformity assessment, CE marking, technical documentation (Annex IV).** A
  record of what a system did is not a description of how it was built.
- **Fundamental rights impact assessment (Art. 27).** An assessment is analysis,
  performed before deployment, by people.
- **Risk management systems (Art. 9) and data governance (Art. 10).** ABSuite
  never sees training data and makes no claim about it.
- **Accuracy, robustness and cybersecurity (Art. 15).** ABSuite records what
  happened; it does not make a model accurate or a system robust.
- **Whether a decision was correct.** The most important omission on this page.
  Every report states which rule permitted an action and refuses to say whether
  that rule should have existed. A product that graded its own users' governance
  would be marking their homework, and the evidence would be worth less for it.
- **Notification, escalation and incident response.** See §1.4.
- **Any claim about what a model was thinking.** Deliberately refused, with the
  reasoning written down in [INTERPRETABILITY.md](internal/INTERPRETABILITY.md).

---

## 6. The three questions a buyer asks, and the answers

**"Does this make us compliant?"**
No, and a vendor who says yes is selling you a risk. It produces evidence that
specific obligations ask for, in a form your auditor can verify without trusting
you or us. Which obligations apply to you is your counsel's call.

**"Can we prove these logs weren't edited?"**
Yes, and you can prove it to somebody who does not trust you. Every record is
Ed25519-signed and hash-chained; `GET /executions/public-key` is unauthenticated
on purpose; and the format is [specified](PROTOCOL.md) and implemented twice, in
TypeScript and in dependency-free Python, so verification does not depend on us
still existing. A [notary](../packages/notary/) closes the remaining gap — that
the operator holds the signing key — by counter-signing chain heads from outside.

**"What happens when an auditor pushes back?"**
The parts that would embarrass you are already in the record. An unapproved
action under a policy that required approval reads `FAILED`, not "no data". An
unchecked signature reads "not checked", not a green tick. A monitor that has
never run says so instead of showing an empty queue. That is the product working;
if it were tuneable, none of the rows above would be worth anything.

---

## Sources

Verified against the linked texts. Check current consolidated versions before
relying on a number in a filing.

- EU AI Act, [Article 12 — Record-Keeping](https://artificialintelligenceact.eu/article/12/)
- EU AI Act, [Article 14 — Human Oversight](https://artificialintelligenceact.eu/article/14/)
- EU AI Act, [Article 26 — Obligations of Deployers of High-Risk AI Systems](https://artificialintelligenceact.eu/article/26/)
- EU AI Act, [Article 19 — Automatically Generated Logs](https://www.deepinspect.ai/blog/eu-ai-act-article-19-logs) (secondary; check against the official text)
- ISO/IEC 42001:2023, [Annex A controls](https://www.isms.online/iso-42001/annex-a-controls/) (secondary; the standard itself is paywalled)
- AICPA, [SOC 2 Trust Services Criteria](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services)
- NIST, [AI Risk Management Framework 1.0](https://www.nist.gov/itl/ai-risk-management-framework)

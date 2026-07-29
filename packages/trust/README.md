# @absuitecore/trust

Evidence-based trust for multi-agent systems.

Every judgement this package makes is a pure function of recorded events, each
pointing at a verifiable artefact — an execution trace, an audit entry, a
signed attestation. That is the whole design constraint, and everything below
follows from it: a score you can interrogate, contest, and reproduce months
later is evidence. One you cannot is a black-box rating that quietly ruins
someone's day.

```bash
npm install @absuitecore/trust
```

Requires Node 22.5+ (uses `node:sqlite`). Service runs on `:8085`.

---

## What it does

| Capability | What it actually gives you |
|---|---|
| **Trust events** | An append-only evidence store with a working appeals process. |
| **Scoring** | Explainable, time-decaying, confidence-bounded scores — advisory by default. |
| **Output verification** | Grounding and contradiction signals against supplied sources. |
| **Chain monitoring** | Structural facts about agent-to-agent chains: cycles, runaways, stalls, observer disagreement. |
| **Arbitration** | Dispute resolution that discounts correlated agreement and escalates rather than guessing. |
| **Reciprocal contracts** | Obligations that run both ways, so an operator's failures stop being charged to the agent. |

---

## Four things this package deliberately refuses to do

These are the design decisions, not caveats bolted on afterwards. Each one
exists because the obvious alternative causes a specific, predictable harm.

### 1. It does not detect hallucinations

Deciding whether an arbitrary statement is true is open-domain fact-checking.
Nobody can do it, and a product claiming to is a classifier with a confident
voice — the fastest possible route to a customer getting sued after trusting it.

What `verifyOutput` answers instead is a closed-domain question that *does* have
a real answer: **does this output assert things its own sources do not support?**

```ts
import { verifyOutput, renderReport } from '@absuitecore/trust';

const report = verifyOutput(
  'The CEO approved this.',
  ['The Q3 report shows revenue of $4.2M, up 23% year over year.']
);

console.log(renderReport(report));
// Claim:    The CEO approved this
// Evidence: none
//           missing: 0/2 content words in sources
// Status:   UNVERIFIED
```

Four statuses and deliberately no fifth. There is no `LIKELY_FALSE` and no
probability:

| Status | Means |
|---|---|
| `SUPPORTED` | Every checkable element traces to a source. Not "true". |
| `UNVERIFIED` | Evidence is absent. **Not** a claim of falsehood — it may be correct and merely unsourced. |
| `CONTRADICTED` | The output disagrees with itself. The only status asserting a defect. |
| `NOT_CHECKED` | No sources supplied; nothing could be assessed. |

Three signals, in descending order of reliability:

1. **Verbatim anchors** — figures, quotes, DOIs, URLs present in the output and
   absent from the sources. Fabricated numbers and invented citations are the
   highest-cost failure and are exactly detectable, no judgement required.
   Magnitude suffixes count: `$4.2M` and `$4.2B` are different claims.
2. **Lexical grounding** — how much of a claim's vocabulary appears in the
   sources. Weak on its own, so it is reported as coverage with the matched
   terms attached, and never becomes a permanent mark against a subject.
3. **Self-contradiction** — two claims in one output with opposite polarity
   about the same subject, or two values for the same quantity. Needs no
   external truth at all, and is always a defect.

Every report carries a disclaimer stating what was and was not checked. A clean
report means every claim traces to a source — **not** that the output is true.

### 2. It does not gate access by default

`gating` is false unless an operator explicitly turns it on. Scores inform
humans; they do not silently deny anyone. Even with gating enabled, a subject
with confidence below 0.5 is **allowed**, because refusing someone on four data
points is not a decision anyone can defend.

```ts
scorer.check('agent:invoicing', 'agent', 70);
// { allowed: true, advisory: true,
//   reason: 'Advisory only. Score 62/70 (moderate); gating is disabled...' }
```

### 3. It does not score people — it counts what they did

ABSuite will not tell you John has a trust score of 42. `evidenceRecord()`
reports facts:

```ts
scorer.evidence('person:j.smith', 'human');
// { actionsRecorded: 1042, policyViolations: 2,
//   manualOverrides: 1, auditFindings: 0,
//   note: 'These are recorded facts, not an assessment...' }
```

The object has no `score` field and cannot be given one. It needs no flag and
has no off switch, because counting what happened is not the same act as rating
a person.

Producing an actual *score* for a human throws unless
`ABSUITE_TRUST_SCORE_HUMANS=true`. That is an employee-monitoring capability with
real obligations attached — GDPR Art. 22 among them — and a deployment should
acquire it deliberately, not as a side effect of installing a package.

### 4. It does not treat agreement as corroboration

Model errors are *correlated*. Five deployments of one base model fail on the
same inputs in the same direction, so a 5-0 "consensus" among them is one
opinion counted five times wearing the costume of overwhelming agreement.

```ts
arbitrate({
  question: 'Approve the refund?',
  positions: [
    { agentId: 'a1', answer: 'yes', family: 'openai:gpt-4' },
    { agentId: 'a2', answer: 'yes', family: 'openai:gpt-4' },
    { agentId: 'a3', answer: 'yes', family: 'openai:gpt-4' },
    { agentId: 'a4', answer: 'yes', family: 'openai:gpt-4' },
    { agentId: 'a5', answer: 'yes', family: 'openai:gpt-4' },
    { agentId: 'b1', answer: 'no',  family: 'anthropic:claude' },
    { agentId: 'c1', answer: 'no',  family: 'google:gemini' },
  ],
  /* ... */
});
// outcome: 'no_consensus'  — a naive 5-2 vote says "yes" decisively
```

The arbitrator also:

- **weights by recorded behaviour, not by confidence** — self-reported certainty
  is uncorrelated with accuracy and trivially gamed, so its influence is capped
  and it can never decide an outcome on its own;
- **requires the leader to have more independent support than the runner-up**,
  so weight alone never settles a dispute;
- **always escalates an irreversible dispute**, whatever the tally. Deleting
  production data on a majority vote among language models is not shippable.

Escalations come with a brief written for the person who has to decide, ending
with `No action has been taken. This decision is yours.`

---

## Reciprocal contracts

Every governance product in this space constrains the agent. That is necessary
and insufficient — a large share of real incidents are the agent behaving
exactly as instructed on inputs that were wrong. Stale credentials. A tool that
silently changed shape. In each case the agent is blamed for a failure it could
not have avoided, and the actual defect goes unrecorded.

```ts
const trust = new ReciprocalTrust(storage, events);
const contract = trust.establish('agent:invoicing', 'acme-corp');

trust.recordBreach(contract.id, 'valid_credentials', 'API key expired three days ago');

trust.health(contract.id);
// { faultAttribution: 'operator',
//   recommendation: '...The agent is largely failing because of its
//                    environment; fixing the environment will do more than
//                    constraining the agent further.' }
```

Five obligations each way. An operator breach is recorded against the operator
and **never** charged to the agent's score — attributing a fault to the
component that cannot fix it is both unfair and diagnostically useless.

---

## Appeals

A score nobody can challenge is a blacklist.

```ts
const appeal = events.appeal(eventId, 'agent-owner@acme', 'Caused by an expired operator credential');
events.decideAppeal(appeal.id, 'reviewer@acme', true, 'Upheld — operator fault');
```

Upholding an appeal neutralises the original event and records a *repairing*
event, so a wrongly penalised subject ends up no worse off than before. The
original is never deleted: the record of what happened, mistake included, has
to survive.

---

## Chain monitoring

Records structural facts about who invoked whom — facts that are true
regardless of anyone's judgement, which is why they can be trusted without
trusting any agent involved.

```ts
monitor.summarise('chain_abc');
// anomalies: [{ kind: 'cycle', severity: 'critical',
//               detail: 'Agents call each other in a loop: a -> b -> c -> a...' }]
```

Detects cycles, excessive depth, runaway fan-out, stalls, and **observer
disagreement**. Disagreement is surfaced, never resolved by majority — two
observers splitting on the same evidence is exactly where a human should look,
and quietly picking the more numerous side throws away the only signal that
mattered.

---

## HTTP API

See [`docs/API.md`](../../docs/API.md) for the generated reference. Every route
is guarded by the same `capabilityGuard` the rest of the suite uses — a service
that grades other services is the last one you want reachable without a token.

Scopes: `trust:read`, `trust:write`, `trust:verify`, `trust:arbitrate`,
`trust:appeal`, `trust:manage`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `TRUST_PORT` | `8085` | Listen port |
| `ABSUITE_DB_PATH` | in-memory | SQLite file, shared with the rest of the suite |
| `CAPKIT_HMAC_SECRET` | — | Required; verifies capability tokens |
| `CAPKIT_ADMIN_KEY` | — | Bootstrap credential |
| `ABSUITE_TRUST_SCORE_HUMANS` | `false` | Permit scoring human subjects |

## Licence

MIT

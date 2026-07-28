# Roadmap Verdict — point by point

> You asked what I agree with, what I disagree with, and what I would do
> differently. Here is every item from the strategic conversation, judged
> against what is actually built and what the market actually shows.
>
> Written 2026-07-28.

---

## Headline: you are further along than the roadmap thinks

The 10-item flagship roadmap lists things as future work that **already exist in
this repository**. Building them again would be pure waste.

| # | Roadmap item | Reality |
|---|---|---|
| 1 | **Black Box Recorder** | ✅ **Built.** `capkit/trace.ts` records subject, capability `jti`, scopes, module, action, input hash, output hash, timing, steps, outcome for every real action. |
| 2 | **Replay Engine** | ✅ **Built.** `replayManifest()` and `compareReplay()` confirm a re-run produced identical output. |
| 3 | **Execution Certificates** | ✅ **Built.** Every trace is Ed25519-signed and hash-chained. That *is* an execution certificate. |
| 4 | **Evidence Engine** | ✅ **Built.** `/executions/verify`, `/executions-verify-chain`, and a browser verifier needing no server or account. |
| 5 | Hallucination Detection | ❌ Not built — and I disagree with building it. See §3. |
| 6 | Trust Scores | ❌ Not built — build the evidence, not the verdict. See §4. |
| 7 | AI-to-AI Monitoring | ❌ Not built — no customer has asked. |
| 8 | Human Trust Scores | ❌ Not built — actively risky. See §4. |
| 9 | Reciprocal Trust Framework | ❌ Not built — the insight is right, the product is not. |
| 10 | Multi-AI Arbitration | ❌ Not built — see §5. |

**Four of the ten flagship capabilities are done.** They are the four that
matter, and they are the four nobody else combines.

---

## 1. What I agree with — strongly

**"Intelligence will become cheap. Trust will become expensive."**
This is the best line in the entire strategy and it is correct. It should be the
first sentence of the README, the pitch, and any conversation with a buyer.

**Minimal core, modular expansion; core never depends on modules.**
Correct, and already true — verified: CapKit has zero workspace dependencies and
all five other packages depend on it.

**Open-core licensing.** Correct. The line is already drawn in the right place.

**"The biggest risk is trying to build everything at once."**
The single most valuable sentence in the whole conversation.

**Publish first, then GitHub, then docs, then adoption.**
Correct ordering. This is the only thing currently blocking progress.

**"Build something people cannot operate without."**
The right ambition, and the right reason to prefer infrastructure to apps.

---

## 2. What I disagree with — the "Supreme Vision"

Distributed execution networks, capability marketplaces, tradable capabilities,
cross-organisation interoperability, protocol standardisation.

**Disagree as a build plan.** Not because it is wrong about the future, but
because it contradicts the same conversation's own best advice. That document
appeared immediately after the question *"can we be more?"* — the scope grew
because the question invited it, not because the project changed.

Keep it as a description of what success might look like in a decade. Schedule
none of it. Standards are *recognised*, never *declared* — the only route there
is adoption first.

---

## 3. Hallucination detection — disagree

It sounds adjacent to trust, but it is a different product:

- It needs model evaluation, ground-truth sources and benchmark data — none of
  which ABSuite has or should have
- The field is crowded with funded specialists
- It dilutes a claim that is currently sharp: *"we prove what happened"* is
  provable. *"we detect when the model was wrong"* is a research problem you
  would be judged on and would sometimes fail

ABSuite's power is that its claim is **binary and checkable**. A signature either
verifies or it does not. Do not trade that for a probabilistic claim.

---

## 4. Trust scores — partially disagree, and this one matters

The reciprocity insight is genuinely good. Trust *is* maintained rather than
granted once; banks re-underwrite, and treating trust as static is a real error.

But **scoring humans is a different business with different hazards:**

- **It is surveillance.** A human trust score is an employee-monitoring product.
  Different buyers, different regulation, different ethics.
- **GDPR Article 22** restricts significant decisions made by automated
  processing. A score that gates someone's access is squarely in scope.
- **It launders judgement as measurement.** "Trust: 62" *feels* objective. It is
  usually a proxy for something nobody wrote down.
- **Any score becomes a target** and stops measuring what it measured.
- **Contestability.** Someone scored down must see why and be able to appeal.
  Without that it is not governance, it is a blacklist.

**Recommendation: record evidence, never issue verdicts.** Traces, approvals,
overrides, policy violations — those are facts, and facts are what you are
already excellent at. Let the customer's own policy compute a score if they want
one.

Selling evidence is defensible. Selling judgement about people is a liability —
and it would put the credibility of everything else at risk.

---

## 5. Multi-AI arbitration — disagree on timing

"Route to the best model, cross-check, report agreement" is a genuinely
interesting product. It is also:

- A months-long build
- A different buyer from the compliance buyer
- Competing with every agent framework and router that already exists
- Impossible to do well without usage data you do not yet have

Revisit if paying customers ask. Not before.

---

## 6. Insurance angle — agree it is real, disagree it is now

"Insurers price ABSuite-verified systems lower" is a genuinely strong long-term
idea, and the reasoning is sound: insurers price what they can measure.

But insurers underwrite against **actuarial data**, which requires years of
incidents across many customers. It is a consequence of success, not a route to
it. File it; do not chase it.

---

## 7. The three futures — agree, with one correction

Infrastructure company / governance company / standard. All three are plausible
and all three run through the same near-term work.

One correction: they are not alternatives you choose between now. They are the
same road at different distances. Publishing to npm this week serves all three
identically.

---

## 8. Where the strategy is silent, and shouldn't be

The conversation never mentions competitors. Research shows several shipping
today: AgentLens (MIT, MCP-native, hash-chained), Attestix (EU AI Act, W3C
credentials), nono (Merkle trees), and Arcade.dev (funded, agent auth, $25/mo).

This does not invalidate ABSuite. It sharpens it:

- Arcade **enforces** without attesting
- AgentLens **attests** without enforcing
- **ABSuite does both with one credential**
- And it signs with **Ed25519**, where the hash-chain projects prove only that a
  record was not edited — not who wrote it

Any strategy written without knowing the competitors is guessing. See
`docs/MARKET.md`.

---

## 9. What I would add that the strategy missed

1. **The browser verifier** (`docs/verify.html`) — already built. Ten seconds of
   experience beats ten paragraphs of claim.
2. **The MCP server** — already built. MCP is how agents get tools now; this puts
   ABSuite inside the agent stack rather than beside it.
3. **npm provenance** — the publish workflow signs a verifiable record of which
   commit built each package. A trust product should be trustworthy about itself.
4. **Per-tenant rate limiting** — not built. One tenant can still saturate a node.
5. **A tested restore** — not built. Untested backups are not backups.

---

## 10. The one disagreement that matters most

The strategy treats **building** as the constraint.

It is not. Six packages exist, 246 tests pass, everything is publish-ready. The
constraint is **distribution** — nothing is installable yet, and no one has used
it.

More features will not fix that. Publishing will.

> **Ship what exists before building what does not.**

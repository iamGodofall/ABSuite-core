# Interpretability, and why it is not a ninth layer

A decision record. Written after a proposal arrived to add *Interpretability*
to the constitution as a layer between Collective Intelligence and
Civilization, on the strength of Anthropic's `jacobian-lens`.

The proposal is refused. The capability behind it is not.

## What was verified, and what was not

The repository is real: **`anthropics/jacobian-lens`**, ~1.6k stars, Python,
companion code for the paper *"Verbalizable Representations Form a Global
Workspace in Language Models."* It is labelled a **reference implementation,
not maintained and not accepting contributions.**

That matters because the proposal arrived with citations that were a SourceForge
mirror and a Reddit thread, every link carrying a `utm_source=chatgpt.com`
marker, and no link to a paper or an Anthropic page. The claim turned out to be
true and the sourcing was still bad, which are not in tension: a correct
conclusion reached from unverifiable citations is a coin that landed the right
way up.

The rule this repository already applies to figures applies to strategy. Nothing
enters `CONSTITUTION.md` on a citation nobody opened.

## What the tool actually does

```
lens_l(h) = unembed( J_l @ h ),    J_l = E[ ∂h_final / ∂h_l ]
```

A residual-stream vector at some layer and position is transported into the
final-layer basis by a Jacobian **averaged over a text corpus**, then decoded
through the model's unembedding into ranked vocabulary tokens.

Three properties follow, and all three constrain how ABSuite could ever use it:

1. **It is linear.** A transformer is not. The lens is a linear approximation of
   a non-linear process.
2. **The Jacobian is an expectation.** `J_l` is averaged over a corpus, not
   computed for the token in front of you. The readout is therefore a
   corpus-level tendency applied to a specific activation, not a measurement of
   that activation's effect.
3. **The output is ranked tokens.** Not concepts, not intentions — vocabulary
   items ordered by a projection.

So the honest description of a readout is: *under a linear approximation fitted
on a corpus, this activation projects toward these tokens.* Anything shorter
than that is a claim the method does not support.

## Why it is not a layer

Three reasons, in order of how much they cost to ignore.

**It cannot be DEMONSTRATED.** This system has four states, and the strongest —
`DEMONSTRATED` — means checked and held. A Jacobian-lens readout can never reach
it. Not because the tool is weak, but because there is no ground truth to check
it against: nothing can confirm that the tokens a linear projection favours were
in any sense what the model was doing. A layer whose every reading is
permanently `UNKNOWN` is not a layer of this architecture. It is an observation.

**It requires open weights.** The repository fits lenses on open-weights decoder
transformers — Qwen and other HuggingFace models. The models most ABSuite
deployments will actually govern are closed. A layer that is structurally
unavailable for the majority of its subjects is not a layer; it is a capability
that some deployments have.

**The constitution has eight layers and the cube has eight vertices.**
`scripts/gen-architecture-layers.mjs` fails the build on any other number, by
design, because the roadmap and the interface must not drift. Adding a ninth is
not a documentation edit — it changes the primary interaction model. And it
would be `NOT_BUILT` for years, on a roadmap that already carries two. Adding a
word to look further ahead is the exact move the first constitutional line
forbids.

## Where it does belong

**Inside Verify, as a fourth verification target.**

Verify's question is *"has any of it been altered?"* and it currently answers
that about three things: the input, the output, and the chain. Model internals
are a fourth, and the framing that survives is not *what was it thinking* but
*is this the model it claims to be*:

| Target | Question | Status |
|---|---|---|
| Input | Does the payload match its recorded hash? | Built |
| Output | Does the result match its recorded hash? | Built |
| Chain | Has the record been altered since it was written? | Built |
| Model | Is this the model whose behaviour was approved? | Not built |

That last row is the useful one, and it is a *governance* question rather than a
psychological one. The same technique that reads a representation can be used to
edit one — the public demonstrations of swapping a concept and getting a
different factual answer are the interesting case here. An operator who approved
a model has an interest in knowing it is still that model. That is squarely
ABSuite's business, and it needs no claim about thought whatsoever.

If it is ever rendered, the language is fixed in advance:

```
LATENT PROJECTION        not   MODEL THOUGHT
under a linear lens            the model believes
tokens, ranked                 concepts, active
```

## The thing worth building first

A second proposal arrived alongside this one: a *Compute Operations* room, with
GPU utilisation, monthly burn, projected capacity and provider exposure.

Also refused as a room, and for a plainer reason — ABSuite measures none of it,
so every field would read `ABSENT` on the day it shipped. The mock-up as
written (`GPU Utilization: 84%`, `Monthly Burn: $48,312`) is the precise shape
`check-no-fabrication.mjs` was written to reject.

But the question underneath it is excellent, and it is not a room. It is a
field:

> Which agent spent $8,000 on inference yesterday?

Every execution already records a subject, a module, an action, and the
capability token that authorised it. Add cost to the trace and that question is
`/executions/stats` grouped by subject — signed, chained, and attributable to
the agent that caused it.

A dashboard of GPU gauges is somebody else's product. **Attributing spend to the
agent responsible, with a record that proves it, is this one's.** It should be
built before either of the layers proposed above.

## Decision

| | |
|---|---|
| Add Interpretability as layer 9 | **No.** Eight layers stand. |
| Support the technique | **Yes**, as an optional Verify capability, never a dependency. |
| Claim it shows reasoning | **No.** Ranked tokens under a linear lens, and said that way. |
| Add a Compute Operations room | **No.** Nothing behind it yet. |
| Add cost to the execution record | **Yes.** Highest-value item of the three. |

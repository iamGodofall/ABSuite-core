# Two provider registries, one of them stale

A finding, written down because it spans two repositories and therefore neither
one's own checks can see it. `npm test` passes in both. `tsc` is clean in both.
Nothing is broken today. It is the shape of the thing that is wrong.

---

## What exists

**`ABSuite-core`** — `packages/capkit/src/llm-provider.ts`, 285 lines. Reports
which providers a deployment is configured to reach, derived from environment
variables. Published, in `@absuitecore/capkit`, with CI and provenance behind it.

**`A.I.A.N.`** — `src/ai/catalog.ts` and `src/ai/index.ts`, 489 lines together.
The same providers, plus per-million-token pricing, `freeTier` flags, a budget
ceiling, automatic fallback when one is down or over budget, and a token
estimator. Not published anywhere.

**Both export a function called `describeProviders`.** Neither imports the
other. Neither mentions the other.

---

## The drift, measured

| provider | `llm-provider.ts` default | `catalog.ts` |
|---|---|---|
| zhipu | `glm-4` | `glm-4.6`, `glm-4.5-air` |
| anthropic | `claude-sonnet-4-5` | `claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5`, `claude-fable-5` |
| gemini | `gemini-2.0-flash` | `gemini-2.5-flash-lite`, `gemini-2.5-flash` |
| moonshot | `kimi-k2` | `kimi-k2-turbo-preview`, `kimi-k2-0905-preview` |
| groq | `llama-3.3-70b-versatile` | agrees |
| deepseek | `deepseek-chat` | agrees |

**Four of six disagree**, and the published package is the one that is behind.
The zhipu row is the one that bites soonest: GLM is what is actively being built
on, and this package would name a model two releases old.

---

## Why neither repository can catch this

Both sibling repositories open their working rules with this exact failure.
`mandalorian-project`:

> **The same function defined twice, with the linker choosing.** This has
> shipped here three times… Before adding a function, grep for it.

Flappy Bird Galaxy:

> **Two systems drawing the same thing.** Before writing a renderer, grep for an
> existing one. Before fixing a renderer, confirm it is the one on screen.

Both rules assume one repository. A `grep` inside `ABSuite-core` finds one
registry and concludes it is the only one. The duplication is only visible from
outside both, which is why it survived long enough to drift four rows.

---

## What was NOT done, and why

**The model ids were not corrected.** A published package's defaults are what
its callers actually send. Copying a value across from the other file would look
like a fix and be a guess — this repository's own rule about `plan_code` says
the same thing in a different context: *mapping a value by a table kept in step
by hand grants the wrong thing silently.*

Verifying each id needs the provider's own current documentation, which is a
five-minute job for someone with a browser and not something to fabricate.

---

## The resolution, when it is worth doing

Not urgent. Nothing is broken; the risk is that the gap widens.

1. **Decide which registry survives.** `catalog.ts` has the better model — cost
   governance is the whole point for an operator running on free tiers, and
   `llm-provider.ts` has none. `llm-provider.ts` has the better home: published,
   versioned, signed.
2. Likely answer: **`catalog.ts`'s capabilities, in ABSuite's package.** Either
   folded into `capkit` or as a tenth package, `@absuitecore/providers`.
3. Verify every model id against its provider's documentation on the day.
4. Delete the loser. Two registries maintained by hand is the state that
   produced this table.

**And it earns its keep beyond these two repositories.** The Coordinator in
`Link` needs exactly this — natural language in, a model call out, on a budget.
So does anything else built on GLM. One registry with pricing and fallback is a
component several projects can take; two half-registries are a maintenance tax
paid twice.

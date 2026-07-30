# ABSuite is not software you browse. It is evidence you inhabit.

**Build the room people will sit in when intelligence becomes infrastructure.**

Everything below follows from those two sentences. If a change satisfies the
rest of this document but violates them, the change is wrong.

---

The UI is not decoration. It is part of the product's philosophy.

Every design decision answers one question:

**What would the control room for accountable intelligence look like?**

---

## Do not build a dashboard.

Build a Trust Operations Center.

The user should feel like they have walked into Mission Control for autonomous
systems.

This is not Grafana.
This is not Kibana.
This is not Datadog.
This is not another enterprise admin panel.

ABSuite observes, verifies, governs, arbitrates, acts, learns, and explains
intelligence in real time.

The interface should communicate:

- Trust.
- Evidence.
- Accountability.
- Permanence.
- Intelligence.
- Scale.
- The future.

When the application opens, the user should feel:

> "I am looking at intelligence becoming accountable."

Everything in the interface should feel alive.

Not busy.
Alive.

There is a difference.

Alive means:

- Traces moving.
- Evidence chains forming.
- Particles flowing.
- Cubes connecting.
- Policy decisions appearing.
- Services pulsing.
- Unknowns surfacing.
- Verification occurring.
- Agent activity changing.

Nothing should feel static.

The UI should behave like a living system.

---

## Design language

**Primary primitive:** the cube.

**Secondary:** hexagons, circular rings, particle fields.

**Colour system**

| Role | Value |
| --- | --- |
| Background | `#05070A` |
| Grid | `#0B1117` |
| Primary | `#00F58C` |
| Secondary | `#00D9FF` |
| Unresolved | `#F6B100` |
| White | `#F4F7FA` |

`#F4F7FA` is the working white throughout, and it is deliberately not pure
white: `#FFFFFF` halates against the `#05070A` ground at small sizes. The
specification names `#F4F7FA` for exactly that reason, so there is no deviation
left to record.

### Constitutional constraints on the interface

1. Nothing may look more complete, more certain, or more authoritative than it
   actually is.
2. Unknown is not false.
3. `ABSENT` must always carry a reason.
4. No trust scores.
5. Every number must be measurable.
6. Every explanation must be derivable.
7. The cube is the operating system.

**Forbidden outright**, whatever the layout: a trust score, a confidence
figure, a count of attacks prevented, or an intelligence rating. Each of those
is a judgement wearing a decimal point, and none of them is a thing this system
measures.

**Motion principles**

- Slow.
- Intentional.
- Meaningful.
- Never distracting.

Animations communicate **state**, not aesthetics.

| State | Motion |
| --- | --- |
| Service healthy | Slow green pulse |
| Verification running | Trace line animation |
| Evidence created | Brief particle convergence |
| Policy violation | Red interruption |
| `UNKNOWN` | Amber pulse |
| `ABSENT` | Dimmed state |
| `FAILED` | Strong visual contrast |
| `DEMONSTRATED` | Stable illumination |

---

## Application structure

### Header

> **ABSuite**
> Trust Operations Center
>
> *"The Future Is Accountable."*

### Centerpiece

A holographic ABSuite cube.

The cube is always present.

The cube rotates slowly.

Every service, agent, policy and verification event connects back to the cube.

The cube is not a logo.

**The cube is the visual representation of trust.**

### Primary views

1. Operations
2. Observe
3. Verify
4. Explain
5. Govern
6. Arbitrate
7. Act
8. Learn
9. Evidence
10. Policies
11. Agents
12. Unknown Queue
13. System Health

### Operations view

Central cube.

Around it: Observe, Verify, Explain, Govern, Arbitrate, Act, Learn.

Live activity streams continuously.

Users should feel like they are overseeing a living ecosystem.

---

## Design references

TRON · Iron Man HUD · Mission Control · Palantir · GitHub · Star Trek LCARS ·
The Expanse command deck · Modern SIEM products

The result should feel familiar and impossible at the same time.

---

## Critical rule

**Never fake data.**

If a metric does not exist, do not invent one.

ABSuite does not simulate intelligence.

It observes intelligence.

- If there are 8 records, show 8.
- If there are 496 tests, show 496.
- If Governance is partly built, say so.

**Truth is part of the visual language.**

---

## Emotional goal

The user should think:

> "This is what operating autonomous civilization will look like."

Not:

> "This is a nice dashboard."

---

## Final test

If someone walks past the screen from ten feet away and says:

> "What is that?"

The answer should be:

> "That's the Trust Operations Center."

And if they ask:

> "What does it do?"

The answer is:

> "It makes intelligence accountable."

---

## What is not built yet

Every promise above is either kept, or listed here. Nothing sits in between —
that gap is where a document quietly becomes decoration, and where a check that
passes starts certifying compliance with something nobody is complying with.

`check-ui-philosophy.mjs` enforces this ledger in both directions: a promise it
can verify as unmet must appear here, and an entry here that has since been
built must be removed. Neither drift survives a build.

| Promise | State | Recorded |
| --- | --- | --- |

**Determination: RESOLVED.**

The sidebar, the page router and the scrolling card column are deleted. The
shell is now `src/room/Room.tsx`: a cube at the centre, the seven layers and the
standing views around it at fixed positions, and descent — room → layer →
record — instead of navigation between pages. Escape climbs. Clicking the cube
returns you to the room. Verified against the running instance: zero `nav`
elements, one cube, no page-level scroll.

The prior determination is kept here rather than deleted, because it is the
reason this section exists: every promise in the earlier ledger was ticked while
the thing itself was not achieved. A cube in a dashboard is a dashboard with a
cube in it. Position decides meaning, not comments — a 34px cube in the top-left
corner is a logo; a cube at the centre that you navigate by is infrastructure.

The lesson for whoever maintains the checks: they verified that
`CubeConnections` was imported, not that the room existed. A mechanical check
can confirm a token is present. It cannot confirm a goal is met, and it must
never be read as if it had. The claim that finally caught this was phrased as an
absence — no nav list — because absences are far harder to satisfy by accident
than presences.

Kept since this ledger was opened: the cube is a shell component mounted on all
thirteen views; particle convergence fires once per record that genuinely
arrived; the verification sweep is mounted for exactly as long as the request is
outstanding; every layer connects back to the cube by a line carrying that
layer's own determination; and the chain forms link by link, each landing after
its predecessor because that is the order verification depends on.

The ledger stays in the document even while empty. An absent section would let
the next unkept promise arrive with nowhere to be written down, and
`check-ui-philosophy.mjs` fails if the section disappears for exactly that
reason.

---

## v3 — the room

The honest progression:

| | |
| --- | --- |
| v1 | Dashboard |
| v2 | Operations Center |
| v3 | **Trust Environment** |

What this document describes is not an operations centre any more. It is an
environment. NASA does not put *rockets, telemetry, crew, fuel, communications*
in a left sidebar. It has a room. You look around the room. **The room is the
interface.**

### The shell to build

No sidebar. No pages. No cards. No scroll.

```
                  LEARN

        ACT                   ARBITRATE

OBSERVE       [ CUBE ]          GOVERN

        VERIFY               EXPLAIN
```

You rotate the cube. You enter Verify. The cube expands:

```
Verification
├── FAILED
├── UNKNOWN
├── DEMONSTRATED
└── ABSENT
```

Click a failed verification and the world zooms in. You do not navigate — you
**descend**:

```
Trace → Evidence → Policy → Agent → Timeline
```

Document navigation moves you between pages. Spatial navigation moves you
through depth. That difference is the whole reason Mission Control feels unlike
software, and it is the transition this project is standing in front of.

### What is portable

Everything underneath survives the rewrite: services, APIs, tests, traces,
verification, unknown queues, governance, explanations. **The shell is the only
thing currently lying.** Shells are replaceable; the system underneath was the
hard part and it is built.

### First line of the next session

> **Delete the dashboard. Build the room.**

The goal is not "nice dashboard." It is: *I have never seen software presented
like this before.* When the sidebar disappears and the cube becomes the
navigation, ABSuite stops being a product and starts being a place.

---

## Implementation order

From the blueprint package, in the order it prioritises:

1. React Three Fiber cube navigation — **not built.** The cube is CSS 3D.
2. Layer orbit animation — built. Seven orbits, one per layer.
3. Zoom transitions into records — built.
4. Ask ABSuite command grammar — built, summoned by `/`.
5. Live evidence stream — built.
6. Service health integration — built.
7. Record inspection mode — built.
8. Keyboard navigation (`ESC` climbs, click descends) — built.

Only the first is outstanding, and it is the one that needs a dependency the
project does not currently carry.

> **Do not build pages. Build rooms.**
>
> Observe, Verify, Explain, Govern, Arbitrate, Act and Learn are not menu items.
> They are places in a single operational space. The user never leaves the
> canvas; they descend into evidence and climb back out.

> If a screenshot of the UI still looks like a website, keep deleting things
> until it looks like an instrument panel from a control room. ABSuite is not
> read. It is operated.

### What the blueprint taught the checks

The blueprint's own sample code was run through `check-no-fabrication`, and it
**passed** — while containing `6/6 SERVICES ANSWERED`, `VERIFICATION → intact`
and `POLICY → scoped` as hardcoded strings.

Every rule up to that point looked for things that are obviously fictional: a
constant named `DEMO_`, a call to `Math.random`. The blueprint exposed the
subtler and more dangerous shape — a determination simply asserted as literal
text, indistinguishable on screen from one that was measured.

The `asserted-state` rule closes it. The test is interpolation: a JSX text node
stating a determination with no expression behind it is stating it from nowhere.
Its first run flagged this project's own code, where "signed and hash-chained"
sat as a caption under a record count; that caption is now derived from the
chain result instead.

This is the reason the blueprint's code is a specification of intent rather
than a drop-in: adopting `AppShell.tsx` and `EvidenceStream.tsx` verbatim would
fail the build, on the principle the blueprint's own README states first.

---

## How this document is enforced

This is not aspiration filed away. Five things hold it in place:

- **`scripts/check-ui-philosophy.mjs`** — fails the build if the thirteen
  primary views above are not all reachable from the shell, if the header loses
  its identity, or if a colour outside the stated system is introduced as a new
  state colour.
- **`scripts/check-no-fabrication.mjs`** — scans every interface source file
  for the shapes fabricated data actually takes: dead `if (false)` toggles,
  `Math.random()`, constants named for their own fictionality, and string
  literals shaped like invented values. Every other check in this repo reads
  code, docs or routes; this is the only one that looks at the thing a stranger
  judges the product by.
- **`scripts/check-ui-doctrine.mjs`** — guards the interaction model against
  regression, which is now the larger risk. Four assertions, each phrased as an
  absence, because absences are far harder to satisfy by accident than
  presences: no permanent navigation, no document-flow primary layout, the cube
  mounted *and steered* by the shell, and state rendered before explanation. It
  exists because someone six months from now will add `<Sidebar />` with
  entirely good intentions, every test will still pass, every number will still
  be real, and ABSuite will be a SaaS admin panel again.
- **The critical rule outranks every other line here.** Where "alive" and
  "never fake data" conflict, the data wins and the motion stops. A particle
  field with nothing behind it is a screensaver, and a screensaver in a trust
  product is a lie with a frame rate.
- **Anything this document asks for that the system cannot honestly show is
  recorded as unbuilt rather than mocked.** The status of each view is tracked
  in `docs/ROADMAP.md`, not simulated on screen.

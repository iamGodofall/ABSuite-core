# Social card — copy deck

**Status: locked.** The card below is the approved one. This document is the
single source for regenerating it, so that a future version cannot reintroduce
the errors earlier ones carried.

The exact strings for the repository's social preview image.

**Canvas: 1280 × 640 px (2:1).** This is GitHub's social preview ratio. The first
version was 3:2, and every surface that unfurls a link — GitHub, X, Slack,
LinkedIn — centre-crops a 3:2 image into a 2:1 card. On that version the crop
would have removed the bottom principles bar and most of the install command,
which is to say the two most useful rows on the image.

Upload at **Settings → General → Social preview**.

---

## What was wrong the first time

Recorded so it is not repeated, and because both errors are the kind this
project's build gates exist to catch.

| On the image | The problem |
|---|---|
| `npm i @absuite-core` | Not a package. The scope is `@absuitecore` with no hyphen, and a scope alone is not installable. Typing it gives `E404` — in the primary call-to-action position. |
| "Decentralized identity & capability tokens" | A claim the repository does not make anywhere, and does not implement. There is no DID, no ledger, no cross-registry resolution. |
| Node colours | Verify gold, Explain cyan, Arbitrate amber, Act red, Learn violet. In the product only Govern matches. Red on Act reads as failure in an interface where red *means* FAILED. |

The identity one matters most. Putting an unearned claim on the cover of a
product whose first constitutional line is *nothing may look more certain than it
is* hands the strongest available criticism to the first person who checks.

---

## The strings

### Wordmark

```
ABSuite
TRUST OPERATIONS CENTER
```

### Headline

```
ABSuite does not tell you
what to believe.
It tells you what can be proven.
```

"proven" in cyan. This is the headline rather than a strapline, and that is the
most important decision on the card: a social preview is mostly seen small — a
feed, a Slack unfurl, a link card four hundred pixels wide — and at that size a
reader gets the wordmark, the cube, and **one line of text**. Everything else is
texture. This is the line that has to survive the shrink, so it is the largest
thing on the card.

### Sub-headline

```
An open-source platform for verifiable, governed and explainable autonomy.
```

### The thesis

Directly beneath the sub-headline, and also the first line of the README.

```
Intelligence is becoming cheap.
Trust is becoming expensive.
```

Present tense. *Will become* is a prophecy, and this project does not predict —
it is an observation about now, which is the only kind of claim the rest of the
product is allowed to make.

Set the second line in gold. Note the deliberate exception: gold is `UNKNOWN` in
the interface's state palette, and here it is being used for its older meaning —
*precious*. That works because nothing on this card is a state readout. It would
not work inside the product.

### Install — deliberately absent

The locked card carries **no `npm` command**. On the repository's own preview the
URL is the call to action, and omitting the command removes the string that was
wrong the first time.

If a future variant does carry one, it is exactly:

```
npm i @absuitecore/capkit
```

Scope `@absuitecore`, no hyphen, package name included. A scope on its own is
not installable.

### Repository

```
github.com/iamGodofall/ABSuite-core
```

---

## The seven operations

Numbered, in this order — the order trust is built, which is also the order the
console navigates.

| # | Name | Line beneath |
|---|---|---|
| 1 | OBSERVE | Capture every action |
| 2 | VERIFY | Prove integrity cryptographically |
| 3 | EXPLAIN | Make it understandable |
| 4 | GOVERN | Enforce rules and protect integrity |
| 5 | ARBITRATE | Resolve with evidence |
| 6 | ACT | Execute with confidence |
| 7 | LEARN | Improve with every cycle |

### Their colours

From `packages/dashboard-ui/src/room/SceneCube.tsx`. A developer who sees the
card and then opens the product should not have to relearn the palette.

The locked card matches five of seven: Observe green, Verify blue, Explain
white, Govern gold, Act green. Arbitrate and Learn are violet on the card and
are the accepted deviation — see below.

| Operation | Hex | |
|---|---|---|
| Observe | `#00F58C` | signal green |
| Verify | `#3B82F6` | blue |
| Explain | `#FFFFFF` | white |
| Govern | `#F59E0B` | gold |
| Arbitrate | `#5B8CA8` | slate |
| Act | `#00F58C` | signal green |
| Learn | `#00F58C` | signal green |

**Red is not available for a node.** In this interface red means FAILED. A red
ACT node tells a viewer that execution is broken — an earlier version had exactly
that, and it is the one colour rule that is not negotiable.

**The accepted deviation.** In the product Observe, Act and Learn are all the
same signal green, so a seven-colour ring implies seven categories the palette
does not have. It is kept anyway: the ring reads as seven distinct operations,
which is true, and it is more legible at card size than three identical greens.
The one thing to improve on any future pass is that Arbitrate and Learn are
currently the same violet family and are hard to tell apart from each other.

---

## The four properties

Each one is checkable, which is the requirement for putting it on a cover.

```
VERIFIABLE
Ed25519-signed, hash-chained. Checkable with a public key alone.

OPEN SOURCE
MIT. Seven packages on npm, with build provenance.

IDENTITY FIRST
Agents prove they hold their own key. The private half never reaches the server.

MODULAR
The core depends on nothing. Everything depends on the core.
```

The identity line replaces "decentralized identity". It is stronger *and* true:
the property that makes an agent's proof mean something to a stranger is that
this server cannot sign as that agent.

---

## The bottom bar

The four properties above, in one row, then the repository:

```
github.com/iamGodofall/ABSuite-core
Join the mission. Build with trust.
```

That closing line stays. It is the only string on the card that says **build on
this** rather than **clone this**, and those are different mindsets.

### Held in reserve

An earlier card ran these three across the bottom instead. They are the
project's own words and are worth keeping for a wider format, a slide, or a
print piece — but they do not fit alongside the four properties at 640px tall,
and the properties earn the space because each one is checkable.

```
BUILT FOR TRUST     Nothing may look more certain than it is.
EVIDENCE FIRST      Everything claimed must be verifiable.
OPEN BY DESIGN      Freedom to build. Responsibility to verify.
```

---

## Palette

| Role | Hex |
|---|---|
| Ground | `#000000` |
| Panel | `#020805` |
| Signal green | `#00F58C` |
| Turquoise | `#2DD4BF` |
| Unresolved amber | `#F6B100` |
| Failure red | `#DC2626` |
| Text | `#F4F7FA` |
| Muted text | `#7C9389` |

Mono for labels, data and the install line. Sans for the headline and body.
Uppercase labels take wide tracking, around `0.2em`.

---

## Composition

Wordmark and headline on the left, the cube and its orbit on the right, the four
properties and the repository across the bottom.

Two notes for the 2:1 crop:

- The repository URL must sit inside the middle 80% of the height. It is the
  string a reader acts on.
- The cube may be cropped at top and bottom. It reads as a cube from a corner
  even when partially framed — that silhouette is a regular hexagon, which is
  what a cube looks like seen corner-on, and it survives a tight crop better than
  the orbital ring does.

---

## Before publishing

- [ ] Any command on the card — copy it out of the image and run it.
- [ ] No claim on the card that is not implemented in the repository.
- [ ] Node colours match `SceneCube.tsx`.
- [ ] No red on anything that is not a failure.
- [ ] 1280 × 640, and the install line survives a centre crop.

# Social card — copy deck

The exact strings for the repository's social preview image, so that regenerating
it cannot reintroduce the two errors the first version carried.

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

The thesis, and the first line of the README. It goes on the card because it is
the sentence that makes someone stop.

```
Intelligence is becoming cheap.
Trust is becoming expensive.
```

Set "Trust is becoming expensive." in the accent green (`#00F58C`). Present
tense throughout — *will become* is a prophecy, and this project does not
predict.

### Sub-headline

```
The open trust layer for AI, agents and systems.
Observe. Verify. Explain. Govern. Arbitrate. Act. Learn.
```

### The line under everything

```
ABSuite does not tell you what to believe. It tells you what can be proven.
```

If the layout only has room for one of the headline or this line, keep this one.

### Install

```
npm i @absuitecore/capkit
```

Exactly that. Scope `@absuitecore`, no hyphen, package included.

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

From `packages/dashboard-ui/src/room/SceneCube.tsx`, so the card and the room
agree. A developer who sees the card and then opens the product should not have
to relearn the palette.

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
ACT node tells a viewer that execution is broken.

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

```
BUILT FOR TRUST     Nothing may look more certain than it is.
EVIDENCE FIRST      Everything claimed must be verifiable.
OPEN BY DESIGN      Freedom to build. Responsibility to verify.
```

Unchanged. These are the project's own words and they are the best part of the
original card.

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

The original layout was right and should be kept: wordmark and headline on the
left, the cube and its orbit on the right, properties along the lower left, the
principles bar across the bottom.

Two notes for the 2:1 recrop:

- The install line and the repository URL must sit inside the middle 80% of the
  height. They are the two strings a reader acts on.
- The cube may be cropped at top and bottom. It reads as a cube from a corner
  even when partially framed — that silhouette is a regular hexagon, which is
  what a cube looks like seen corner-on, and it survives a tight crop better than
  the orbital ring does.

---

## Before publishing

- [ ] `npm i @absuitecore/capkit` — copy it out of the image and run it.
- [ ] No claim on the card that is not implemented in the repository.
- [ ] Node colours match `SceneCube.tsx`.
- [ ] No red on anything that is not a failure.
- [ ] 1280 × 640, and the install line survives a centre crop.

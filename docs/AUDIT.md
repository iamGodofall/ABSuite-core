# What is wired, what is not, and where this is weak

A whole-system pass, written against the running repository rather than from
memory. Recorded here because the honest list of shortfalls is more useful than
another feature, and because a project whose entire claim is *nothing may look
more complete than it is* has to apply that to itself first.

---

## 1. The defect found in this pass

**`POST /watch/notices/:id/acknowledge` required `execution:record`.**

Every recording agent holds that scope. So the subject of a finding could close
the finding about itself: an agent that ran without recorded authority could
acknowledge the notice saying so, and the queue would look clean to the next
person who opened it.

It is `watch:acknowledge` now, and the smoke suite asserts a recording token gets
403. Separation of duties applies to a monitor exactly as it applies to an
approval, and the reason is the same — a control that the controlled party can
switch off is a control on paper.

This shipped in this same session, which is the point worth keeping: it was not
found by reading the code, it was found by asking *who holds this scope?* about
every route in one pass.

---

## 2. Built and not reachable from the interface

The largest gap in the project, and it is not a missing capability. It is
capability that exists and cannot be opened.

| Built | Where | Interface |
|---|---|---|
| **Identity (Layer 1)** — enrolment, key rotation, suspension, proof of possession | `capkit/src/identity.ts`, 7 routes | **None.** No proxy route, no panel. |
| **Provenance** — which agent's output became which agent's input | `capkit/src/provenance.ts`, 2 routes | **None.** |
| **Model identity** — is the thing answering still the model that was approved | `capkit/src/model-identity.ts`, 4 routes | Partial — no approve/supersede surface |
| **Tenancy and billing** | `tenancy.ts`, `billing.ts`, 6 admin routes | **None.** |

Identity is the base of the ascent. Every condition report says *Identity:
UNKNOWN* until a subject is enrolled, and there is no way to enrol one except by
`curl`. That is the single highest-leverage interface work left, ahead of any
new capability: a layer nobody can operate is a layer nobody adopts.

Sixty capkit routes exist; the dashboard reaches roughly a third of them.

---

## 3. Weaknesses worth stating before a buyer finds them

**Separation of duties is enforced on names, not on credentials.** An approval
refuses `decidedBy === requestedBy`, but one holder of an admin key can pass two
different names and play both parties. The product's honest answer is already
built — such a decision reads `ASSERTED`, and only a decision signed with an
enrolled key reads `PROVEN` — but the distinction lives in a field, not in a
gate. **Anyone relying on approvals for a regulated obligation should require
signed decisions**, and nothing currently forces that.

**SQLite, single writer, one disk.** Deliberate: a chain has one head. It also
means no horizontal scaling, and it is the gate on hosting this for anyone else.

**`verifyChain()` walks the whole chain on every call**, and several reports call
it. Fine at thousands of records. A checkpointing scheme — verify from the last
known-good sequence — is the obvious answer and is not built.

**The watch sweeps in batches from a high-water mark.** Correct, and slower to
first finding on a large import than a single pass. `coverage.behind` says so.

**One secret destroys the archive.** Losing `CAPKIT_TRACE_PRIVATE_KEY` makes
every existing record fail signature verification, permanently. There is no
recovery and there should not be one.

**Nothing notifies anybody.** No incident, no escalation, no email. That is a
constitutional refusal, and it is also a real gap against EU AI Act Article
26(5). Both things are true and [COMPLIANCE.md](COMPLIANCE.md) §1.4 says so.

---

## 4. What was checked and found sound

- **No route added this session is unauthenticated by accident.** Witnessing on
  the notary and `/executions/public-key` are unauthenticated *by design*, and
  both are argued for where they are defined.
- **Admin key comparison is constant-time** (`secretsMatch`), with a regression
  test. It was `===` once.
- **No horizontal overflow and no console errors** on any of the three published
  pages, at 1280px and 390px.
- **Every relative link on the site resolves** to a file `docs/` contains — now
  gated, after two had been 404ing.
- **719 tests, 33 suites, 17 gates, exit 0.**
- **The record format verifies from a second implementation** that shares no code
  with the first.

---

## 5. The order to fix these in

| | Do this | Why |
|---|---|---|
| 1 | An Identity surface in the dashboard | The base layer cannot be operated at all. Everything above it reports UNKNOWN until it can. |
| 2 | Require signed approvals as a configurable mode | Turns a field into a gate, and it is the row a regulated buyer will press on. |
| 3 | A provenance view | AI-to-AI accountability is built, distinctive, and invisible. |
| 4 | Chain checkpointing | The first scaling wall, and it is not close yet. |

None of this is blocked on anything but time. That is the useful thing about a
list like this: everything on it is work, not luck.

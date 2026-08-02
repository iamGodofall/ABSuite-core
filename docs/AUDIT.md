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
| **Identity (Layer 1)** — enrolment, key rotation, suspension, proof of possession | `capkit/src/identity.ts`, 7 routes | **Built.** Enrol, suspend, reinstate, and proven-vs-enrolled shown per subject. |
| **Provenance** — which agent's output became which agent's input | `capkit/src/provenance.ts`, 2 routes | **None.** |
| **Model identity** — is the thing answering still the model that was approved | `capkit/src/model-identity.ts`, 4 routes | Partial — no approve/supersede surface |
| **Tenancy and billing** | `tenancy.ts`, `billing.ts`, 6 admin routes | **None.** |

Identity is the base of the ascent, and it was top of this list until
`absuite doctor` made the case unanswerable: the doctor's first finding on any
fresh instance is *no subject is enrolled*, and there was nothing anybody could
do about it from inside the product. A finding nobody can act on is a complaint.

Sixty capkit routes exist; the dashboard reaches roughly a third of them. The
remaining three rows are real, and none of them is load-bearing the way Identity
was — nothing else in the product reports UNKNOWN because of them.

---

## 2b. Windows — five defects, found by somebody running it

Every one of these was invisible on Linux and fatal on Windows, and all five are
fixed. They are recorded because the pattern matters more than the bugs: a
project tested on one platform has *untested* platform assumptions, not portable
ones, and the only way to learn that is for somebody to run it somewhere else.

| Where | What Windows exposed |
|---|---|
| `scripts/run-room.mjs` | `spawn('pnpm')` — Node will not resolve a `.cmd` shim without the extension, and throws `EINVAL` on a path with special characters. The one-command path died at the first line. |
| `packages/capkit/src/server.smoke.test.ts` | `rmSync` threw `EPERM` — Windows holds a lock on the SQLite file until the child exits. Linux unlinks an open file happily and nobody noticed. |
| `check-ui-philosophy.mjs`, `check-ui-doctrine.mjs` | Path regexes written `/room\//` matched nothing against backslashes. **The gates passed by finding no files to check** — the worst way for a gate to pass. |
| `scripts/gen-api-docs.mjs` | `new URL(…).pathname` returns `/D:/A%20B/…`, which `join()` mangles into `D:\D:\A%20B\…`. |
| `scripts/check-protocol-conformance.mjs` | Node's ESM loader read `D:\…` as protocol `d:` and refused it. |

The third row is the one worth remembering. Two checks were reporting green on
Windows because their file filter silently matched an empty set — the same class
of failure as the grep that hid a red build for six commits.

---

## 3. Weaknesses worth stating before a buyer finds them

**Separation of duties is enforced on names, not on credentials.** An approval
refuses `decidedBy === requestedBy`, but one holder of an admin key can pass two
different names and play both parties. The product's honest answer is already
built — such a decision reads `ASSERTED`, and only a decision signed with an
enrolled key reads `PROVEN` — but the distinction lives in a field, not in a
gate. **Anyone relying on approvals for a regulated obligation should require
signed decisions**, and nothing currently forces that.

**The admin key bypasses proof of possession.** `POST /auth/token` refuses to
issue authority in an enrolled subject's name without a signed challenge — unless
the caller holds `CAPKIT_ADMIN_KEY`, which mints it anyway. Verified against a
running instance: a token was issued for an enrolled, proven subject with no
proof at all.

The mitigation is real and it is the reason this is a weakness rather than a
defect: **the record does not lie about it.** That execution's condition report
reads `Identity: UNKNOWN`, not `DEMONSTRATED`, because the token was never bound
to a proof. The system loses the strong claim rather than faking it.

But it means the admin key is a master key over identity, and anyone holding it
can act in any enrolled subject's name. Treat it as the second most dangerous
secret after `CAPKIT_TRACE_PRIVATE_KEY`, and prefer proof-backed tokens for
anything that needs to read `DEMONSTRATED`.

**The database is not encrypted at rest, and `.env.example` implied it was.**
`ABSUITE_DB_ENCRYPTION_KEY` sat in the example environment file telling operators
to generate 32 random bytes. **Nothing read it** — not the services, not
docker-compose, not the Kubernetes manifests. An operator who set it believed
their record was encrypted and it never was.

That is this project's own stated failure, committed in its own configuration,
in a security product — and it is worse than a missing feature, because a
missing feature does not produce false confidence. It is removed rather than
quietly implemented: the honest statement is what was owed.

The SQLite file is plaintext. Protect it with disk encryption and file
permissions. The real mitigation, which is genuine and is not encryption:
payloads are hashed and dropped, so the file holds hashes, subjects, scopes and
timestamps rather than your inputs and outputs.

**`.env.example` documented 21 variables while the code read 50.** Found in the
same pass. The undocumented ones included `ABSUITE_PUBLIC_PASSWORD`, which gates
a public instance, and `CAPKIT_NOTARY_PRIVATE_KEY`. Now listed.

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

## 3c. Configuration that was offered and read by nothing

Swept properly after `ABSUITE_DB_ENCRYPTION_KEY` turned out to be decorative:
every variable offered by `docker-compose.yml`, `.env.example` and `deploy/`
compared against every variable actually read in source. Sixty-four read,
thirty-nine offered.

Exactly one real survivor: **`ABSUITE_LOG_LEVEL`**, passed into all six
containers and consumed by nothing. (`DATA_DIR` and `PUBLIC_PORT` also showed up
and are false positives — local constants in `deploy/serve-all.mjs`, not
environment variables. The first sweep of this kind produced a false positive
too, `CAPKIT_REVOCATION_FILE`, read as `env.X` off a passed object rather than
`process.env.X`. A detector for this defect needs checking by hand.)

**It is removed rather than implemented, and the reason is not that it was
unread.** The services log two things: startup lines, and warnings. The warnings
are the ones that say the signing key is ephemeral, no admin key is set, or the
notary will invalidate every receipt it has issued the moment it restarts. There
is no per-request or debug logging for a level to unlock, so `debug` would turn
on nothing — and `error` would silence exactly the warnings that make this
product different from one that opens with a green tick.

A log level here is not a missing feature. It is a switch for hiding findings,
and shipping it would contradict [FAQ](FAQ.md) Q10.

---

## 3b. The adoption claim, published twice without a measurement

This is the sharpest finding in the audit, because the defect is in the
project's own documentation and it is precisely the defect the project exists
to catch.

**First version.** `ROADMAP.md`, `README.md` and `FAQ.md` Q11 all stated flatly
that *nobody outside the project has used it.* Confident, repeated across three
documents, quoted in commit messages. **The registry was never queried.** It
turned out to be approximately right, which is worse than being wrong — an
unchecked claim that survives on luck teaches nobody to check the next one.

**Second version.** Corrected to *about 3,048 weekly downloads and five
dependents.* Both halves were wrong in a more interesting way:

- The downloads are real and mean nothing. All seven packages peaked on
  2026-07-29, the day they were published, with 89% of the thirty-day total on
  that single day. That is what registry mirrors, CDN caches and security
  scanners do to a new package. Read as adoption, it is a number that flatters.
- The five dependents did not exist. npm has no dependents endpoint;
  `?text=depends:@scope/pkg` is read as free text and returns the registry
  ranked by relevance. One of the "dependents" was an unrelated package that
  happens to be named `capkit` and belongs to somebody else.

**What was done.** `scripts/measure-adoption.mjs` (`pnpm adoption`) now derives
the figure, reports the daily series rather than a weekly total, names the
publish-day spike as a spike, and refuses to convert downloads into users. It
reaches UNKNOWN and says what would make it DEMONSTRATED: a dependent package,
an issue from a stranger, a deployment that is not ours. Each of those carries a
name; a download does not, at any scale.

It is deliberately **not** in `pnpm verify`. It needs the network, and a gate
that fails when the wifi drops gets switched off — taking the checks that do not
need a network with it.

**The general lesson, which is not about npm.** Both errors were claims about
the project stated in prose without a measurement behind them, and prose is
exactly where a wrong number survives longest. `check:numbers` now polices
figures that the repository can measure about itself. This one could not be
caught that way, because the fact lived outside the repository — and that is the
category to stay suspicious of.

**Also surfaced by that script:** `@absuitecore/notary` is marked
`publishConfig.access: public` at version 1.0.0 and **is not on the registry.**
`ROADMAP.md` says all seven packages were published, which is true of the seven
that shipped; notary is an eighth that is configured to publish and did not.
`CONSTITUTION.md` §7 names it as a mechanism that *exists*, which is true of the
repository and not of npm. Either publish it or stop naming it as though it were
installable — it is listed in §5.

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
- **All 18 interface views render with zero runtime errors**, swept in one pass
  against the running stack — every layer, every standing view, every console.
- **All six services plus the dashboard answer `/health`**, and a record written
  through the API verifies and reports its five conditions correctly.
- **721 tests, 33 suites, 18 checks, exit 0.** `pnpm verify` runs a build, the
  suite, and 18 checks. Two of them are new and both police this document:
  `check:numbers` compares every figure the documents publish against what the
  repository measures, and `check:config` fails the build if a variable is
  offered to an operator and read by nothing (§3c).

  The count itself is the demonstration. This section said "17 gates" — here
  and in FAQ §20 — for a long time, when the real number was 16, because nobody
  counted. Adding `check:numbers` made it genuinely 17, and that check
  immediately failed the documents still saying 16. Adding `check:config` made
  it 18, and the same check failed this line while it was being written. A
  number that corrects itself twice in two commits is the behaviour working,
  not a coincidence.
- **The record format verifies from a second implementation** that shares no code
  with the first.

---

## 5. The order to fix these in

| | Do this | Why |
|---|---|---|
| ~~1~~ | ~~An Identity surface~~ | **Done.** `absuite doctor` reported "no subject is enrolled" and there was nothing anybody could do about it from the product. A finding nobody can act on is not a finding. |
| 1 | Publish `@absuitecore/notary`, or stop naming it as though it ships | Minutes, not hours, and it is the cheapest item here. Three documents name a package the registry does not have — see §3b. |
| 2 | Require signed approvals as a configurable mode | Turns a field into a gate, and it is the row a regulated buyer will press on. |
| 3 | A provenance view | AI-to-AI accountability is built, distinctive, and invisible. |
| 4 | Chain checkpointing | The first scaling wall, and it is not close yet. |

None of this is blocked on anything but time. That is the useful thing about a
list like this: everything on it is work, not luck.

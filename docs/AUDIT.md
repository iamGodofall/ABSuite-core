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

**Separation of duties is enforced on names by default.** An approval refuses
`decidedBy === requestedBy`, but one holder of an admin key can pass two
different names and play both parties. Such a decision reads `ASSERTED`, and
only one signed with an enrolled key reads `PROVEN`.

That distinction used to live only in a field, which is something a reader has
to notice. **It is now also a gate:** `ABSUITE_REQUIRE_SIGNED_APPROVALS=true`
turns Governance **FAILED** on a `REQUIRES_APPROVAL` record whose approval is
merely `ASSERTED`, and the finding names the deployment setting rather than
accusing the record of being fake — the approval is real and recorded; what it
is not is evidence of who decided.

Off by default, because switching it on retroactively fails every approval
recorded without a signature and nothing about those records changed. capkit
announces which mode it is in at boot, both ways: an operator who believes
signatures are enforced when they are not is worse off than one who knows.
**Anyone relying on approvals for a regulated obligation should set it** — see
[COMPLIANCE.md](COMPLIANCE.md) §1.2.

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

## 3g. A flaky test that could never have worked, found by it blocking a release

`quickbench`'s throughput test asserted `opsPerSecond < 1000`. It passed locally
every time and failed on CI at **1011.3**, which stopped a publish for a reason
that had nothing to do with the change being published.

The threshold could never have worked, and that is the interesting part. The
test exists to prove throughput comes from the wall clock rather than from mean
latency — but with 20 iterations, concurrency 5 and a 5ms sleep, **1000 is what
both calculations give**: 5 workers ÷ 5ms is 1000, and 20 iterations ÷ 20ms is
also 1000. The two numbers the test exists to tell apart were the same number,
so the assertion sat exactly on the boundary and measured nothing but how
precisely the machine honours `setTimeout(5)`. A shared CI runner does not.

It is replaced by an arithmetic ceiling that holds on any machine — throughput
cannot exceed `concurrency × 1000 ÷ mean`, because work cannot be retired faster
than the workers allow — compared with `≤`, so it cannot flake.

**The discriminating assertion was the one already there**, comparing reported
`opsPerSecond` against the figure recomputed from reported `wallClockMs`.
Confirmed by writing the bug: an implementation deriving throughput from latency
reports 834.7 where its own wall clock says 822.7, and the test names both.
The comment now says which assertion catches the bug and which is a guard,
because a test whose comment overstates what it proves is the same defect as a
document that does.

Local repetition is not what settled this. Twelve consecutive local passes prove
nothing — the old assertion also passed locally every time.

---

## 3f. The published packages were four days and twenty-six commits stale

Two findings with one cause, both found by asking the registry instead of the
repository.

**`@absuitecore/notary` had never been published.** Built, marked
`publishConfig.access: public` at 1.0.0, named in three documents as though it
shipped. `publish.yml` wrote its package list by hand in **five** separate
places — preview, workspace-protocol check, publish loop, and twice in the
summary — and notary was in none of them. `release.yml` held a sixth copy of the
same list, so every release note also published an inventory missing it.

Nothing caught this because the six hand-written copies agreed with each other.
It is the same shape as §3e: a fact copied by hand drifts from the thing it
describes, and copies agreeing looks like confirmation.

**The published capkit predated Layers 5 and 6.** `capkit@1.1.2` went to npm on
2026-07-29 and took 26 commits after it, 15 touching non-test source — including
`approval.ts` and `watch.ts`, both exported from `index.ts`. No version was ever
bumped, so the registry copy could not have been updated in place.

Confirmed rather than inferred: `npm install @absuitecore/capkit` into an empty
directory returned 1.1.2 with **no `approval.js` and no `watch.js` in the
tarball.** Anyone installing that day got a package without Governance and
Autonomy while the documentation described both as built.

**Fixed.** The list is derived by `scripts/publishable-packages.mjs` from
`packages/*/package.json`, capkit sorted first because everything depends on it
and npm resolves at install time against the registry. `dashboard-ui` is excluded
by `private: true` — an application, not a library, so its absence is a decision
rather than an omission. Versions were bumped by what actually changed in `src`:
capkit `1.2.0`, cli `1.1.0`, trust `1.1.2`, quickbench `1.0.2`, notary `1.0.0`
first publish. connector-starter, edge-run and mcp had no source changes and were
left alone; their published copies require capkit `^1.1.2`, which `1.2.0`
satisfies.

**Verified against the live registry after publishing**, not against the
workflow's summary: a clean `npm install` in an empty directory returns
capkit 1.2.0 carrying `dist/approval.js` and `dist/watch.js`, an approval
reaches `GRANTED`, `Watch.coverage()` reports `everRun: false` with the sentence
explaining that nothing has looked yet, a trace verifies, and `@absuitecore/notary`
exports. The documented `examples/incident-forensics.mjs` runs end to end
against published packages.

---

## 3e. "Six services", in eleven places, in two shapes that cannot both be true

Found by bringing the stack up and counting what answered rather than reading
what the documents said.

`pnpm room` starts **five backend services** — capkit, edge-run, quickbench,
connector-starter, trust — plus the room itself on `:3001`. The documents said
*six services* eleven times, in two phrasings:

- **"six services"** — defensible only if the room is counted as one of them.
- **"all six services plus the interface"** — which counts the room twice, and
  was the phrasing in `GUIDE.md`, `HOSTING.md`, `README.md`, `DEPLOY.md`,
  `room.html` and this document's own §4.

Two files said **five** and were right the whole time: `MODULES.md` and
`deploy/serve-all.mjs`. They had been contradicting nine other files for as long
as both existed, and nobody saw it — **nine documents agreeing looks like
consensus**, and the two correct ones looked like the outliers.

Everything now says five services and the room, and `check:numbers` derives the
figure from the service list `run-room.mjs` actually spawns. The pattern reads
the word as well as the digit, because *"six services plus the interface"* is
how this was wrong and a check that only reads digits would have missed it.

One more stale figure fell out of the same live run: `ROADMAP.md` claimed 46
documented GET routes confirmed against a live suite when `check:live` reports
**52**.

**A correction to this section.** It first also recorded that `@absuitecore/notary`
is not started by `pnpm room`, listed as a gap. **That was wrong, and the
reasoning is in the notary's own source:** a notary deployed alongside the system
it witnesses, signing with a key the same operator holds, is a second signature
from the same party and proves nothing. Its absence from the room and from
`docker-compose.yml` is the design working. Counting services was the right
check; calling that one a gap was a conclusion drawn without reading why.

The real gap next to it was different and is now closed: the notary was
published, `SERVICES.md` said what it needs is *"somebody other than us running
one"*, and **no document told that person how.** [NOTARY.md](NOTARY.md) does,
including a worked audit of a rewritten chain that verifies perfectly against
itself and is caught anyway.

---

## 3d. Three build checks that passed by inspecting nothing

The Windows report (§2b) noted two interface checks passing there because the
walk used `/` separators against paths that arrive with `\`. They scanned zero
files, found zero problems, and printed a tick. The separators were fixed. **The
reason a green tick was possible on an empty set was not**, so the whole suite
was swept for it — every gate run against a copy of the repository with its scan
target emptied, and its exit code recorded.

| Check | On an empty tree | |
|---|---|---|
| `check:styles` | **exit 0**, `0 interface source file(s) scanned` | vacuous pass |
| `check:surface` | **exit 0**, three ticks and `0 interface file(s) scanned` | vacuous pass |
| `check:config` | **exit 0**, `0 offered configuration variable(s)` | vacuous pass |
| `check:fabrication` | exit 1 — `No interface source files were scanned` | already guarded |
| `check:motion`, `check:ui`, `check:doctrine-ui` | exit 1 | fail correctly |

`check:surface` was the worst of the three, and for a structural reason worth
naming: it is a *budget* check. Every other gate hunts a defect and finds none
when there is nothing to search; a budget counts occurrences against a ceiling,
so an empty set produces zero of everything and emits the most confident output
in the suite. Three ticks, having read nothing.

`check:config` is the one added in §3c — **written this session, to catch
exactly this class, and shipped with the hole in it.** Writing the gate does not
exempt you from the failure mode you wrote it to catch. That is the honest note
to leave here, and it is why the floors went into all three at once rather than
into the two that were already broken.

All three now assert a minimum before reporting success, set well below the real
count. An exact figure would fail the build for adding a component, which is how
a floor gets raised without thought until it means nothing. These catch *the
walk matched nothing* — and each was proved by running it against an emptied
tree and watching it fail, then against the real one and watching it pass.

**A green build that inspected nothing is worse than a red one, because it is
trusted.** That is the whole finding, and it applies to the sixteen checks not
listed above every time one of them is edited.

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

**Also surfaced by that script:** `@absuitecore/notary` was marked
`publishConfig.access: public` at version 1.0.0 and **was not on the registry** —
`ROADMAP.md` said all seven packages were published, which was true of the seven
that shipped, while notary was an eighth configured to publish that never did.
Chased down in §3f and published on 2026-08-02.

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
- **All five services plus the dashboard answer `/health`**, and a record written
  through the API verifies and reports its five conditions correctly.
- **726 tests, 33 suites, 18 checks, exit 0.** `pnpm verify` runs a build, the
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
| ~~1~~ | ~~Publish `@absuitecore/notary`~~ | **Done**, 2026-08-02. Three documents named a package the registry did not have. The cause was a hand-written package list in six places — §3f. |
| ~~2~~ | ~~Require signed approvals as a configurable mode~~ | **Done.** `ABSUITE_REQUIRE_SIGNED_APPROVALS` turns a field into a gate — the row a regulated buyer presses on. Proved by deleting the gate and watching a test fail. |
| 1 | A provenance view | AI-to-AI accountability is built, distinctive, and invisible. |
| 2 | Chain checkpointing | The first scaling wall, and it is not close yet. |

None of this is blocked on anything but time. That is the useful thing about a
list like this: everything on it is work, not luck.

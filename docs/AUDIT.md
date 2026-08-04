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
| **Provenance** — which agent's output became which agent's input | `capkit/src/provenance.ts`, 2 routes | **Built.** Coverage first, then failures something else consumed, then the edges with their shared hash on screen. |
| **Model identity** — is the thing answering still the model that was approved | `capkit/src/model-identity.ts`, 4 routes | **Built.** Approve, supersede and attest, with drift shown field by field and the limits carried on the answer. |
| **Tenancy and billing** | `tenancy.ts`, `billing.ts`, 6 admin routes | **Built.** Tenants, plans, suspension and key rotation — and the panel says which of the five plan limits anything actually counts. |

Identity is the base of the ascent, and it was top of this list until
`absuite doctor` made the case unanswerable: the doctor's first finding on any
fresh instance is *no subject is enrolled*, and there was nothing anybody could
do about it from inside the product. A finding nobody can act on is a complaint.

Model identity was the second row to come off this list, and for the same reason
Identity did: **four routes existed and the only way to reach them was curl**, so
every attestation answered `UNKNOWN` because nothing had ever been approved. A
layer that cannot be operated reports the same thing as a layer that was never
built, and the record cannot tell you which.

**The table is now empty.** Every layer that was built is reachable. That is
worth stating carefully rather than triumphantly: it means nothing in this
product is now built-and-unusable, which was the largest gap in it. It does not
mean every layer is finished — §3 is still where the honest shortfalls live, and
building the tenancy surface added one to it.

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
it — 3.2 seconds at twenty thousand records, measured. Checkpointing now exists
and resuming is **opt-in**, so this remains the default cost and that is
deliberate: the alternative is a verification that skips history and a caller
who cannot tell. See §3m, including the tampering a resumed pass cannot detect.

**The watch sweeps in batches from a high-water mark.** Correct, and slower to
first finding on a large import than a single pass. `coverage.behind` says so.

**One secret destroys the archive.** Losing `CAPKIT_TRACE_PRIVATE_KEY` makes
every existing record fail signature verification, permanently. There is no
recovery and there should not be one.

**Nothing notifies anybody.** No incident, no escalation, no email. That is a
constitutional refusal, and it is also a real gap against EU AI Act Article
26(5). Both things are true and [COMPLIANCE.md](COMPLIANCE.md) §1.4 says so.

---

## 4q. The room could read the evidence chain and could not add to it

A visitor to a fresh instance met a completely motionless scene: the core dim,
the rings stopped, the particle field not drawn at all, and seven grey stations
reporting nothing. Every part of that was correct. `SceneCube` stops the rings
at exactly zero when the determination is `ABSENT`, because motion is evidence
and nothing had happened.

It is also indistinguishable from a dead product, and there was no way at all to
tell the two apart from the screen you were looking at.

It fooled the person who built it. Four rounds went into hunting a rendering bug
in a scene that was reporting the truth perfectly; the answer was in the
masthead the whole time, reading `EVIDENCE HELD 0`.

### The half that was missing

`POST /executions` has existed in capkit since the first commit. The dashboard
server proxied **fourteen** execution routes and not that one, so the product's
central act — *record what an agent did* — was reachable by `curl` and by
nothing else. An evaluator could only start the thing by first reading the
documentation for the thing they were evaluating.

Its absence did not 404 either. The SPA catch-all answers `index.html`, so the
first person to try it would have been told their JSON was malformed.

`check:routes` was written to catch precisely that failure and did not, because
it matched on **path** and Express registers a handler per **verb**: `app.get`
does not answer a POST, and the check saw `/executions` on both sides and
agreed. It now compares the verb as well, and reports the near miss by name —
*the server answers GET on this path, not POST*. Confirmed by deleting the new
route and watching it fail.

### The rule the largest object on screen was exempt from

Everywhere else, this system carries the step that would settle a
determination — `UNKNOWN` without a next step is a dead end wearing the costume
of a finding. The connector panel does it. The provider list does it, since §4j.
The cube did not.

`FirstRecord` is that step, on the core's own face, and it performs the act
rather than describing it. What it records is not a fictional invoice —
`seed-scenario.mjs` exists for that and is candid about it. It records the one
event anyone can be certain occurred: an operator opened this room and asked it
to record. Signed with the instance's own key, chained to the genesis hash,
verifiable by the same routes as everything else. Every claim in it is true.

The panel can only be seen by an instance holding nothing, and the only thing it
does is end that condition. **Stillness with an explanation is evidence.
Stillness without one is a bug report.**

`check:doctrine-ui` gained a fifth rule so it cannot come back: the shell must
mount something on an ABSENT determination, and that something must contain an
action rather than a paragraph. Confirmed by deleting the mount and watching the
build fail.

### The second empty room, which was worse

There are two ways to arrive at an unreadable room and only one of them had ever
been considered. A browser holding no admin key gets 403 from every evidence
route, so `integrity` falls to UNKNOWN and all seven stations go amber — the
ordinary first minute of anyone's first install, drawn identically to an outage,
with no field anywhere in the room to fix it. Settings held the only copy of
that field, and Settings is reached through a command palette a newcomer does
not know exists.

The panel now distinguishes them, because *nobody has introduced themselves to
this instance* and *the service holding the record is not answering* have
different next steps. The key is **tried before it is stored** — a key saved and
then silently rejected leaves somebody pressing a button that appears to do
nothing, waiting on a poll that has no way to say *that key was wrong* rather
than *still nothing*.

### Two defects the screenshots found and the reasoning did not

The confirmation was **unreachable code**. Recording flips the determination
away from ABSENT, which is the condition the panel is mounted on, so the success
message was written and unmounted in the same frame — a sentence that would have
rendered for nobody, ever. And the panel's own headline reading stayed at `0`
while the masthead four inches above it read `1`: the interface disagreeing with
itself on screen.

Neither was visible in the diff. Both were obvious in a screenshot. That is now
three separate occasions in this repository where the browser knew and the
reasoning did not.

---

## 4p. The reference verifier crashed instead of reporting

Three passes were spent on *"no Python 3 found"* appearing on a machine with
Python 3.13 on its PATH. The first fix reasoned about interpreter names (§4n).
The second found Node's `.cmd` restriction (§4o). Both were real. Neither was
this. The message only became true after it was made to say what actually
happened:

```
UNKNOWN: the conformance count was not verified —
  python exited 1 — UnicodeEncodeError: 'charmap' codec can't encode
  character '✓' in position 7: character maps to <undefined>
```

Python was found. The suite ran. It **died printing `✓`**.

On Windows, Python takes stdout's encoding from the locale whenever output is
redirected rather than attached to a console — cp1252 on a typical install,
which has no U+2713, no `§`, no em dash. Both Python files here print all three.

### Why it took three passes

The failure depends on **who is listening**, not on the machine:

| caller | stdout | result |
|---|---|---|
| `check:python` | inherits the console | 33/33 passed |
| `gen-site.mjs` | captured, to read the count | exit 1, UnicodeEncodeError |

Same machine, same interpreter, same suite, same `pnpm verify`. One passed and
one reported "no Python", and the difference was a pipe. Every hypothesis that
reasoned about *the environment* was looking in the wrong place, because the
variable was the caller.

### The one that actually mattered

`absuite_verify.py` had it too, and that is the serious one. It is the reference
verifier — the file somebody who has no reason to trust us downloads and points
at our records. Confirmed by running it:

```
$ python absuite_verify.py records.json > report.txt
UnicodeEncodeError: ... '—' ...
```

Redirecting a verifier's output to a file is the ordinary case, not the exotic
one. And a verifier that crashes instead of reporting is worse than useless: to
the person running it, **a tool that dies is indistinguishable from a
verification that failed**. The entire argument of this project is that a
stranger can check the record without trusting us. On Windows, into a file, they
could not — and nothing here knew.

Both files set their output encoding now, at the source rather than in the
caller, because `python test_conformance.py > report.txt` is a thing a person
does and no Node wrapper is present to help them. `runPython` also exports
`PYTHONIOENCODING` as a second line of defence for anything spawned that has not
learned to. Verified by forcing a codec that cannot encode the output: exit 1
before, exit 0 and a full verdict after.

`check:cross-platform` now fails if a printing Python file carries non-ASCII
without setting its encoding.

### What this cost, and the rule that would have saved it

Two wrong fixes shipped before the right one, and both were shipped as though
they were explanations. §4o already recorded *"a fix verified only where the bug
is absent is a hypothesis"* — and the next thing to go out was another
hypothesis, presented as a diagnosis, by a message that named a cause the code
had never established.

The change that ended it was not a better guess. It was making the failure
report what it observed instead of what it assumed. **Four `null`s meaning four
different things, printed as one sentence, cost more than the bug did.**

---

## 4o. A gate that failed the build over somebody's `.env`

The Windows run got all the way to check twenty-five. Twenty-four passed. The
last one said:

```
- .env:9 contains CRLF.
```

`.env` is in `.gitignore`. **`.gitattributes` cannot normalise a file Git does
not track**, so the check was demanding something of a file the repository has
no control over — and failing a shared build over a contributor's private
secrets file. Any stray `build.log`, editor swap file or scratch note would have
done the same.

The cause is one line: the rule walked the filesystem when the set it is
actually about is the set that *reaches other machines*. That set is exactly
what `git ls-files` returns, and it is what the rule reads now. Proved both
ways — an untracked CRLF file no longer fails it, a tracked one still does.

The gate was written yesterday to catch a portability defect, and its own first
contact with the platform it was written for produced a false failure. Third
time in two days something has been reported as a defect in the repository when
it was a fact about a machine: CRLF (§4l), a missing interpreter (§4n), and now
a gate confusing *present on disk* with *part of this project*.

### And the interpreter still was not found

The same run printed:

```
UNKNOWN: the conformance count was not verified — no Python 3 found (tried python3, python, py -3)
```

On a machine with Anaconda active. The §4n fix tried the right names and still
came back empty, because of something upstream of names: since Node 18.20 and
20.12 — **CVE-2024-27980** — `spawn` refuses to launch a `.bat` or `.cmd`
without `shell: true`, and conda puts `python` on Windows behind exactly that
kind of shim. Every candidate was rejected by Node before it ever ran.

Each name is now tried directly first, then through a shell. Direct first
because it needs no quoting and cannot be re-parsed; the shell only as fallback.
`findPython()` reports which applied, because it changes what the caller must
do: under a shell the argv becomes a command line again, and a path containing a
space — `D:\ABS main\ABSuite-core`, which is where this was found — splits in
two unless quoted, while a direct spawn must *not* be quoted or the quotes
become part of the filename. Both paths verified by running the conformance
suite from a directory with a space in its name.

The probe also stopped passing `-c "import sys; print(sys.version_info[0])"`.
Under a shell that string is at the mercy of `cmd.exe`. `--version` answers the
same question with no parsing surface at all.

**The lesson is the ordering.** The §4n fix was reasoned from *what is Python
called* and was right about that, which made it look complete. It was wrong
about something one level down that no amount of thinking about names would have
surfaced — and it took the fix being run on the actual machine to find it. A fix
verified only where the bug is absent is a hypothesis.

---

## 4n. `python3` is not what Python is called on every machine

The `.gitattributes` fix in §4l worked. A fresh Windows clone ran the build, 936
tests, and twenty checks that had never executed on that machine — then stopped
at the twenty-first:

```
$ node scripts/gen-site.mjs --check
docs/index.html is out of date. Run: pnpm docs:site
```

Not line endings this time; the comparison is newline-insensitive now and four
other generators passed. A different defect wearing the same error message.

`gen-site` measures one figure by running the Python conformance suite, because
typing the number would be the exact thing this project fails builds over. It
shells out to **`python3`**. The reporting machine runs Anaconda, which installs
`python.exe` and no `python3.exe`. Reproduced here by pointing the spawn at a
name that does not exist, and the whole difference is one line:

```diff
- <strong>33 conformance checks</strong> run on every build, and they are the reason this is a
+ <strong>A conformance suite</strong> runs on every build, and it is the reason this is a
```

The fallback wording is right — a page must not publish a number nobody
measured. What was wrong is what happened next: `--check` compared that page to
the committed one and reported the *document* as stale. **The document was
current. The machine did not have `python3`.** Same confusion as the CRLF one, a
layer up: a fact about the environment, published as a fact about content.

`"check:python": "python3 ..."` in package.json had it too, so the last link in
`pnpm verify` would have failed next for the same reason.

### Writing and checking are not the same act

`scripts/lib/python.mjs` tries `python3`, then `python`, then `py -3`, and
confirms each is Python 3 before trusting it — `python` is still Python 2 on
some systems, and running the suite under it would fail in a way that looks like
a defect in the suite. On the reporting machine this now finds Anaconda's
`python` and genuinely runs the conformance suite, which is the outcome worth
having.

When there is no Python at all the two modes diverge, deliberately:

- **Writing** falls back to wording that states no number. Publishing a figure
  nobody measured is the defect; that behaviour was already correct and stays.
- **Checking** reads the committed figure back and compares everything else
  exactly, then prints `UNKNOWN: the conformance count was not verified`. It is
  not a fabrication — it is declining to report an absent interpreter as a
  changed document.

`check:python` does the same: UNKNOWN and exit 0 when no Python exists, naming
what it tried and what would settle it. Uncomfortable, and correct. The four
words this product is built on separate *the evidence contradicts it* from
*nobody checked*, and a missing interpreter is squarely the second. Failing the
build would state FAILED for something never run — in the check that exists to
demonstrate the distinction. CI has Python, so the suite still runs on every
push; what changes is that a contributor without it gets a stated UNKNOWN rather
than a wall, or a green tick they did not earn.

`check:cross-platform` now also fails on any hardcoded interpreter name outside
that one module.

### The gate flagged its own comment

First run, the new rule fired on the line in its own header quoting
`spawnSync('python3', ...)` as the thing to avoid — and because that hit sorted
first, it **masked both regression tests**, which appeared to pass by reporting
the self-hit instead of the defects being reintroduced. Comment lines are
skipped now, and both regressions were re-run properly and do go red.

Worth recording rather than quietly fixing: for two runs the evidence that the
gate worked was evidence of something else entirely, and only re-reading the
line numbers caught it. **A check that fires is not the same as a check that
fired for the reason you think.**

---

## 4m. Six images that would install a package the lockfile never pinned

A local Docker build failed on one service:

```
target dashboard: failed to solve:
process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully
```

Six images built. One did not. The obvious readings — the dashboard is the
largest install, or something is wrong with the dashboard's Dockerfile — are
both wrong, and the discriminating fact is a flag:

```
capkit, connector-starter, edge-run, notary, quickbench, trust
    pnpm install --filter ... --no-frozen-lockfile

dashboard
    pnpm install --frozen-lockfile
```

**The dashboard was the only strict install in the suite.** It did not fail
because it was different; it failed because it was the only one that would.

### What the loose flag actually does

Not "tolerate a lockfile that is slightly behind" — it resolves around it.
Demonstrated in a real build context by adding an undeclared dependency to a
manifest and running both flags against it:

| flag | result |
|---|---|
| `--frozen-lockfile` | `ERR_PNPM_OUTDATED_LOCKFILE`, names the disagreeing file, exit 1 |
| `--no-frozen-lockfile` | fetches and installs it, exit 0 |

So six of seven service images would build with a package the lockfile never
pinned, and report success. **Those images are not reproducible from the
lockfile**, and no output anywhere says so. For a project whose entire argument
is that evidence beats assurance, that is the wrong artifact to ship — a
container nobody can rebuild identically is exactly the kind of unverifiable
claim this repository exists to refuse.

There was no technical reason for it. Strict was tested in these exact partial
build contexts — one workspace manifest present out of ten — for both the build
install and the `--prod` prune step. Both pass. All twelve installs across the
six images are `--frozen-lockfile` now, and `check:container-pnpm` fails the
build if one goes back.

### The part worth keeping

This was found while diagnosing somebody else's broken build, and it is not the
cause of that build failing. The lockfile drift is on one machine; this is about
what the other six images do when they meet one.

The shape recurs in this document. §4j: seven images had the pnpm 11 defect and
BuildKit only ever showed one, because it cancels its siblings. Here: seven
images meet a drifted lockfile and only one says so, because the other six are
configured not to look. **A report of one failure is not evidence of one
defect**, and twice in two days the difference has been six.

---

## 4l. Twenty-two checks that had never run on Windows

Reported from a Windows clone, on a commit where `pnpm verify` was green here.
Same tree, same lockfile, same pnpm. Build passed. **936 tests passed.** Then:

```
$ node scripts/gen-api-docs.mjs --check
docs/API.md is out of date. Run: pnpm docs:api
```

`docs:check` is the third link in a chain of twenty-six. Everything after it —
including every gate written in the last two days — had never executed on that
machine. Not failed: **never run.** The suite reported itself as a suite while a
whole platform reached a fifth of it.

### A newline is not a fact about content

There was no `.gitattributes`. Git for Windows applies its own default and
checks text files out with CRLF. The generators build their output in memory
with `\n` and compared it byte-for-byte:

```js
if (current !== output) {
```

So `current` held CRLF, `output` held LF, and the documents were declared out of
date for a difference that says nothing about what they contain.

The worst part is the second line of the error. Running `pnpm docs:api` rewrote
an identical document and changed nothing, so the fix the tool named could not
work. **A check that reports a false difference and then prescribes a remedy for
it is worse than a check that is simply wrong** — it sends someone round a loop
until they conclude the repository is broken. On Windows, past step three, it
was.

Six comparisons, five generators — `gen-api-docs`, `gen-performance-doc`,
`gen-site`, `gen-system-map`, `gen-architecture-layers`. One report surfaced one
of them, for the same reason BuildKit only ever showed one failing image in §4j:
the chain stops at the first.

### Both halves, deliberately

`.gitattributes` sets `* text=auto eol=lf`, which settles what a fresh clone
gets. `text=auto` on its own is not enough — it normalises what enters the
repository and still hands Windows a CRLF working tree, which is the half that
broke.

That alone would leave every existing checkout still failing until re-cloned, so
the comparisons go through `sameGenerated` in `scripts/lib/generated.mjs`, which
normalises line endings and nothing else. Trailing whitespace, final newlines and
encoding differences are real and still fail; the point of these checks is that a
generated file nobody regenerated gets caught, and that is untouched.

Verified by converting all six target files to CRLF and running every generator
against them: five of five green, where five of five had been red.

### The check, and what it says about the last two days

`check:cross-platform` holds four things: `.gitattributes` normalises to LF; no
file in the tree carries CRLF; every `--check` generator imports `sameGenerated`;
none of them compares file contents with `===`. Each proved by reintroducing it.

This is the **second** Windows defect found by the one person running this on
Windows, and §2b had already recorded the first — `spawn` on an extension-less
`.bin` shim — before it was repeated in the dashboard smoke tests. Both are
invisible from a Linux container, which is the only place this project's
automation runs. Neither is exotic. The pattern is not that Windows is hard; it
is that **every machine in this project's automation is the same machine**, and a
suite that only ever runs in one place cannot tell you it is unreachable
somewhere else.

Two days of new gates were added in that window. On Windows, none of them had
ever run.

---

## 4k. Test Endpoint dialled the dashboard, once per service

In Settings, *Test Endpoint* answered `fetch failed` for all five backend
services while every one of them was up and answering. Two of the seven rows
worked — the database, and the dashboard's own — and that is the part that gives
it away, because they worked for the same accidental reason.

`/endpoint-check` runs in the dashboard **server**. The interface was building
its targets in the browser:

```ts
url: `http://localhost:${service.port}`
```

On a host running `pnpm room` that is right, because the server and the ports are
on the same machine. In a container it is the dashboard dialling itself. Five
rows named ports 8081–8085, where, inside that container, nothing listens. The
two that answered named port 3001 — `/health` and
`/service-health/absuite-db` — which is the dashboard. Every row that resolved
correctly did so because its address happened to name the process making the
request.

**The browser cannot know this address.** It depends on whether the *server* is
in Docker, and on `CAPKIT_URL` and its siblings, which never reach the bundle.
`useServices.ts` held its own `SERVICE_PORTS` map — half of the server's
`SERVICE_BASE_URLS`, with the host guessed. §4a records the same shape: a fact
hand-copied into a second place, where it can only be a guess.

### Two lists of the same six names

`HEALTH_HOSTS` — the `/endpoint-check` allowlist — also spelled out
`capkit, edge-run, quickbench, connector-starter, trust, dashboard`, beside a
`SERVICE_BASE_URLS` that already defined exactly those services. An operator who
repointed `CAPKIT_URL` was still naming one of our own services, and the
allowlist would have refused it for not being on a list somebody typed by hand.
It is derived from the map now, so the two cannot disagree.

### The fix, and the one that was not taken

The interface sends `?service=capkit` and the server resolves it, from the same
map every other proxy in the file already uses. The `?url=` form and its
allowlist are untouched: naming a service does not widen what may be contacted,
it stops the browser inventing a hostname it has no way to know.

The alternative — route every row through `/service-health/:service`, which
already resolves correctly — is a reasonable fix and was proposed first. It was
not taken for two reasons. The button would no longer test the endpoint; it would
test the dashboard's proxy, which answers `502` from the dashboard whether the
service is down or the proxy is broken. And it would retire `/endpoint-check`
without removing it, leaving a guarded, reachable route that nothing calls —
which is how a route stops being maintained while still being exposed.

### What is proved, and what is not

Four smoke tests, each verified by putting the defect back:

- A service resolves to the configured address, not `localhost`, and the
  configured server counts the hit. Reverting to `?url=` only turns this red.
- The allowlist follows a service configured at `127.0.0.3` — an address on no
  hand-written list. Restoring the typed-out `HEALTH_HOSTS` turns this red.
- `absuite-db` resolves through the dashboard, which is the thing that knows
  whether the file opened.
- An unknown service name is refused and nothing is contacted.

The container case itself is **not executed here** — there is no Docker daemon in
this environment, so no test in this repository has ever seen
`http://capkit:8081`. What the tests exercise is the resolution path that
produces it, driven by an env override, which is the same branch of the same map.
The Docker value is reached by the same line and is not separately demonstrated.
Stated rather than glossed, because "we fixed the Docker bug" and "we tested the
Docker bug" are different sentences.

`check:fabrication` gained an `invented-address` rule: no hostname for one of our
own services may be compiled into browser code. It is an address rather than a
metric, but it is the same defect that file exists for — a guess rendered as a
fact.

---

## 4j. The pin said pnpm 9. The build ran pnpm 11

Both container jobs went red — `CI / Docker Build` and `CD / build` — while
lint, test and the whole local chain stayed green. Second time in one day, and
the first instinct was wrong: the guess was that the Dockerfiles' `pnpm@9.15.0`
pin had fallen behind the workspace's move to `pnpm@11.18.0`. The logs said
something stranger.

```
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
...
Done in 22.8s using pnpm v11.18.0
```

Both lines are from the same build. **Corepack takes the version from
`packageManager` in `package.json`**, so the pin never selected anything — it
downloaded a pnpm that was then not used. It read like a version decision and
had not been one for as long as it had existed. When `packageManager` moved 9 →
11, nothing in the tree changed, nothing local failed, and every container
silently crossed a major version.

pnpm 11 asks before wiping an existing `node_modules`. Every service image
installs twice — once in full to build, then again with `--prod` to drop
devDependencies before the artefact is copied out — and the second install
purges. A Docker build has no TTY to answer with:

```
ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
```

### Seven images, one of them visible

The log names `capkit`. Seven images have the identical double-install shape;
BuildKit cancels its siblings the moment one target fails, so the build can only
ever show whichever reached the step first. A fix aimed at the image in the
error message would have gone red six more times, once per image, each looking
like a fresh problem. **The failure that gets reported and the failure that
exists are different sizes**, and nothing in the output says so.

### The part that is mine

§4h explains why nothing local catches a container defect: nothing local
installs from a Dockerfile's build context. True again here, and not the real
answer. The identical error had already happened **on this machine, an hour
earlier**, upgrading a local clone. It was cleared with `CI=true pnpm install`
and nothing else — the symptom went away, the question *where else does this
install run without a TTY?* was never asked, and the answer was: every image in
the repository.

### The fix, and what was deliberately not done

`confirmModulesPurge: false` in `pnpm-workspace.yaml`. One setting, one place,
already copied into every image before any install runs — and it fixes the same
abort for anyone re-installing a local clone, which `ENV CI=true` in seven
Dockerfiles would not have. The trade is recorded there: a local
`pnpm install --prod` now purges without asking, and what it purges is
reproducible from the lockfile.

The `corepack prepare` lines were **deleted rather than corrected**. Re-pinning
them to 11.18.0 would have been true for exactly as long as nobody bumped
`packageManager` again. Two places that state a version can only drift, and the
drift is what made this silent.

Reproduced and fixed under real pnpm 11.18.0 in a throwaway two-project
workspace: baseline `exit 1` with that exact error, `exit 0` with the setting.
The images themselves were not built here — no Docker daemon in this
environment — so CI is the end-to-end proof, not this document. An earlier run
of the same experiment reported both fixes working under **pnpm 10.33.0**,
because the scratch workspace had no `packageManager` field and quietly used the
ambient binary. That result proved nothing and was discarded. It is the same
mistake as the one being audited, made while auditing it.

### The check that exists now

`check:container-pnpm`, in `pnpm verify`. It builds nothing. It holds the three
properties that make this failure impossible:

1. `pnpm-workspace.yaml` sets `confirmModulesPurge: false`.
2. Every Dockerfile **stage** that runs `pnpm install` has copied
   `pnpm-workspace.yaml` first — the setting only applies where the file is, and
   a new stage starts empty.
3. No Dockerfile pins a pnpm version at all.

Each was proved by putting the defect back and watching it go red: removing the
setting, restoring the `pnpm@9.15.0` pin, and dropping `pnpm-workspace.yaml`
from a stage's `COPY` — that last one correctly reporting *both* installs in the
stage, not just the first.

### And it immediately caught something else

Adding the check moved `pnpm verify` from 24 to 25, and `check:numbers` failed
on three documents that published 24. A fourth line was stale at **19** and had
been for some time, one line above a line policed at 24 — because
`check:numbers` treated `**bold**` as quoting rather than asserting.

Bold is how this repository writes its loudest claims.
`**932 tests, 42 suites, 19 checks, exit 0.**` is a headline, not a figure held
up for inspection, and it was exempt. Italic still counts as quoting — §3e
really does write *six services* in order to correct it — so the rule now
refuses to read the inside of a `**bold**` span as italic, which is the overlap
the stale number had been hiding in. The removed sentence next to it,
*"Four of them are new"*, went for the same reason: a snapshot phrased as a
standing fact, with nothing to make it fail when it stopped being true.

---

## 4i. "The password is not optional" was a heading, not a mechanism

Before drafting anything that points strangers at a demo instance, the obvious
question is whether a public instance is actually safe. Two answers, and they
disagreed.

**The gate works.** With `ABSUITE_PUBLIC_PASSWORD` set, every route answers
`401` without credentials — including the model-identity and tenancy routes added
hours earlier, which the middleware covers by registration order. `/health` stays
open deliberately. The password admits you to the instance; the admin key is
still required for anything that reads the record, so a visitor to a public demo
gets the interface and not the executions. Verified against a running server.

**It had no test.** The one control standing between a demo instance and anyone
who finds the address, and nothing asserted it. Ten tests now, load-bearing:
disabling the gate turns all ten red.

**And `deploy/serve-all.mjs` did not require it.** `DEPLOY.md` carries a section
headed *"The password is not optional"*. The script that section is about — the
one that exists solely to run the all-in-one public container — started happily
without one. A heading claiming mandatory over a mechanism saying optional is
exactly the defect this document keeps recording, and it was sitting in the
deployment path.

It refuses now, with `ABSUITE_PUBLIC_UNPROTECTED=true` as the named way out for
somebody who really does have an authenticating proxy in front. Both paths
verified by running them. `pnpm room` and compose are untouched — they bind
loopback, where a password protects nobody.

### The pattern, stated once more

Three times today a document asserted something the code did not enforce: the
security model's filtering engine, the retention limits no meter counts, and
this. **A sentence is not a control.** The difference is whether something fails
when it stops being true.

---

## 4h. Five hours of red container builds, and `pnpm verify` green throughout

Asked to publish, the first thing to check was what actually ships. npm was in
sync — the last two features are in `dashboard-ui`, which is `private: true`.
**The container images were not.** Every CD run since 02:57 had failed: fourteen
consecutive pushes, five hours.

The cause was mine, and it is a single edge. Adding `guardedFetch` to
`/endpoint-check` meant giving `dashboard-ui` a `workspace:^` dependency on
capkit. Its Dockerfile copies only its own directory, so
`pnpm install --frozen-lockfile` could not resolve `@absuitecore/capkit` and the
build died before it started.

### Why nothing local caught it

`pnpm verify` ran its full chain of checks and 932 tests and every one passed,
in the same commits that broke the image — because **nothing local installs from
a Dockerfile's build context.** The dependency resolves perfectly in the
repository, where capkit is present. It resolves nowhere in an image that never
received it.

`check:deploy` was the gate closest to this and it looked directly past it. It
verifies that every `COPY` names something real — written after
`COPY packages/mcp-server/package.json` broke CD for three commits — and a
missing COPY names nothing at all. **A check for wrong paths cannot see an absent
one.**

### The check that exists now

For every `packages/*/Dockerfile`, each `workspace:` dependency of that package
must appear as a `COPY packages/<dep>/` in it. Five edges across the repository,
all present. Proved by deleting the three lines I just added and watching it name
the file, the dependency and the consequence.

That is the honest version of "we fixed it": the Dockerfile is correct now, and
the reason it was wrong for five hours is that the gate protecting it could only
see one half of the problem.

### What it says about the rest of the gates

Twenty-four checks, and the deployment path had a hole this size. Every gate here
answers a question somebody thought to ask; none of them answers *what did I
change that nothing watches?* The container build was the one thing in this
repository that could only be tested by doing it, and it is the one thing this
environment cannot do — no Docker daemon. That gap is now covered statically,
which is weaker than building the image and is what is available.

---

## 4g. Three of five plan limits are advertised and counted by nothing

Building the tenancy surface meant asking what the numbers on it would mean. The
answer is the finding.

Every plan in `billing.ts` declares five limits. **`enforceQuota` is applied to
two routes** — `POST /auth/token` and `POST /auth/token/validate` — and nowhere
else:

| Limit | Counted by | Free plan says |
|---|---|---|
| `agents` | `POST /auth/token` | 3 |
| `validations` | `POST /auth/token/validate` | 10,000 |
| `schedules` | **nothing** | 5 |
| `benchmarkRuns` | **nothing** | 100 |
| `auditRetentionDays` | **nothing, and nothing enforces retention either** | 7 days |

Schedules are created in edge-run and benchmark runs in quickbench; neither
shares the meter. `auditRetentionDays` is not a counter at all — and since
ABSuite deletes no records, nothing acts on it in either direction.

Measured rather than read. A tenant on the free plan, three tokens issued:

```
agents               used 3    of 3         ← moved, and 402 on the fourth
validations          used 0    of 10000     ← real, just unused
auditRetentionDays   used 0    of 7         ← cannot move
schedules            used 0    of 5         ← cannot move
benchmarkRuns        used 0    of 100       ← cannot move
```

Suspension works too: `403 TENANT_SUSPENDED` on the next request.

### Why this decided what the screen is

Five gauges all reading `0 / N` are indistinguishable from each other, and three
of them are meaningless. **Zero because nothing counted looks exactly like zero
because nothing happened**, and the reader concludes they have headroom. It is
the defect `watch.coverage()` exists to prevent, arriving in a screen about
money — which is the worst place for it, because the reader is deciding whether
to upgrade.

So an unmetered limit reads `ABSENT` with its reason attached, never a number and
never a bar. `approachingLimit` is described as covering counted limits only,
because a metric nothing increments can never appear there.

### The hand-copied fact, and the gate that holds it

Which limits are real is written into `Tenancy.tsx` as a map. **That is a
hand-copied fact — the defect this repository keeps finding in itself** — and it
is copied deliberately, because the alternative is inferring *metered* from a
usage of zero, which cannot tell the two zeros apart.

`pnpm check:metered` reads `enforceQuota` from capkit's server and the map from
the panel and fails on any disagreement. Proved in both directions: wiring
`enforceQuota('schedules')` into a route turns it red, and so does the panel
claiming `schedules` is counted when nothing counts it.

### The rest of the surface

Six routes proxied, all admin-guarded. Eleven tests. The one piece of real logic
is that `/admin/tenants/:id/:action` checks the action against a list rather than
interpolating it — without that, the route would let a caller aim the dashboard's
admin key at any capkit path beneath `/admin/tenants/:id/`. Disabling the
allowlist turns three red, including a path-traversal attempt.

The API key is returned exactly once, by create and by rotate, and stored only as
a SHA-256 hash. It is absent from the list response — checked, not assumed — and
the panel says it cannot be shown again, because a screen that could show it
twice would mean the key had been kept.

### And a note on `check:numbers`, twice in one day

Adding these routes moved the admin-guarded count from 42 to 45, and adding the
gate moved the check count from 23 to 24. Both were caught by gates written
earlier today, in the same session, against documents I had corrected hours
before. That is the mechanism doing exactly what it exists for, on its author.

---

## 4f. Model identity, which was built and unreachable

`capkit/src/model-identity.ts` and its four routes have existed for a long time.
Nothing could reach them. The only way to approve a model, replace an approval or
ask for an attestation was curl — so on every real instance, nothing had ever
been approved, and every attestation therefore answered `UNKNOWN`.

That is the same failure Identity had, and it is worth naming precisely: **a
layer that cannot be operated reports exactly what an unbuilt one reports.** The
record cannot distinguish them, and neither can a buyer.

### What it catches, and what it does not

The claim is deliberately narrow. It compares **identifying material** — provider,
model, version, digest — and says nothing about behaviour. What that catches is
the set of changes that do not announce themselves in an execution log: a
provider rolling a version silently, a quantisation changing numerics, a proxy
repointed at a different endpoint.

Demonstrated end to end through the dashboard against a live capkit:

```
approve   refunds-classifier   anthropic / claude-sonnet-4-5 / 2026-05-01
attest    same fingerprint     DEMONSTRATED
attest    version 2026-08-01   FAILED — drift: version 2026-05-01 -> 2026-08-01
supersede by ops:bob, with a basis
attest    version 2026-08-01   DEMONSTRATED
approve   the same name again  409 ALREADY_APPROVED
```

`SERVICES.md` has claimed for months that *"a silent provider version roll is a
`FAILED` attestation, not a surprise."* That is now something a person can
produce from the interface rather than a sentence.

### Three decisions in the surface

**Superseding is its own action, with its own form.** capkit answers `409` if you
approve a name twice, and that refusal is load-bearing — replacing an approval is
a decision somebody makes, not something that happens because setup ran again. So
the panel asks who and why, and will not submit without both.

**The attestation is a question you ask, not a stored verdict.** You supply what
you observe now. Nothing here goes and interrogates a provider on your behalf,
because a fingerprint this server collected is a fingerprint this server could
invent — and the whole point is that the comparison is checkable by someone who
does not trust the server.

**The limits travel with the answer.** `behaviour` and `reasoning` are printed
beside every attestation rather than footnoted, because a reader who takes
`DEMONSTRATED` away without them has taken the wrong thing: the model reporting
the same version can still answer differently, and nothing here would know.

### Proved, including by the gate written this morning

Eight tests on the proxy — four asserting `403` unauthenticated, three asserting
that an unreachable capkit produces `502` rather than an empty list, one that a
model name with a slash is encoded rather than interpolated. Load-bearing:
removing `requireAdminAccess` from one route turns one red.

And `check:numbers` caught the change immediately. Four new admin-guarded routes
moved the count from 38 to 42, and `DEPLOY.md` still said 38 — in the gate added
two entries earlier, for exactly this. **A number that corrects itself the same
day it is written is the mechanism working**, not a coincidence.

---

## 4e. GUIDE, NOTARY and SERVICES — the last three no gate covers

`PERFORMANCE`, `PROTOCOL`, `API`, `CONSTITUTION`, `MODULES` and `UI-PHILOSOPHY`
are each already held to the code by a gate. That left three documents whose
claims nothing checks.

**`GUIDE.md` was run, verbatim.** It is a curl walkthrough, so the audit is to
execute it against a real capkit rather than read it:

```
STEP 1 — mint a token                  token: eyJhbGciOiJIUzI1NiIs…
STEP 2 — record an execution           {"id":"exec_0bcf8593…","outcome":"success"}
STEP 3 — jq -r .publicKey              '-----BEGIN PUBLIC KEY-----…'
STEP 4 — verify the chain              {"valid":true,"checked":1,…}
```

Four steps, four correct results, including the field name — `publicKey` on that
route, which was worth confirming because `publicKeyPem` is the field name
everywhere else in the same server.

**`NOTARY.md` had one defect**: a heading reading *"The four endpoints"* above a
table of **five**. All five exist. It is the same shape as `DEPLOY.md`'s "five
secrets" listing six, found two entries earlier — a count written in prose beside
a list that grew.

Both are fixed the same way, and it is the fix the FAQ got too: **remove the
count**. A number restated next to the thing it counts has no protection, and
written as a word it is invisible to the gate that exists to catch exactly this.
Three instances in one sweep is a pattern, not three typos.

**`SERVICES.md`** marks five offerings **Built**, and each names a module that
exists. Nothing there overstates.

---

## 4d. The FAQ said microseconds; the measurement says milliseconds

`FAQ.md` is the customer-facing document, and Q13 answers *will it slow my agent
down?* with **"Recording is a hash and a signature — microseconds."**

`trace.record` has a measured p50 of **1.27 ms**. Out by a factor of about fifty.

The sentence is defensible word by word and wrong as an answer. The hash and the
signature *are* microseconds. What a caller actually invokes is `record`, which
also commits to SQLite in the same transaction — and the commit is the cost. The
cryptography was never the expensive part, which is the genuinely useful thing to
tell somebody, and the old answer hid it behind a flattering number.

Fixed by not restating a number at all. `PERFORMANCE.md` is generated from the
benchmark and CI fails if the two disagree; a figure retyped into an answer has
no such protection, and this is the second time in one sweep that a hand-copied
number was the defect.

### The rest of the FAQ, checked by running it

| Claim | Result |
|---|---|
| Q13: *"CI fails if the document and the benchmark disagree"* | **True.** `gen-performance-doc.mjs --check` is a step in `ci.yml`, and it passes |
| Q14: *"inputs and outputs are hashed and dropped"* | **DEMONSTRATED.** A card number and an output canary were recorded, then searched for in the database file *and its write-ahead log*. Neither appears |
| Q19: *"what it deliberately does not do"* | **True.** 8 advertised refusals, each still enforced by a test — `check:constraints` |

Q14 is the one worth having proved rather than read. It is the claim that decides
whether a regulated buyer can keep the record for seven years, and the WAL had to
be searched too — a payload can be absent from the `.db` file and still sitting
in the log beside it.

---

## 4c. A publish that failed twice, and not for the reason it looked like

`capkit@1.8.0` was built, tested and packed cleanly and then failed to publish,
twice:

```
npm error code TLOG_CREATE_ENTRY_ERROR
npm error error creating tlog entry - (409) an equivalent entry already exists
                                       in the transparency log
```

The first instinct was that the new dashboard smoke tests had broken CI — they
spawn a real server, bind `127.0.0.2`, and had never run on a GitHub runner.
**That was wrong.** The logs show build and test passing; the failure is in
`npm publish --provenance`, after the tarball is packed.

Both runs produced a **byte-identical tarball** — the same shasum,
`4d7f50bd…` — so Sigstore's transparency log saw the same artifact signed by the
same identity twice and refused the duplicate. The first attempt got far enough
to write the log entry and not far enough to complete the publish, which leaves
that exact version permanently unpublishable.

The fix is a version whose tarball differs: **1.8.0 is skipped and 1.8.1 ships
the same code.** A gap in the version series is cosmetic; a version that can
never be published is not.

Worth recording for the same reason as everything else here: *"CI is broken by my
change"* was the available story, it fit, and reading the actual log took less
time than acting on it would have.

---

## 4b. Every document, checked for what it names

The remaining thirteen documents were swept mechanically: every route, script and
file named in backticks, against every server in the repository, the root
`package.json`, and the filesystem.

**237 citations across 31 documents, all resolving.** That is the whole of
`docs/` plus every package README, and it is now a gate rather than a sweep —
`check:apis` fails the build on a document naming a route, script or file that
does not exist. Proved by adding one of each and watching all three get named.

### The probe was wrong before the documents were

The first pass reported **37 broken route citations** and every one was real. It
searched only capkit's `server.ts`; the routes belonged to trust, edge-run,
quickbench, connector-starter and the dashboard. Six servers unexamined, thirty-
seven false findings, and about ninety seconds from being written up.

That is the fourth time in this sweep that a hasty probe produced a false
finding, and the fourth time the thing that caught it was refusing to accept a
surprising result without confirming the mechanism. A gate that cries wolf at
that rate gets switched off, which is why it checks all seven servers and why
this is recorded next to the gate rather than in a commit message nobody reads.

### And it immediately caught two of mine

The `/secrets/dump` and `/trust-score` routes appear in §3x and §3w — added
temporarily to prove other gates fire, then removed. Written in backticks with a
method in front they read as API citations, for routes that do not exist, and
both were.

Then this paragraph did it again. Naming them here in the same shape, to explain
the problem, reproduced the problem — the gate flagged §4b while §4b was being
written about the gate flagging §3x. Dropping the method prefix is the whole fix,
and the rule it teaches is small and real: **describing an API and citing one
look identical to a checker, so write the difference deliberately.**

### What "audited" now means, per document

| | |
|---|---|
| **Citations** — routes, scripts, files, imported symbols, compiled examples | **All 31 documents**, and gated |
| **Behavioural claims** — does the thing described actually behave that way | `SECURITY-MODEL`, `ARCHITECTURE`, `COMPLIANCE`, `DEPLOY`, `HOSTING` |
| Neither | none |

The second row is the one that cannot be gated, and the distinction is worth
keeping: a document can cite a real route and still be wrong about what it does.
That is exactly what `SECURITY-MODEL.md` was.

---

## 4a. The operational documents, and a number hand-copied into a program

`DEPLOY.md`, `HOSTING.md`, `GUIDE.md` and `SERVICES.md` are what an operator acts
on. Every citation in them resolves: 3 commands are real `package.json` scripts,
6 cited files exist, and all 5 named environment variables are read by something.
`HOSTING.md` is accurate throughout — its refusals about Cloud Run and Firestore,
the plaintext-disk statement, and the two-secrets ranking all hold.

Two claims in `DEPLOY.md` did not.

**"Twenty-eight routes sit behind `ABSUITE_ADMIN_API_KEY`."** There are 38. That
figure decides whether an operator treats the variable as important.

**"The five secrets… prints all five."** `gen-deploy-secrets.mjs` prints **six**.
The table omitted `CAPKIT_TRACE_KEY_ID`, which names the signing key in every
trace — so an operator copying six lines out of the script found five described.

### The same wrong number was inside a program

`deploy/serve-all.mjs` refuses to start without `ABSUITE_ADMIN_API_KEY` and
explains why, in a message printed to whoever is deploying. It said *"Twenty-eight
read routes sit behind it"* — the same figure, hand-copied into a second place,
both wrong.

`check:numbers` had never seen it, because it scanned Markdown. **A published
number in a program was outside the one check built to catch published numbers**,
and a claim is a claim wherever a person reads it. The gate now scans
`deploy/serve-all.mjs` too, and derives the route count from the dashboard rather
than trusting either copy.

Spelled out in words was the other half of the escape: every pattern in that gate
matches digits. Both copies now use a digit, which is a smaller lesson than it
looks — *a number written as a word is a number the checker cannot see.*

Proved by putting `28` back: the gate names the file and line.

---

## 3z. DNS rebinding, closed

Four entries in this document listed DNS rebinding as open, each time correctly
and each time with the same sentence about what closing it would take: *an HTTP
agent that connects to the address that was checked.*

The window was real. `guardedFetch` resolved a hostname, classified the answer,
then handed the **hostname** to `fetch`, which resolved it a second time. A
resolver answering differently between the two calls got a request the guard had
approved, aimed at an address it never saw.

`guardedFetch` now pins the connection, with an `undici` agent whose `lookup`
returns the address that was classified. TLS is untouched — the certificate is
still validated against the hostname, because only resolution is overridden.

**Proved, not asserted.** Two servers on the same port, on different loopback
addresses, one hostname:

```
hostname is "localhost" in both requests; only the pin differs.

  pinned to 127.0.0.1  ->  SERVER-ON-127.0.0.1
  pinned to 127.0.0.2  ->  SERVER-ON-127.0.0.2

  unpinned (whatever DNS says) -> SERVER-ON-127.0.0.1
```

Three tests, and the pin is load-bearing: making the agent ignore the address it
was given turns one red immediately.

### Why `undici`, and what it costs

Writing the client by hand on `node:https` would have avoided a dependency and
been the wrong trade. `fetch` does compression, keep-alive, redirect semantics
and TLS; a hand-rolled replacement would have swapped a rebinding window for a
decompression bug across four services. `undici` is what Node's own `fetch` is
built from.

**The cost is one runtime dependency on `@absuitecore/capkit`**, which previously
had one. That is stated here and in the README rather than absorbed quietly.

### The bug in the fix, found by running it

The first version returned the pinned address as a bare string. Node calls
`lookup` in two shapes — `net.connect` uses `{ all: true }` and expects an array
of `{ address, family }` — so every request died at connect with
`ERR_INVALID_IP_ADDRESS: undefined`. Visible immediately because the probe was
run before the code was believed.

### What remains, which is not rebinding

A name whose *legitimate* answer is hostile. If an attacker owns the DNS record
and points it at their own public server, the guard classifies a public address,
pins to it, and connects — correctly. That is the operator having supplied a URL
under someone else's control, and no address check can fix it. It is now the
entry in `SECURITY-MODEL.md` where rebinding used to be.

---

## 3y. The same question asked of capkit, which is the one that matters

The dashboard holds the admin key. **capkit is what the admin key commands** — it
mints tokens, holds the chain, enrols identities. Checking only the dashboard was
checking the easier one, so `check:routeauth` now covers both: **111 routes, 86
guarded, 25 public with a stated reason, 0 undecided.**

Thirteen capkit routes carried no `authorise()`. Probed against a running
instance rather than read:

| Route | What it does | Verdict |
|---|---|---|
| `/health`, `/ready` | liveness | correct — a probe cannot carry a token |
| `/metrics` | Prometheus: route names, status codes, counts | accepted; a scraper cannot carry a token either. Restrict at the network |
| `/plans` | the published price list | correct |
| `/usage` | **returns `401 TENANT_KEY_REQUIRED`** — guarded inside the handler, not at the router | correct, and only visible by asking |
| `GET`/`POST /signup` | **`404` unless self-serve signup is explicitly enabled** | correct, fails closed |
| `POST /billing/webhook` | authenticated by signature inside the handler | correct — a payment provider cannot carry a token |
| `/executions/public-key`, `POST /executions/verify` | the key, and verification | **deliberate**, as on the dashboard |
| `POST /identities/:subject/challenge` | issues a nonce | **an enumeration oracle** |

`/usage` and `/signup` are the two worth naming as *correct*: both look open at
the router and are not, and the only way to establish that was to send the
request. Reading the route table would have produced two false findings.

### The one real finding, and why it is not being fixed

`POST /identities/:subject/challenge` must be unauthenticated — an agent cannot
need authority in order to prove who it is, and gating it inverts the whole
identity layer. That argument was already in the code and it is right.

What was not stated is the side effect. An unknown subject answers `404
IDENTITY_UNKNOWN`, an enrolled one answers `200` with a nonce, and a **suspended
one answers `403`** — so an anonymous caller can enumerate which subjects exist
and which are suspended, at 60 requests a minute.

Returning a nonce for every subject would close it. It is not being done, and the
reason is stated rather than assumed: the commonest real failure at this endpoint
is a typo in a subject name, and the operator would get *your signature is
invalid* about a subject that was never enrolled. Subject names are inventory,
not credentials. **The trade is now written on the route and in
[SECURITY-MODEL.md](SECURITY-MODEL.md) under what this does not protect
against**, which is the difference between a decision and an oversight.

---

## 3x. Twelve routes with no authentication, and nobody had decided

Asking *which routes carry no auth?* — the question that found `/endpoint-check`
— returned **12 of the dashboard's 50**. That is the most privileged process in a
default deployment: it holds `CAPKIT_ADMIN_KEY`, mounts the Docker socket, and
can start and stop services.

**The first thing checked was the worst case, mechanically:** does any
unauthenticated route forward the dashboard's own admin key upstream? The
dashboard attaches `X-ABSuite-Admin-Key` to about twenty calls into capkit, and
an anonymous caller borrowing that authority would be privilege escalation
outright.

```
routes: 50   unauthenticated: 12   of those forwarding the admin key: 0
```

None. That is the good news and it is worth stating first, because the rest is
smaller.

### What an anonymous caller actually receives

Probed against a running server rather than reasoned about:

| Route | What comes back | Verdict |
|---|---|---|
| `/health`, `GET *` | liveness, the static bundle | correct |
| `/executions/public-key`, `POST /executions/verify` | the key, and verification | **correct and deliberate** — an auditor who must ask permission proves nothing |
| `/system/layers` | `docs/CONSTITUTION.md`, which ships in the repo | correct |
| `/status`, `/bench/core`, `/bench/core/regression` | own-service state, own measurements | accepted |
| `POST /ai/policy/generate`, `POST /connector-starter/generate` | deterministic generated text | accepted; bounded compute, rate-limited |
| `/ai/providers` | **which providers have keys configured** — never key material | accepted, now stated |
| `/service-health/absuite-db` | **`ABSUITE_DB_PATH`** | **fixed** |

The database path was disclosed to anonymous callers **in a field the interface
never read**. Grepping `dashboard-ui/src` for it returns nothing. It was leaked
for no purpose at all, which is the cheapest kind of finding there is.

### The finding is not twelve. It is that nobody had decided

Several of the twelve are right to be open, and one constraint explains most of
the rest: **`requireAdminAccess` returns 503 when no admin key is configured**,
which is the default. A route the interface needs on a fresh install cannot be
guarded without breaking the product for everyone who has not set a key.

That is a real reason. It was in nobody's head in writing, so a route that was
open *because somebody thought about it* looked identical to a route that was
open *because nobody had*. `/endpoint-check` was the second kind for as long as
it existed.

`check:routeauth` now requires every route to be guarded or annotated
`// public-route: <reason>`. All twelve carry one. Proved by adding a `/secrets/dump` route with neither, and watching the gate
name the file and line.

Four tests assert what the public routes disclose, including a blunt sweep for
environment values across all of them. Proved by restoring the database path:
two turn red.

### One correction to my own work in this pass

The first version of the traversal test asserted that
`/service-health/../../etc/passwd` would not return 200. It does return 200 — the
client normalises `../..` before sending, so the request lands on the
single-page-app fallback and receives the bundle, never reaching the handler. The
assertion was wrong, not the route. The encoded forms, which do reach it, are
refused by the service allowlist, and the test now asserts those.

---

## 3w. The compliance document, audited the same way — and it mostly held

`COMPLIANCE.md` is the highest-stakes document in the repository: it maps EU AI
Act articles, ISO 42001 controls, SOC 2 criteria and NIST AI RMF functions onto
specific endpoints, fields and test files. It is the document a buyer's auditor
reads, and it had never been checked against the code.

**Every citation resolves.** All 10 routes exist in `server.ts`, all 4 named test
files exist, all 6 cited record fields are real, and all 4 cited modules are
there. The specific claims tested by running them:

| Claim | Result |
|---|---|
| *"working `backup`/`restore`"* | **DEMONSTRATED.** `scripts/backup.mjs create` snapshots via SQLite's online backup API, captures WAL content, and verifies the chain — run against a database with 3 records, reported 3 and intact |
| *a record this build cannot read reports `checkable: false`* | Real, in `explain.ts` and `conditions.ts` |
| *`watch.test.ts` fails if "incident", "severity", "critical" or a recommendation appears* | Real, and asserted exactly as described |
| *every report carries an `unverifiable` list* | Real |
| *ABSuite does not notify anybody* | Real, and correctly stated as **a gap against a real obligation** |

That is a document written by someone who checked. The preamble — *"a mapping
document that only lists the boxes it fills is a sales brochure"* — is honoured
by the body, which is more than `SECURITY-MODEL.md` managed.

### Two rows were wrong, both in §1.5

*"There is no trust score anywhere, and `check:doctrine` fails the build if one
appears."*

**The wrong gate is named.** It is `check:fabrication`. An auditor following that
pointer finds a gate that checks something else entirely, which is worse than no
pointer.

**"Anywhere" is not the scope.** The check reads the 53 source files under
`packages/dashboard-ui/src` and matches *rendered* text. A score computed in a
service and returned by an API is not caught — confirmed by adding a
`/trust-score` route to capkit's server and watching the check pass. The doctrine
holds because nothing computes one, **not because a gate would stop it**, and the
row now says so.

### The process failure in this pass, which is the part worth keeping

Testing whether the gate really fires, I injected `'Trust score: 87'` into
`Agents.tsx` with a Python `.replace()` anchored on `export default function`.
That string does not appear in the file. The replace matched nothing, wrote the
file unchanged, and reported success. The gate then passed — correctly, because
nothing had been injected.

I read that as the gate failing to fire, reasoned that its negation exemption had
swallowed the match, **and wrote a fix for it** — narrowing the exemption to a
single line, with a comment confidently explaining a cause that had not happened.
It was reverted before it was committed, but only because the next probe
contradicted it.

This is the second occurrence of the exact failure §3r records, and §3r states
the lesson: *a `.replace()` with no assertion is not an edit.* Writing a lesson
down did not prevent it. What caught it both times was the same thing — treating
a result that should have been red, and was green, as something to explain rather
than accept.

The rule that actually works is narrower than the lesson: **every scripted edit
asserts its pattern before writing**, and every negative result gets one
confirmation that the change under test was really applied. The three probes in
this pass that carried an `assert` all behaved correctly; the one that did not is
the one that produced a false finding and nearly a false fix.

---

## 3v. The most privileged process in the deployment had no tests at all

`find packages/dashboard-ui -name '*.test.ts'` returned nothing. The dashboard
holds `CAPKIT_ADMIN_KEY`, mounts the Docker socket, and can start and stop
services — and not one of its routes had ever been asserted against.

That is how `/endpoint-check` became the fourth instance of an SSRF this
repository had already fixed three times, carrying two defects at once: **no
`requireAdminAccess`**, alone among the routes that reach anything, and **a
hostname allowlist that covered one hop**. Both were found by probing a running
server, and both were fixed by hand.

Which left the fix exactly as durable as one person's memory of a terminal
session. Every other fix in this sweep had a test proved load-bearing by
reintroducing the defect; that one had a paragraph.

Ten tests now, against a real spawned server. `127.0.0.2` is the off-allowlist
target throughout — the whole of `127/8` is local on Linux, so it needs no
external network and no environment-specific interface, and it is genuinely not
on the health-host list rather than being staged to look that way.

Proved by reverting each defect separately:

| Reverted | Turns red |
|---|---|
| `requireAdminAccess` removed from the route | 3 — unauthenticated, wrong-key, and unconfigured |
| `only:` changed back to `allow:` | 1 — the redirect reaches the excluded host |

The third of those three is the one worth naming: **the route is closed rather
than open when no admin key is configured**, which is the state most instances
actually run in. If it failed open there, the fix would be void exactly where it
matters most.

---

## 3u. A code block is the most credible thing on the page

§3t ended by saying the rest of `docs/` was UNKNOWN rather than sound. This is
the pass that stopped it being UNKNOWN for the parts that can be checked
mechanically, and it found three more things.

### The token structure block was wrong about what a token contains

`SECURITY-MODEL.md` presented `kid: string` and `aud: 'absuite://production'` as
unconditional fields. Minting one and decoding it:

```
payload: { sub, scope, iat, exp, jti }
header : { alg, typ }
```

Both are opt-in and absent unless passed. **An operator who believed audience
binding was on by default had none.** The validation flow listed *"extracts kid,
looks up signing key"* and *"checks aud matches"* as unconditional steps; both
are conditional.

Worth recording how this got missed: §3t's own table marked this row
**Accurate**, on the strength of reading `capability.ts` and seeing `kid?:` and
`aud?:` declared. The declaration was right and the conclusion was wrong — an
optional field in a type says nothing about whether the document showing it as
required is honest. Decoding a real token took ten seconds and settled it.

### The published README listed half the error codes

`@absuitecore/capkit`'s README — the page npm renders — enumerated four
rejection codes. There are eight. A caller switching on `result.error` fell
through on `TOKEN_MISSING`, `TOKEN_MALFORMED`, `TOKEN_NOT_ACTIVE` and
`TOKEN_AUDIENCE_MISMATCH`, the last of which is the one that matters if you
believed audience binding was protecting you.

Four tests now pin it, including one that fails if a ninth code is ever added —
proved by adding `TOKEN_ISSUER_MISMATCH` and watching it go red. That is the
only mechanism that would have caught the list going stale at four.

### The fix I wrote for §3t was itself an example nobody could run

Replacing `await capkit.rotateKey()`, I wrote `ring.rotate(…)` in a block that
never constructs `ring`, and called `rotated.active()` as a method when `active`
is a getter. Both wrong, in the correction to a section about wrong examples.

It surfaced because the example was **run before it was published**, which is now
the standard for a code block in this repository: the output in
`SECURITY-MODEL.md` is copied from a terminal, not written from a type signature.

### `pnpm check:apis`

Every `import { … } from '@absuitecore/…'` in a fenced ts/js block, in every
document, checked against the real export surface — read from the built
`dist/index.js` rather than a list maintained here, because a list here would be
one more hand-copied fact that drifts.

Currently 52 symbols across 40 blocks in 31 documents, all real. **It found
nothing new**, and that is the honest result: it is a tripwire for the next
`AIPolicyRule`, not a discovery. Proved by adding a fabricated `rotateKey` import
to `docs/MODULES.md` and watching it name the file and line.

### And then it compiles them

Symbol existence does not catch `rotated.active()` on a getter. So the same gate
extracts every self-contained block — 23 of them — and runs `tsc --strict`
against the packages' own `.d.ts` declarations.

A document elides its setup: `secret`, `publicKeyPem`, `input` are named without
being declared, and should be. Four error codes say exactly that (`TS2304`,
`TS2552`, `TS18004`, `TS2307`) and are ignored **by category, in code**. Everything
else fails the build. An ignore list tuned until the output went quiet would be a
gate that reports success by suppression, so the list is short and it is stated.

Proved by reintroducing three real classes of error and watching each get named
with its file, its line, and its line within the block:

```
TS6234  This expression is not callable because it is a 'get' accessor
TS2551  Property 'rotateKey' does not exist on type 'KeyRing'. Did you mean 'rotate'?
TS2345  Argument of type 'number' is not assignable to parameter of type 'string'
```

The first of those is the mistake I made writing the correction to §3t.

**One thing worth recording about building it.** The first harness ran with
`strict: false` and reported the capkit README's headline example as broken —
`Property 'error' does not exist on type 'CapabilityValidation'`. It was about to
be written up as a defect. It is not one: `strictNullChecks: false` silently
disables discriminated-union narrowing, so a correct example compiles as wrong.
The gate is strict for that reason, and the near-miss is recorded because a
*checker* that produces false findings is worse than no checker — it spends the
credibility that makes the true ones actionable.

**What it still does not check.** Prose, and the elided identifiers themselves.
`ring.rotate(…)` in a block that never constructs `ring` reports `TS2304`, which
is indistinguishable from a deliberate elision. That one is caught by running
examples before publishing them, which is a practice and not a gate.

---

## 3t. The security document described controls that do not exist

Three passes of outbound work all assumed `docs/SECURITY-MODEL.md` was true, and
none of them checked it. Read against the code, claim by claim:

| Claim | What is there |
|---|---|
| *"CapKit's AI content policy engine filters prompts and responses"*, with an `AIPolicyRule` interface and a default policy blocking prompt-injection patterns | **ABSENT.** A repository-wide search for prompt-injection filtering returns nothing. |
| Threat model: *Prompt injection → AI content policy regex patterns* | **ABSENT**, same cause — and this is the row a buyer reads. |
| *"CapKit filters known patterns but cannot catch sophisticated jailbreaks"* | It filters none. The sentence conceded a limit on a thing that was not running. |
| Rate limits: per token 100/min, per IP 500/min, per endpoint 1000/min | Token bucket, default **60/min**, keyed `tenant:<id>` or `ip:<addr>`. **No per-endpoint limit exists.** Numbers measured, not read. |
| *"stored in SQLite with a sliding window algorithm"* | In-memory `Map`. A restart resets every bucket; two replicas at 60/min admit 120/min. |
| `await capkit.rotateKey()` | No such method. Real API is `KeyRing.rotate(secret, kid, retain)` — synchronous, and you supply the secret. |
| *"Keys are rotated regularly (automatically via the key rotation system)"* | Nothing rotates automatically. No scheduler exists. |
| *"defense-in-depth at four levels: … transport encryption …"* and *"in production, enable TLS by configuring certificates in each service's environment"* | **No service terminates TLS.** No service reads a certificate. There is no such configuration. |
| Audit log written synchronously, immutable, no UPDATE or DELETE | **Accurate.** `appendFileSync`, append-only. |
| *"Stored in SQLite"* (audit log) | A JSONL file. |
| Token carries `kid`, `aud`, `jti` | `jti` always. **`kid` and `aud` are opt-in and absent by default** — I marked this row accurate on a first pass by reading `capability.ts`, where both are `?:`. Decoding a minted token is what settled it. See §3u. |

### This is §3's own defect, in the same family of document

`ABSUITE_DB_ENCRYPTION_KEY` sat in `.env.example` telling operators to generate
32 random bytes while nothing read it, and this audit already calls that *worse
than a missing feature, because a missing feature does not produce false
confidence.* The prompt-injection row is the same object and lands harder: an
operator can check whether their database is encrypted, and cannot easily check
whether an engine that was never built is filtering their prompts.

### The filter was not implemented, and that is the decision

The obvious repair is to build the thing the document promised. It is the wrong
one. [PRINCIPLES.md](../PRINCIPLES.md) refuses **a hallucination detector**,
because a control that cannot define the class it claims to catch produces false
confidence rather than safety — and a regex list for prompt injection is the same
object. It would stop the examples in its own tests, miss everything written
afterwards, and leave an operator believing the class was covered.

So the position is stated instead: **ABSuite does not filter prompts.** An
injected agent still acts under a capability token that names what it may do, and
whatever it does is signed, hash-chained and attributable. That is a smaller
claim than filtering and it is one that holds.

The rate-limiting correction went the other way — the implementation is *better*
than the document. A token bucket beats the sliding window that was advertised,
and `rate-limit.ts` explains why. The document was still wrong, and being wrong
in your own favour is not better than being wrong: an operator sizing a
deployment against "stored in SQLite" would have assumed limits survived a
restart and held across replicas. Neither is true.

### What this pass did not check

Every claim above is from `SECURITY-MODEL.md` and `ARCHITECTURE.md`. The rest of
`docs/` has not had the same treatment, and until it does, the honest state of
those documents is UNKNOWN rather than sound.

---

## 3s. Four instances of one defect, and nothing stopping a fifth

`webhook.send`, edge-run's `http` tasks, quickbench's `http` provider, the
dashboard's `/endpoint-check`. Four packages, three passes, one defect — and
every one of them was found by a person asking *what else fetches a URL somebody
else chose?* The fourth was found only because the question got asked a fourth
time.

That is not a process. A `fetch(url)` added to a route handler next month looks
exactly like the forty-two calls in this repository that are perfectly safe, and
the difference is invisible at a glance.

`pnpm check:outbound` requires every `fetch(` in server-side source to be either
`guardedFetch`, or annotated `// outbound-ok: <reason>`.

**The annotation does not make anything safe.** It makes someone write down why
it is safe, on the line, where the next reader sees it. A gate that tried to
infer safety from the shape of a URL expression would be guessing, and would be
wrong quietly — this one is wrong loudly or not at all. Current state: 5 guarded,
9 annotated, 0 unaccounted, across 69 files.

Enumerating them was itself worth doing. The dashboard's 42 `fetchJson` calls all
build their URL from a fixed `SERVICE_BASE_URLS` map with `encodeURIComponent` on
each path segment — checked one by one rather than assumed, and now recorded on
the function so the next person does not have to check again.

It carries a `FLOOR` of 40 files, for the reason §3d exists: three gates in this
repository once passed by matching an empty file set, one of them written to
catch exactly that.

Proved by adding a fifth instance the way a real one would arrive — a `notify()`
helper on `TaskRuntime` calling `fetch(url)` — and watching the gate name the
file and line and exit 1.

**And it immediately caught something else.** Adding a twenty-first check made
`check:numbers` fail on two documents that said `20 checks`. That is two gates
working: one that counts what the repository has, another that refuses to let a
document claim a number nobody measured.

---

## 3r. The fix for §3q had the same hole in it, ninety seconds after publishing

§3q made every redirect hop get classified. It did not make every redirect hop
get *allowlisted*, and those are different things.

edge-run enforces `EDGERUN_ALLOWED_HOSTS` before fetching, then passed the same
list to `guardedFetch` as `allow` — which exempts a host from the **range**
check and says nothing about hosts arrived at later. So with an allowlist naming
exactly one host:

```
direct call to a host NOT on the allowlist:
   {"ok":false,"error":"Host not allowed: 192.0.2.2"}

same host, via a redirect from the ONE allowlisted host:
   {"ok":true,"output":{"reached":"not-on-the-allowlist"},"statusCode":200}
   off-allowlist server hit 1 time(s)
```

`.env.example` calls `EDGERUN_ALLOWED_HOSTS` *the single most useful line in this
file*. A restriction that binds the first request and not the second is not a
restriction, and this was live in a version published minutes earlier.

`GuardedFetchOptions` now separates the two. `allow` means *these hosts skip the
range check*; `only` means *nothing but these hosts, ever*, and it binds every
hop. It is also checked **before** resolution, because it is a rule about names:
`resolveRanges` returning undefined is deliberately not a refusal, so checking
`only` afterwards would have let an unresolvable host skip the one rule that does
not depend on resolution.

### A fourth service was doing the same thing, unauthenticated

Asking *what else in this repository fetches a caller-supplied URL* — the
question that found §3n, §3o and §3q — turned up `/endpoint-check` on the
dashboard, which none of the previous passes had looked at because it is not a
published package.

Two defects, both demonstrated against a running server:

**It had no `requireAdminAccess`.** Every sibling route that touches a service
carries it; this one did not. The response distinguishes an answer from a refused
connection, so it was an unauthenticated localhost port scanner.

**Its hostname allowlist covered one hop.** An allowlisted service answering
`302 Location: http://192.0.2.2/` reached that host, and the route reported
`ok: true`. Same shape as edge-run's, found in the same hour, in a file with no
tests.

Both fixed, both verified against the running server: the redirect is now refused
naming the hop, the off-allowlist server logs zero requests, and checking a real
local service still returns `200` — the route still does its job.

### Two process notes, because they cost more than the bugs

**A test edit silently did not apply, and I nearly reported the result.** A
compound command began with `pkill -9 -f "server.ts"`, and the pattern matched
the shell's own command line — killing the shell before the rest ran. The
subsequent "tests pass after reintroducing the defect" was not evidence of a
weak test; nothing had been edited. It surfaced only because *tests still passing
after a defect is reintroduced* was treated as a result to explain rather than a
result to accept.

**A `.replace()` with no assertion is not an edit.** An earlier attempt at the
same revert matched nothing and reported success. Every scripted edit in this
pass asserts its pattern first, which is what turned the second failure into a
loud one.

Both are the same lesson as the rest of this document: **a step that cannot fail
loudly will eventually fail quietly**, and a green result whose cause you have
not verified is not a green result.

Proved by reintroducing the defect: making `only` bind hop zero alone turns 2
red — one in capkit, one in edge-run, both against real sockets.

---

## 3q. The guard was correct and completely bypassed, by one line of HTTP

Three packages had an SSRF guard. Each classified the URL before calling
`fetch`. Each was right about that URL. All three were defeated by a redirect,
which was demonstrated rather than reasoned about:

```
server A (public address)  →  302 Location: http://127.0.0.1:PORT/latest/meta-data/iam/

  hop 1 classified: public   → ALLOWED
  hop 2 classified: loopback → REFUSED
  hops the guard actually inspected: 1
  body returned: {"iam":"STOLEN-CREDENTIALS"}
```

`fetch` follows redirects by default and does not ask again. **Against a
redirect this was not partial protection — it was none.** A guard that inspects
only the URL the caller supplied is checking the one hop an attacker has no
reason to make hostile.

This is the finding that matters most in this pass, because everything written
about the previous one was true and none of it helped. The audit said three
services refuse link-local. They did. The READMEs said so. A `302` went straight
through all of it. Documentation that describes a control accurately, while the
control has a hole of this shape, is worse than no documentation — it is the
gloss this section exists to catch.

### Three more holes, found by probing spellings instead of reading code

**`::ffff:a9fe:a9fe` classified as public.** `new URL()` re-serialises an IPv6
address to its shortest form, so `[::ffff:169.254.169.254]` — what a person
writes, and what the test asserted — reaches the guard as `::ffff:a9fe:a9fe`.
The check looked for a dotted quad, found none, returned `public`.

The existing test passed the entire time. It fed the function the spelling the
author had in mind rather than the spelling the URL parser produces, which is a
specific and repeatable way for a unit test to be green and wrong. Classification
is now numeric — the address is expanded to its eight groups and compared as
numbers, so every spelling of one address is one address.

**`metadata.google.internal.` was not matched.** The trailing dot makes a valid
fully-qualified name that resolves identically and did not match the pattern. On
GCP the address check still caught it; the name check, which exists precisely
for when resolution cannot be trusted, did not.

**AWS serves IMDS over IPv6 at `fd00:ec2::254`.** That is a unique-local
address. edge-run and quickbench refuse link-local and *allow* unique-local —
correctly, because an `fd00::/8` service is exactly the kind of internal thing
they exist to call. So the IPv4 metadata service was refused and the IPv6 one,
serving the same credentials, was not.

That one is a lesson about the shape of the abstraction, not a typo. Metadata
endpoints are **not a range**, and modelling them as one guaranteed a gap the
moment a provider put theirs somewhere else. They are now tracked as endpoints —
`169.254.169.254`, `169.254.170.2` (ECS task role credentials), `100.100.100.200`
(Alibaba), `fd00:ec2::254` — and refused whatever a caller's range policy says,
so no caller carries the list.

### `guardedFetch`, and the parts of the spec that came with it

Following redirects by hand means owning what `fetch` was doing for us. Three
rules, all in one place:

1. **Every hop is classified**, not just the first.
2. **Metadata endpoints are refused regardless of policy.**
3. **`Authorization` and `Cookie` are dropped when the origin changes** — or a
   redirect becomes a way to harvest the caller's own tokens. This one fails
   silently: the request succeeds and the token is simply gone somewhere else.

Method rewriting came with it too. A 303 becomes a GET; a 301 or 302 on a POST
becomes a GET. Getting that wrong would not throw — it would re-POST a body to a
URL it had never been sent to.

### One promise was deliberately broken

edge-run used to say an `EDGERUN_ALLOWED_HOSTS` entry always wins, because *an
operator who names `169.254.169.254` has said what they mean*. That conflated two
statements. *Restrict which hosts this may call* is routine scoping; *yes, read
this machine's cloud credentials* is not, and the knob named for the first should
not quietly be the one that does the second.

The override still exists — a control an operator cannot switch off gets patched
out, and a patched-out control protects nobody — but it is now
`EDGERUN_ALLOW_METADATA=true`, which says what it does. The old test asserting
the old promise was rewritten rather than deleted, and says why.

### What this is proved by

Twenty-three tests on `guardedFetch`, against **real HTTP servers rather than a
stubbed `fetch`**. That is deliberate: the defect lived inside fetch's redirect
handling, so a stub returning whatever the test says would have passed against
the broken code. Two real servers, a real `302`, and the assertion is whether
the second server was reached — it now records zero requests.

Proved by reintroducing each defect in turn: the old redirect handling turns 3
red, the old IPv6 text match turns 6 red, the trailing-dot pattern 3, removing
`fd00:ec2::254` from the endpoint list 4.

**One thing was not demonstrated here and is not claimed.** Whether a kernel
routes `::ffff:a9fe:a9fe` to `169.254.169.254` depends on its network stack, and
this container has no IPv6 at all — `listen ::` returns `EAFNOSUPPORT`. The
misclassification is demonstrated; the reachability is UNKNOWN in this
environment. The guard does not depend on the answer, which is the point: a
control whose correctness rests on a property of the target machine's network
stack is not a control.

DNS rebinding was still open at the time of this entry, and stated as open.
**It is closed now — see §3z.**

---

## 3p. A security fix that was done everywhere except where people install it

Publishing §3o surfaced something that had nothing to do with it. The registry
said:

```
@absuitecore/edge-run   local 1.2.0   registry 1.0.2
```

**The §3n SSRF fix never reached npm.** It was committed, the audit recorded it
as done, the README described the guard, and `npm i @absuitecore/edge-run` still
delivered the version that would fetch `169.254.169.254` for you. Nothing looked
wrong from inside the repository, because nothing *was* wrong inside it.

This is §3f in a new shape. There, a hand-written package list meant three
documents named a package the registry did not have. Here, a version bump that
never got published meant every document described code nobody could install.
Same failure both times: **the repository and the artifact people actually
receive drifted apart, and the repository could not see it** — every check ran
against the tree, and the tree was fine.

`pnpm check:registry` now asks the registry directly and reports each package in
the same four words as everything else:

- `DEMONSTRATED` — the published version is the documented one
- `PENDING` — committed here, not published yet
- `FAILED` — the registry is *ahead*, so something was published from another tree
- `ABSENT` / `UNKNOWN` — no record, or the registry could not be reached

It exits non-zero only for `FAILED` and `ABSENT`. `PENDING` is the ordinary state
of a repository between a commit and a release, and `UNKNOWN` is a network
condition — failing on either would make it a gate people learn to ignore, which
is worse than not having one. It is not in `pnpm verify` for the same reason
`pnpm adoption` is not: it needs the network, and a gate that fails when the wifi
drops takes the twenty offline checks down with it.

The gap here was hours, not months. The check exists because the next one might
not be, and because a security fix that is only true in git is not a fix.

---

## 3o. The third instance, and the copy-paste that nearly shipped with it

§3j found SSRF in `webhook.send`. §3n found it in edge-run by asking the obvious
follow-up. The same question asked a third time — *what else takes a URL from a
caller and fetches it?* — reached quickbench, where `POST /run` takes `url` from
the request body under a `bench:run` scope. Probed on a default runtime:

```
REACHED  http://169.254.169.254/
REACHED  http://127.0.0.1:8081/
REACHED  http://10.0.0.5/
```

**This is the least severe of the three, and saying so is the point.** The
provider returns `{ ok, latencyMs }` and never the response body — measured,
`body-leaked=false` — so nothing is exfiltrated. Volume is capped at
`MAX_RUNS = 500` and `MAX_CONCURRENCY = 32`. What remains is an existence and
latency oracle plus a bounded amount of traffic aimed wherever the caller likes.
That is real and it is narrower than §3j, and inflating it to match the other
two would make the whole list less believable.

### Three fixes were about to become three copies of one guard

Writing the guard a third time is the moment to stop. **A hand-copied fact that
drifts is the defect this repository keeps finding in itself** — §3e was one
number in eleven places, §3f was a package list maintained by hand in six. A
third copy of an address classifier would have been the same failure with worse
consequences: fix one instance, leave the others quietly wrong.

So classification moved into `packages/capkit/src/outbound.ts`. All three
packages already depend on capkit, and the project's own stated pattern is that
enforcement lives in a library distributed to every service rather than in a
gateway.

### It classifies, and deliberately does not decide

There is no shared `isAllowed()`, because the right answer genuinely differs:

| | Private ranges | Why |
|---|---|---|
| `webhook.send` | **refused** | posts to third parties; `10.0.0.5` is not a Slack endpoint |
| `edge-run` | allowed | a task runner inside your own infrastructure — §3n |
| `quickbench` | allowed | benchmarking your own service is the entire use case |

All three agree on link-local. `169.254.0.0/16` is where every major cloud puts
instance metadata and is never a legitimate target for any of them, so that is
what each one refuses. A shared decision function would have had to pick a side
and be wrong somewhere; a shared classifier with per-caller policy is honest
about the difference.

connector-starter's local copy was deleted in the same pass, so the three now
share one table rather than three that agree today.

### The refactor introduced a false statement, and the tests caught it

The first version put the reason string on the range: `link-local` read *"the
cloud instance metadata range (169.254.0.0/16)"*. True of `169.254.169.254`.
Plainly false when printed about `fe80::1` — which is link-local and is not that
range. Three of edge-run's existing tests went red on it.

That is the failure mode of consolidation, in miniature: **a shared module can
bake one caller's phrasing into every caller's error message**, and the result
is a security warning that tells an operator something untrue. `describeTarget()`
now names the specific thing that matched, and `ResolvedTarget.why` carries it to
whichever package is reporting.

Thirty-two tests on the classifier, seventeen on the providers. Proved by
removing the guard: two turn red. A third — *the refusal is timed, not reported
as 0ms* — still passes without it, because the real network also refuses that
address. It is kept for the timing assertion and is not evidence the guard
exists.

---

## 3n. The same SSRF in edge-run, and worse — found by asking the obvious question

Fixing `webhook.send` in §3j left a question that should have been asked in the
same breath: **edge-run makes outbound HTTP calls too.** It does, and the answer
was worse.

`EDGERUN_ALLOWED_HOSTS` empty means *any host*, and empty is the documented
default. Probing a default runtime, every one of these was reachable with the
body returned in `output`:

```
REACHED  http://169.254.169.254/latest/meta-data/iam/security-credentials/
REACHED  http://metadata.google.internal/computeMetadata/v1/
REACHED  http://127.0.0.1:8081/executions
```

**Worse than §3j for one specific reason: plain `http:` is accepted.** AWS
IMDSv1 is HTTP-only. Requiring https in connector-starter incidentally blocked
the classic credential-theft path; here nothing did. And these are *scheduled*
tasks, so it runs unattended and repeatedly.

A `queue:write` scope means *queue a task*. It does not mean *read this
machine's IAM credentials*.

### The judgement call, and why it went the other way than §3j

`webhook.send` sends to third parties, so refusing private ranges there is
right. **edge-run is the opposite:** a task runner inside your own
infrastructure, where *call `http://10.0.0.5/reindex` every fifteen minutes* is
the product's primary job. Blocking `10.x` by default would break real
deployments to prevent nothing — and a control that breaks the main use case
gets switched off, which protects nobody.

So the fix is deliberately narrow. **Link-local only** — `169.254.0.0/16`, IPv6
`fe80::/10`, and IPv4-mapped forms — because that is never a legitimate
scheduled-task target and is the highest-value one there is. Private ranges and
loopback still work. An explicit `EDGERUN_ALLOWED_HOSTS` entry always wins: an
operator who names `169.254.169.254` has said what they mean.

### One thing the DNS check could not do

`metadata.google.internal` was still reachable after the first fix. It resolves
to `169.254.169.254` **on GCP and nowhere else** — `ENOTFOUND` here, verified
rather than assumed. So a resolution-based guard works only in the one
environment where it is hardest to test, which is not a guard worth trusting.
The name is now refused outright, alongside the address.

Twelve tests, proved by deleting the guard: six turn red. Four of them assert
the *permissive* half — private, loopback and public hosts must still work, or
the fix would have broken the product to secure it.

`.env.example` now says the empty default is a wide-open default, in those
words, rather than presenting it as neutral.

---

## 3m. Chain checkpointing, and the thing it cannot do

The last item in §5. Measured before it was built, because the rule here is that
no number is published a measurement did not produce:

| records | signed walk | per record |
|---|---|---|
| 1,000 | 192 ms | 192 µs |
| 5,000 | 860 ms | 172 µs |
| 20,000 | **3,225 ms** | 161 µs |

Linear, and the watch paid it in full on every sweep. Signature verification is
~87% of it — an unsigned walk over the same 20,000 records is 431 ms.

`checkpoint()` writes a signed note that this instance walked from genesis and
found a given head. `verifyChain(key, { from: 'checkpoint' })` resumes from it.
Measured on the same chain: **3,244 ms → 12 ms, a 280× difference.**

### The hazard is the feature, and it cannot be engineered away

A checkpoint says *I walked to seq N.* Trusting it means no longer verifying
anything before N — and it lives in the same SQLite file as the records it
vouches for, so anybody able to edit an execution can edit it too.

**A test was written expecting a resumed pass to catch a record edited before
the checkpoint. It does not, and the code was right — the expectation was
wrong.** Editing `action` at seq 3 leaves the stored hash at seq 10 untouched,
so the anchor still matches and the walk legitimately starts after it. Detecting
that would require the walk being avoided. *Skipping the walk is the feature;
not seeing what you skipped is what the feature means.*

That test now asserts the real behaviour, paired with the full walk finding the
same tampering at record 3 — so anybody who later "fixes" the resumed pass has
to read why it cannot be fixed.

### So the mitigation is entirely in the reporting

- **The default never resumes.** Every existing caller still walks from genesis
  without being asked.
- **A resumed result is shaped differently.** It carries `verifiedFrom` and a
  `scope` sentence naming what was not re-examined; a full pass carries neither.
  The two claims cannot be confused by anything reading them.
- **The signature covers sequence *and* hash**, so a genuine checkpoint cannot be
  replayed at a sequence it never described — the usual way a signed cache stops
  meaning anything.
- **A checkpoint that does not verify is ignored, not escalated.** A key rotation
  and an edited row produce the same correct response: fall back to a full walk.
- **`POST /executions/checkpoint` needs `execution:verify`, not
  `execution:read`.** Creating one decides how much history a later verification
  stops examining, and that is not a power that belongs with reading.

### The watch deliberately does not use it

The most obvious place to spend the 280× is the sweep, and it is the one place
that must not. A monitor that skips the part of the record nobody else is
looking at is not a faster monitor — it has a blind spot exactly where an
attacker would choose to put one. The refusal is written into `watch.ts` beside
the call, with the instruction that if the full walk outgrows the interval, the
interval should move and not the standard of the answer.

---

## 3l. The provenance view — the failure that happens between two records

Provenance had been the top unbuilt item in §5 and the second row of §2:
built in capkit, two routes, **reachable only with curl.** It is the most
distinctive thing in the product and it had no surface.

The gap it closes is the one every other station cannot see, because every
other station shows one record at a time:

> Agent A writes a summary that is wrong. Agent B consumes it and produces a
> recommendation. Agent C acts on it and moves money.

Three records, three signatures, **three successes.** Nothing anywhere in the
interface said these were the same piece of work travelling.

Verified against a live instance seeded with exactly that shape. The treasury
record that moved 250,000 reads `success`, its immediate upstream reads
`success`, and its lineage names `agent:summariser docs.summarise` — a
**failure two hops back**:

```
record:      agent:treasury payments.allocate [success]
upstream:    agent:analyst [success]
inherited:   agent:summariser docs.summarise
```

### Three decisions worth keeping

**Coverage is rendered first**, above the edges, at the same weight — the same
rule as the watch and for the same reason. A graph with two edges across four
hundred records looks like a calm system; it is far more likely to be one whose
handoffs go unrecorded, and a reader who counts arrows first has already
concluded *calm* from evidence that supports *blind*.

**No node-and-arrow canvas.** A laid-out graph invents position, clustering and
hierarchy, and a reader takes all three as findings. What exists is a set of
edges, each backed by one shared hash — so the hash is printed on screen and any
edge can be checked against the records themselves.

**The refusal is on the surface, not in a tooltip.** An edge shows the same
content moved between two records; it is not proof one caused the other, since
two agents reading one source produce the same hash. That distinction is the
difference between evidence and an accusation, so it is rendered, permanently,
under the graph.

Found while reading live output rather than source: with every record linked,
the coverage sentence read *"The other 0 stand alone, which may be correct"* —
nonsense, in the first sentence a reader meets. Fixed.

All seven interface gates pass, the room still opens on the cube, and a browser
pass recorded **zero page errors** — the only failing requests were health
checks for the four services not started in that test.

---

## 3j. `webhook.send` would fetch the cloud metadata service and hand back the body

**The most serious defect found in this repository so far**, and it was found by
continuing the same audit into `connector-starter`.

The generic webhook action takes its URL from the caller and required only that
it begin `https://`. Probed with a stubbed network so nothing left the machine,
it **accepted every one of these**:

```
ACCEPTED  https://169.254.169.254/latest/meta-data/iam/security-credentials/
ACCEPTED  https://metadata.google.internal/computeMetadata/v1/
ACCEPTED  https://127.0.0.1:8081/executions
ACCEPTED  https://[::1]/admin
ACCEPTED  https://user:pass@example.com/creds-in-url
```

…and returns the response body in `data`. On a cloud VM the first of those is
the instance metadata service, which is how a machine's IAM credentials are
stolen. The third is this project's own capkit instance on loopback.

**The capability token is not a defence, and saying it is would be the whole
mistake.** The scope is `connector:execute` — *send a webhook*. It does not say
*read this machine's cloud credentials and anything else reachable on its
loopback interface*. **A capability that grants more than its name says is
precisely the defect this project exists to prevent**, and it was sitting in the
package whose job is letting agents reach outward.

**Fixed.** The URL is parsed, credentials in the userinfo section are refused
(they end up in logs and proxies), the hostname is resolved, and loopback,
private, link-local, unique-local, carrier-grade-NAT and IPv4-mapped-IPv6
addresses are all refused with a reason that names the range.
`ABSUITE_ALLOW_PRIVATE_WEBHOOKS=true` restores internal delivery for deployments
that genuinely need it — off by default, because the safe choice has to be the
one you get without reading anything.

**What the fix does not do, stated rather than glossed.** Resolving the hostname
closes `https://localhost` and any name pointing at a private address. It does
not close DNS rebinding: between this lookup and the one `fetch` performs, a
hostile resolver can answer differently. Closing that needs an agent that pins
the resolved address, which is a larger change than this package should carry
alone. The cost is raised substantially; the class is not eliminated, and an
operator whose threat model includes hostile DNS should not expose
`webhook.send` to untrusted callers at all.

Thirteen tests, proved by restoring the old one-line https check: ten turn red.

**Also checked and found sound:** a failed delivery does not leak the webhook
URL, which is itself a credential — anyone holding a Slack or Discord webhook
URL can post as that integration. Node keeps the URL in `error.cause` rather
than `error.message`, so `{"ok":false,"error":"fetch failed"}` is all that
escapes. That is a property of the runtime rather than a decision this code
made, which is exactly why it is now pinned by a test: appending `cause` to the
message later would look like better error reporting.

---

## 3k. The MCP transport every client uses was the least tested part of it

`runStdio` — newline-delimited JSON-RPC over a pipe — was uncovered. An odd
place for a gap: no host calls `handle()` directly, so everything the package
does passes through those twenty lines.

No defect found. The framing buffers a partial tail correctly, malformed JSON
produces a `ParseError` rather than a crash, and a notification draws no reply.
Eight tests now hold that, including the case a test written against whole lines
would never catch: **a single message split across two writes**, which is what a
real pipe does and what a naive transport answers twice or not at all. Proved by
breaking the buffering — two tests turn red.

The rule worth keeping is `cli.ts`'s: **stdout belongs to the protocol.** One
`console.log` added anywhere in the package does not degrade the experience, it
corrupts the stream and every client disconnects — while looking entirely
reasonable in review. That is now asserted across the package's source rather
than trusted, and it is assertable only because `runStdio` writes through an
injected `output` and never touches `process.stdout` directly. Proved by adding
a `console.log` and watching it fail.

---

## 3i. A benchmarking tool reported 0ms for every request that failed

Found by auditing the three least-examined packages — which turned out to be the
three with the thinnest tests. Coverage put `quickbench/src/providers.ts` lowest
in the repository: **40% of statements, 22.5% of branches.**

Inside it, every provider's `catch` returned `latencyMs: 0`. A request aborting
after the full 120-second timeout was recorded as having taken **no time at
all** — in the package whose entire job is reporting how long things take, in a
project whose stated rule is that *no number is published that a measurement did
not produce.*

**Why it survived.** `runner.ts` filters to successes before summarising
latency, so the fabricated zero never reached a percentile or a published
figure. That made it a latent lie rather than a live one: harmless until
somebody calls a provider directly, and wrong the whole time. Nothing would ever
have surfaced it, because the only thing that could was a test of an error path
that had none.

Providers now time the attempt rather than the success — which is not only
correctness but a capability the tool did not have. **A provider degrading under
load fails slowly**, and *"every request errored"* tells an operator far less
than *"every request errored after 119 seconds"*.

Two zeros remain, on the unconfigured-key guards where no request is made and
zero is the measurement. Those are asserted in the suite too, so a later pass
tightening the rule does not "fix" a number that is already correct.

`runner.ts` still summarises latency over successes only, and now says why in
the code. That used to be forced by the fabricated zero; it is now a choice,
because a 119-second timeout mixed into a p50 of 200ms successes describes no
request that ever happened. `latency.count` and `successRate` sit beside each
other so the population is visible rather than inferred, and `measure.ts` takes
the opposite view deliberately — the comment names that difference instead of
leaving two doctrines in one package unexplained.

**Checked at the same time and found sound:** `edge-run@1.0.1`,
`connector-starter@1.0.1`, `mcp@1.0.3` and `quickbench@1.0.2` all install from
npm and load correctly against `capkit@1.3.1`. The older packages are not stale
in the sense that would hurt anybody.

---

## 3h. The notary had no container image — and it is the one that needed one

Reported by the owner: no notary under GitHub Packages.

The first answer given was that this project does not publish to GitHub Packages
at all. **That was wrong, and it was wrong in the laziest way — by asserting
rather than looking.** `grep` found no mention of `npm.pkg.github.com` in the
repository, and that was treated as settled. GitHub Packages hosts *containers*
too, `cd.yml` has pushed to `ghcr.io` since July, and the page lists seven
images.

Seven, from a hardcoded list of build steps. `@absuitecore/notary` is not among
them, because it had no `Dockerfile` — **the only service without one.**

That is exactly backwards. Every other image is for somebody running ABSuite.
The notary is the one image for somebody who is **not**: a notary you run
yourself is a second signature from the same party and proves nothing, so the
whole product needs a stranger to run one. It was the single service where
`docker run` matters most, and the single service you could not `docker run`.

Same root cause as §3f — a list of build steps written by hand, one per image,
which drifts from what the repository contains and cannot notice. Now added,
with the Dockerfile deliberately shorter than its siblings: it copies no capkit,
because a notary that depended on the thing it witnesses would be a component of
it. If that file ever needs a line mentioning capkit, something upstream has
gone wrong.

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
- The five dependents were found by a *search* — `?text=depends:@scope/pkg` —
  which npm reads as free text and answers with the registry ranked by
  relevance. One result was an unrelated package that happens to be named
  `capkit` and belongs to somebody else.

**And then a third version, which is the one worth keeping.** The correction
above concluded that npm has no dependents data at all. **It does** — it is a
field on the search result, and for `@absuitecore/capkit` it says five. Those
five are `connector-starter`, `edge-run`, `mcp`, `quickbench` and `trust`:
every one of them ours. So the number is real, it is not adoption, and
reporting it without that distinction would have been the third telling of the
same story.

`pnpm adoption` now reports dependents and subtracts our own, because
**a first-party dependent is a fact about the monorepo and a third-party one is
the first evidence a stranger chose this.** Today: five, all ours, none outside.

The lesson is not about npm. Twice the fix for a wrong claim was another claim
made without checking — including the fix that said "this cannot be measured",
which is the most comfortable wrong answer available, because nobody ever
audits an admission of ignorance.

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
- **936 tests, 42 suites, 26 checks, exit 0.** `pnpm verify` runs a build, the
  suite, and 26 checks. `check:numbers` compares every figure the documents
  publish against what the repository measures, and `check:config` fails the
  build if a variable is offered to an operator and read by nothing (§3c).

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
| ~~3~~ | ~~A provenance view~~ | **Done.** AI-to-AI accountability was built, distinctive, and invisible — see §3l. |
| ~~4~~ | ~~Chain checkpointing~~ | **Done.** 3,244 ms → 12 ms at twenty thousand records, and the limitation is stated rather than glossed — see §3m. |

None of this is blocked on anything but time. That is the useful thing about a
list like this: everything on it is work, not luck.

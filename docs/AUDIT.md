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

DNS rebinding is still open, and still stated as open. `guardedFetch` resolves
and `fetch` resolves again, so a hostile resolver can answer differently in
between. Closing it needs an HTTP agent that connects to the address that was
checked. The window is now one hop wide instead of unbounded — smaller, not
closed.

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
- **883 tests, 41 suites, 19 checks, exit 0.** `pnpm verify` runs a build, the
  suite, and 22 checks. Four of them are new — three police this document, and the fourth runs the demo:
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
| ~~3~~ | ~~A provenance view~~ | **Done.** AI-to-AI accountability was built, distinctive, and invisible — see §3l. |
| ~~4~~ | ~~Chain checkpointing~~ | **Done.** 3,244 ms → 12 ms at twenty thousand records, and the limitation is stated rather than glossed — see §3m. |

None of this is blocked on anything but time. That is the useful thing about a
list like this: everything on it is work, not luck.

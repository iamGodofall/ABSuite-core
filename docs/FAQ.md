# Questions people actually ask

Written so you do not have to ask. Sections are numbered so they can be linked
and quoted — `FAQ.md#q7` and so on.

The uncomfortable questions are in here too, answered straight. A FAQ that only
handles the flattering ones is marketing with a table of contents.

---

## The basics

### Q1. What is this, in one sentence?

A record of what your AI agents actually did, signed so that anyone can check it
— including people who have no reason to trust you.

### Q2. What problem does it solve?

You cannot currently answer *"what did my agent do last Tuesday, under what
authority, and has anything changed since?"*

Your logs can be edited. They have no signature. Nothing about them survives
being handed to somebody who does not already trust you.

### Q3. Is this a logging library?

No, and the difference is the whole product.

A logger records what your code chose to say. This records **what happened**,
hash-chained and Ed25519-signed, so that altering one byte of one record is
detectable by a stranger with only a public key. A log is a claim. This is
evidence.

### Q4. Why can't I just use my existing logs?

You can, until somebody asks you to prove they were not edited. At that moment a
log file is worth exactly as much as your word — which is fine between
colleagues and worth nothing to an auditor, a customer, or a regulator.

### Q5. Is this blockchain?

No. There is no chain of blocks, no consensus, no token, no network, no mining.

It uses two boring cryptographic primitives — SHA-256 hashing and Ed25519
signatures — the same ones your SSH key and your TLS certificate use. Records
link to their predecessor by hash, which is a thousand-year-old idea and predates
blockchain by decades.

### Q6. Who is this actually for?

Three people, and none of them is an enterprise on day one:

- **A developer whose agent touched something real** — payments, customer email,
  a deploy pipeline — and who cannot reconstruct what it did.
- **A consultant or agency selling AI automation**, whose client asks how they
  know what the agent did. You hand them a signed artifact instead of a
  screenshot.
- **Anyone who just received a procurement questionnaire** asking how they govern
  AI. See [COMPLIANCE.md](COMPLIANCE.md).

---

## Trust and honesty

### Q7. Do I have to trust ABSuite?

No, and that is the point.

Verification needs only the public key, and `GET /executions/public-key` is
unauthenticated on purpose. The record format is [specified](PROTOCOL.md)
independently of this code and implemented a second time in
[dependency-free Python](../implementations/python/) that shares nothing with the
TypeScript. Thirty-three conformance checks run on every build.

If this project vanished tomorrow, your records would still verify.

### Q8. Why is there no trust score?

Because a number replaces evidence with something nobody audits. Nobody
interrogates a 96.4 — they act on it.

Every finding lands in one of four words instead, and each can be argued with:

| | Meaning |
|---|---|
| **DEMONSTRATED** | The evidence supports it. Not *"this is true"* — the evidence for it is present and holds. |
| **FAILED** | The evidence contradicts it. |
| **UNKNOWN** | Nobody checked, or this build cannot read it. Always carries the step that would settle it. |
| **ABSENT** | The record never attempted to answer. Always carries why it is silent. |

`check:doctrine` fails the build if a score appears anywhere.

### Q9. Unknown just means no, right?

No — and getting that wrong was a real bug in this codebase.

**Unknown is not false, and unknown is not true.** A thermometer that cannot read
10,000°C reports out of range, not `temperature: false`. A verifier that checked
a hash has not thereby checked a signature.

### Q10. How do I know the tool is not lying to me?

Run `absuite doctor`. On a fresh instance it will tell you, unprompted, that your
signing key is ephemeral and your watch has never run — two real problems in a
deployment reporting itself healthy.

A product that opens by listing its own faults is a different kind of instrument
from one that opens with a green tick.

### Q11. Has anyone actually used this?

Not yet, outside the project. That is the honest answer and it is written in
[ROADMAP.md](ROADMAP.md) too.

The code is real, tested and running; the adoption is not there. Anyone claiming
otherwise about a project at this stage is telling you something else you should
not believe either.

---

## Running it

### Q12. What does it cost?

The core is MIT and free forever. **Verification never becomes a paid feature** —
an auditor who has to pay to check is not an independent auditor, and that
refusal is constitutional rather than a pricing decision.

What may eventually cost money is convenience, scale, integration and attention.
Never the proof. See [SERVICES.md](SERVICES.md).

### Q13. Will it slow my agent down?

Recording is a hash and a signature — microseconds. Measured figures, on a stated
machine, are in [PERFORMANCE.md](PERFORMANCE.md), and CI fails if the document
and the benchmark disagree.

The one thing to know: `/executions/stats` defaults to skipping signature
verification and **says so in the response**, because verifying signatures across
20,000 records took 3 seconds and Node is single-threaded.

### Q14. Does ABSuite see my data?

No. Inputs and outputs are **hashed and dropped**. The record proves what was
processed without being a copy of it, which is the only kind of record that is
safe to keep for years.

### Q15. What happens if I lose the signing key?

**Every record ever signed fails verification, permanently.** There is no
recovery and there should not be one — a system that can re-sign its own history
is not an evidence system.

`CAPKIT_TRACE_PRIVATE_KEY` is the most dangerous secret in the product. Back it
up somewhere that is not the server. See [HOSTING.md](HOSTING.md).

Generate a durable one with **`pnpm key:trace`**. It writes straight into `.env`
and never puts the private half in a file of its own — a key sitting in a working
directory is one `git add -A` from being public permanently, and unlike a
password it cannot be rotated out of trouble.

### Q16. Can I deploy it on Cloud Run / Firestore / Lambda?

Short answer: **no, not without breaking it.**

A chain has one head. Writing a record means reading the current head and
appending atomically, so two instances doing that at once break the chain
permanently. Serverless platforms scale horizontally by design and their
filesystems do not survive a restart.

Use a single always-on instance with a real disk. [HOSTING.md](HOSTING.md) gives
the free options and the exact reasoning.

### Q17. Does it scale?

Not horizontally, and that is deliberate. SQLite, one writer, one disk, because
a chain has one head.

It is correct for thousands of records and one deployment. It is not a
multi-tenant hosted service, and [AUDIT.md](AUDIT.md) names that as a real
ceiling rather than hiding it.

### Q17b. Does it run on Windows?

Yes, and it did not until somebody tried. Five defects only a Windows machine
could surface — `spawn('pnpm')` failing on a `.cmd` shim, a SQLite file lock
that made test cleanup throw `EPERM`, path regexes written with `/` that matched
nothing against backslashes, `URL.pathname` mangling a drive letter into
`D:\D:\…`, and an ESM import that Node read as protocol `d:`.

Every one is fixed. If you hit another, it is a bug worth reporting — the docs
say every command was run before being written down, and that promise only holds
on platforms somebody actually ran them on.

### Q18. Does it work with LangChain / Claude Code / n8n / my framework?

It is framework-agnostic. Three ways in:

- **Library** — `npm install @absuitecore/capkit`, call `record()`.
- **HTTP** — `POST /executions` from anything that speaks JSON.
- **MCP** — `@absuitecore/mcp` exposes governed tools to any MCP client.

Nothing about it assumes a particular agent framework.

---

## Limits

### Q19. What does it deliberately not do?

- **It never claims to detect truth.** Supported versus unverified is the whole
  product; closing that gap for a better demo would end the project's reason to
  exist.
- **It never rates a human being.**
- **It never decides what should happen.** It may say what a person should look
  at. It may not say what should be done about it.
- **It never notifies anybody.** No incidents, no escalation, no email. Calling
  something an incident is a judgement, and the judgement is yours.
- **It never learns who to suspect.**

Full list, with the reasoning: [CONSTITUTION.md](CONSTITUTION.md).

### Q20. Is it production-ready?

The code is: 721 tests, 33 suites, 17 build checks, a frozen-fixture chain that
still verifies across versions, and a second implementation that agrees with the
first.

The *project* is early. Nobody outside it has run it in production, and
[AUDIT.md](AUDIT.md) lists every weakness found so far — including that the admin
key can mint tokens in an enrolled subject's name without proof.

Read that document before you depend on this. It was written to be read by
somebody deciding whether to.

### Q21. What is the fastest way to see whether this is real?

Two minutes, no install:

1. Open <https://iamgodofall.github.io/ABSuite-core/> and press
   **Verify in my browser**. Three real signed records verify in *your* browser
   with nothing asked of any server.
2. Press **Alter one record**. The check names the exact sequence number that
   broke.

Then `npm install @absuitecore/capkit` if you want it locally, or `pnpm room` in
a clone to bring up the whole stack.

---

## Getting help

Open an issue on [GitHub](https://github.com/iamGodofall/ABSuite-core/issues).
If the answer turns out to be missing from this page, that is a defect in this
page and it gets fixed here rather than only in the thread.

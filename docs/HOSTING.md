# Where this can actually run

Written because the obvious answer is the wrong one, and the reason why is
architectural rather than a matter of taste.

---

## The one constraint everything else follows from

**A chain has one head.**

Every execution record links to the one before it by hash. Writing a record means
reading the current head and appending to it, and that read-then-append must be
atomic. Two processes doing it at the same moment produce two records claiming
the same predecessor, and the chain is broken — permanently, because the record
is append-only and nothing here rewrites history.

That is why storage is SQLite with a single writer, an `RWO` volume and a
`Recreate` deployment strategy. It is not a placeholder for something better. It
is the cheapest correct implementation of *one writer, one head, on one disk*.

Any hosting decision that breaks that breaks the product.

---

## Cloud Run — **no**, not as the default

You have used it before and it is a genuinely good product. It is the wrong
shape for this one, for two reasons that are not fixable by configuration:

**It scales horizontally.** Cloud Run's whole value is spinning up instances on
demand. Two instances writing the same chain is exactly the failure above. You
would be paying for the one feature you must switch off.

**Its filesystem is ephemeral.** A container's local disk does not survive a
restart, and Cloud Run restarts containers routinely. A SQLite file written to
local disk is gone — along with every record ever written. The chain would not
even break; it would simply cease to exist, quietly, on a redeploy nobody
thought was risky.

### If you use it anyway, these are non-negotiable

```
--min-instances=1 --max-instances=1     # one writer. never raise max.
--no-cpu-throttling                      # the watch sweeps on an interval
```

…plus a **real persistent volume** — Filestore over NFS, not a Cloud Storage
FUSE mount. SQLite's locking over GCS FUSE is unreliable, and unreliable locking
on the one file that holds the chain is the worst place in the system for it.

At that point you are paying Cloud Run and Filestore prices to run a single
always-on instance with a disk. Which is a VM, described the long way round.

---

## Firestore — **no**, and this one is a rewrite

Firestore is a good document store. It is not a fit here, and the reasons are
worth stating so nobody revisits this in six months:

- **The whole storage layer would have to be rewritten.** `storage.ts` is SQL —
  schema, migrations, indexes, `SELECT … ORDER BY seq`. Nothing carries over.
- **Sequence integrity becomes your problem.** SQLite gives *one writer, ordered
  by `seq`* for free. In Firestore you would rebuild that with transactions and
  a counter document, and a counter document is a single hot key — the same
  bottleneck, reimplemented, with a bill attached.
- **You lose the exit.** The constitution promises *"SQLite file, documented
  schema, working backup and restore. Leaving must always be possible."* A
  managed proprietary document store is the opposite of that promise, and it is
  one of four things this project owes its users.

**Firestore is right for an app with many concurrent writers and no ordering
requirement.** This is one writer with nothing but an ordering requirement.

---

## What to actually use

Ranked for someone who needs this running today, cheaply, without a rewrite.

### 1. Google Compute Engine `e2-micro` — **free, and the closest fit**

Google's always-free tier includes one `e2-micro` in `us-west1`, `us-central1`
or `us-east1`, with 30 GB of standard persistent disk.

That is a real VM with a real disk. The repository already ships a
`docker-compose.yml` that brings up all six services; on a VM it runs unchanged.
One instance, one disk, always on — exactly the shape the architecture wants.

- `CAPKIT_TRACE_PRIVATE_KEY` in **Secret Manager**, injected at boot. Never in
  the image, never in the repo.
- `scripts/backup.mjs` on a nightly cron, copying to a Cloud Storage bucket.
- It is small. Six Node services on an `e2-micro` will be tight, and the honest
  first step is to run **capkit and the dashboard only** and add the rest as
  they are needed.

### 2. Fly.io — **best fit technically**, small free allowance

Fly gives a persistent block volume attached to a single machine, which is
precisely the SQLite deployment story. `fly volumes create` and a
`[mounts]` block, and it works with no architectural argument at all.

### 3. A cheap VPS — Hetzner, DigitalOcean, ~€4/month

Boring, predictable, and you own the disk. If the free tiers get in the way,
this is the answer that never surprises you.

---

## The disk is plaintext

The record is not encrypted at rest. `.env.example` implied otherwise for a long
time — see [AUDIT.md](AUDIT.md) §3 — and it does not now.

What that means practically: **treat a stolen disk as a stolen record.** Use full
disk encryption on the host, keep the file readable only by the service user, and
put the backup bucket behind its own access control.

What it does *not* mean: your payloads are not in there. Inputs and outputs are
hashed and dropped at record time, so the file holds hashes, subjects, scopes and
timestamps. That is a real and deliberate mitigation, and it is not a substitute
for encrypting the volume.

## The two secrets, in order of danger

| | Losing it costs |
|---|---|
| `CAPKIT_TRACE_PRIVATE_KEY` | **Every record ever signed fails verification, permanently.** There is no recovery and there should not be one. Back it up somewhere that is not the server. |
| `CAPKIT_ADMIN_KEY` | Full authority, including minting tokens in any enrolled subject's name without proof — see [AUDIT.md](AUDIT.md) §3. |

Both belong in Secret Manager or Fly secrets. Neither belongs in an image, an
environment file in the repo, or a screenshot.

---

## The scaling wall, named honestly

Single-writer SQLite is correct and it is a ceiling. It is fine for thousands of
records and one deployment; it does not become a multi-tenant hosted service.

That is the gate on [SERVICES.md](SERVICES.md) §2.1, and it is a real piece of
work: a different storage engine behind the same interface, preserving one
writer and one head. Nothing about today's choice makes that harder — it makes
it *possible*, because the interface is already the boundary.

Do not pre-solve it. There is no second deployment yet.

---

## About seeing it run

`pnpm room` starts all six services and the interface locally and tells you what
did not come up. That is the fastest path to watching it work, and it needs no
cloud account.

For a recording, the sequence worth capturing is already written down in
[ROADMAP.md](ROADMAP.md) — record an action, verify it, alter one byte, watch the
chain name the record that broke. Under two minutes, and it is the only demo
that shows the thing nobody else can do.

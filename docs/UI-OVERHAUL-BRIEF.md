# UI overhaul — session brief

> Written at the end of the previous session, against the running suite, so the
> next one starts from findings rather than rediscovering them.

## The one number that frames everything

**103 endpoints exist. The dashboard reaches 18.**

That is the whole problem in a sentence. The interface is not a weaker version
of the product — it is a small window onto a much larger one, and the window is
pointed at the least interesting part. A stranger judges ABSuite by what the
window shows, so today they are judging maybe a sixth of it.

## Fix first — the interface tells a lie

The notification bell renders three hardcoded events, including **"QuickBench
health check passed"** (`App.tsx`, state initialiser). That is a claim a check
ran and passed when it may never have run. Invented evidence, in the first thing
anyone sees, in the product whose root principle is that nothing may look more
certain than it is.

Every check we built — `check:doctrine`, `check:constraints`, `check:routes`,
the smoke suites — looks at code and docs. **None of them look at the
interface.** That is why this survived. Consider a check that fails on
hardcoded, human-authored "events" in the UI.

Same class, lower severity: `DEMO_BENCHMARK_HISTORY` ships hand-written latency
and throughput numbers behind the LIVE/DEMO toggle. Either delete demo mode, or
make it structurally unmistakable — persistent watermark, different chrome,
obviously synthetic values. A label is not enough once someone screenshots it.

## Capabilities that exist and cannot be reached from the UI

Each of these is built, tested, documented, and invisible:

**Forensics — the strongest material we have**
- `GET /executions/:id/replay` and `POST /executions/:id/replay` — **the replay
  engine**. Reachable only inside a collapsed `<details>` after selecting a
  record. This is a headline feature rendered as a footnote.
- `GET /executions/:id/conditions` — the five necessary conditions, with
  DEMONSTRATED / FAILED / UNKNOWN / ABSENT and resolutions. Only appears nested
  under Explain.
- `GET /executions/:id` — a single record has no dedicated view at all.
- `GET /audit`, `GET /audit/verify` — the hash-chained audit log. No UI.

**Trust — an entire service with almost no surface**
- `GET /chains`, `GET /chains/:chainId` — agent-to-agent chains. Nothing renders
  them. This is the "AI watching AI" story and it has no picture.
- `GET /scores`, `GET /score/:subjectId` — agent/vendor/model reputation.
- `GET /evidence/:subjectId`, `GET /events/:subjectId` — the evidence trail.
- `GET /disputes`, `GET /disputes/pending`, `GET /contracts`,
  `GET /obligations` — governance machinery, entirely unsurfaced.
- `POST /appeals/:appealId/decide`, `GET /events/:eventId/appeals` — the appeal
  path. A subject contesting a record is a core promise with no interface.

**Act — the execution layer**
- `GET /schedule`, `POST /schedule`, `GET /queue`, `GET /queue/:id/status`,
  `GET /runtime/logs` — Edge-Run's scheduler and queue. The Act layer currently
  shows service tiles instead of work in flight.
- `GET /connectors`, `GET /connectors/:id` — the connector registry.

**Govern**
- `POST /auth/token`, `POST /auth/token/revoke` — issuing and revoking authority
  from the console. Revocation in particular is a live safety control with no
  button.

**Learn**
- `GET /history`, `GET /compare`, `GET /run/:jobId/report` — benchmark history
  and statistical comparison between runs.

## Screen-level findings

1. **No overview.** The global view is buried inside Observe; System shows
   service health. There is no screen showing everything at once, which is the
   first thing a sixty-second test needs.
2. **Verify is half empty** until something is clicked — a blank column facing a
   list. Observe answers before interaction; every layer should.
3. **The search box does nothing.** A control that looks capable and is not is
   the same failure as a number that looks measured and is not. Wire it or
   remove it.
4. **No motion anywhere.** Nothing arrives, nothing updates, nothing streams —
   despite a live socket already being connected. A flight recorder that looks
   static is not believable as a recorder.
5. **The record is the product and has no page.** Everything happens in panels
   beside lists. A signed execution deserves a full view: timeline, authority,
   governing rule, conditions, replay, explanation, chain position.

## Direction

The dashboard is not a dashboard. It is the physical argument for the
Constitution — someone should infer *this system cares about evidence* from
looking at it, before reading a word.

Concretely, that means:

- **Lead with the record, not the service.** Services are our deployment detail;
  the record is what the user came for.
- **Show the loop happening.** Observe → Verify → Explain → Govern → Arbitrate →
  Act → Learn is the product's own model; a live activity stream moving through
  those stages *is* the demo.
- **Every state visible in the UI must be one of the four**, with resolutions
  shown for unknowns and reasons for absences. The interface should speak the
  same language as the API.
- **Motion should mean something.** Animate arrival of real events, not
  decoration. A pulse on a record that just landed is information; a spinning
  gradient is noise.
- **Nothing on screen may look more complete, more certain, or more
  authoritative than it is.** Same root, applied to pixels.

## Sixty-second scenario to build against

```text
Agent receives a request
  ↓  capability checked
  ↓  governing rule evaluated
  ↓  action performed
  ↓  trace signed and chained
  ↓  evidence verified
  ↓  an unknown identified, with its resolution
  ↓  dashboard updates live
  ↓  a human clicks "Explain"
  ↓  conditions shown, trust composition shown
  ↓  a human clicks "Replay" and reproduces the execution
```

If a stranger watches that and says *"oh — this is an evidence layer for
automated systems"*, the overhaul worked.

## How to start the environment

```bash
pnpm build
# six services on 8081-8085 and 3001; admin key must match across all of them
CAPKIT_ADMIN_KEY=<key> CAPKIT_TRACE_PRIVATE_KEY="$(cat key.pem)" \
  ABSUITE_DB_PATH=./absuite.db node packages/capkit/dist/server.js
# edge-run 8082, quickbench 8083, connector-starter 8084, trust 8085
cd packages/dashboard-ui && PORT=3001 ABSUITE_ADMIN_API_KEY=<key> npx tsx server.ts
```

The dashboard needs the admin key in `localStorage` under `absuiteAdminApiKey`,
or every execution route returns 403 and the screens look broken when they are
merely locked.

Screenshots of the current state, for before/after comparison, were taken across
all seven layers plus System at 1600×1100.

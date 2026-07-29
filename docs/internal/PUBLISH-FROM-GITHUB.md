# Publishing from GitHub — no computer setup needed

> **Historical — superseded 29 July 2026.**
> The publish workflow it sets up exists and has run. Releases are now cut
> from `.github/workflows/publish.yml`.
> The current state of the project is in
> [`docs/ROADMAP.md`](../ROADMAP.md); the current numbers are whatever
> `pnpm test` and `pnpm docs:check` print. This document is kept for the
> reasoning, not for its facts.

> You do **not** need Node, pnpm, or a terminal on your own machine. This
> publishes from GitHub's servers, triggered by a button.

---

## First, the thing that was confusing

When I wrote `cd /path/to/ABSuite-core`, I meant a folder on **your own
computer** — and that was a bad assumption on my part.

Here is where the code actually lives:

| Where | What it is | Permanent? |
|---|---|---|
| The cloud session I work in | A temporary container | **No** — it gets deleted |
| **GitHub** | `iamGodofall/ABSuite-core`, branch `claude/app-monetization-strategy-1bvigd` | **Yes** — everything is safely pushed here |
| Your computer | Only if you clone it | Optional |

Every commit is already on GitHub. Nothing is at risk. And because it is on
GitHub, **GitHub can do the publishing for you.**

---

## The five steps

### 1. Create an npm access token (3 min)

1. Go to **https://www.npmjs.com** and sign in
2. Click your avatar (top right) → **Access Tokens**
3. **Generate New Token** → **Granular Access Token**
4. Fill in:
   - **Name:** `absuite-github-publish`
   - **Expiration:** 90 days
   - **Packages and scopes** → Permissions: **Read and write**
   - **Select packages and scopes:** choose your scope (`@absuite` if you own
     it, otherwise `@themba-mpehle`)
5. **Generate token**
6. **Copy it now.** It is shown once and starts with `npm_`

### 2. Add the token to GitHub (2 min)

1. Go to **https://github.com/iamGodofall/ABSuite-core/settings/secrets/actions**
2. **New repository secret**
3. **Name:** `NPM_TOKEN` — exactly this, capitals and underscore
4. **Secret:** paste the token
5. **Add secret**

GitHub encrypts it. Nobody — including me — can read it back.

### 3. Dry run first (2 min)

1. Go to **https://github.com/iamGodofall/ABSuite-core/actions**
2. Left sidebar → **Publish to npm**
3. **Run workflow** (right side) and set:
   - **Branch:** `claude/app-monetization-strategy-1bvigd`
   - **Dry run:** ✅ **leave checked**
   - **Scope:** leave blank for now
4. **Run workflow**

Wait ~2 minutes. Green tick means the build and all 246 tests passed and the
five packages packed correctly. **Nothing was published.**

### 4. Publish for real (3 min)

Same steps, with one change: **untick Dry run.**

If it succeeds, all five packages are live on npm.

### 5. Verify

```
https://www.npmjs.com/package/@absuitecore/capkit
```

Or ask anyone to run `npm view @absuitecore/capkit`.

---

## If step 4 fails with a scope error

If the log shows `404 Scope not found` or `403 Forbidden`, you do not own the
`absuite` organisation. **Do not fight it.** Re-run the workflow with:

- **Dry run:** unticked
- **Scope:** `@themba-mpehle`

The workflow renames every package, dependency and import automatically before
publishing. Your username scope always belongs to you and needs no organisation.

`@themba-mpehle/capkit` installs exactly as easily as `@absuitecore/capkit`. You can
always move to an organisation later. Do not lose an evening to a name.

---

## A bonus worth understanding

The workflow publishes with `--provenance`. npm then attaches a **signed,
publicly verifiable record** of exactly which commit and which workflow built
each package, and shows a "Provenance" badge on the npm page.

For a project whose entire premise is *provable execution*, publishing with
cryptographic build provenance is the right kind of consistency. It is also a
direct answer to the supply-chain concern npm was warning about in that banner
on your screen.

---

## If you would rather use your own computer

Still an option. You need Node 22.5+ and pnpm, then:

```bash
git clone https://github.com/iamGodofall/ABSuite-core.git
cd ABSuite-core
git checkout claude/app-monetization-strategy-1bvigd
pnpm install
pnpm test                 # expect 246 passed
npm login
pnpm publish:packages
```

`cd ABSuite-core` here means the folder `git clone` just created on **your**
machine — that is what "path" meant.

---

## What to send me if something breaks

Open the failed workflow run, click the red step, and copy the last ~20 lines.
Paste them here and I will tell you exactly what to change.

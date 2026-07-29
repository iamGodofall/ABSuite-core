# Publishing to npm — exact steps

> Verified 2026-07-28: `@absuitecore/capkit`, `edge-run`, `quickbench`,
> `connector-starter` and `mcp` all return **"Not found"** on the npm registry.
> The publish has not landed yet. Here is why, and exactly how to fix it.

---

## The blocker

The packages are **scoped**: `@absuitecore/capkit`, not `absuite-capkit`.

npm only lets you publish under a scope you own. A scope is either:

- **your username** — so `@yourusername/capkit` would work, or
- **an organisation you created** — so `@absuitecore/capkit` needs an npm
  organisation literally named `absuite`.

If you ran `pnpm publish:packages` without creating that organisation, npm
rejected it with something like:

```
npm error 404 Not Found - PUT https://registry.npmjs.org/@absuite%2fcapkit
npm error 404 Scope not found
```

or

```
npm error 403 Forbidden - You do not have permission to publish "@absuitecore/capkit"
```

**Good news:** the name `absuite` is currently unregistered on npm. It is
available. Claim it before someone else does.

---

## Step 1 — Create the `absuite` organisation (3 minutes)

1. Log in at **https://www.npmjs.com**
2. Go to **https://www.npmjs.com/org/create**
3. Organisation name: **`absuite`** (exactly this — lowercase, no spaces)
4. Choose the **Free** plan — free organisations can publish unlimited *public*
   packages, which is what we want
5. Click Create

Verify it worked — this should now load:
**https://www.npmjs.com/settings/absuite/packages**

---

## Step 2 — Log in from the terminal (2 minutes)

```bash
npm login
```

Modern npm opens a browser to authenticate. Older versions prompt for username,
password, email, and a 2FA code from your authenticator app.

Confirm it worked:

```bash
npm whoami          # should print your npm username
npm org ls absuite  # should list you as owner
```

---

## Step 3 — Make sure you have the latest code (1 minute)

**Important:** the code with all the finished work is on the branch
`claude/app-monetization-strategy-1bvigd`, not on `main`. If your local clone is
older, you would publish an out-of-date build.

```bash
cd /path/to/ABSuite-core
git fetch origin
git checkout claude/app-monetization-strategy-1bvigd
git pull origin claude/app-monetization-strategy-1bvigd

pnpm install
pnpm test           # expect: 246 passed
```

If the tests do not say 246, stop and say so — something is out of sync.

---

## Step 4 — Dry run first (1 minute)

Never publish blind. This shows exactly what would be uploaded without
uploading anything:

```bash
pnpm publish:dry
```

You should see five packages, each a few tens of kB. If you see source files or
tests listed, stop — something is wrong with the `files` field.

---

## Step 5 — Publish (3 minutes)

```bash
pnpm publish:packages
```

This builds every package and publishes all five. Keep your phone nearby — npm
asks for a **one-time password** per package if 2FA is on:

```
npm notice Publishing to https://registry.npmjs.org/
npm notice Enter one-time password:
```

Enter the 6-digit code from your authenticator app. It refreshes every 30
seconds; if it expires, wait for the next one rather than reusing it.

> **If publishing one at a time is easier**, publish CapKit **first** — the
> other four depend on it:
>
> ```bash
> pnpm --filter @absuitecore/capkit publish --access public --no-git-checks
> pnpm --filter @absuitecore/edge-run publish --access public --no-git-checks
> pnpm --filter @absuitecore/quickbench publish --access public --no-git-checks
> pnpm --filter @absuitecore/connector-starter publish --access public --no-git-checks
> pnpm --filter @absuitecore/mcp publish --access public --no-git-checks
> ```

---

## Step 6 — Verify it is really live (1 minute)

```bash
npm view @absuitecore/capkit
npm view @absuitecore/mcp

# The real test — install it somewhere else entirely
cd /tmp && mkdir t && cd t && npm init -y
npm install @absuitecore/capkit
node -e "console.log(Object.keys(require('@absuitecore/capkit')).length + ' exports')"
```

If that prints a number, you are genuinely published.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `404 Scope not found` | The `absuite` org does not exist | Do Step 1 |
| `403 Forbidden` | Logged in as someone without org access | `npm whoami`, then `npm org ls absuite` |
| `402 Payment Required` | Publishing as private | Ensure `--access public` (already in `publishConfig`) |
| `EOTP` / `one-time password` | 2FA required | Enter the 6-digit code |
| `You cannot publish over the previously published versions` | Already published | Bump `version` in the package.json, then republish |
| `git not clean` | Uncommitted changes | Use `--no-git-checks`, or commit first |

---

## After publishing

1. **Make the GitHub repo public** — Settings → General → Danger Zone → Change
   visibility. npm links to it; a 404 destroys credibility instantly.
2. **Tag a release:**
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
3. **Submit `@absuitecore/mcp` to MCP registries** — that is the highest-intent
   audience available to this project.
4. **Tell me it is live** and I will verify all five from the registry.

---

## One honest note on timing

Publishing tonight is realistic — the packages are built, tested and pack
cleanly. What will **not** happen tonight is revenue.

Developer infrastructure sells slowly: people find a package, read the README,
try it in a side project, and come back weeks later. First revenue for this
category is typically months out, not hours. That is not pessimism about
ABSuite; it is how this market works for everyone in it.

What tonight buys is the thing that has to exist before any of the rest can:
**a package anyone in the world can install.**

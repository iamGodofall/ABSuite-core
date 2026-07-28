# Launch & Distribution

> How ABSuite actually reaches customers, and what must be true before it does.

---

## 1. Where ABSuite is distributed

**ABSuite is developer infrastructure, not a consumer app.** It is a set of
HTTP services, Docker images and npm packages. That determines the channels,
and it rules one out that is often assumed:

### The App Store does not apply

Apple's App Store and Google Play distribute **iOS and Android applications** to
consumers. ABSuite has no mobile app — it is backend services that run on a
server. There is no build to submit, no review to pass, and no listing to
create. Submitting it is not possible rather than merely inadvisable.

If a mobile presence is wanted later, the honest path is a separate product: a
small native client that talks to the ABSuite API (view agent status, approve a
capability request, receive an alert). That is a real product, but it is a new
build with its own design, review cycle and support burden — and it should only
be started once the API has paying users, because a mobile client with no
backend customers has nobody to serve.

### The channels that do apply

| Channel | What goes there | Effort | Why it matters |
|---|---|---|---|
| **npm** | `@absuite/capkit`, `edge-run`, `quickbench`, `connector-starter`, `mcp` | Low | Primary discovery for developers. `npm install` is the whole funnel. |
| **MCP directories** | `@absuite/mcp` listed in MCP server registries | Low | Where agent builders look for tools. Highest-intent audience there is. |
| **GitHub** | Source, releases, docs | Low | Where technical buyers evaluate before they ever contact you. |
| **Docker Hub / GHCR** | Per-service images | Low | Lets someone run the suite in one command. |
| **GitHub Marketplace** | An Action wrapping QuickBench regression checks | Medium | Puts the product inside a workflow developers already run. |
| **AWS / Azure / GCP Marketplace** | BYOL or SaaS listing | High | Enterprise procurement. Only worth it once enterprise deals exist. |
| **Your own hosted service** | The paid tier | High | Where the recurring revenue is. |

**Recommended order:** npm and GitHub first (days), Docker images next (days),
GitHub Marketplace once there are users (weeks), cloud marketplaces only when a
customer asks (months).

---

## 2. Production readiness

### What is in place

| Requirement | Status |
|---|---|
| Authentication & authorisation | Capability tokens, scope matching, audience enforcement |
| Credential revocation | Shared store; propagates across all services |
| Audit trail | Hash-chained, tamper-evident, verifiable via `/audit/verify` |
| Durable state | SQLite-backed; schedules and queued work survive restart |
| Multi-tenancy | Tenants with hashed API keys, one-time issuance, rotation |
| Usage metering | Per-tenant, per-metric, per-month |
| Quota enforcement | `402` on limit, `403` on suspension |
| Billing integration | Stripe webhook with signature verification and replay protection |
| Observability | `/metrics` (Prometheus), `/health`, `/ready` on every service |
| Graceful shutdown | SIGTERM drains in-flight requests and flushes state |
| Container security | Non-root user, pinned Node 22 base |
| Test coverage | 246 tests over the security- and correctness-critical paths |

### What is not, and must be decided before selling an SLA

- **Single-node SQLite.** Correct and durable for one node. Horizontal scaling
  needs Postgres. The `Storage` and `RevocationStore` interfaces exist so this
  is an implementation swap, not a rewrite.
- ~~No backup automation.~~ **Resolved.** `scripts/backup.mjs` snapshots the live
  database and **verifies every snapshot before keeping it** — integrity check,
  schema check, and a full execution-chain walk. A snapshot that fails is
  discarded rather than stored. Restore was tested against a deliberately
  corrupted database; tenants, usage and the signed chain all came back intact.
- ~~No rate limiting per tenant.~~ **Resolved.** Token-bucket limiting per
  tenant, sized by plan (free 60/min, team 300, business 1200, enterprise
  unlimited). Verified: a free tenant flooding 70 requests got 60 through and 10
  `429`s while a second tenant was completely unaffected. Health and readiness
  probes are exempt so a flood cannot starve the orchestrator's checks.
- ~~No secret rotation procedure.~~ **Resolved.** `KeyRing` keeps recently
  retired keys verifying, so rotation no longer invalidates tokens in flight.
  Set `CAPKIT_PREVIOUS_SECRETS` to the outgoing secret when you rotate.
- **Experimental SQLite API.** `node:sqlite` is stable enough in Node 22 but
  still flagged experimental upstream; pin the Node minor version in production.

---

## 3. Pre-launch checklist

### Security

- [ ] `CAPKIT_HMAC_SECRET` is 32+ random bytes (`openssl rand -hex 32`), unique per environment
- [ ] `CAPKIT_ADMIN_KEY` is separate from `ABSUITE_ADMIN_API_KEY` and rotated
- [ ] `ABSUITE_ALLOWED_ORIGINS` lists real origins — not empty, which is permissive in development
- [ ] `NODE_ENV=production` (CapKit refuses to start without a real secret)
- [ ] `EDGERUN_SCRIPT_ROOT` left unset unless script execution is genuinely needed
- [ ] `EDGERUN_ALLOWED_HOSTS` restricts outbound task targets
- [ ] Service ports bound to `127.0.0.1` and fronted by TLS termination
- [ ] `STRIPE_WEBHOOK_SECRET` set if billing is live

### Operations

- [ ] Volume backing `ABSUITE_DB_PATH` is on persistent storage
- [ ] `node scripts/backup.mjs create` scheduled (cron or a sidecar), with
      `prune --keep 7` so snapshots do not fill the disk
- [ ] **A restore has actually been performed once**, not just assumed
- [ ] `/health` wired to the orchestrator's liveness probe
- [ ] `/ready` wired to the readiness probe
- [ ] `/metrics` scraped; alert on `absuite_quota_rejections_total` and error-rate
- [ ] Log aggregation configured
- [ ] Restart tested: confirm schedules survive (`Restored N schedule(s)` on boot)

### Commercial

- [ ] Plans in `billing.ts` match the public pricing page
- [ ] Stripe products carry `metadata.plan` matching a plan id
- [ ] Tenant `externalRef` set to the Stripe customer id, or webhooks cannot map
- [ ] Quota-exceeded (`402`) copy points at an upgrade path
- [ ] Terms of service and privacy policy published
- [ ] Support channel exists and is monitored

### Legal

- [ ] Data-processing terms cover the audit log — it records subjects and actions
- [ ] Audit retention matches what the plan promises
- [ ] MIT licence retained in every published package

---

## 3b. Backups

```bash
node scripts/backup.mjs create          # snapshot + verify, discards if invalid
node scripts/backup.mjs verify <file>   # re-check an existing snapshot
node scripts/backup.mjs restore <file>  # moves the current db aside first
node scripts/backup.mjs prune --keep 7  # retain the newest seven
```

Copying a live SQLite file with `cp` is unsafe: a write in flight yields a torn
copy, and in WAL mode the `.db` alone is missing everything still in the log.
The script checkpoints and folds the WAL in so each snapshot stands alone.

Restore never overwrites silently — the current database is moved aside first,
so a mistaken restore is itself recoverable.

Suggested cron:

```cron
0 * * * * cd /srv/absuite && node scripts/backup.mjs create && node scripts/backup.mjs prune --keep 24
```

---

## 4. Deploying

```bash
# 1. Secrets
cp .env.example .env
sed -i "s/^CAPKIT_HMAC_SECRET=.*/CAPKIT_HMAC_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s/^ABSUITE_ADMIN_API_KEY=.*/ABSUITE_ADMIN_API_KEY=$(openssl rand -hex 32)/" .env

# 2. Start
docker compose up -d

# 3. Verify
curl -s localhost:8081/health && curl -s localhost:8081/ready
for p in 8082 8083 8084 3001; do curl -s -o /dev/null -w "$p:%{http_code}\n" localhost:$p/health; done

# 4. First tenant
curl -X POST localhost:8081/admin/tenants \
  -H "X-ABSuite-Admin-Key: $ABSUITE_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"First Customer","plan":"team","externalRef":"cus_stripe_id"}'
# Store the returned apiKey immediately — it is shown once.
```

## 5. Publishing to npm

```bash
pnpm -r build
pnpm --filter @absuite/capkit publish --access public
pnpm --filter @absuite/edge-run publish --access public
pnpm --filter @absuite/quickbench publish --access public
pnpm --filter @absuite/connector-starter publish --access public
pnpm --filter @absuite/mcp publish --access public
```

Or in one command: `pnpm publish:packages`.

Publish CapKit first — the others depend on it, and `workspace:*` is rewritten
to the published version at pack time.

---

## 6. What "ready to launch" honestly means

The software is ready to be **used**. Someone can deploy it today, create
tenants, issue credentials, schedule work, and be metered and billed.

It is not yet ready to carry an **SLA for a large customer**, because of the
single-node and backup gaps in §2. That is a deliberate, stated boundary rather
than a hidden one — and it is the right boundary for a first launch. Ship to
early users on the free and Team plans, learn what actually breaks, and add
Postgres when a customer's scale genuinely requires it rather than in
anticipation of one who has not arrived.

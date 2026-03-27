# ABSuite v1.1 - Sovereign Local-First AI Agent Platform 🚀

[![ABSuite](packages/capkit/ABSuite%20image.jpeg)](packages/capkit/ABSuite%20image.jpeg)

**Dynamic Orchestrator for Secure Offline Agents** – Build, Secure, Run, Eval, **Control** from one CLI/UI. From original 4 GitHub tools → unified monorepo marvel.

## 🎯 Vision & Origin
ABSuite started as **Agent Builder Suite** primitives:
- [capkit](https://github.com/iamGodofall/capkit): HMAC capabilities vs prompt injection.
- [quickbench](https://github.com/iamGodofall/quickbench): Signed local evals.
- [edge-run](https://github.com/iamGodofall/edge-run): SQLite agent scheduler.
- [connector-starter](https://github.com/iamGodofall/connector-starter): Adapter factory.

**Now**: **Central orchestrator** (`absuite-core`) dynamically starts/stops 6+ services on-demand. **CLI/UI control**—no static stacks.

**Why Marvel?** Production Docker healthchecks + Node daemon fallback + live dashboard. Safe, sovereign agents at scale.

## 🏗️ Architecture (Dynamic)
```
CLI: npx absuite-core suite:start capkit edge-run
  ↓
Core (`src/index.ts`): spawn/pnpm or Docker
  ↓
Services: Ports 3001(Dash), 8081(Capkit), 8082(Edge), 8083(Quick), 8084(Conn)
Dashboard: Socket.io start/stop/refresh
```

| Component | Port | Role | Dynamic Cmd |
|-----------|------|------|-------------|
| Dashboard | 3001 | Live Control | `suite:start dashboard` |
| Capkit | 8081 | Capabilities | `suite:start capkit` |
| Edge-run | 8082 | Scheduler | `suite:start edge-run` |
| Quickbench | 8083 | Benchmarks | `suite:start quickbench` |
| Connector | 8084 | Adapters | `suite:start connector-starter` |
| DB | Internal | Persistent | Auto w/ depends_on |

## 🚀 Quick Start (Dynamic)
```bash
pnpm i
npx absuite-core suite:start --services=dashboard  # Or all
open http://localhost:3001  # UI to start others
```

**Full Stack**:
```bash
npx absuite-core suite:start  # Defaults all
docker compose up -d  # Or static
```

## 📋 Workflows (Vision Realized)
### 1. Generate & Secure Adapter
```bash
npx absuite-core suite:start connector-starter capkit
npx connector-starter generate mastodon
curl localhost:8081/issue -d '{"action":"post","resource":"mastodon","expiresIn":"1h"}' > token.cap
```

### 2. Schedule Agent
```bash
npx absuite-core suite:start edge-run
curl localhost:8082/schedule -d '{"cron":"* * * * *","token":"token.cap"}'
```

### 3. Eval
```bash
npx absuite-core suite:start quickbench
npx quickbench eval datasets/en-global-sentiment.csv
```

### 4. UI Control
Dashboard@3001: Click start/stop/refresh services live.

## 🛠️ Development (On-Demand)
```
pnpm --filter dashboard-ui dev  # Vite HMR 3001
npx absuite-core suite:start --docker=false capkit  # Node mode
pnpm test  # Jest all
```

## 🔒 Security Model (CapKit Core)
```
Threat: Prompt Injection → Scoped `post/mastodon` token expires 1h, HMAC verified.
Audit: Signed receipts in DB.
Policies: YAML `policy.yaml` → checkPolicy(action, resource).
```

## 📊 Benchmarks (Quickbench)
- **Datasets**: `en-global-sentiment.csv` (input/expected/demographics).
- **Metrics**: Accuracy, P95 latency, fairness parity—signed HTML reports.

## 📦 Docker Prod (Healthchecks/Depends)
Healthchecks on all, DB first, restarts unless-stopped. `docker compose up -d`.

## 🎯 Why Important to Tech World/Users
- **Engineers**: Pure primitives (Node/SQLite/HMAC)—fork, extend, ship v1.1.
- **Users**: Offline agents—no cloud bills, sovereign data.
- **World**: Safe scaling (scoped perms)—agents as infrastructure.

MIT Licensed | **Shipped Dynamic v1.1** – One command to rule agents.

**Demo**: `npx absuite-core suite:start dashboard && open localhost:3001`


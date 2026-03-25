# ABSuite-core v1.0 - AI Agent Suite Orchestrator

[![ABSuite image](ABSuite image.jpeg)](ABSuite image.jpeg)

Central monorepo coordinator for ABSuite ecosystem:

| Package | Path | Status |
|---------|------|--------|
| capkit | packages/capkit | ✅ Symlinked |
| edge-run | packages/edge-run | ✅ Symlinked |
| connector-starter | packages/connector-starter | ✅ Symlinked |
| quickbench | packages/quickbench | ✅ Symlinked |

## Features
- **CLI**: `npx absuite-core suite:start` | `suite:list` | `workflow <tools>`
- **Workspaces**: pnpm monorepo
- **Build**: TypeScript → dist/
- **Docker**: `docker-compose up` (db, capkit, edge-run, dashboard:3000)

## Quick Start

```bash
pnpm i
pnpm run build
npx absuite-core suite:start  # Starts services
pnpm suite workflow edge-run capkit  # Run workflow
```

## Demo
- Dashboard: http://localhost:3000
- Full stack with sqlite db

## Roadmap v1.1
- Tests
- GitHub Actions
- Published to npm

*Shipped v1.0 [13/16]* 🚀

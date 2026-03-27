# ABSuite-core Docker Suite 🚀

## Quick Start
```bash
docker-compose -f docker-compose.full.yml up -d
```

## Services (6 packages + DB)
| Service | Purpose | Access |
|---------|---------|--------|
| **absuite-db** | SQLite DB | `docker-compose exec absuite-db sqlite3 /data/absuite.db` |
| **capkit** | Capability/permissions system | `docker-compose exec capkit node dist/index.js` |
| **edge-run** | Agent scheduler/runtime | `docker-compose exec edge-run node dist/index.js` |
| **dashboard** | Core orchestrator | `docker-compose exec dashboard node dist/index.js` (port 3000) |
| **quickbench** | Agent benchmark tool | `docker-compose exec quickbench npm run demo` (port 8080) |
| **connector-starter** | Platform adapter generator | `docker-compose exec connector-starter node dist/cli.js` |

## Workflow
1. **Start stack** `docker-compose -f docker-compose.full.yml up -d`
2. **DB ready** `./data/absuite.db` persistent
3. **CLI tools** `docker-compose exec [service] [command]`
4. **Logs** `docker-compose logs -f`
5. **Stop** `docker-compose down`

## Why CLI-focused?
ABSuite-core = **developer/agent framework**. No web UI (CLI-first):
- `capkit`: issue/verify capabilities
- `edge-run`: schedule agents offline
- `quickbench`: local AI evals
- `connector-starter`: generate adapters

**Convenience:** Single command starts full local dev environment + DB sharing across services.

**Production:** Scale with `docker-compose.full.yml`, add nginx reverse proxy.

All 6 packages Dockerized + working. Original sqlite error fixed!

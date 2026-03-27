# ABSuite Docker Fixes TODO

## Current State

- CLI lists all 6 services
- `suite:start dashboard` → dashboard + deps (db/capkit/edge-run) up 4/4
- All containers exist but Restarting/unhealthy
- connector-starter/quickbench: No "start" script
- dashboard: docker compose not found in container
- Healthchecks fail

## Steps

- [ ] 1. Add "start" scripts to connector-starter/quickbench package.json
- [ ] 2. Volume docker-compose.yml to dashboard
- [ ] 3. Fix dashboard/server.ts docker commands (use -f flag)
- [ ] 4. Update healthchecks for CLI packages (sleep or remove)
- [ ] 5. docker compose down -v && docker compose up -d
- [ ] 6. Verify docker compose ps all Up (healthy)
- [ ] Complete

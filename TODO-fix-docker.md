# ABSuite Docker Fixes TODO

## Current State ✅ FIXED

- ✅ CLI lists all 6 services
- ✅ All packages have "start" scripts
- ✅ Dashboard Socket.io event mismatch fixed (restart → start)
- ✅ Healthchecks updated from sleep to curl for all services
- ✅ All services have /health endpoints

## Steps Completed

- [x] 1. Add "start" scripts to connector-starter/quickbench package.json - ALREADY EXISTS
- [x] 2. Volume docker-compose.yml to dashboard - ALREADY CONFIGURED
- [x] 3. Fix dashboard/server.ts docker commands (use -f flag) - ALREADY CONFIGURED
- [x] 4. Update healthchecks for CLI packages (sleep → curl) - FIXED
- [ ] 5. docker compose down -v && docker compose up -d - READY TO TEST
- [ ] 6. Verify docker compose ps all Up (healthy) - READY TO TEST
- [ ] Complete

## Next Actions
1. Run `docker compose down -v` to clean up
2. Run `docker compose up -d --build` to rebuild and start
3. Run `docker compose ps` to verify all services are healthy
4. Test endpoints: curl localhost:8081/health, localhost:8082/health, etc.

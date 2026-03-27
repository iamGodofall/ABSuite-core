# ABSuite Docker Fix Progress Tracker

Status: Following approved plan to fix container restarts. DB healthy, others restarting.

## Steps from Plan:

### 1. capkit & edge-run: Add Express /health servers
- [x] packages/capkit/src/server.ts (create health server)
- [x] packages/capkit/src/index.ts (export startServer) 
- [x] packages/capkit/package.json (add "start": "node dist/server.js")
- [x] packages/capkit/Dockerfile (CMD ["npm", "start"])
- [x] packages/edge-run/src/server.ts (create health server)
- [x] packages/edge-run/src/index.ts 
- [x] packages/edge-run/package.json ("start")
- [x] packages/edge-run/Dockerfile

### 2. CLI services: Fix CMD to "npm start"
- [x] packages/connector-starter/Dockerfile (CMD ["npm", "start"])
- [x] packages/quickbench/Dockerfile (CMD ["npm", "start"])

### 3. dashboard fixes
- [x] packages/dashboard-ui/server.ts (add -f flag to docker compose cmds, fix imports, status check)
- [x] docker-compose.yml (already has volume)

### 4. docker-compose.yml adjustments
- [x] Added docker-compose.yml volume to dashboard (user did manually)

### 5. Verification
- [ ] docker compose down -v
- [ ] docker compose up -d --build  
- [ ] docker compose ps (all Up/healthy)
- [ ] Test endpoints: curl localhost:8081/health etc.

Next: Implement capkit server.ts first.

Updated after each step.


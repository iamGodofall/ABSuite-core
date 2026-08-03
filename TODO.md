# Fix Windows `tsx` ENOENT in dashboard smoke tests

## Root Cause
`packages/dashboard-ui/server.smoke.test.ts` spawns the `.bin/tsx` shell shim, which Windows cannot execute without `shell: true` → `ENOENT` → server never starts → all 33 "dashboard never became healthy" failures plus 5 suite spawn failures.

## Steps
- [x] Analyze root cause
- [x] Confirm approval of plan
- [x] Edit `packages/dashboard-ui/server.smoke.test.ts`:
  - [x] Point `TSX` at the real CLI entry: `node_modules/tsx/dist/cli.mjs`
  - [x] Spawn `process.execPath` (Node) with `[TSX, 'server.ts']` for cross-platform support
- [x] Make CapKit proxy assertions robust to a live Dockerized CapKit (accept 502 or 401, never a fabricated 200)
- [x] Run the smoke test to verify: `pnpm jest packages/dashboard-ui/server.smoke.test.ts`

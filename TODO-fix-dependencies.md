# Dependency Fix Plan for ABSuite

## Current Status
All package.json files are correctly configured with proper dependencies. The TypeScript errors are occurring because node_modules haven't been installed.

## Root Causes
1. **Missing node_modules**: `pnpm install` hasn't been run
2. **Workspace linking**: Internal package references (capkit) need workspace installation
3. **Build order**: capkit must be built first since connector-starter depends on it

## Fix Steps - COMPLETED ✅

### Step 1: Install all dependencies ✅
```bash
pnpm install
```
**Status**: Completed successfully - 698 packages resolved

### Step 2: Build packages in dependency order ✅
```bash
# Build capkit first (others depend on it)
cd packages/capkit && pnpm build ✅

# Build remaining packages
cd packages/edge-run && pnpm build ✅
cd packages/quickbench && pnpm build ✅
cd packages/connector-starter && pnpm build ✅
cd packages/dashboard-ui && pnpm build ✅ (Fixed missing tailwindcss dependency)
```
**Status**: All packages built successfully

### Step 3: Fix dashboard-ui dependencies ✅
**Issue**: Missing tailwindcss, postcss, autoprefixer
**Solution**: Added to devDependencies:
- tailwindcss: ^3.3.6
- postcss: ^8.4.32
- autoprefixer: ^10.4.16

### Step 4: Run tests to verify everything works
```bash
pnpm test
```
**Status**: Ready to run

## Package Dependency Analysis

### capkit (foundation package)
- Dependencies: express, better-sqlite3, js-yaml, openai, @anthropic-ai/sdk, yargs
- DevDependencies: All @types/* packages, jest, ts-jest, ts-node, typescript
- **Status**: ✅ Properly configured

### edge-run
- Dependencies: express, js-yaml, node-cron, better-sqlite3, commander, socket.io
- DevDependencies: All @types/*, socket.io-client, jest, ts-jest, ts-node, typescript, nodemon
- **Status**: ✅ Properly configured

### quickbench
- Dependencies: csv-parse, js-yaml, open, express, simple-statistics, uuid
- DevDependencies: All @types/*, supertest, jest, ts-jest, ts-node, typescript, eslint, prettier
- **Status**: ✅ Properly configured

### connector-starter
- Dependencies: capkit (workspace:*), fs-extra, js-yaml, prompts
- DevDependencies: All @types/*, jest, ts-jest, ts-node, typescript
- **Status**: ✅ Properly configured

### dashboard-ui
- Dependencies: React, Vite, TypeScript setup
- **Status**: Needs verification

## Expected Outcome
After running these steps:
- All TypeScript module resolution errors will be resolved
- Workspace packages will be properly linked
- All packages will compile successfully
- Tests will pass

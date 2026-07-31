# The public instance: every service and the room in one image.
#
# packages/*/Dockerfile each build one service, which is what docker-compose.yml
# composes and what CD pushes to ghcr.io. This builds all of them at once and
# adds a supervisor, because a free host gives you one container and one port
# and a seven-container topology cannot be squeezed through that.
#
# It shares the builder stage across all six packages rather than building six
# images, so the workspace is installed and compiled exactly once.

FROM node:22-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Manifests first, so a source edit does not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/
COPY packages/edge-run/package.json ./packages/edge-run/
COPY packages/quickbench/package.json ./packages/quickbench/
COPY packages/connector-starter/package.json ./packages/connector-starter/
COPY packages/trust/package.json ./packages/trust/
COPY packages/dashboard-ui/package.json ./packages/dashboard-ui/
COPY packages/cli/package.json ./packages/cli/
COPY packages/mcp/package.json ./packages/mcp/

RUN pnpm install --frozen-lockfile

COPY . .

# The room's vertices are generated from the constitution. Building without
# this step would ship whatever JSON happened to be committed, which is the
# drift `check:layers` exists to catch — so it is regenerated here rather than
# trusted.
RUN node scripts/gen-architecture-layers.mjs

RUN pnpm --filter @absuitecore/capkit build \
 && pnpm --filter @absuitecore/edge-run build \
 && pnpm --filter @absuitecore/quickbench build \
 && pnpm --filter @absuitecore/connector-starter build \
 && pnpm --filter @absuitecore/trust build \
 && pnpm --filter @absuitecore/dashboard-ui build

# ── Runtime ─────────────────────────────────────────────────────────────────
#
# The whole workspace is carried over rather than a curated subset. pnpm links
# dependencies with relative symlinks inside /app; copying selected directories
# breaks those links in ways that only show up at runtime, on one service, under
# load. The image is larger and it actually runs.

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=builder /app /app

# SQLite lives here. Mount a volume at /data to keep records across deploys;
# without one the instance is a clean slate on every restart, which is a fine
# and honest state for something whose job is to be looked at.
RUN mkdir -p /data
ENV ABSUITE_DB_PATH=/data/absuite.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "deploy/serve-all.mjs"]

FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src
COPY packages/edge-run/package.json ./packages/edge-run/package.json
COPY packages/edge-run/tsconfig.json ./packages/edge-run/tsconfig.json
COPY packages/edge-run/src ./packages/edge-run/src

RUN pnpm install --filter @absuitecore/edge-run... --no-frozen-lockfile
RUN pnpm --filter @absuitecore/capkit build
RUN pnpm --filter @absuitecore/edge-run build

# Drop devDependencies now that dist exists. The runtime image carries the
# workspace layout verbatim, so pruning has to happen here, before the copy.
RUN pnpm install --filter @absuitecore/edge-run... --prod --no-frozen-lockfile --ignore-scripts

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy the workspace layout exactly as the builder produced it.
#
# pnpm does not put real packages in a project's node_modules — it puts
# symlinks pointing at the root .pnpm store. Copying only
# packages/edge-run/node_modules therefore yields a directory of dangling
# links, and the service dies at startup with "Cannot find module 'express'".
# Preserving the root node_modules and the relative paths beneath it is what
# makes those links resolve.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/capkit ./packages/capkit
COPY --from=builder /app/packages/edge-run ./packages/edge-run

WORKDIR /app/packages/edge-run

EXPOSE 8082

# Run as the unprivileged user the base image already provides.
USER node

CMD ["node", "dist/server.js"]

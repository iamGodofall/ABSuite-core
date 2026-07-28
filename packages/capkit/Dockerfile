FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src

RUN pnpm install --filter @absuite/capkit... --no-frozen-lockfile
RUN pnpm --filter @absuite/capkit build

# Drop devDependencies now that dist exists. The runtime image carries the
# workspace layout verbatim, so pruning has to happen here, before the copy.
RUN pnpm install --filter @absuite/capkit... --prod --no-frozen-lockfile --ignore-scripts

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy the workspace layout exactly as the builder produced it.
#
# pnpm does not put real packages in a project's node_modules — it puts
# symlinks pointing at the root .pnpm store. Copying only
# packages/capkit/node_modules therefore yields a directory of dangling
# links, and the service dies at startup with "Cannot find module 'express'".
# Preserving the root node_modules and the relative paths beneath it is what
# makes those links resolve.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/capkit ./packages/capkit

WORKDIR /app/packages/capkit

EXPOSE 8081

# Run as the unprivileged user the base image already provides.
USER node

CMD ["node", "dist/server.js"]

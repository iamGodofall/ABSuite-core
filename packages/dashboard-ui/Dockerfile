FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# capkit, because the dashboard depends on it as a workspace package.
#
# It was added for `guardedFetch` — the outbound guard the /endpoint-check route
# needs — and this file was not updated, so `pnpm install --frozen-lockfile`
# could not resolve `@absuitecore/capkit` and every container build failed for
# five hours. `check:deploy` verifies that COPY paths exist; it did not verify
# that a workspace dependency is among them, which is why nothing caught it.
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src

COPY packages/dashboard-ui/package.json ./packages/dashboard-ui/package.json
COPY packages/dashboard-ui/tsconfig.json ./packages/dashboard-ui/tsconfig.json
COPY packages/dashboard-ui/vite.config.ts ./packages/dashboard-ui/vite.config.ts
COPY packages/dashboard-ui/postcss.config.js ./packages/dashboard-ui/postcss.config.js
COPY packages/dashboard-ui/tailwind.config.ts ./packages/dashboard-ui/tailwind.config.ts
COPY packages/dashboard-ui/index.html ./packages/dashboard-ui/index.html
COPY packages/dashboard-ui/server.ts ./packages/dashboard-ui/server.ts
COPY packages/dashboard-ui/src ./packages/dashboard-ui/src

RUN pnpm install --frozen-lockfile

# capkit first: the dashboard imports from its built `dist/`, not its source.
RUN pnpm --filter @absuitecore/capkit build

WORKDIR /app/packages/dashboard-ui
RUN pnpm build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# No corepack here. The runtime image runs no package manager — see CMD.
RUN apk add --no-cache docker-cli docker-compose

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/dashboard-ui/package.json ./package.json
COPY --from=builder /app/packages/dashboard-ui/dist ./dist
COPY --from=builder /app/packages/dashboard-ui/server.ts ./server.ts

EXPOSE 3001

# `node`, not `pnpm start`. This container crash-looped on every start:
#
#     ! Corepack is about to download .../pnpm-11.20.0.tgz
#     [ERR_PNPM_WORKSPACE_PKG_NOT_FOUND] "@absuitecore/capkit@workspace:^" is in
#     the dependencies but no package named "@absuitecore/capkit" is present
#     Packages found in the workspace: @absuitecore/dashboard-ui
#
# Three things compounded. `/app/package.json` is dashboard-ui's, and it declares
# a `workspace:^` dependency on capkit — true in the repository, false in an
# image that contains one package. That file carries no `packageManager`, so
# corepack downloaded whatever pnpm was newest rather than the 11.18.0 this
# repository pins. And pnpm 11.20 verifies dependency status before `run`, so
# `pnpm start` resolved the workspace, could not, and exited 1.
#
# The deeper mistake is running a package manager in a runtime container at all.
# It resolves dependencies at container start — reaching the network, running a
# supply-chain check, and taking whatever version it is handed — at the one
# moment nothing should be uncertain. Every sibling image already runs
# `node dist/server.js`, and `deploy/serve-all.mjs` already starts this same
# server with `node --import tsx`. This was the one that did not.
#
# Nothing here failed in CI: when CI last built, latest pnpm still behaved. The
# image was a time bomb with an external fuse, and 11.20.0 lit it.
CMD ["node", "--import", "tsx", "server.ts"]


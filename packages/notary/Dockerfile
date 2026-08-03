# The notary, as an image somebody else can run in one command.
#
# Every other service in this repository copies packages/capkit into the build
# because it imports the shared capability layer. This one does not, and the
# absence is the point: a notary that depended on the thing it witnesses would
# be a component of it, and its whole value is being a different party.
#
# So the build is short, and it should stay short. If this Dockerfile ever needs
# a line mentioning capkit, something has gone wrong upstream of it.
#
#   docker run -p 8086:8086 \
#     -e CAPKIT_NOTARY_PRIVATE_KEY="$(cat notary-key.pem)" \
#     ghcr.io/iamgodofall/absuite-notary
#
# Without that key it generates one per process and says so loudly at boot and
# in /health — every receipt it has issued stops verifying when the container
# restarts, and receipts already handed out keep looking valid until somebody
# checks them.
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/notary/package.json ./packages/notary/package.json
COPY packages/notary/tsconfig.json ./packages/notary/tsconfig.json
COPY packages/notary/src ./packages/notary/src

RUN pnpm install --filter @absuitecore/notary... --no-frozen-lockfile
RUN pnpm --filter @absuitecore/notary build

# Drop devDependencies now that dist exists. The runtime image carries the
# workspace layout verbatim, so pruning has to happen here, before the copy.
RUN pnpm install --filter @absuitecore/notary... --prod --no-frozen-lockfile --ignore-scripts

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# pnpm does not put real packages in a project's node_modules — it puts symlinks
# pointing at the root .pnpm store. Copying only packages/notary/node_modules
# would yield dangling links and the service would die at startup with
# "Cannot find module 'express'". Preserving the root node_modules and the
# relative paths beneath it is what makes those links resolve.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages/notary ./packages/notary

WORKDIR /app/packages/notary

EXPOSE 8086

# Run as the unprivileged user the base image already provides.
USER node

CMD ["node", "dist/server.js"]

FROM node:20-alpine3.21 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src

RUN pnpm install --filter @absuite/capkit... --no-frozen-lockfile
WORKDIR /app/packages/capkit
RUN pnpm build

FROM node:20-alpine3.21

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/capkit/package.json ./package.json
COPY --from=builder /app/packages/capkit/dist ./dist
COPY --from=builder /app/packages/capkit/node_modules ./node_modules

EXPOSE 8081

# Run as the unprivileged user the base image already provides.
USER node

CMD ["node", "dist/server.js"]

FROM node:20-alpine3.21 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src
COPY packages/quickbench/package.json ./packages/quickbench/package.json
COPY packages/quickbench/tsconfig.json ./packages/quickbench/tsconfig.json
COPY packages/quickbench/src ./packages/quickbench/src

RUN pnpm install --filter @absuite/quickbench... --no-frozen-lockfile
RUN pnpm --filter @absuite/capkit build
RUN pnpm --filter @absuite/quickbench build

FROM node:20-alpine3.21

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/quickbench/package.json ./package.json
COPY --from=builder /app/packages/quickbench/dist ./dist
COPY --from=builder /app/packages/quickbench/node_modules ./node_modules
COPY --from=builder /app/packages/capkit ./node_modules/@absuite/capkit

EXPOSE 8083

USER node

CMD ["node", "dist/server.js"]

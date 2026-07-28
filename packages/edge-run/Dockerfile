FROM node:20-alpine3.21 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src
COPY packages/edge-run/package.json ./packages/edge-run/package.json
COPY packages/edge-run/tsconfig.json ./packages/edge-run/tsconfig.json
COPY packages/edge-run/src ./packages/edge-run/src

RUN pnpm install --filter @absuite/edge-run... --no-frozen-lockfile
RUN pnpm --filter @absuite/capkit build
RUN pnpm --filter @absuite/edge-run build

FROM node:20-alpine3.21

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/edge-run/package.json ./package.json
COPY --from=builder /app/packages/edge-run/dist ./dist
COPY --from=builder /app/packages/edge-run/node_modules ./node_modules
COPY --from=builder /app/packages/capkit ./node_modules/@absuite/capkit

EXPOSE 8082

USER node

CMD ["node", "dist/server.js"]

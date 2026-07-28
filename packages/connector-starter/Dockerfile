FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src
COPY packages/connector-starter/package.json ./packages/connector-starter/package.json
COPY packages/connector-starter/tsconfig.json ./packages/connector-starter/tsconfig.json
COPY packages/connector-starter/src ./packages/connector-starter/src

RUN pnpm install --filter @absuite/connector-starter... --no-frozen-lockfile
RUN pnpm --filter @absuite/capkit build
RUN pnpm --filter @absuite/connector-starter build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/connector-starter/package.json ./package.json
COPY --from=builder /app/packages/connector-starter/dist ./dist
COPY --from=builder /app/packages/connector-starter/node_modules ./node_modules
COPY --from=builder /app/packages/capkit ./node_modules/@absuite/capkit

EXPOSE 8084

USER node

CMD ["node", "dist/server.js"]

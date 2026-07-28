FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/capkit/package.json ./packages/capkit/package.json
COPY packages/capkit/tsconfig.json ./packages/capkit/tsconfig.json
COPY packages/capkit/src ./packages/capkit/src
COPY packages/trust/package.json ./packages/trust/package.json
COPY packages/trust/tsconfig.json ./packages/trust/tsconfig.json
COPY packages/trust/src ./packages/trust/src

RUN pnpm install --filter @absuite/trust... --no-frozen-lockfile
RUN pnpm --filter @absuite/capkit build
RUN pnpm --filter @absuite/trust build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/trust/package.json ./package.json
COPY --from=builder /app/packages/trust/dist ./dist
COPY --from=builder /app/packages/trust/node_modules ./node_modules
COPY --from=builder /app/packages/capkit ./node_modules/@absuite/capkit

EXPOSE 8085

USER node

CMD ["node", "dist/server.js"]

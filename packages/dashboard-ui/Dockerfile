FROM node:20-alpine3.21 AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/dashboard-ui/package.json ./packages/dashboard-ui/package.json
COPY packages/dashboard-ui/tsconfig.json ./packages/dashboard-ui/tsconfig.json
COPY packages/dashboard-ui/vite.config.ts ./packages/dashboard-ui/vite.config.ts
COPY packages/dashboard-ui/postcss.config.js ./packages/dashboard-ui/postcss.config.js
COPY packages/dashboard-ui/tailwind.config.ts ./packages/dashboard-ui/tailwind.config.ts
COPY packages/dashboard-ui/index.html ./packages/dashboard-ui/index.html
COPY packages/dashboard-ui/server.ts ./packages/dashboard-ui/server.ts
COPY packages/dashboard-ui/src ./packages/dashboard-ui/src

RUN pnpm install --frozen-lockfile
WORKDIR /app/packages/dashboard-ui
RUN pnpm build

FROM node:20-alpine3.21

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && apk add --no-cache docker-cli docker-compose

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/dashboard-ui/package.json ./package.json
COPY --from=builder /app/packages/dashboard-ui/dist ./dist
COPY --from=builder /app/packages/dashboard-ui/server.ts ./server.ts

EXPOSE 3001

CMD ["pnpm", "start"]


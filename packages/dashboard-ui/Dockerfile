FROM node:20-alpine3.19 AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine3.19

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY package.json ./

# Install Docker CLI for socket access
RUN apk add --no-cache docker-cli docker-compose

EXPOSE 3001

CMD ["npm", "start"]


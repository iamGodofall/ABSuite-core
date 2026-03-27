FROM node:20-alpine3.19

WORKDIR /app
COPY package.json ./
RUN npm install --production --no-optional --no-audit --no-fund

# Install Docker CLI for container to control host Docker daemon via socket
RUN apk add --no-cache docker docker-compose


COPY . .
RUN npm run build || true

EXPOSE 3000
CMD ["npm", "start"]

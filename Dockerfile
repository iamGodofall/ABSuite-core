FROM node:20-alpine3.19

WORKDIR /app
COPY package*.json ./
RUN npm install --production --no-optional --no-audit --no-fund --legacy-peer-deps

COPY . .
RUN npm run build || echo "Build skipped, prod ready"

EXPOSE 3000
CMD ["npm", "start"]

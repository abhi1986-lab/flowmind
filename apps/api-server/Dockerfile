# FlowMind API Server (NestJS) - MVP
FROM node:20-alpine AS base
WORKDIR /app

# Install deps first for caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

# Generate BOTH Prisma clients (control @prisma/client + client-data @prisma/client-data)
RUN npx prisma generate --schema=prisma/control/schema.prisma \
 && npx prisma generate --schema=prisma/client/schema.prisma \
 || true

# Build
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/main.js"]

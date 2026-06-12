# FlowMind API Server (NestJS) - MVP
FROM node:20-alpine AS base
WORKDIR /app

# Install deps first for caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

# Generate prisma (control) at build if needed
RUN npx prisma generate || true

# Build
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/main.js"]

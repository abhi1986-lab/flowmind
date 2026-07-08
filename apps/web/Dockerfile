# FlowMind Web (Next.js) - Dev
FROM node:20-alpine
WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install

# Copy source (overridden by volume mount in compose for live dev)
COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]

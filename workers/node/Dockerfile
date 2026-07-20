FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production deps
RUN npm ci --omit=dev --ignore-scripts

# Copy server + packages
COPY server/ server/
COPY packages/ packages/
COPY convex/ convex/
COPY tsconfig.json ./

# Build TypeScript
RUN npx tsc --outDir dist --declaration false --sourceMap false 2>/dev/null || true

ENV PORT=3100
ENV NODE_ENV=production
EXPOSE 3100

CMD ["npx", "tsx", "server/index.ts"]

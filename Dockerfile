# Multi-stage Docker build for CircuitShield Resilience Gateway
FROM node:24-alpine AS base
WORKDIR /app

# Stage 1: Build client and server
FROM base AS builder
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

RUN npm run build

# Stage 2: Production runtime
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4004

COPY package.json ./
COPY server/package.json ./server/
COPY --from=builder /app/node_modules ./node_modules
# server/dist already contains the compiled shared/ modules (tsc's rootDir
# spans both server/src and ../shared, see server/tsconfig.json), so nothing
# else needs to be copied from the shared/ source directory.
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 4004

# app.ts resolves the client build as a sibling of its own working directory
# (see resolveClientDistPath in server/src/app.ts), the same convention
# `npm start --workspace=server` uses, so run node from server/ here too.
WORKDIR /app/server
CMD ["node", "dist/server/src/index.js"]
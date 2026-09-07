# =============================================================================
# Backend Dockerfile — PRODUCTION (multi-stage)
# Compiles TS, installs only prod deps, runs a minimal runtime image.
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache tzdata
ENV TZ=America/Argentina/Buenos_Aires

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/main.js"]

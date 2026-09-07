# =============================================================================
# Frontend Dockerfile — PRODUCTION (multi-stage)
# Builds Next.js, runs standalone output.
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json ./
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
# Pass build-time API URL (public). If empty, the runtime env is used by client.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]

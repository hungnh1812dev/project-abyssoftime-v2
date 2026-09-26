# syntax=docker/dockerfile:1
# frontend image for the VPS (k3s + Flux): Next.js standalone output on a Node runner. Bun installs and
# builds; Node runs server.js, Next's supported server runtime. Runtime config and secrets come from
# the k8s Secret (see k8s/secret.example.yaml), never from this image.

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.mjs bakes <origin of GRAPHQL_URL>/health into the client bundle as CMS_HEALTH_URL, so it
# must be the public cms-api GraphQL URL (e.g. https://api.example.com/graphql).
ARG GRAPHQL_URL
# src/auth.ts throws at import time without AUTH_SECRET, and `next build` imports it while collecting
# page data. The build only needs a value to exist; the real secret is set at runtime from the Secret.
ARG AUTH_SECRET=build-only-placeholder-not-used-at-runtime
RUN test -n "$GRAPHQL_URL" || { echo "GRAPHQL_URL build arg is required (e.g. https://api.example.com/graphql)" >&2; exit 1; }
ENV NEXT_TELEMETRY_DISABLED=1
RUN NEXT_OUTPUT=standalone GRAPHQL_URL="$GRAPHQL_URL" AUTH_SECRET="$AUTH_SECRET" bun run build

# ── Run stage ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

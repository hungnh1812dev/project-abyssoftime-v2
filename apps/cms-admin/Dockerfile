# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The cms-api origin, e.g. https://api.example.com (no path: the app appends /api/v1 and /health).
# Vite bakes it into the bundle at build time, so it's required and one image serves one API.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || { echo "VITE_API_URL build arg is required (e.g. https://api.example.com)" >&2; exit 1; }
RUN VITE_API_URL="$VITE_API_URL" bun run build

# ── Run stage ────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

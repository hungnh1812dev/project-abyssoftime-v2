# syntax=docker/dockerfile:1

# ── deps ─────────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
# --ignore-scripts: the postinstall's `prisma:generate` needs scripts/prisma.ts, which
# isn't copied yet at this point — the `build` stage runs it explicitly after `COPY . .`.
RUN bun install --frozen-lockfile --ignore-scripts

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build

COPY . .
RUN bun run prisma:generate
RUN bun run build

# ── prod-deps ────────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS prod-deps

WORKDIR /app

COPY package.json bun.lock ./
# --ignore-scripts: no scripts/ dir copied here; the generated Prisma client ships via
# dist/ from the `build` stage instead, so postinstall's prisma:generate isn't needed.
RUN bun install --frozen-lockfile --production --ignore-scripts

# ── migrator ─────────────────────────────────────────────────────────────────
FROM deps AS migrator

COPY . .

CMD ["bun", "run", "prisma:migrate:deploy"]

# ── runner (default target) ─────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

RUN addgroup -S abyssdev && adduser -S -G abyssdev abyssdev

COPY --from=prod-deps --chown=abyssdev:abyssdev /app/node_modules ./node_modules
COPY --from=build --chown=abyssdev:abyssdev /app/dist ./dist
COPY --from=build --chown=abyssdev:abyssdev /app/content-types ./content-types
COPY --chown=abyssdev:abyssdev package.json ./

USER abyssdev

# EXPOSE is build-time metadata, so the port comes from the required APP_PORT build arg (same name
# as k8s/.env's APP_PORT); it also seeds the runtime PORT that src/main.ts listens on. Pass it from
# the environment: `APP_PORT=3000 docker build --build-arg APP_PORT ...` (a bare --build-arg
# reads the shell env var). CI passes the CMS_API_APP_PORT repo variable.
ARG APP_PORT
RUN : "${APP_PORT:?APP_PORT build arg is required, e.g. --build-arg APP_PORT=3000}"
ENV PORT=${APP_PORT}
EXPOSE ${APP_PORT}

# No HEALTHCHECK — k8s liveness/readiness probes target GET /health instead.
CMD ["bun", "dist/src/main"]

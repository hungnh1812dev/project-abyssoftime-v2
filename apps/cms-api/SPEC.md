# Spec — Production Dockerfile for cms-api

## 1. Objective

Add a multi-stage `apps/cms-api/Dockerfile` that builds a production runtime image for the NestJS/Bun
API, targeting **≤ 500MB**. Secrets/config are injected at container run time (k3s/k8s `Secret`/
`ConfigMap` → env vars) — nothing is baked into the image at build time. Minimal, targeted
`package.json`/source changes are in scope only where they directly reduce image size.

Out of scope: `apps/cms-admin` (already has a Dockerfile) and `apps/frontend`. No k8s manifests are
written in this task — only documenting what the image expects.

## 2. Investigated facts (baseline, measured in this repo)

- Base image: `oven/bun:1-alpine` (already the convention — see `apps/cms-admin/Dockerfile`) = **124.4MB**.
- Full `node_modules` (dev + prod deps) = 739MB. Biggest contributors: `@prisma/*` (173MB) + `prisma`
  CLI (42MB), `@angular-devkit`/`webpack`/`typescript`/`jest`/`eslint` (dev-only, ~150MB+ combined),
  `better-sqlite3` (12MB, native addon), `@aws-sdk/client-s3` (11MB), `@getbrevo/brevo` (17MB).
- **Prisma 7 uses a WASM query compiler, not a native engine binary.** The generated client
  (`src/prisma/application/client/`, 11MB, already copied into `dist/` by `nest-cli.json`'s `assets`
  config) only `require()`s its own local files + `node:buffer`/`path`. It does **not** import
  `@prisma/client` or the `prisma` CLI at runtime.
- `@prisma/adapter-pg`, `@prisma/adapter-mariadb`, `@prisma/adapter-better-sqlite3` each depend only
  on their own DB driver (`pg`, `mariadb`, `better-sqlite3`) + the tiny `@prisma/driver-adapter-utils`
  (64K) — none depend on `@prisma/client` or `prisma`.
- `@prisma/client` (75MB), `prisma` CLI (42MB, pulls in `@prisma/studio-core` 42MB + `@prisma/dev` 18MB
  + `@prisma/engines` 24MB) are listed as regular `dependencies` today but are **build/migration-time
  tooling only** — confirmed no `"@prisma/client"` import anywhere in `src/`.
- `src/prisma/application/prisma.service.ts` **statically** imports all three adapters
  (`PrismaPg`/`PrismaMariaDb`/`PrismaBetterSqlite3`) at the top of the file and `switch`es on
  `DB_DRIVER` at construction time. Static imports are eagerly resolved — so today all three adapter
  packages (and `pg`/`mariadb`/`better-sqlite3`) must physically exist in `node_modules` regardless of
  which one is used.
- Local/default `DB_DRIVER` is `postgresql` (`.env.local`, and the default in `env.validation.ts` /
  `scripts/prisma.ts`).
- `main.ts` listens on `process.env.PORT ?? 3000` directly. **`SERVER_PORT` in `env.validation.ts`
  (default 8080) is validated but never read anywhere** — pre-existing dead config, not touched by this
  task; flagged under §7.
- `content-types/*.json` (24K) is read at boot (`CONTENT_TYPES_DIR`) and must ship in the image.
  `prisma/`, `scripts/`, `plop-templates/`, `test/`, `docs/`, `tasks/` are build/dev-time only.
- Docker is available locally (v29.8.0) — the image will actually be built and measured, not just
  estimated, during `/build`.

## 3. Design

### 3.1 Dockerfile stages (`apps/cms-api/Dockerfile`)

Two build targets from one Dockerfile:

1. `deps` — `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile` (full install: needed for
   `prisma generate` + `nest build` + typecheck).
2. `build` — from `deps`, copy source, `bun run prisma:generate` (defaults to the `postgresql` schema —
   `DB_DRIVER` unset at build time), then `bun run build` (`nest build`; `nest-cli.json` assets already
   copy the generated Prisma client + `.hbs` email templates into `dist/`).
3. `prod-deps` — fresh `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile --production` (drops all
   `devDependencies` — see §3.2), then prune the two unused DB-driver adapter packages by path:
   `rm -rf node_modules/@prisma/adapter-mariadb node_modules/@prisma/adapter-better-sqlite3
   node_modules/mariadb node_modules/better-sqlite3` (documented inline with a comment explaining why —
   this image is locked to `DB_DRIVER=postgresql`, see §3.3).
4. `runner` (**default target**, `ENV NODE_ENV=production`) — non-root user, copy `node_modules` from
   `prod-deps`, `dist/` and `content-types/` from `build`, `package.json`. `CMD ["bun", "dist/src/main"]`
   (mirrors the existing `start:prod` script). No `HEALTHCHECK` instruction — k8s liveness/readiness
   probes should target `GET /health` instead (documented in §5, not implemented here).
5. `migrator` (separate target, **not** part of the size budget) — from `deps`, copy full source,
   `CMD ["bun", "run", "prisma:migrate:deploy"]`. Built/run as a one-off `docker build --target migrator`
   image (e.g. a k8s `Job` or CI step) — keeps the `prisma` CLI out of the always-on `runner` image
   entirely, per your migrations-strategy choice.

Single-arch `linux/amd64` build (per your choice). Note: since Prisma 7's client is WASM (not a native
per-arch binary) and the only native addon (`better-sqlite3`) is pruned out of `runner`, an `arm64` build
would be low-risk to add later if ever needed — no `binaryTargets` pinning required.

### 3.2 `package.json` changes

- Move `prisma` and `@prisma/client` from `dependencies` → `devDependencies`. Both are build/generate/
  migrate-time only (§2). `@prisma/adapter-mariadb`/`@prisma/adapter-better-sqlite3` **stay** in
  `dependencies` (real code still supports them — see §3.3); the `runner` stage prunes them by path
  instead, so local dev / a future "multi-driver" image variant keeps working unmodified.
- No other dependency changes. (`ioredis`, `better-sqlite3` as a *library choice* stay — packaging-only
  per your answer; not a `bun:sqlite`/`Bun.redis` migration.)

### 3.3 Code change — `src/prisma/application/prisma.service.ts`

Change the three top-level static imports:

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaPg } from "@prisma/adapter-pg";
```

to dynamic `import()` **inside each `switch` case**, e.g.:

```ts
case "postgresql": {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  ...
}
```

This requires restructuring the constructor (adapter construction currently happens synchronously,
before `super()`) — the constructor will need to build the adapter synchronously still (Prisma requires
the adapter instance at `super()` time), so **only the `postgresql` import can safely become
non-dynamic/eager**; the `mysql`/`sqlite` branches' dynamic imports would only ever be reached if
someone runs this code with a different `DB_DRIVER`, at which point Node/Bun's module resolution
throwing "Cannot find module" is the correct, clear failure in the pruned `runner` image. Confirm the
exact restructuring during `/build` (this is the one piece of business logic this task touches — keep
the diff minimal, no behavior change for `DB_DRIVER=postgresql`).

### 3.4 ENV / secrets handling

- No `.env*` file is copied into the image (`.dockerignore` excludes `.env*` except none needed at
  build time at all — build stage doesn't need runtime secrets, only `prisma generate` which needs no
  DB connection).
- All config comes from process env at container start, already validated by
  `src/config/env.validation.ts` (fails fast on boot if a required var is missing) — no Dockerfile
  change needed here, just documenting the contract: required vars (`JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `CORS_ORIGINS`, plus whichever
  `STORAGE_PROVIDER`/`EMAIL_PROVIDER` credentials are selected) map to k8s `Secret` keys;
  optional/defaulted vars map to `ConfigMap` keys. Full list already in `.env.example`.
- `DB_DRIVER` is not set in the Dockerfile — defaults to `postgresql` (matches the pruned `runner`
  image); set explicitly via the k8s `ConfigMap` anyway for clarity.
- `PORT` (not `SERVER_PORT` — see §2's dead-config note) controls the listen port, default `3000`.

### 3.5 `.dockerignore`

New `apps/cms-api/.dockerignore`: `node_modules`, `dist`, `coverage`, `.git`, `.gitignore`, `*.md`,
`.env*` (except none — no exception needed, `.env.example` isn't read at build time either),
`.vscode`, `test`, `docs`, `tasks`, `plop-templates`, `Dockerfile`, `.dockerignore`.

## 4. Commands

- `docker build -t abyssoftime-cms-api:latest apps/cms-api` (default `runner` target).
- `docker build --target migrator -t abyssoftime-cms-api:migrator apps/cms-api` (migration job image).
- `docker run --rm -p 3000:3000 --env-file <local-only, gitignored env-file> abyssoftime-cms-api:latest`
  for a local smoke test.

## 5. Testing / verification strategy (acceptance criteria)

1. `docker build` succeeds for both `runner` and `migrator` targets.
2. `docker image inspect abyssoftime-cms-api:latest --format='{{.Size}}'` — record the actual size.
   - If **≤ 500MB**: done.
   - If **over**: run `docker history abyssoftime-cms-api:latest` (or `dive` if available) to break down
     per-layer size, identify which stage/dependency is responsible, and record concrete further options
     (e.g. drop `@getbrevo/brevo`/unused email providers, drop unused `EMAIL_PROVIDER` SDKs, re-check for
     any transitively-reintroduced dev package) — do **not** just report the number.
3. Boot smoke test: run the `runner` image against a real local Postgres (reuse existing e2e Postgres
   setup if available) with `DB_DRIVER=postgresql` + the required env vars set, confirm `GET /health`
   returns 200 and the app doesn't crash on the pruned adapters.
4. Negative check: confirm setting `DB_DRIVER=mysql` (or `sqlite`) against the `runner` image fails
   loudly at the `PrismaService` construction point (expected — documented boundary, not a regression).
5. Confirm the container runs as a non-root user (`docker run ... whoami`).
6. `bun run lint` / existing `jest`/`test:cov` suites still pass after the `prisma.service.ts` change —
   update `src/prisma/application/prisma.service.spec.ts` for the new dynamic-import shape.

## 6. Code style

Follow the existing `apps/cms-admin/Dockerfile` conventions: `# syntax=docker/dockerfile:1` pragma,
`# ── Stage name ──` comment banners, stage names as `AS <name>`.

## 7. Boundaries

- **Always**: keep the `postgresql`-only behavior change scoped to `prisma.service.ts`; don't touch
  `env.validation.ts`'s `SUPPORTED_DB_DRIVERS` or the `mysql`/`sqlite` Prisma schema files — multi-driver
  support stays in the codebase, only this image is postgres-locked.
- **Ask first**: any change beyond `prisma.service.ts` + `package.json` + the new `Dockerfile`/
  `.dockerignore` (e.g. if the size target isn't met even after the above and a deeper cut — like
  dropping unused email-provider SDKs — is needed).
- **Never**: bake secrets/`.env*` files into the image; touch `apps/cms-admin` or `apps/frontend`; fix
  the pre-existing `SERVER_PORT` dead-config issue as part of this task (flagged, not fixed).

## 8. Known pre-existing issue (out of scope, flagged only)

`env.validation.ts` validates `SERVER_PORT` (default 8080) but `main.ts` never reads it — only
`process.env.PORT` (default 3000) actually controls the listen port. Not fixed here; worth a separate
follow-up.

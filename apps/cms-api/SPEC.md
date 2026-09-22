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
- `src/prisma/application/prisma.service.ts` **statically** imported all three adapters
  (`PrismaPg`/`PrismaMariaDb`/`PrismaBetterSqlite3`) at the top of the file and `switch`ed on
  `DB_DRIVER` at construction time. Static imports are eagerly resolved — so all three adapter
  packages (and `pg`/`mariadb`/`better-sqlite3`) had to physically exist in `node_modules` regardless of
  which one was used. A constructor can't `await` a dynamic `import()` before calling `super()`
  (`PrismaClient`'s parent needs the adapter object immediately), so making only the unused branches
  lazy wasn't possible without a much bigger restructuring (e.g. an async NestJS factory provider) —
  see §3.3 for the resolution.
- `prisma/mysql/schema.prisma` and `prisma/sqlite/schema.prisma` were already **non-functional 8-line
  stub files** (generator + datasource only, zero models — the real 141-line schema with all models
  lived only under `prisma/postgresql/`). `docs/documents/media.md` and `docs/documents/content-type.md`
  already stated in writing that this repo "is Postgres-only" and that the mysql/sqlite files "remain
  stubs." The `mysql`/`sqlite` `DB_DRIVER` branches in `PrismaService` were therefore already broken in
  practice (constructing a real adapter against a schema with no models) before this task.
- Local/default `DB_DRIVER` was `postgresql` (`.env.local`, and the default in `env.validation.ts` /
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

Five stages, two build targets:

1. `deps` — `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile --ignore-scripts` (full install:
   needed for `prisma generate` + `nest build` + typecheck; `--ignore-scripts` skips the `postinstall`
   hook, since it needs `scripts/prisma.ts`, not copied in yet — the `build` stage runs
   `prisma:generate` explicitly after `COPY . .`).
2. `build` — from `deps`, copy source, `bun run prisma:generate` (Postgres-only — see §3.3), then
   `bun run build` (`nest build && tsc-alias -p tsconfig.build.json`; `nest-cli.json` assets already
   copy the generated Prisma client + `.hbs` email templates into `dist/`).
3. `prod-deps` — fresh `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile --production
   --ignore-scripts` (drops all `devDependencies` — see §3.2). No manual pruning needed: since
   `@prisma/adapter-mariadb`/`@prisma/adapter-better-sqlite3` are removed from `package.json` entirely
   (§3.2/§3.3), not just path-pruned in this one stage, a plain `--production` install is already clean.
4. `migrator` (from `deps`, **not** part of the size budget) — copy full source,
   `CMD ["bun", "run", "prisma:migrate:deploy"]`. Built/run as a one-off `docker build --target migrator`
   image (e.g. a k8s `Job` or CI step) — keeps the `prisma` CLI out of the always-on `runner` image
   entirely.
5. `runner` (**default target — must be the last stage in the file**, `ENV NODE_ENV=production`) —
   non-root `bun` user (built into `oven/bun:1-alpine`), copy `node_modules` from `prod-deps`, `dist/`
   and `content-types/` from `build`, `package.json`. `CMD ["bun", "dist/src/main"]` (mirrors the
   existing `start:prod` script). No `HEALTHCHECK` instruction — k8s liveness/readiness probes should
   target `GET /health` instead (documented in §5).

Single-arch `linux/amd64`/`arm64` (whichever the build host targets) — Prisma 7's client is WASM, not a
native per-arch binary, so no `binaryTargets` pinning is needed.

**Docker gotcha**: with no `--target` flag, `docker build` uses the **last** stage in the file as the
default target — `runner` must be defined last, not `migrator`, even though `migrator` is conceptually
simpler/earlier in the dependency chain.

### 3.2 `package.json` changes

- Remove `@prisma/adapter-mariadb` and `@prisma/adapter-better-sqlite3` from `dependencies` entirely
  (their transitive `mariadb`/`better-sqlite3` drivers drop automatically) — not just pruned by path in
  one Docker stage. See §3.3: the code no longer supports `mysql`/`sqlite` at all, so there's no reason
  to keep them installed anywhere, including local dev.
- Move `prisma` and `@prisma/client` from `dependencies` → `devDependencies`. Both are build/generate/
  migrate-time only (§2) — confirmed no `"@prisma/client"` import anywhere in `src/`.
- Added `tsc-alias` as a devDependency, and changed `"build"` to
  `"nest build && tsc-alias -p tsconfig.build.json"` — see §3.3's "unplanned fix" note.
- No other dependency changes. (`ioredis`, `better-sqlite3` as a *library choice* stay — packaging-only
  per the original scope answer; not a `bun:sqlite`/`Bun.redis` migration.)

### 3.3 Code change — `src/prisma/application/prisma.service.ts` (superseded design)

The original plan here was to convert the three top-level static adapter imports to dynamic `import()`
inside each `switch` case, keeping `mysql`/`sqlite` support in the codebase and only Docker-image-scoped
to Postgres. **This turned out to be impossible**: `PrismaService`'s constructor must call `super(...)`
synchronously (`PrismaClient` needs the adapter object immediately), and a constructor can't `await` a
dynamic `import()`'s Promise before calling `super()` — there's no way to make only the unused branches
"lazy" without a much bigger change (e.g. an async NestJS factory provider).

**What was actually built instead** (decision made with the user, see §2's stub-schema finding for why
this was low-risk): `cms-api` became **postgres-only in the source**, not just in the Docker image.
`PrismaService` now constructs `PrismaPg` directly — no `DB_DRIVER` read, no `switch`, one static import.
`env.validation.ts` dropped `DB_DRIVER`/`SUPPORTED_DB_DRIVERS`/`DbDriver` entirely. `scripts/prisma.ts`
and `prisma.config.ts` hardcode `prisma/postgresql/schema.prisma` / a `postgresql://` URL. The stub
`prisma/mysql/` and `prisma/sqlite/` directories were deleted. Full rationale/comparison in
`docs/documents/dockerfile-techstack.md`.

**Unplanned fix required during Docker boot-testing** (not part of the original scope, confirmed with
the user before implementing): `nest build` (plain `tsc`) does not rewrite the project's `@/*` → `src/*`
path aliases into relative paths in the emitted `dist/*.js` — Bun can't resolve the literal `"@/..."`
specifier at runtime and crashes. This reproduced in a clean container even outside Docker concerns
(confirmed by running `bun run build` fresh inside the `migrator` image), meaning `bun run start:prod`
was already broken in any environment other than the original dev machine, never previously exercised.
Fixed by adding `tsc-alias` as a devDependency and chaining it into the `build` script (§3.2).

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

All verified during `/build`:

1. `docker build` succeeded for both `runner` (default) and `migrator` targets.
2. `docker image inspect abyssoftime-cms-api:latest --format='{{.Size}}'` → **438.50MB**, under the
   500MB budget — no further cuts needed.
3. Boot smoke test: ran the `runner` image against a fresh local Postgres container (throwaway
   credentials, not the dev `.env.local`) with the required env vars set — `GET /health` returned 200,
   seed data logged, app started cleanly.
4. `migrator` target verified end-to-end: applied all 7 pending migrations against the fresh database.
5. Confirmed the container runs as the non-root `bun` user (`docker run ... whoami` → `bun`).
6. `bun run lint` / `bun run test:cov` (152 suites / 1118 tests) / `bun run build` all green throughout
   Phases 1 and 2, including after the `tsc-alias` fix (§3.3).

## 6. Code style

Follow the existing `apps/cms-admin/Dockerfile` conventions: `# syntax=docker/dockerfile:1` pragma,
`# ── Stage name ──` comment banners, stage names as `AS <name>`.

## 7. Boundaries

- **Always**: multi-driver support was **removed**, not preserved — `cms-api` is now postgres-only in
  the source (`PrismaService`, `env.validation.ts`, `scripts/prisma.ts`, `prisma.config.ts`), not just in
  the Docker image. See §3.3 for why the original "keep multi-driver, Docker-scope only" plan didn't
  work and was superseded with the user's sign-off.
- **Ask first**: any change beyond the postgres-only refactor + `package.json` + the new `Dockerfile`/
  `.dockerignore` (e.g. if the size target isn't met even after the above and a deeper cut — like
  dropping unused email-provider SDKs — is needed). The `tsc-alias` build-script fix (§3.3) was one such
  out-of-original-scope change, confirmed with the user before implementing.
- **Never**: bake secrets/`.env*` files into the image; touch `apps/cms-admin` or `apps/frontend`; fix
  the pre-existing `SERVER_PORT` dead-config issue as part of this task (flagged, not fixed).

## 8. Known pre-existing issue (out of scope, flagged only)

`env.validation.ts` validates `SERVER_PORT` (default 8080) but `main.ts` never reads it — only
`process.env.PORT` (default 3000) actually controls the listen port. Not fixed here; worth a separate
follow-up.

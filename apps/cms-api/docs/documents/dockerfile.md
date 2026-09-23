# Production Dockerfile

`apps/cms-api/Dockerfile` — multi-stage build producing a production runtime image for the NestJS/Bun
API. Mirrors the `oven/bun:1-alpine` convention already used by `apps/cms-admin/Dockerfile`. Built
alongside a postgres-only refactor of `PrismaService`/`env.validation.ts`/`scripts/prisma.ts`/
`prisma.config.ts` (see [dockerfile-techstack.md](./dockerfile-techstack.md) for why, `SPEC.md` for the
full spec). Config/secrets are injected entirely at container run time (k3s/k8s `Secret`/`ConfigMap` →
env vars) — nothing is baked into the image at build time.

## Stages

Five stages, two build targets — `runner` (default) and `migrator`:

1. **`deps`** — `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile --ignore-scripts` (full
   install, needed downstream for `prisma generate` + `nest build` + typecheck). `--ignore-scripts`
   skips the `postinstall` hook (`bun run prisma:generate`), which needs `scripts/prisma.ts` — not
   copied in at this point, only `package.json`/`bun.lock` — the `build` stage runs it explicitly
   instead, after the full source is copied.
2. **`build`** (from `deps`) — copies the full source, runs `bun run prisma:generate` (always
   Postgres now — no `DB_DRIVER` to set), then `bun run build`
   (`nest build && tsc-alias -p tsconfig.build.json`). `nest-cli.json`'s `assets` config already copies
   the generated Prisma client and `.hbs` email templates into `dist/`; `tsc-alias` rewrites the `@/*`
   path-alias imports used throughout `src/` into relative paths in the emitted `.js` (see "Alias
   resolution" below — required, not optional).
3. **`prod-deps`** (fresh `FROM oven/bun:1-alpine`) — `bun install --frozen-lockfile --production
   --ignore-scripts`. Drops all `devDependencies` (including `prisma`/`@prisma/client`, both
   build/migrate-time only). No manual pruning step is needed: `@prisma/adapter-mariadb`/
   `@prisma/adapter-better-sqlite3` are removed from `package.json` entirely, so a plain `--production`
   install is already clean.
4. **`migrator`** (from `deps`, **not** part of the 500MB budget) — copies the full source,
   `CMD ["bun", "run", "prisma:migrate:deploy"]`. Carries the `prisma` CLI and its full dependency tree
   deliberately — this target is built and run as a one-off job (a k8s `Job`, a CI step), never the
   always-on production image, so its size doesn't matter the way `runner`'s does.
5. **`runner`** (**default target — must stay the last stage in the file**; see "Docker gotcha" below)
   — `ENV NODE_ENV=production`, creates a dedicated non-root `abyssdev` system user/group
   (`addgroup -S abyssdev && adduser -S -G abyssdev abyssdev`), copies `node_modules` from `prod-deps`,
   `dist/` and `content-types/` from `build`, and `package.json` (all `--chown=abyssdev:abyssdev`).
   `CMD ["bun", "dist/src/main"]`, mirroring the existing `start:prod` script.

### Docker gotcha: default target = last stage in the file

`docker build` with no `--target` flag uses the **last** stage defined in the Dockerfile as the default
target, not whichever stage is "conceptually last" (e.g. `runner`). Defining `migrator` after `runner`
silently made `migrator` the default target of `docker build -t abyssoftime-cms-api:latest .` — caught
during Checkpoint B's boot smoke test, not by the build itself (both targets build successfully either
way; only the *default* choice was wrong). Fixed by ordering `migrator` before `runner` in the file.

### Alias resolution: `tsc-alias` is required, not optional

The project's `tsconfig.json` maps `@/*` → `src/*`, and this alias is used throughout `src/` (e.g.
`import { PrismaService } from "@/prisma/application/prisma.service"`). Plain `nest build` (`tsc`) does
**not** rewrite these into relative paths in the emitted `dist/*.js` — the literal `"@/..."` specifier
is left in `require(...)` calls, which Bun cannot resolve at runtime
(`Cannot find module '@/prisma/application/prisma.service'`). This reproduced inside a clean container
even outside any Docker-specific concern (confirmed by running `bun run build` fresh inside the
`migrator` image), meaning `bun run start:prod` was already broken in any environment other than the
original dev machine — a pre-existing bug this task surfaced and fixed, not introduced by it. Fixed by
adding `tsc-alias` as a devDependency and chaining it into the `"build"` script:
`"nest build && tsc-alias -p tsconfig.build.json"`.

## Env-var contract

No `.env*` file is ever copied into the image (`.dockerignore` excludes `.env*`; the `build` stage's
`prisma generate` needs no DB connection). All configuration comes from process env at container start,
validated by `src/config/env.validation.ts` (fails fast on boot if a required var is missing). The full,
authoritative list of every variable — required and optional, with defaults — is `.env.example`; the
required-vs-optional split maps directly to k8s `Secret` (required: `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `CORS_ORIGINS`, plus whichever
`STORAGE_PROVIDER`/`EMAIL_PROVIDER` credentials are selected) vs. `ConfigMap` (everything with a
default) keys. `PORT` (not `SERVER_PORT` — a pre-existing, unrelated dead-config issue, see
`SPEC.md` §8) controls the listen port. The `runner` stage requires an `APP_PORT` build arg (no default,
the build fails without it; same name as in the k8s env file), which sets both `EXPOSE` and the image's
default `PORT`. Pass it from the environment with a bare `--build-arg APP_PORT`. CI passes the
`CMS_API_APP_PORT` repo variable. `EXPOSE` is fixed at build time; a runtime `-e PORT=...` still
changes the listen port but not the exposed-port metadata. The `migrator` target doesn't need it.

## Building and running

```sh
# Production app image (default target = runner). APP_PORT is required, read from the shell env
APP_PORT=3000 docker build --build-arg APP_PORT -t abyssoftime-cms-api:latest apps/cms-api

# Migration job image
docker build --target migrator -t abyssoftime-cms-api:migrator apps/cms-api

# Run a migration (one-off job — a k8s Job or CI step in real deployments)
docker run --rm \
  -e DB_HOST=... -e DB_PORT=... -e DB_NAME=... -e DB_USERNAME=... -e DB_PASSWORD=... \
  abyssoftime-cms-api:migrator

# Run the app
docker run --rm -p 3000:3000 \
  -e DB_HOST=... -e DB_PORT=... -e DB_NAME=... -e DB_USERNAME=... -e DB_PASSWORD=... \
  -e JWT_ACCESS_SECRET=... -e JWT_REFRESH_SECRET=... \
  -e COOKIE_SECURE=... -e COOKIE_SAMESITE=... -e CORS_ORIGINS=... \
  abyssoftime-cms-api:latest
```

In k8s, apply `migrator` as a `Job` (or a CI/CD pipeline step) that runs to completion **before** the
`Deployment` using `runner` rolls out — see
[dockerfile-techstack.md](./dockerfile-techstack.md#migrations-strategy-separate-migrator-target-chosen-vs-migrate-on-boot-in-runner)
for why migrations are a separate target rather than baked into `runner`'s boot sequence.

## Non-root, no `HEALTHCHECK` — by design

- **Non-root**: `runner` creates a dedicated `abyssdev` system user/group (rather than using the base
  image's built-in `bun` user) and switches to it via `USER abyssdev` before `CMD` runs. Verified:
  `docker run ... whoami` → `abyssdev`.
- **No `HEALTHCHECK` instruction**: deliberately omitted. This image is meant to run under k8s, where
  liveness/readiness probes (targeting `GET /health`) are the standard mechanism and make a Docker-level
  `HEALTHCHECK` redundant — the two mechanisms would duplicate the same check with different failure
  semantics and no clear precedence. Document the `GET /health` endpoint as the probe target when
  writing the (out-of-scope-for-this-task) k8s manifests.

## Measured image size

**438.50MB** (`docker image inspect abyssoftime-cms-api:latest --format='{{.Size}}'`), under the 500MB
budget with no further cuts needed. See [dockerfile-techstack.md](./dockerfile-techstack.md) for the
base-image comparison and what makes up the bulk of `node_modules`.

## Verified state

`docker build` succeeds for both `runner` and `migrator` targets. Boot smoke test: `runner` run against
a fresh, throwaway local Postgres container (not the dev `.env.local`) with the required env vars set —
app started cleanly, seed data logged, `GET /health` returned `200`. `migrator` verified end-to-end:
applied all 7 pending migrations against that same fresh database. Container confirmed non-root.
`bun run lint` / `bun run test:cov` (152 suites / 1118 tests) / `bun run build` all green throughout,
including after the `tsc-alias` fix.

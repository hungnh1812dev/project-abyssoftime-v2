# Archive

Completed phases moved out of `tasks/plan.md` / `tasks/todo.md` to keep those files token-lean.
Each entry is a frozen snapshot at archive time.

## Production Dockerfile for cms-api (archived 2026-09-22)

Status: done. All 4 phases (14 tasks + 4 checkpoints) committed on `develop`: `67800c3` (Phase 1 —
postgres-only refactor), `03faeed` (Phase 2 — Dockerfile, plus the `tsc-alias` fix for a pre-existing
broken `start:prod`), `29f7cda` (Phase 3 — docs), and the Checkpoint D commit (`.dockerignore` fix
from the five-axis review + `SPEC.md` reduced to a minimal pointer). Final image: **438.50MB**, under
the 500MB budget. Five-axis review verdict: **APPROVE**, no Critical/Important findings. Full
implementation writeup lives in `docs/documents/dockerfile.md` and
`docs/documents/dockerfile-techstack.md`.

Two things worth knowing if this Dockerfile is touched again:

- **`cms-api` is now postgres-only in the source, not just in the Docker image.** The original spec
  planned to keep `mysql`/`sqlite` support in the codebase and only exclude the unused adapter packages
  from the `runner` image via dynamic `import()`. That's impossible — `PrismaService extends
  PrismaClient`, and a subclass constructor can't `await` a `Promise` before calling `super()`, which a
  dynamic import requires. `DB_DRIVER`/`SUPPORTED_DB_DRIVERS`/`DbDriver` and the `mysql`/`sqlite` Prisma
  schema stubs were removed entirely (they were already non-functional 8-line stubs with zero models).
- **`nest build` doesn't rewrite `@/*` path-alias imports into relative paths** — Bun can't resolve the
  literal `"@/..."` specifier in compiled `dist/*.js` output and crashes at runtime. This was a
  pre-existing bug (`bun run start:prod` was already broken outside the original dev machine, never
  previously exercised in a clean environment) that this task's boot-smoke-testing surfaced, not
  introduced. Fixed by adding `tsc-alias` and chaining it into the `"build"` script — if that script or
  `tsconfig.json`'s `paths` ever changes, re-verify `dist/` has zero `"@/` references after a rebuild.
- **`docker build` with no `--target` uses the *last* stage in the file as the default**, not whichever
  stage is conceptually "the app image." `runner` must stay the last stage in `Dockerfile`, not
  `migrator` — this order was wrong on the first pass and only caught by the boot smoke test at
  Checkpoint B (both targets still built fine either way; only the *default* target was wrong).

<details>
<summary>Final tasks/plan.md</summary>

# Plan: cms-api Production Dockerfile

See `SPEC.md` for the full spec (objective, investigated facts, design, boundaries). See
`tasks/todo.md` for the actionable checklist this plan expands into.

## Context

`apps/cms-api` needs a multi-stage production Dockerfile targeting ≤500MB, with all config/secrets
injected at container runtime (k3s/k8s `Secret`/`ConfigMap`), matching the pattern `apps/cms-admin`
already uses. The spec identified that ~190MB of the image would be `prisma`/`@prisma/client`/
`@prisma/studio-core`/`@prisma/dev`/`@prisma/engines` — all build/migrate-time tooling, never imported
by the generated (WASM-based, Prisma 7) client at runtime — and proposed moving `prisma`/`@prisma/client`
to `devDependencies` plus a separate `migrator` build target for `prisma migrate deploy` jobs.

## Correction found during planning (supersedes SPEC.md §3.3)

SPEC.md §3.3 proposed converting `PrismaService`'s three static adapter imports
(`PrismaPg`/`PrismaMariaDb`/`PrismaBetterSqlite3`) to dynamic `import()` per `switch` case, so a
postgres-only image could exclude the unused mysql/sqlite adapter packages. **This doesn't work**:
`PrismaService`'s constructor must call `super(...)` synchronously (its parent, `PrismaClient`, needs
the adapter object immediately), and a JS/TS constructor cannot `await` a dynamic `import()`'s Promise
before calling `super()`. There's no way to make only one of three branches "lazy" here without a much
bigger change (e.g. an async NestJS factory provider building the adapter before construction).

Asked the user how to resolve this; they chose to **drop multi-driver support entirely** — `cms-api`
becomes postgres-only in the source, not just in the Docker image.

This turns out to be low-risk, not just expedient: `prisma/mysql/schema.prisma` and
`prisma/sqlite/schema.prisma` are already non-functional 8-line **stub files** (generator + datasource
only, zero models — the real 141-line schema with all models lives only under `prisma/postgresql/`).
`docs/documents/media.md` and `docs/documents/content-type.md` already state in writing that "this repo
is Postgres-only" and that the mysql/sqlite files "remain stubs." The `mysql`/`sqlite` `DB_DRIVER`
branches in `PrismaService` were therefore already broken in practice (constructing a real adapter
against a schema with no models) — removing them removes dead, misleading code, not working
functionality.

This also **simplifies** the Dockerfile from SPEC.md §3.1: since `@prisma/adapter-mariadb` and
`@prisma/adapter-better-sqlite3` are removed from `package.json` entirely (not just "pruned by path" in
one Docker stage), the `prod-deps` stage's `bun install --frozen-lockfile --production` alone is
sufficient — no `rm -rf node_modules/...` pruning step needed.

**Out of scope (explicitly confirmed with the user):** the email-provider set (`gmail`/`smtp`/`resend`/
`brevo`/`sendgrid`/`console`) is untouched by this work — a mailer-reduction idea was raised and then
withdrawn; do not touch `resolve-email-sender.ts` or any email-sender file as part of this plan.

## Architecture decisions

- `PrismaService` constructs `PrismaPg` directly — no `DB_DRIVER` read, no `switch`.
- `env.validation.ts` drops `DB_DRIVER`/`SUPPORTED_DB_DRIVERS`/`DbDriver` entirely. `DB_HOST`/`DB_PORT`/
  `DB_NAME`/`DB_USERNAME`/`DB_PASSWORD` stay unchanged (defaults already assume Postgres).
- `scripts/prisma.ts` and `prisma.config.ts` hardcode `prisma/postgresql/schema.prisma` / a
  `postgresql://` URL — no driver switch.
- Delete `prisma/mysql/` and `prisma/sqlite/` (stub-only, no migrations under either).
- `package.json`: remove `@prisma/adapter-mariadb`/`@prisma/adapter-better-sqlite3` from `dependencies`
  (their transitive `mariadb`/`better-sqlite3` drivers drop automatically); move `prisma`/
  `@prisma/client` from `dependencies` → `devDependencies` (SPEC.md's migration-strategy decision,
  unaffected by this correction).
- Dockerfile: `deps` → `build` → `prod-deps` → `runner` (default target) → `migrator` (separate target,
  carries the `prisma` CLI for `prisma migrate deploy` jobs, not held to the 500MB budget) — same
  5-stage shape as SPEC.md §3.1, minus the now-unneeded manual adapter pruning.
- No code/behavior change to anything outside the Postgres-only boundary (`ioredis`, `better-sqlite3`-
  as-a-library-choice for other purposes, email providers, storage adapters — all untouched, per the
  spec's "packaging only" refactor-scope answer).

## Dependency graph

```
Phase 1 — Postgres-only refactor (source + config, no Docker yet)
  T1 PrismaService + spec: drop mariadb/sqlite branches, construct PrismaPg directly
  T2 env.validation.ts + spec: remove DB_DRIVER/SUPPORTED_DB_DRIVERS/DbDriver
  T3 scripts/prisma.ts + prisma.config.ts: hardcode postgresql; delete prisma/mysql/, prisma/sqlite/
  T4 .env.example: remove DB_DRIVER
     (T1–T4 touch disjoint files, independent of each other)
        └─→ T5 package.json: remove unused adapter deps, move prisma/@prisma/client → devDependencies
               — depends on T1 (code must stop importing them first)
               └─→ Checkpoint A (build/lint/test green, bun install clean)
                      │
Phase 2 — Dockerfile                                                       │
  T6 apps/cms-api/Dockerfile (5 stages) ◄─────────────────────────────────┘ (needs Phase 1's slimmed deps)
  T7 apps/cms-api/.dockerignore
        └─→ Checkpoint B (docker build both targets; measure size; boot smoke test; non-root check)
               │
Phase 3 — Docs & spec                                                      │
  T8 Update SPEC.md (§3.3 correction, §3.1 simplification, §7 boundary correction) ◄┘
  T9 New docs/documents/dockerfile-techstack.md (decision tables: base image, postgres-only vs
     multi-driver, separate-migration vs baked-in)
  T10 New docs/documents/dockerfile.md (module doc: stages, env-var contract, migrator usage)
  T11 docs/ENTRYPOINT.md: add T9/T10 entries
  T12 Stale-wording sweep: docs/documents/media.md, docs/documents/content-type.md
     (both currently describe the now-deleted DB_DRIVER stub setup)
        └─→ Checkpoint C (docs reviewed)
               │
Phase 4 — Review & cleanup                                                 │
  T13 Five-axis review (correctness, readability, architecture, security, performance) ◄┘
  T14 Reduce SPEC.md back to a minimal pointer (per this project's established convention)
        └─→ Checkpoint D (final commit, user confirmation per commit rules)
```

## Task list

See `tasks/todo.md` for the full checklist (acceptance criteria, verify commands, files, deps/size per
task). Phase summary:

### Phase 1 — Postgres-only refactor
T1 `PrismaService` postgres-only · T2 drop `DB_DRIVER` from env validation · T3 hardcode
`scripts/prisma.ts`/`prisma.config.ts`, delete stub schemas · T4 `.env.example` cleanup · T5
`package.json` dependency cleanup · **Checkpoint A**

### Phase 2 — Dockerfile
T6 `apps/cms-api/Dockerfile` (5 stages) · T7 `apps/cms-api/.dockerignore` · **Checkpoint B** (real
`docker build` + measured size + boot smoke test — if over 500MB, a documented breakdown + next options
is required, not just the number)

### Phase 3 — Docs & spec
T8 Update `SPEC.md` · T9 `docs/documents/dockerfile-techstack.md` · T10 `docs/documents/dockerfile.md`
· T11 `docs/ENTRYPOINT.md` index entries · T12 Stale-wording sweep (`media.md`, `content-type.md`) ·
**Checkpoint C**

### Phase 4 — Review & cleanup
T13 Five-axis review · T14 Reduce `SPEC.md` to a minimal pointer · **Checkpoint D** (explicit commit
confirmation)

## Verification summary (end-to-end)

1. `bun run build && bun run lint && bun run test:cov` — no regressions from the Postgres-only refactor.
2. `docker build apps/cms-api` (both targets) succeeds.
3. Real measured image size via `docker image inspect`, with a documented breakdown if over 500MB (not
   just a pass/fail number) — this is the user's explicit ask from the original request.
4. Boot smoke test against a real local Postgres, `GET /health` → 200, confirmed non-root.
5. Docs (`dockerfile.md`, `dockerfile-techstack.md`, `ENTRYPOINT.md`, stale-wording sweep) reviewed for
   accuracy against what was actually built.

</details>

<details>
<summary>Final tasks/todo.md</summary>

# Todo — cms-api Production Dockerfile

See `tasks/plan.md` for full context, the correction found during planning (SPEC.md §3.3 → postgres-only
refactor), and architecture decisions. See `SPEC.md` for the spec.

**Out of scope, confirmed:** email providers (`gmail`/`smtp`/`resend`/`brevo`/`sendgrid`/`console`) are
untouched by this work.

## Phase 1 — Postgres-only refactor

- [x] **T1 — `PrismaService` + spec: Postgres-only.** Remove the `PrismaBetterSqlite3`/`PrismaMariaDb`
  imports and the `switch`; constructor reads `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USERNAME`/`DB_PASSWORD`
  and directly does `super({ adapter: new PrismaPg({ host, port, database, user, password }) })`.
  Update `prisma.service.spec.ts`: remove the mariadb/sqlite mocks and their two test cases, remove the
  "throws for unsupported DB_DRIVER" test (nothing left to throw on), keep the postgres/connect/
  disconnect tests.
  - Acceptance: `PrismaService` has exactly one import from `@prisma/*`; constructing it always builds
    a `PrismaPg` adapter with the same options as today's `postgresql` branch.
  - Verify: `bun run test src/prisma`, `bun run lint`.
  - Files: `src/prisma/application/prisma.service.ts`, `src/prisma/application/prisma.service.spec.ts`
  - Deps: none. Size: S

- [x] **T2 — `env.validation.ts` + spec: drop `DB_DRIVER`.** Remove the `DB_DRIVER` field, the
  `SUPPORTED_DB_DRIVERS` const, and the `DbDriver` type export. Update `env.validation.spec.ts` to
  remove any `DB_DRIVER`-related assertions/fixtures.
  - Acceptance: `EnvironmentVariables` has no `DB_DRIVER` field; nothing in `src/` imports
    `SUPPORTED_DB_DRIVERS`/`DbDriver` (grep clean after T3).
  - Verify: `bun run test src/config`, `bun run lint`.
  - Files: `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`
  - Deps: none (parallel with T1). Size: S

- [x] **T3 — `scripts/prisma.ts` + `prisma.config.ts`: hardcode Postgres; delete stub schemas.**
  Remove the `driver`/`SUPPORTED_DB_DRIVERS` check in `scripts/prisma.ts` — hardcode
  `--schema=prisma/postgresql/schema.prisma`. Remove `prisma.config.ts`'s `driver`/`buildDatasourceUrl`
  switch — always build the `postgresql://` URL. Delete `prisma/mysql/` and `prisma/sqlite/`
  directories.
  - Acceptance: `bun run prisma:generate` and `bun run prisma:migrate:deploy` work with no `DB_DRIVER`
    set; `prisma/` contains only `postgresql/`.
  - Verify: `bun run prisma:generate` succeeds locally.
  - Files: `scripts/prisma.ts`, `prisma.config.ts`, delete `prisma/mysql/schema.prisma`,
    `prisma/sqlite/schema.prisma`
  - Deps: none (parallel with T1/T2). Size: S

- [x] **T4 — `.env.example`: remove `DB_DRIVER`.** Drop the `DB_DRIVER` line and its comment from the
  Database connection section.
  - Acceptance: `.env.example` has no `DB_DRIVER` reference.
  - Verify: visual diff.
  - Files: `.env.example`
  - Deps: none. Size: XS

- [x] **T5 — `package.json`: dependency cleanup.** Remove `@prisma/adapter-mariadb` and
  `@prisma/adapter-better-sqlite3` from `dependencies`. Move `prisma` and `@prisma/client` from
  `dependencies` to `devDependencies`. Regenerate `bun.lock`.
  - Acceptance: `bun install` succeeds; `node_modules` no longer contains `mariadb`/`better-sqlite3`/
    `@prisma/adapter-mariadb`/`@prisma/adapter-better-sqlite3`; `bun install --production` (dry check)
    excludes `prisma`/`@prisma/client`/`@prisma/studio-core`/`@prisma/dev`/`@prisma/engines`.
  - Verify: `bun install && bun run build && bun run test:cov`.
  - Files: `package.json`, `bun.lock`
  - Deps: T1 (code must stop importing the adapters first). Size: S

- [x] **Checkpoint A** — `bun run build && bun run lint && bun run test:cov` all green, no regressions.
  Confirm no remaining `DB_DRIVER`/`SUPPORTED_DB_DRIVERS`/`adapter-mariadb`/`adapter-better-sqlite3`/
  `better-sqlite3` references anywhere in `src/`, `scripts/`, `prisma.config.ts`, `.env.example` (grep
  clean). Commit.

## Phase 2 — Dockerfile

- [x] **T6 — `apps/cms-api/Dockerfile`.** Multi-stage, `# syntax=docker/dockerfile:1`, stage-banner
  comments matching `apps/cms-admin/Dockerfile`'s style:
  1. `deps` — `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile`.
  2. `build` — from `deps`, copy source, `bun run prisma:generate`, `bun run build`.
  3. `prod-deps` — fresh `FROM oven/bun:1-alpine`, `bun install --frozen-lockfile --production`.
  4. `runner` (default) — `ENV NODE_ENV=production`, non-root user, copy `node_modules` (from
     `prod-deps`), `dist/` + `content-types/` (from `build`), `package.json`.
     `CMD ["bun", "dist/src/main"]`. No `HEALTHCHECK` (k8s probes handle it — document in T10).
  5. `migrator` — from `deps`, copy full source, `CMD ["bun", "run", "prisma:migrate:deploy"]`.
  - Acceptance: `docker build apps/cms-api` (default target) and
    `docker build --target migrator apps/cms-api` both succeed.
  - Verify: see Checkpoint B.
  - Files: `apps/cms-api/Dockerfile`
  - Deps: T5 (needs the slimmed `package.json`). Size: M

- [x] **T7 — `apps/cms-api/.dockerignore`.** Exclude `node_modules`, `dist`, `coverage`, `.git`,
  `.gitignore`, `*.md`, `.env*`, `.vscode`, `test`, `docs`, `tasks`, `plop-templates`, `Dockerfile`,
  `.dockerignore`.
  - Acceptance: none of the above end up in the build context (spot-check via
    `docker build --progress=plain` context size).
  - Verify: part of Checkpoint B's build.
  - Files: `apps/cms-api/.dockerignore`
  - Deps: none (pairs with T6). Size: XS

- [x] **Checkpoint B** — `docker image inspect abyssoftime-cms-api:latest --format='{{.Size}}'`
  recorded: **438.50 MB**, under the 500MB budget. Boot smoke test: ran `runner` against a fresh local
  Postgres container with required env vars set — `GET /health` returned 200, seed data logged, app
  started cleanly. Confirmed non-root (`docker run ... whoami` → `bun`). `migrator` target verified
  end-to-end (applied all 7 pending migrations against the fresh DB).

  **Unplanned fix required to get here** — found and fixed a pre-existing bug, not part of the
  original DB-driver refactor scope: `nest build` (plain `tsc`) does not rewrite the `@/*` → `src/*`
  path aliases used throughout `src/` into relative paths in the emitted `dist/*.js`; at runtime Bun
  can't resolve the literal `"@/..."` specifier and crashes (`Cannot find module '@/...'`). This
  reproduced inside a clean container even outside Docker concerns (ran `bun run build` fresh in the
  `migrator` image) — meaning `bun run start:prod` was already broken in any environment other than
  the original dev machine, never previously exercised. Confirmed with the user before fixing (out of
  the originally-scoped files). Fix: added `tsc-alias` as a devDependency, changed `"build"` to
  `"nest build && tsc-alias -p tsconfig.build.json"` — verified zero `"@/` references remain in `dist/`
  after a clean rebuild, full test suite/lint/build still green.

## Phase 3 — Docs & spec

- [x] **T8 — Update `apps/cms-api/SPEC.md`.** Replace §3.3 with the actual implemented approach
  (postgres-only, no dynamic imports); simplify §3.1's `prod-deps` step (no manual pruning); correct
  §7's "Always" bullet (multi-driver support was removed, not preserved) and §2 to note the
  stub-schema finding.
  - Verify: read-through for internal consistency with what was actually built.
  - Files: `apps/cms-api/SPEC.md`
  - Deps: T1–T7 complete. Size: S

- [x] **T9 — `docs/documents/dockerfile-techstack.md`.** Decision-rationale table per
  `docs/rules/workflow.md`: base image (`oven/bun:1-alpine` vs `-slim`/`-debian`), postgres-only vs
  keep-multi-driver, separate `migrator` target vs baked-in migrate-on-boot — options vs. criteria
  (image size, complexity, maintenance cost, existing precedent) — reusing the analysis already done
  during spec/planning.
  - Files: `apps/cms-api/docs/documents/dockerfile-techstack.md`
  - Deps: T8. Size: S

- [x] **T10 — `docs/documents/dockerfile.md`.** Module doc matching the `docs/documents/*.md`
  convention: the 5 stages and what each does, the required env-var contract (pointing at
  `.env.example`), how to build/run the `migrator` target, the non-root/no-`HEALTHCHECK`-by-design
  notes, the final measured image size.
  - Files: `apps/cms-api/docs/documents/dockerfile.md`
  - Deps: T9. Size: S

- [x] **T11 — `docs/ENTRYPOINT.md`.** Add one-line index entries for `dockerfile.md` and
  `dockerfile-techstack.md`, matching the existing entries' format.
  - Files: `apps/cms-api/docs/ENTRYPOINT.md`
  - Deps: T10. Size: XS

- [x] **T12 — Stale-wording sweep.** `docs/documents/media.md` (point 6, currently: "...matching
  `DB_DRIVER` defaulting to `postgresql`...") and `docs/documents/content-type.md` (point 1,
  currently: "...this repo is Postgres-only (`DB_DRIVER` defaults to `postgresql`; the `mysql`/`sqlite`
  schema files stay stubs)...") — reword both past-tense: the stub files and `DB_DRIVER` no longer
  exist, point at `dockerfile-techstack.md` for the removal rationale.
  - Files: `apps/cms-api/docs/documents/media.md`, `apps/cms-api/docs/documents/content-type.md`
  - Deps: T9 (needs the techstack doc to link to). Size: XS

- [x] **Checkpoint C** — Docs read-through for consistency. Commit.

## Phase 4 — Review & cleanup

- [x] **T13 — Five-axis review.** `agent-skills:code-reviewer` — **Verdict: APPROVE**, no Critical or
  Important findings. `prisma.service.ts`'s simplification confirmed correct (the removed
  "unsupported DB_DRIVER" throw is a strict improvement — there's no longer any input that could
  produce an unsupported value); non-root/no-secrets-baked-in properties verified; `migrator`'s
  broader `deps`-stage footprint confirmed acceptable (explicitly out of the 500MB budget per
  `dockerfile-techstack.md`).

  Three non-blocking Suggestions: (1) `migrator` could use a leaner install than the full
  `devDependencies` tree — deferred as a future follow-up only if job-image pull time ever matters,
  per the reviewer's own framing; (2) `runner`'s `COPY package.json` may be dead weight (nothing in
  `src/` reads it at runtime) — kept as a ~1KB safety margin, not worth the risk of removing
  unverified; (3) `.dockerignore` didn't exclude the gitignored, always-regenerated
  `src/prisma/application/client` directory — **fixed**: added it, rebuilt both targets (438.50MB,
  unchanged), full test/lint/build re-verified green.
  - Deps: Checkpoint C. Size: M

- [x] **T14 — Reduce `apps/cms-api/SPEC.md` to a minimal pointer.** Once `dockerfile.md` +
  `dockerfile-techstack.md` fully capture the implementation, strip SPEC.md back down (per this
  project's established convention), pointing to those docs rather than repeating detail.
  - Deps: T13. Size: XS

- [x] **Checkpoint D** — Final review sign-off. Ask for explicit commit confirmation (exact staged
  files + full commit message) before committing, per `docs/rules/workflow.md`'s commit rules.

</details>

## Helmfile deployment — in-repo `app-template` chart (archived 2026-09-23, superseded)

Status: done, then **superseded**. Phases 1 + 1.5 were committed as `c7cc99b` (chart) and `817bccc`
(CI publish job). The user then published a standalone chart,
`oci://ghcr.io/hungnh1812dev/helmfile-chart-template` (0.2.0 adds `initContainers` + `secrets.enabled`),
which replaces this one. `charts/app-template/` and the `helm-chart-publish` job are removed by T0b in
`tasks/todo.md`. Frozen snapshot of the original task text:

### Phase 1 — Reusable Helm chart (`charts/app-template/`)

- [x] **T1 — Chart skeleton: naming plumbing.** `Chart.yaml` (apiVersion v2), `values.yaml` schema
  (all generic, no cms-api defaults): `appName`, `servicePostfix`, `namespaceBase`,
  `image.{repository,tag}`, `migratorImage.{repository,tag}`, `migration.enabled` (bool, default
  `true`), `appPort` (default `3000`), `secretName` (optional override; defaults to computed
  `<appName>-<servicePostfix>-secrets`), `resources`, `probePath` (default `/health`). `_helpers.tpl`:
  `app-template.fullname` (`<appName>-<servicePostfix>`), `app-template.namespace`
  (`<namespaceBase>-prod`), `app-template.secretName` (override or computed default).
  - Acceptance: chart metadata valid; helpers compute the three names correctly for arbitrary
    appName/servicePostfix input (verified via T2's render — a bare `_helpers.tpl` has nothing to
    render on its own).
  - Verify: folded into T2's verify.
  - Files: `charts/app-template/Chart.yaml`, `charts/app-template/values.yaml`,
    `charts/app-template/templates/_helpers.tpl`
  - Deps: none. Size: S

- [x] **T2 — Deployment + Service templates.** `deployment.yaml`: one container
  (`image.repository:image.tag`, `envFrom` the computed secret, `containerPort`/readiness+liveness
  `httpGet` on `probePath` using `appPort`); one `initContainers` entry when `migration.enabled`
  (image `migratorImage.repository:migratorImage.tag`, same `envFrom` — no command override needed,
  the `migrator` Dockerfile target's own `CMD` already runs `prisma migrate deploy`). `service.yaml`:
  ClusterIP, named port `http`, `port: 80` → `targetPort: http` (same convention as the current
  uncommitted `service.yaml`).
  - Acceptance: `helm template` output has exactly one Deployment + one Service, names matching the
    helper convention, init container listed before the main container, `envFrom` on both containers.
  - Verify: `helm lint charts/app-template` (no errors); `helm template rel charts/app-template
    --set appName=demo,servicePostfix=api,namespaceBase=demo,image.repository=example/app,image.tag=v1,migratorImage.repository=example/app,migratorImage.tag=v1-migrate`
    — inspect rendered YAML.
  - Files: `charts/app-template/templates/deployment.yaml`,
    `charts/app-template/templates/service.yaml`
  - Deps: T1. Size: M

> **CHECKPOINT A** — **PASSED** (2026-09-23). `helm lint charts/app-template` clean (no errors).
> `helm template` with cms-api-like sample values (`appName=demo,servicePostfix=api,namespaceBase=demo,...`)
> renders exactly one Deployment + one Service named `demo-api`, namespace `demo-prod`, init
> container (`demo-api-migrate`) listed before the main container, both with `envFrom:
> secretRef.name: demo-api-secrets`. `secretName` override verified independently (renders the
> literal override instead of the computed default). No cms-api specifics in the chart itself.
>
> Implementation note: the chart's own **default** `values.yaml` (used by bare `helm lint`/
> `helm template` with no overrides) needed non-empty placeholder values (`appName: "app"`,
> `servicePostfix: "service"`, `namespaceBase: "default"`, `*.repository: "changeme/app"`) rather
> than empty strings — an empty `appName`/`servicePostfix` renders `name: -`, which is invalid/
> ambiguous YAML to Helm's parser (`block sequence entries are not allowed in this context`).
> These are still generic, non-app-specific placeholders; every real consumer overrides all of them.
> **Commit 1** — once Checkpoint A passes.

### Phase 1.5 — Publish `app-template` as an OCI Helm chart to GHCR

Added after user discussion: instead of every app referencing the chart by local relative path
(`../../charts/app-template`, only works from inside this monorepo checkout), package it as a
versioned OCI artifact on GHCR — the same registry already chosen for cms-api's images — so any
app's `helmfile.yaml` can pull it by `oci://` reference + pinned version, with no local chart
checkout required. Mirrors this repo's existing precedent of CI publishing artifacts to GHCR
(`docker/build-push-action` in Phase 3) rather than introducing a new mechanism.

- [x] **T3 — New `helm-chart-publish` CI job.** Add a `helm-chart` path-filter output to
  `change-detecter` (`charts/app-template/**`). New job `helm-chart-publish`,
  `needs: [change-detecter]`,
  `if: needs.change-detecter.outputs.helm-chart == 'true' && github.ref == 'refs/heads/master' && github.event_name == 'push'`,
  `permissions: { contents: read, packages: write }`. Steps: checkout; `azure/setup-helm@v4`;
  `helm registry login ghcr.io -u ${{ github.actor }} --password-stdin <<< "${{ secrets.GITHUB_TOKEN }}"`;
  `helm package charts/app-template -d /tmp/chart-dist` (version comes from `Chart.yaml`);
  `helm push /tmp/chart-dist/app-template-*.tgz oci://ghcr.io/hungnh1812dev/project-abyssoftime-v2/charts`.
  Document in the job (a comment) that `Chart.yaml`'s `version` must be bumped on every template
  change — OCI tags are immutable, so re-pushing the same version fails.
  - Acceptance: job only runs on a master push that touches `charts/app-template/**`; publishes to
    `oci://ghcr.io/hungnh1812dev/project-abyssoftime-v2/charts/app-template` at the `Chart.yaml`
    version.
  - Verify: YAML parses; `helm package charts/app-template -d /tmp/chart-dist` succeeds locally
    (packaging logic, no registry credentials needed); read-through confirms the new
    `change-detecter` output and job don't alter any existing job's `needs`/`if` graph.
    **Cannot be fully verified end-to-end from here** — actually publishing requires GHCR
    credentials only the user has. First real publish happens either when this lands on `master`
    and CI runs, or the user runs the same `helm registry login`/`helm package`/`helm push`
    sequence locally once to bootstrap it before Phase 2 needs the artifact to exist.
  - Files: `.github/workflows/ci.yml`
  - Deps: Checkpoint A. Size: M

> **CHECKPOINT A.5** — **PASSED** (2026-09-23). `python3 -c "import yaml; yaml.safe_load(...)"`
> confirms `ci.yml` is valid YAML. `helm package charts/app-template -d /tmp/chart-dist` succeeds
> locally, producing `app-template-0.1.0.tgz`. Full `git diff .github/workflows/ci.yml` reviewed:
> only the 3 added lines in `change-detecter` (new `helm-chart` output/filter/debug line) and the
> new standalone `helm-chart-publish` job — every other job (`cms-api-*`, `cms-admin-*`,
> `frontend-*`, `deploy-cms-api`, `deploy-cms-admin`, `deploy-frontend`) byte-identical to before.
>
> **Not yet done (needs the user, no agent has GHCR write credentials):** the job has never actually
> run against real GHCR — first real publish happens when this lands on `master`, or the user runs
> the bootstrap sequence in `SPEC.md`'s Commands section locally. **Phase 2 (T4) is blocked on that
> publish actually happening** — `helmfile template` against the `oci://` chart reference will fail
> with "not found" until the artifact exists at those coordinates.
> **Commit 2** — once Checkpoint A.5 passes.


## cms-api Helmfile deployment + GHCR image pipeline (archived 2026-09-23)

Status: done. All 13 tasks and 5 checkpoints are committed on `develop`:
- `6bb7328`: Phase 0. Switched to the shared `helmfile-chart-template` and removed
  `charts/app-template` plus its publish job.
- `612dab6`: Phase 2. `helmfile.yaml`, `k8s/values.yaml` and the renamed `secret.example.yaml`; the
  old raw manifests were deleted.
- `0bf5573`: Phase 3. The `cms-api-ghcr-publish` job, with the Render deploy gated on
  `CMS_API_DEPLOY_MODE`.
- `7482f6a`: Phase 4. Docs.
- `4023f3a`: fixes from the five-axis review (verdict REQUEST CHANGES, no Critical findings; both
  Important findings fixed).
- Close-out commit: `SPEC.md` reduced to the ENTRYPOINT pointer.

The full implementation writeup lives in `docs/documents/cms-api-k3s-deployment.md` and
`docs/documents/cms-api-k3s-deployment-techstack.md`.

Worth knowing if this deployment is touched again:

- **The chart is unpinned** (user decision). Always run `helmfile cache cleanup` before
  `diff`/`apply`. helmfile caches unversioned OCI charts and never refreshes them otherwise.
- **`helmfile apply` doesn't roll out new `latest` images.** Use `kubectl rollout restart`, or switch
  `values.yaml` to `<short-sha>` tags.
- **Not verified from an agent session:** a real `helmfile apply`, the GHCR publish job (it needs a
  `master` push), and pull access to GHCR from the node. The chart has no `imagePullSecrets` value
  yet.

Frozen snapshot of `tasks/plan.md` and `tasks/todo.md` at archive time:

## Plan: cms-api Helmfile deployment + GHCR image pipeline

Spec: [`SPEC.md`](../SPEC.md) (approved, 2026-09-23)
Status: **IN PROGRESS** — re-planned onto the latest `helmfile-chart-template` (unpinned)
Task list: [`tasks/todo.md`](todo.md)

---

### Context

The spec replaces the current hand-written, uncommitted k8s manifests
(`apps/cms-api/k8s/deployment.yaml`, `service.yaml`) with a **helmfile-driven** deployment, backed by
the shared, externally published `helmfile-chart-template` Helm chart (also reusable by
`cms-admin`/`frontend` later). CI currently deploys cms-api only via a Render webhook; this adds a
second path that builds the existing multi-stage `Dockerfile`'s `runner` and `migrator` targets and
pushes both to GHCR, gated by a repo variable so the Render path is untouched by default. The user pulls the new image and runs
`helmfile apply` by hand — no cluster access from CI.

Confirmed naming (chart-derived): `appName=abyssoftime`, `serviceName=cms-api`,
`appNamespace=abyssoftime`, `appEnv=prod` → Deployment/Service `abyssoftime-cms-api-prod`, namespace
`abyssoftime-prod`, secret `abyssoftime-cms-api-secrets-prod`. GHCR image path
`ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, two tags per push (runner + `-migrate` suffix
for the migrator target). CI flag: `vars.CMS_API_DEPLOY_MODE` (`ghcr` opts in; unset/`render` keeps
today's behavior).

Reusable pieces already in place, confirmed by reading the code:

- `apps/cms-api/Dockerfile` already has both `runner` (default) and `migrator` targets — no Dockerfile
  changes needed, only two different `--target` builds in CI.
- `apps/cms-api/k8s/secret.example.yaml` already has the right *keys* (`PORT`, DB/storage/email vars)
  — only the `Namespace`/`Secret` **names** need renaming to the new convention.
- `.github/workflows/ci.yml`'s `change-detecter` → `cms-api-build` job chain is reused as the
  dependency for the new GHCR job, matching how `deploy-cms-api` already hooks in today.
- `src/main.ts:10` reads `process.env.PORT` only — there is no `APP_PORT` env var in the app. The
  chart's `appPort` value is a separate, non-secret template input (drives `containerPort` and the
  Service port); it must be kept in sync by hand with the Secret's `PORT` key.

**Chart source changed (2026-09-23, user follow-up):** the user published a standalone, shared chart,
`oci://ghcr.io/hungnh1812dev/helmfile-chart-template`. Version `0.2.0` adds `initContainers` (plain
container specs) and `secrets.enabled` (`envFrom` a pre-existing
`<appName>-<serviceName>-secrets-<appEnv>` Secret on the app and every init container). `0.3.0` adds
optional httpGet probes (`probes.enabled`, `probes.{liveness,readiness}`, default path `/healthz`)
and changes the default `image.pullPolicy` to `Always`. It replaces
the in-repo `charts/app-template/` and its `helm-chart-publish` CI job. Those phases were done and
committed (`c7cc99b`, `817bccc`) and are now archived as superseded in `tasks/archive.md`. They are
removed in Phase 0. Differences from `app-template` that change the plan:

- All names gain an `-<appEnv>` suffix, and the chart **fails** the render unless the release
  namespace equals `<appNamespace>-<appEnv>`.
- The Secret name is fixed by the chart (no override).
- The Service exposes `appPort` directly (`3000 → 3000`, was `80 → http`).
- Probe paths default to `/healthz`, so cms-api overrides them with `/health` and carries over the
  old manifest's timings.
- The chart's `image.pullPolicy` (default `Always` as of 0.3.0) covers only the main container. The
  `migrate` init container's `latest-migrate` tag isn't exactly `latest`, so Kubernetes would default
  it to `IfNotPresent`; cms-api sets `imagePullPolicy: Always` on it explicitly.

The chart is already published, so Phase 2 is no longer blocked on a first publish.

**Version policy (user decision, 2026-09-23):** consume the **latest** chart version. There is no
`version:` in `helmfile.yaml`, so chart changes the user publishes later (e.g. probes) reach cms-api
without edits here. Verified with helmfile v1.5.2: an unversioned OCI chart resolves to the newest
tag, but helmfile then caches it and skips refreshing it on later runs. The operator flow must be
`helmfile cache cleanup && helmfile apply`. A semver range (`">=0.2.0"`) caches the same way, so it
isn't used.

### Dependency graph

```
Phase 0 — Switch to the published chart
  T0a Align SPEC.md with the latest helmfile-chart-template (names, inputs, unpinned, probes)
  T0b Remove charts/app-template/ + helm-chart-publish CI job (ask before delete)
        │
        ▼
  CHECKPOINT 0 — spec matches chart; in-repo chart + publish job gone

Phase 2 — cms-api's helmfile release
  T4 apps/cms-api/helmfile.yaml + apps/cms-api/k8s/values.yaml (chart:
     oci://ghcr.io/hungnh1812dev/helmfile-chart-template, no version = latest; real cms-api values,
     secrets.enabled, migrate init container, /health probes)
        │
        ▼
  T5 apps/cms-api/k8s/secret.example.yaml — rename Namespace/Secret to abyssoftime-prod /
     abyssoftime-cms-api-secrets-prod
        │
        ▼
  T6 Remove old apps/cms-api/k8s/deployment.yaml + service.yaml (ask before delete)
        │
        ▼
  CHECKPOINT B — helmfile render supersedes the old manifests (incl. /health probes); old raw
                 manifests removed with explicit confirmation

Phase 3 — CI/CD for cms-api images (independent of Phase 2; after T0b since same ci.yml)
  T7 New cms-api-ghcr-publish job (build+push runner & migrator targets, gated on
     vars.CMS_API_DEPLOY_MODE == 'ghcr')
        │
        ▼
  T8 Gate existing deploy-cms-api (Render) job so it still runs by default (unset/'render')
        │
        ▼
  CHECKPOINT C — ci.yml diff reviewed line-by-line: cms-admin/frontend jobs untouched, existing
                 cms-api jobs unchanged except the one added `if` gate, new job correctly scoped,
                 YAML valid

Phase 4 — Docs & wrap-up (after Checkpoints B, C)
  T9 docs/documents/cms-api-k3s-deployment.md
  T10 docs/documents/cms-api-k3s-deployment-techstack.md
  T11 apps/cms-api/docs/ENTRYPOINT.md index entries
        │
        ▼
  CHECKPOINT D — Review & cleanup
  T12 Five-axis review
  T13 Reduce apps/cms-api/SPEC.md to a minimal pointer
  T14 Explicit commit confirmation
```

### Risks / open items carried from the spec

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `appPort` (chart value) vs. `PORT` (secret key) can drift — the chart can't enforce they match | Medium — a mismatch breaks Service routing silently | Documented explicitly in T4 (inline comment) and T9 (module doc); `3000` matches today's secret |
| Chart probe path defaults to `/healthz`, but cms-api serves `/health` | High if missed — liveness fails, and the pod restarts in a loop | T4 overrides both probe paths; the acceptance criteria check the rendered path |
| `latest-migrate` init image defaults to `IfNotPresent` (only an exact `latest` tag defaults to `Always`) | Medium — the migrator silently runs stale migrations | T4 sets `imagePullPolicy: Always` on the init container explicitly |
| The chart is unpinned, so a breaking chart release (renamed/required values) lands on the next cms-api deploy | Medium — `helmfile apply` could fail or render differently with no change in this repo | Always run `helmfile cache cleanup && helmfile diff` before `apply` (documented in T9). The chart's `values.schema.json` makes most breakages fail loudly at render time |
| helmfile caches an unversioned OCI chart and skips refreshing it | Medium — "latest" silently sticks to the first fetched version | `helmfile cache cleanup` before every deploy, in the `helmfile.yaml` comment and T9 |
| Image tag scheme (`latest` + short-SHA) wasn't explicitly specified by the user | Low — easy to change later | Called out in T4/T7; adjust before Checkpoint C if the user wants something else |
| Deleting the in-repo chart (T0b) and the old raw manifests (T6) is destructive | Low-Medium — the chart is recoverable from git history; the raw manifests are untracked | Ask explicit confirmation before each delete, per the global rule |

No `helm`/`helmfile apply` (or any cluster-mutating command) runs as part of this plan — every
verification step is `lint`/`template`/`diff`, read-only against the user's cluster.

### Open Questions

None.

## Todo: cms-api Helmfile deployment + GHCR image pipeline

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS** — 13 done / 13 tasks — DONE (in-repo chart phases archived as superseded — see
[`tasks/archive.md`](archive.md))

Checkbox updates ship in the same commit as that phase's code.

**Chart:** the shared, externally published `oci://ghcr.io/hungnh1812dev/helmfile-chart-template`,
**unpinned**: `helmfile.yaml` has no `version:`, so each deploy fetches the latest published version
(0.3.0 at the last re-plan). Its source lives in its own repo; this repo only consumes it. It
replaces the in-repo `charts/app-template/` chart built in the archived Phases 1/1.5.

**Cache caveat (verified with helmfile v1.5.2):** helmfile caches an unversioned OCI chart and skips
refreshing it on later runs ("Skipping refresh for chart at …/helmfile-chart-template"). The first
fetched version would stick. The operator flow is therefore `helmfile cache cleanup && helmfile
apply`. A semver range (`version: ">=0.2.0"`) was also tested; it caches under the range string and
has the same problem, so it adds nothing.

### Phase 0 — Switch to the published chart

- [x] **T0a — Align `apps/cms-api/SPEC.md` with `helmfile-chart-template` (latest, currently 0.3.0).** Rewrite the
  sections that describe `charts/app-template`: naming inputs are now `appName`/`serviceName`/
  `appNamespace`/`appEnv` (was `appName`/`servicePostfix`/`namespaceBase`); resource names change to
  Deployment/Service `abyssoftime-cms-api-prod`, namespace `abyssoftime-prod` (the chart **fails** the
  render unless the release namespace equals `<appNamespace>-<appEnv>`), Secret
  `abyssoftime-cms-api-secrets-prod` (fixed by the chart, no override). Service now exposes `appPort`
  directly (`3000 → 3000`, was `80 → http`). The migrator runs through `initContainers.containers`
  (plain container spec) and secrets through `secrets.enabled: true` (`envFrom` on the app and every
  init container). Probes come from `probes.enabled` + `probes.{liveness,readiness}` (httpGet on
  port `http`). The chart defaults the path to `/healthz`, so cms-api must override it with `/health`.
  Drop the chart-publish CI job, the `helm package`/`helm push` commands, and
  `charts/app-template/` from Project Structure/Testing/Boundaries/Success Criteria.
  - Acceptance: `grep -n "servicePostfix\|namespaceBase" apps/cms-api/SPEC.md` returns nothing, and
    `app-template` appears only as "removed". Every resource name in the spec matches the latest
    chart's render.
  - **Done (2026-09-23).** Spec rewritten around a numbered Decisions list. Added decision 6 (found
    while rewriting): with a fixed `latest` tag, `helmfile apply` renders identical manifests and
    doesn't restart pods. New images are rolled out with
    `kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod`, or by switching
    `values.yaml` to `<short-sha>` tags.
  - Verify: read-through against `helm template` output of the published chart.
  - Files: `apps/cms-api/SPEC.md`
  - Deps: none. Size: S

- [x] **T0b — Remove the in-repo chart and its publish job.** Ask the user explicitly before deleting.
  Delete `charts/app-template/` (and `charts/` if empty). In `.github/workflows/ci.yml` remove the
  `helm-chart` output, path filter and debug-summary line from `change-detecter`, and the whole
  `helm-chart-publish` job. Every other job stays byte-identical.
  - Acceptance: `app-template`/`helm-chart` appear only in the spec/task files as "removed"/history;
    `ci.yml` diff touches only those lines.
  - **Done (2026-09-23).** Deletion confirmed by the user. The `ci.yml` diff is 31 deleted lines, and
    `git diff 817bccc~1 -- .github/workflows/ci.yml` is empty: the workflow is byte-identical to its
    state before the chart-publish commit. YAML parses; `actionlint` is not installed.
  - Verify: `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`;
    `grep -rn "app-template\|helm-chart" --exclude-dir=node_modules . | grep -v tasks/archive.md` is
    empty; `git diff .github/workflows/ci.yml` read-through.
  - Files (deleted): `charts/app-template/**`; (edited): `.github/workflows/ci.yml`
  - Deps: none. Size: S

> **CHECKPOINT 0**: **PASSED** (2026-09-23). The spec matches the published chart, and the in-repo
> chart and publish job are gone, with deletion confirmed by the user.
> **Commit 1**: once Checkpoint 0 passes.

### Phase 2 — cms-api's helmfile release

- [x] **T4 — `apps/cms-api/helmfile.yaml` + `apps/cms-api/k8s/values.yaml`.** One release
  `abyssoftime-cms-api-prod`, namespace `abyssoftime-prod` (literal; it must equal
  `<appNamespace>-<appEnv>` or the chart fails), chart from an OCI repository entry
  (`repositories: [{name: hungnh1812dev, url: ghcr.io/hungnh1812dev, oci: true}]`,
  `chart: hungnh1812dev/helmfile-chart-template`), **no `version:`**, so the latest published chart is
  used. Add a comment above the release explaining that and the `helmfile cache cleanup`
  requirement. Values file `k8s/values.yaml`. Values:
  - `appName: abyssoftime`, `serviceName: cms-api`, `appNamespace: abyssoftime`, `appEnv: prod`
  - `appPort: 3000` (must match `secret.example.yaml`'s `PORT: "3000"`; add a comment about the pairing)
  - `image.repository: ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, `image.tag: latest`
    (no `pullPolicy`, since the chart defaults to `Always` as of 0.3.0)
  - `resources`: carry over the old manifest's `100m/128Mi` requests and `500m/512Mi` limits
  - `secrets.enabled: true`
  - `initContainers.enabled: true`, `containers: [{name: migrate, image: ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:latest-migrate, imagePullPolicy: Always}]`.
    No `command` is needed because the `migrator` target's `CMD` already runs `prisma migrate deploy`.
    Set `imagePullPolicy: Always` explicitly. The chart's `pullPolicy` only applies to the main
    container, and Kubernetes pulls every time by default only for a tag that is exactly `latest`.
    `latest-migrate` would default to `IfNotPresent` and never re-pull.
  - `probes.enabled: true`, with the old manifest's settings carried over: `liveness: {path: /health,
    initialDelaySeconds: 15, periodSeconds: 20}` and `readiness: {path: /health, initialDelaySeconds: 5,
    periodSeconds: 10}`. The path must be overridden because the chart defaults to `/healthz`, while
    cms-api serves `/health` outside the `api/v1` prefix (`src/bootstrap/configure-app.ts:95`).
    `timeoutSeconds: 1`/`failureThreshold: 3` come from the chart defaults.
  - Acceptance: `helmfile template` renders a Deployment and a Service named
    `abyssoftime-cms-api-prod` in `abyssoftime-prod`. The init container `migrate` uses the
    `latest-migrate` image and is listed before the main container (image `...cms-api:latest`). Both
    containers have `envFrom: abyssoftime-cms-api-secrets-prod`. Both images use
    `imagePullPolicy: Always`. The liveness and readiness probes hit `/health` with the old timings.
    Resources match the old manifest, and the Service port is `3000`.
  - Verify: `cd apps/cms-api && helmfile cache cleanup && helmfile template`. The "Pulling" line shows
    no tag, and the render matches the acceptance criteria. The same setup (unversioned, OCI repo
    entry) and these exact values rendered successfully against 0.3.0 during planning.
  - Files: `apps/cms-api/helmfile.yaml`, `apps/cms-api/k8s/values.yaml`
  - Deps: T0a. Size: S
  - **Done (2026-09-23).** `helmfile cache cleanup && helmfile template` pulled chart 0.3.0 with no
    tag, and every acceptance item checked out in the render.

- [x] **T5 — Rename `apps/cms-api/k8s/secret.example.yaml`.** `Namespace.metadata.name` and
  `Secret.metadata.namespace` → `abyssoftime-prod` (was `abyssoftime`); `Secret.metadata.name` →
  `abyssoftime-cms-api-secrets-prod` (was `cms-api-env`). This name is fixed by the chart's
  `chart.secretName` helper. Update the header comment (apply-order note, `kubectl apply -f` example)
  to match. Keys unchanged. `secret.yaml` itself is never touched.
  - Acceptance: `abyssoftime-cms-api-secrets-prod` matches exactly what T4's rendered Deployment
    references in `envFrom`.
  - Verify: `kubectl apply --dry-run=client -f apps/cms-api/k8s/secret.example.yaml` succeeds
    (client-side, no live cluster needed); diff review against T4's rendered secret name.
  - Files: `apps/cms-api/k8s/secret.example.yaml`
  - Deps: T4. Size: XS
  - **Done (2026-09-23).** The header now also notes the apply-before-helmfile order and that the
    Secret name is fixed by the chart. `kubectl apply --dry-run=client` can't run offline: it still
    fetches OpenAPI from the unreachable cluster. It was replaced by a YAML parse check (Namespace
    `abyssoftime-prod` plus Secret `abyssoftime-cms-api-secrets-prod` in `abyssoftime-prod`, 20 keys)
    and a name match against T4's rendered `envFrom`. `kubeconform` is not installed.

- [x] **T6 — Remove superseded raw manifests.** Ask the user explicitly before deleting (untracked,
  pre-existing files). First cross-check T4's render against the old files. Resources and the `/health`
  readiness/liveness probes (same timings) carry over. The Service port changes from `80` to `3000`, so the port-forward becomes
  `svc/abyssoftime-cms-api-prod 3000:3000`. The old `imagePullPolicy: Never` +
  `docker save | ssh ... ctr images import` flow is fully replaced by the GHCR pull flow (documented
  in T9).
  - Acceptance: files deleted only after explicit confirmation; `grep -r` for the deleted filenames
    comes back clean.
  - Verify: manual cross-check + confirmation.
  - Files (deleted): `apps/cms-api/k8s/deployment.yaml`, `apps/cms-api/k8s/service.yaml`
  - Deps: T4, T5. Size: XS
  - **Done (2026-09-23).** Cross-check passed: resources and probes are identical. Additions:
    migrate init container and GHCR images. Renames: names/namespace, with Service `80→http` becoming
    `3000→3000`. Deletion was confirmed by the user, and no references remain outside the task/spec
    history. Operator note: the old `cms-api` Deployment/Service and the `cms-api-env` Secret in the
    `abyssoftime` namespace still exist on the live cluster until removed by hand.

> **CHECKPOINT B**: **PASSED** (2026-09-23). The helmfile, pulling the latest
> `helmfile-chart-template` (0.3.0) from GHCR, and the renamed secret template fully replace the old
> raw manifests. The render matches the old manifest, including probes, and deletion was confirmed by
> the user.
> **Commit 2**: once Checkpoint B passes.

### Phase 3 — CI/CD for cms-api images (parallel to Phase 0/2)

- [x] **T7 — New `cms-api-ghcr-publish` job.** `needs: [cms-api-build]`,
  `if: needs.change-detecter.outputs.cms-api == 'true' && vars.CMS_API_DEPLOY_MODE == 'ghcr' && github.ref == 'refs/heads/master' && github.event_name == 'push'`,
  `permissions: { contents: read, packages: write }`. Steps: checkout, `docker/login-action@v3`
  (`registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`),
  two `docker/build-push-action@v6` calls against `apps/cms-api` — `target: runner` tagged
  `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:{latest,<short-sha>}` and `target: migrator`
  tagged `...:{latest-migrate,<short-sha>-migrate}`.
  - Acceptance: job only runs when the repo variable is set to `ghcr`; produces both image tags on a
    master push.
  - Verify: YAML parses (`python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`);
    read-through confirms `cms-admin`/`frontend` jobs and their `needs`/`if` graphs are byte-identical
    to before.
  - Files: `.github/workflows/ci.yml`
  - Deps: T0b (same file; land the removal first). Size: M
  - **Done (2026-09-23), with one deviation:** the `if` drops the
    `needs.change-detecter.outputs.cms-api == 'true'` check. The `needs` context only holds *direct*
    dependencies, so it would evaluate to empty here. It is also redundant, because
    `needs: [cms-api-build]` already skips this job when cms-api didn't change, the same way
    `deploy-cms-api` works. The short SHA is computed in a step (`${GITHUB_SHA::7}`). There is no buildx
    setup: the default driver shares layers between the two builds in the same job. Unverified
    observation: the existing `cms-api-lint`/`-test`/`-build` jobs (and the cms-admin/frontend
    equivalents) use the same `needs.change-detecter` pattern without a direct dependency. That may
    make them always skip. Worth checking against a real run, but it is outside this feature's scope.

- [x] **T8 — Gate the existing Render deploy job.** Add `&& vars.CMS_API_DEPLOY_MODE != 'ghcr'` to
  `deploy-cms-api`'s existing `if:` condition — every other line of that job untouched, so an unset
  variable reproduces today's behavior exactly.
  - Acceptance: with `CMS_API_DEPLOY_MODE` unset, `deploy-cms-api` still runs and
    `cms-api-ghcr-publish` does not; with it set to `ghcr`, the reverse.
  - Verify: same YAML-parse check as T7; trace both branches of the condition by hand.
  - Files: `.github/workflows/ci.yml`
  - Deps: T7 (same file/section, sequential). Size: XS
  - **Done (2026-09-23).** Both branches traced by hand. Unset or `render` means Render deploy runs
    and the publish job is skipped; `ghcr` means the reverse.

> **CHECKPOINT C**: **PASSED** (2026-09-23). The `ci.yml` diff since Commit 2 is +47/-1: the new
> `cms-api-ghcr-publish` job plus the one changed `deploy-cms-api` `if` line. Every other job is
> untouched, and the YAML parses. `actionlint` is not installed. The image builds run only on a real
> master push, because there are no GHCR credentials here.
> **Commit 3**: once Checkpoint C passes.

### Phase 4 — Docs & wrap-up

- [x] **T9 — `docs/documents/cms-api-k3s-deployment.md`.** Module doc (matches the
  `docs/documents/*.md` convention). Cover:
  - The external chart (`oci://ghcr.io/hungnh1812dev/helmfile-chart-template`, unpinned so each
    deploy uses the latest version, source in its own repo). Cover the cache caveat
    (`helmfile cache cleanup` before every apply), and use `helmfile diff` to preview what a new
    chart version changes.
  - Which values are cms-api-specific, and the derived names
    (`abyssoftime-cms-api-prod`, `abyssoftime-prod`, `abyssoftime-cms-api-secrets-prod`).
  - The init-container migration mechanism.
  - The full manual operator flow: apply `secret.yaml`, then `helmfile apply`. Include rolling out
    new `latest` images with `kubectl rollout restart` (apply alone doesn't restart pods when the
    manifests are unchanged; see `SPEC.md` decision 6).
  - The GHCR image path, the two-tag convention.
  - The `CMS_API_DEPLOY_MODE` flag.
  - The `appPort`/`PORT` pairing caveat.
  - The `/health` probe override (the chart defaults to `/healthz`) and why the migrate init
    container sets `imagePullPolicy: Always` explicitly.
  - Files: `apps/cms-api/docs/documents/cms-api-k3s-deployment.md`
  - Deps: Checkpoint B, Checkpoint C. Size: S

- [x] **T10 — `docs/documents/cms-api-k3s-deployment-techstack.md`.** Decision-rationale table per
  `docs/workflow.md`. Compare:
  - Helm+helmfile vs. Kustomize vs. raw manifests.
  - Unpinned (latest) chart vs. a pinned version vs. a semver range. Latest was chosen by the user
    so chart updates reach cms-api without edits here. The trade-off is less reproducible deploys.
  - A shared external chart published from its own repo vs. an in-repo chart published from this
    repo's CI (tried, then superseded) vs. a local relative path.
  - Two tags in one GHCR package vs. two packages for the migrator image.
  - A repo variable vs. a `workflow_dispatch` input for the CI flag.
  - Files: `apps/cms-api/docs/documents/cms-api-k3s-deployment-techstack.md`
  - Deps: T9. Size: S

- [x] **T11 — `apps/cms-api/docs/ENTRYPOINT.md`.** Add index entries for T9/T10, matching the
  existing bullet format.
  - Files: `apps/cms-api/docs/ENTRYPOINT.md`
  - Deps: T10. Size: XS

> **CHECKPOINT D**: **PASSED** (2026-09-23). A read-through of both docs, `SPEC.md`,
> `helmfile.yaml` and `values.yaml` found no contradictions. T9 also documents two operator points
> that weren't planned: GHCR packages are private by default, so the node needs pull access (the chart
> has no `imagePullSecrets` value yet), and the old `abyssoftime`-namespace resources must be removed
> by hand.
> **Commit 4**: once Checkpoint D passes.

### Phase 5 — Review & cleanup

- [x] **T12 — Five-axis review** (`agent-skills:code-reviewer`). Axes:
  - Correctness: helmfile/values render the intended names, the namespace guard passes, and the
    init container gets the secret.
  - Readability.
  - Architecture: cms-api specifics live only in `k8s/values.yaml`, and the chart is consumed rather
    than forked.
  - Security: no secrets baked in, `GITHUB_TOKEN` scoped to `packages: write` only, no cluster
    credentials in CI.
  - Performance: n/a for YAML; note it and skip.
  - Deps: Checkpoint D. Size: M
  - **Done (2026-09-23).** Verdict: REQUEST CHANGES, with no Critical findings. Both Important
    findings were confirmed and fixed:
    - `latest` and `latest-migrate` could diverge if the run failed or was cancelled
      (`cancel-in-progress`) between the two pushes. Now both images are built first and pushed in
      order: SHA tags, then `latest-migrate`, then `latest`.
    - `.dockerignore` didn't exclude `k8s/`, so a local `COPY . .` would bake the real `secret.yaml`
      into the migrator image. `k8s` and `helmfile.yaml` are now excluded.
    - Also applied: the `org.opencontainers.image.source` label, and an `ENTRYPOINT.md` techstack
      list that was missing 2 of the 6 tables.
    - Not applied: `resources` on the init container, a non-root `USER` in the `migrator` stage, and
      buildx GHA cache. All three are optional follow-ups.
    - The pre-existing `needs.change-detecter` issue (see T7) was re-raised as possibly blocking the
      whole cms-api chain. It needs a real CI run to confirm and is left to the user.
    - The `ci.yml` change after the fix still parses.

- [x] **T13 — Reduce `apps/cms-api/SPEC.md` to a minimal pointer**, per this repo's established
  convention (see the Dockerfile feature's `tasks/archive.md` T14 for precedent) — once T9/T10 fully
  capture the implementation, strip the spec back to a short pointer at those docs.
  - Deps: T12. Size: XS
  - **Done (2026-09-23).** Every spec decision is captured in `cms-api-k3s-deployment.md` and
    `cms-api-k3s-deployment-techstack.md`. `SPEC.md` is now the standard "No active spec → see
    `docs/ENTRYPOINT.md`" pointer.

> **CHECKPOINT E** — Final review sign-off. Ask for explicit commit confirmation (exact staged files
> + full commit message) before committing, per `docs/workflow.md`'s commit rules.

- [x] **T14 — Commit confirmation** — ask Yes/No on the exact staged file list and full commit
  message before running `git commit`.
  - Deps: Checkpoint E. Size: XS

## cms-api CI/CD on Flux (archived 2026-09-25)

The feature shipped and later moved to the `deployment`-branch flow (see docs/documents/cms-api-flux-deployment.md). The open items below were superseded, not skipped.

# Implementation Plan: cms-api CI/CD on Flux

Spec: `apps/cms-api/SPEC.md`. Task list: `tasks/todo.md`. Prior work: `tasks/archive.md`.

## Overview

Replace the helmfile deploy with Flux GitOps. CI pushes sortable `<run_number>-<sha7>` and
`<run_number>-<sha7>-init` images. Plain k8s templates in `k8s/flux/` (which the owner copies to
the GitOps repo) are filled in by Flux from a hand-made ConfigMap and the image-automation tag.
The runtime Secret is hand-made too. helmfile, values and secrets-chart are removed.

## Dependency graph

```
naming contract (SPEC)
  ├── k8s/config.env.example ──┐
  ├── k8s/flux/app (Deployment, Service) ──┐
  │       └── image automation (ImageRepository/Policy/UpdateAutomation) ── needs tag format ──┐
  │               └── k8s/flux/kustomization.flux.yaml (substituteFrom + setter marker)        │
  ├── CI publish job (tag format, -init before app, vars.CMS_API_IMAGE_REPO) ◄─────────────────┘
  ├── k8s/.env.example (drop APP_*)
  └── remove helmfile / values / secrets-chart ── after templates exist (nothing still points at them)
          └── docs + rule + ENTRYPOINT (describe the final state)
```

The tag format (`^\d+-[a-f0-9]{7}$`, with `-init` excluded) is the contract between the CI
job and the ImagePolicy. It is fixed in the SPEC, so the two sides can be built independently.

## Architecture decisions (from the SPEC intake)

- Flux image automation instead of a manual tag bump. Git records what's deployed, and rollback
  is a revert.
- Plain manifests instead of the shared `helmfile-chart-template`. There's no chart to pin or
  cache-clean, and there are only two resources.
- A separate GitOps repo. This repo only ships templates, because agents can't write outside it.
- The ConfigMap lives in `flux-system`, which `postBuild.substituteFrom` requires. The Secret
  lives in `<full-namespace>`, which `envFrom` requires.
- A single `APP_IMAGE_TAG` substitution feeds both images, so app and init always come from
  one commit.
- `PORT` is set from `${APP_PORT}` through the app container's
  `command: ["sh","-c","PORT=${APP_PORT} exec bun dist/src/main"]`, replacing the helmfile `PORT`
  injection. An `env` value can't carry it, because Flux substitutes after kustomize drops the
  quotes, so the API server would get an int. The command must stay in sync with the Dockerfile
  `CMD`.

## Phases

1. **Flux templates.** This is new and carries the most risk (substitution typing, the setter
   marker), so it goes first. Tasks 1–3.
2. **CI + Secret template.** These are the producer side of the tag contract and the owner's
   inputs. Tasks 4–5.
3. **Remove helmfile.** Only after the replacement exists. Task 6.
4. **Docs, rules, wrap-up.** Tasks 7–9.

Checkpoints come after each phase. Commits are batched at checkpoints, and every commit needs
an explicit Yes/No first (per `docs/workflow.md`).

## Verification toolkit (all local, no cluster access)

- `kubectl kustomize k8s/flux/app` renders the templates.
- `… | envsubst` with fake `APP_*` values (same order as Flux), then PyYAML asserts. **Not**
  `kubectl apply --dry-run=client`, because it contacts the kubeconfig's real cluster.
- `python3 -c 'import yaml,sys; list(yaml.safe_load_all(sys.stdin))'` checks that YAML parses
  (used for the Flux CRD files and `ci.yml`).
- `grep -E` checks the ImagePolicy regex against sample tags, and a literal scan checks for
  `abyssoftime|hungnh1812dev|cms-api|3000`.

`flux`, `kubeconform` and `actionlint` aren't installed. Installing them is ask-first and isn't
required by this plan.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A number-like placeholder becomes an int after substitution (kustomize drops quotes, then Flux converts YAML to JSON) | High (apply fails) | Seen in Task 1: `containerPort` must be an int, so it's fine. `PORT` moved into `command`. The check asserts every env value is a string |
| `command` falls out of sync with the Dockerfile `CMD` | Med (app won't start) | Comments in both places, plus a note in the deployment doc and dockerfile doc (Tasks 7, 9) |
| Setter marker in the wrong place or wrong format, so the tag never updates | High (no auto deploy) | Follow the Flux docs exactly: the marker goes on the `APP_IMAGE_TAG` line with `:tag` suffix. The owner verifies with `flux get images policy` |
| Flux picks an app tag before its `-init` exists | Med (init pull fails, then retries) | CI pushes `-init` first (Task 4). The policy regex excludes `-init` |
| `run_number` resets if the workflow file is renamed | Med (Flux stops picking up newer tags) | Documented. Switching to `<epoch>-<sha7>` is an open question |
| Private GHCR package | High (ImageRepository scan and pod pulls fail) | Open question. If private, Task 2 and Task 1 add a pull-secret placeholder |
| Cutover downtime between `helm uninstall` and the first Flux apply | Low | Documented in the migration steps. The owner picks the window |
| Uncommitted helmfile work in the tree | Low | Resolve before Task 1 (Task 0) |

## Open questions (defaults used unless you say otherwise)

1. Is the GHCR package public? **Default: public**, so no pull-secret placeholders.
2. Tag counter: **default `run_number`**, as approved. The alternative is `<epoch>-<sha7>`.
3. Uncommitted helmfile changes: **default: commit them as-is first** (Task 0, needs your Yes).
4. Template location: **default `apps/cms-api/k8s/flux/`**.

# Todo: cms-api CI/CD on Flux

Spec: `apps/cms-api/SPEC.md` · Plan: `tasks/plan.md` · History: `tasks/archive.md`

## Phase 0: Clean baseline

- [x] **Task 0: Settle the uncommitted helmfile work**. Done: committed as `62438de`.
  - Acceptance: `git status` is clean for the files this plan touches (the pending helmfile edits
    are committed, or discarded on your call).
  - Verify: `git status --short` shows none of `k8s/*`, `ci.yml`, `Dockerfile`, `docs/*`.
  - Files: none new (commit only, needs a Yes/No first).
  - Deps: none · Size: XS

## Phase 1: Flux templates

- [x] **Task 1: Core workload templates + ConfigMap template**
  - Acceptance:
    - `k8s/flux/app/{kustomization,deployment,service}.yaml` use only `${APP_NAME}`,
      `${APP_SERVICE_NAME}`, `${APP_NAMESPACE}`, `${APP_ENV}`, `${APP_PORT}`, `${APP_IMAGE_REPO}`
      and `${APP_IMAGE_TAG}`.
    - The Deployment has init container `init` (`…:${APP_IMAGE_TAG}-init`) and container `app`,
      both with `envFrom` on the `-secrets` Secret. The app sets `PORT` through
      `command: ["sh","-c","PORT=${APP_PORT} exec bun dist/src/main"]`, with `/health` probes
      (15/20, 5/10) and resources 100m/128Mi → 500m/512Mi. The Service is ClusterIP on
      `${APP_PORT}`.
    - `k8s/config.env.example` lists exactly the six `APP_*` keys, with empty placeholders.
  - Verify:
    - `kubectl kustomize k8s/flux/app` succeeds.
    - The placeholder set from `… | grep -o '\${[A-Z_]*}' | LC_ALL=C sort -u` is exactly the
      7 vars.
    - Fake `envsubst` (same order as Flux), then PyYAML asserts: names, images, envFrom, int
      ports, the `PORT` command, every env value a string, probes, resources, selector.
    - The literal scan (non-comment lines) finds nothing.
  - Done: all checks pass. Along the way, a quoted `env: PORT="${APP_PORT}"` turned out to become
    an int, because kustomize drops quotes before Flux runs envsubst. The Flux source
    (`fluxcd/pkg` `SubstituteVariables`: AsYAML, then envsubst, then YAMLToJSON) confirms it. You
    chose the `command` wrapper, and the SPEC is updated.
  - Files: `k8s/flux/app/kustomization.yaml`, `k8s/flux/app/deployment.yaml`,
    `k8s/flux/app/service.yaml`, `k8s/config.env.example`
  - Deps: Task 0 · Size: M

- [x] **Task 2: Image automation templates**. Done: all checks pass. The API version
  (`image.toolkit.fluxcd.io/v1`) and field names were checked against the fluxcd.io docs. The
  Flux envsubst source (`fluxcd/pkg/envsubst`) confirms that only `${…}` is expanded, so
  `extract: '$n'` is safe. The local simulation now passes an explicit `APP_*` list to GNU
  envsubst to match. The IUA uses the bootstrap `flux-system` GitRepository, no `update.path`,
  and a `policySelector` on the app label. Task 7 must list "GitRepository `flux-system` with a
  write key + image controllers" as prerequisites.
  - Acceptance:
    - `ImageRepository` (`image: ${APP_IMAGE_REPO}`), `ImagePolicy` (filter
      `^(?P<n>\d+)-[a-f0-9]{7}$`, extract `$n`, numerical asc) and `ImageUpdateAutomation`
      (commits to the GitOps repo's branch, `update.strategy: Setters`) are in `flux-system`.
    - All three are named `${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}` and listed in
      `app/kustomization.yaml`.
  - Verify:
    - The files parse (python yaml) and `kubectl kustomize k8s/flux/app` still succeeds.
    - `printf '57-a1b2c3d\n57-a1b2c3d-init\nlatest\n' | grep -E '^[0-9]+-[a-f0-9]{7}$'` prints
      only `57-a1b2c3d`.
  - Files: `k8s/flux/app/image-repository.yaml`, `k8s/flux/app/image-policy.yaml`,
    `k8s/flux/app/image-update.yaml`, `k8s/flux/app/kustomization.yaml`
  - Deps: Task 1 · Size: M

- [x] **Task 3: Flux entry Kustomization**. Done: all 7 checks pass (structure, a single
  setter marker on the `APP_IMAGE_TAG` line, `<full-app-name>` 3× on non-comment lines, no
  literals). Added the `<path-to-app-dir>` and `<initial-tag>` placeholders, plus
  `wait: true`/`timeout: 5m`. Task 7 must document the placeholders and that `app/` stays
  outside the bootstrap Kustomization's path.
  - Acceptance:
    - `k8s/flux/kustomization.flux.yaml` (`kustomize.toolkit.fluxcd.io/v1`, in `flux-system`)
      points at `./app` with `prune: true`.
    - `postBuild.substituteFrom` is the ConfigMap `<full-app-name>-config`.
    - `postBuild.substitute.APP_IMAGE_TAG` carries the
      `# {"$imagepolicy": "flux-system:<full-app-name>:tag"}` marker.
    - `<full-app-name>` stays a placeholder. A header comment says the owner fills it in when
      copying.
  - Verify: the file parses. `grep -c '<full-app-name>'` gives 3 (name, ConfigMap, marker). The
    literal scan finds nothing.
  - Files: `k8s/flux/kustomization.flux.yaml`
  - Deps: Task 2 · Size: XS

### Checkpoint: Flux templates
- [x] Tasks 1–3 verify steps re-run green together.
- [x] Human review of `k8s/flux/` (substitution and marker placement) before any CI change.
- [x] Commit (Yes/No confirmation).

## Phase 2: Producer side and owner inputs

- [x] **Task 4: CI publish job → sortable tags**. Done: the `check-ci.py` asserts pass (tag
  step, both builds tagged from `vars.CMS_API_IMAGE_REPO`, `-init` pushed first, no
  `latest`/`migrate`/literal repo, and every other job unchanged vs HEAD). Also: a fail-fast
  guard for an unset `CMS_API_IMAGE_REPO`, the OCI source label now comes from
  `github.server_url`/`github.repository`, and the dead `APP_PORT` build arg is dropped (the
  Dockerfile stopped using it in `62438de`). The owner creates the `CMS_API_IMAGE_REPO` repo
  variable, and `CMS_API_APP_PORT` can be deleted.
  - Acceptance:
    - In `cms-api-ghcr-publish`, the tag is `${{ github.run_number }}-<sha7>`, and the image
      repo is `${{ vars.CMS_API_IMAGE_REPO }}`, not a literal.
    - Pushes are `<tag>-init` and then `<tag>`. No `latest`, `latest-migrate` or `-migrate`
      tags remain.
    - Comments are updated. No other job changes.
  - Verify:
    - `ci.yml` parses (python yaml).
    - `grep -n 'latest\|-migrate\|project-abyssoftime-v2/cms-api' .github/workflows/ci.yml`
      finds nothing in the cms-api publish job.
    - `git diff` only touches that job.
    - Remind the owner to create the `CMS_API_IMAGE_REPO` repo variable.
  - Files: `.github/workflows/ci.yml`
  - Deps: Task 0 · Size: S

- [x] **Task 5: Secret template for manual creation**. Done: the check passes (no
  `APP_*`/`PORT` keys, the secret key list is identical and in the same order as `62438de`, the
  header documents `kubectl create secret generic … --from-env-file=<(grep non-empty)`, the
  update-in-place variant and `rollout restart`, with no helmfile mention).
  `apps/cms-api/.env.example` is unchanged: the only divergence is `PORT`, which is intentional.
  - Acceptance:
    - `k8s/.env.example` has no `APP_*` keys and no `PORT`.
    - The header explains the `kubectl create secret generic <full-app-name>-secrets
      --from-env-file` flow (dropping empty values) instead of helmfile.
    - `apps/cms-api/.env.example` is unchanged unless the key list diverged.
  - Verify:
    - `grep -c '^APP_' k8s/.env.example` gives 0.
    - The non-`APP_*` key list is unchanged from before (diff the keys).
  - Files: `k8s/.env.example`
  - Deps: Task 1 · Size: XS

### Checkpoint: CI + inputs
- [x] `cd apps/cms-api && bun run lint && bun run test && bun run build` pass (regression guard). Lint 0 errors (1 pre-existing warning in `src/main.ts`), 152/152 suites, 1117 tests, build OK.
- [x] Commit (Yes/No confirmation).

## Phase 3: Remove helmfile

- [x] **Task 6: Delete helmfile artifacts** (ask before deleting). Done after your Yes: `git rm`
  of the 5 tracked files, and `secrets-chart/` is gone. `k8s/` now tracks `.env.example`,
  `config.env.example` and `flux/`. The Flux checks are still green. The remaining
  `helmfile`/`secrets-chart` refs are `SPEC.md` (intentional) and the 4 docs/rule files for
  Tasks 7–9. `ci.yml` is clean.
  - Acceptance: `k8s/helmfile.yaml.gotmpl`, `k8s/values.yaml.gotmpl` and `k8s/secrets-chart/`
    are removed.
  - Verify: `ls k8s` shows `.env.example`, `config.env.example` and `flux/`.
    `grep -rn 'helmfile\|secrets-chart' --exclude-dir=node_modules --exclude-dir=tasks .` finds
    only docs/rule files, which Tasks 7–9 fix.
  - Files: the 3 paths above
  - Deps: Tasks 1–3 · Size: S

## Phase 4: Docs, rules, wrap-up

- [x] **Task 7: Deployment doc**. Done: `check-doc.sh` passes 33/33 (naming contract, all 7
  variables, prerequisites, owner setup incl. placeholders and the app/-outside-bootstrap rule,
  migration `helm uninstall` of both releases, day-2 ops, `run_number` and command/CMD caveats,
  GHCR visibility, no helmfile commands). The old doc was deleted after your Yes. Correction
  found while writing: a rollback must `flux suspend image update` first, because a plain revert
  gets overwritten by the automation. The SPEC user story is fixed. Dangling links are left for
  Task 8 (the techstack doc) and Task 9 (`ENTRYPOINT.md`).
  - Acceptance:
    - `docs/documents/cms-api-flux-deployment.md` replaces `cms-api-k3s-deployment.md`
      (the old file is deleted, ask first).
    - It covers the naming contract, the ConfigMap and Secret keys, owner prerequisites
      (Flux controllers, write deploy key, `CMS_API_IMAGE_REPO` var), the one-time migration
      (`helm uninstall` of both old releases), how a deploy happens, rollback (revert the tag
      commit), restart after a Secret change, and the `run_number` caveat.
  - Verify: every SPEC "Owner prerequisites" and "Migration" step appears in the doc. No
    helmfile instructions remain.
  - Files: `docs/documents/cms-api-flux-deployment.md`,
    `docs/documents/cms-api-k3s-deployment.md` (delete)
  - Deps: Tasks 1–6 · Size: S

- [x] **Task 8: Techstack decision doc**. Done: `check-techstack.py` passes (all required topics,
  8 sections, each an options × criteria table with one `**Verdict**` row and exactly one
  `**Chosen`). Covers delivery (Flux/helmfile/Argo CD/CI push), tag delivery (automation/manual
  bump/`latest`), rendering (plain/HelmRelease), manifest home (separate repo/this repo), project
  info (ConfigMap/Secret/Git), tag format, the `PORT` injection and the migrator suffix. The old
  doc was deleted after your Yes, and its history is referenced as
  `git show c1168e6:…` (verified to exist).
  - Acceptance:
    - `docs/documents/cms-api-flux-deployment-techstack.md` replaces
      `cms-api-k3s-deployment-techstack.md` (delete, ask first).
    - It has comparison tables for Flux vs helmfile, image automation vs a ConfigMap tag bump vs
      `latest` + restart, plain manifests vs the shared chart, a separate GitOps repo vs in-repo,
      and a manual ConfigMap vs a Secret for project info.
  - Verify: each table has options × criteria and a stated winner (per the
    `docs/workflow.md` Decision rationale rule).
  - Files: the 2 techstack docs
  - Deps: Task 7 · Size: S

- [x] **Task 9: Rule, index and cross-refs**. Done: `check-t9.sh` passes (no stale refs in the
  rule, `ENTRYPOINT.md`, `dockerfile.md` or the memory file and index, apart from whitelisted history;
  the index links both new docs with no dangling links; the rule covers the manual Secret/ConfigMap and
  forbids cluster commands incl. `--dry-run=client`; `dockerfile.md` and the Dockerfile `CMD` comment
  point at the Deployment `command`). Also fixed stale `dockerfile.md` text not in the plan: the
  `APP_PORT` build-arg paragraph and build command (dead since `62438de`), and the migrator described
  as a k8s `Job` (it's now the `init` container, `<tag>-init`). The repo sweep only finds
  intentional historical mentions, and all 6 check scripts pass together.
  - Acceptance:
    - `docs/rules/k8s-secrets.md` describes the manual Secret and ConfigMap flow: agents never
      touch `k8s/.env*` other than `.env.example`, and never create cluster objects.
    - `docs/ENTRYPOINT.md` entries point to the new docs.
    - `docs/documents/dockerfile.md` refers to `-init`, not `-migrate`, and notes that the runner
      `CMD` is repeated in `k8s/flux/app/deployment.yaml`'s `command`. A one-line comment next to
      the Dockerfile `CMD` says the same.
    - The memory `feedback_never_touch_k8s_secret_yaml.md` no longer says helmfile builds the
      Secret.
  - Verify: `grep -rn 'helmfile\|-migrate\|secrets-prod\b' --exclude-dir=node_modules
    --exclude-dir=tasks apps/cms-api .github` finds only intentional historical mentions in the
    techstack doc.
  - Files: `docs/rules/k8s-secrets.md`, `docs/ENTRYPOINT.md`, `docs/documents/dockerfile.md`,
    the memory file
  - Deps: Tasks 7–8 · Size: S

- [x] **Task 10 (follow-up request): Secret/ConfigMap YAML templates**. Done:
  - `k8s/secret.example.yaml` and `k8s/configmap.example.yaml` are full manifests with
    `<placeholders>`, and they replace `k8s/.env.example` and `k8s/config.env.example` (removed, at
    your choice). The filled copies `k8s/secret.yaml` and `k8s/configmap.yaml` are gitignored.
  - In the Secret, required and defaulted keys are active and optional keys are commented out.
    `env.validation.ts` rejects `""` (e.g. `RATE_LIMIT_FPS: ""` → `0` → `@Min(1)`), so an empty
    optional key would stop the app booting.
  - Apply commands use `kubectl apply --server-side`, which avoids a plaintext
    `last-applied-configuration` copy of the Secret.
  - Updated the rule, `ENTRYPOINT.md`, the deployment doc, the entry-Kustomization comment and
    memory. `check-yaml-templates.py` passes 21/21, and all 6 checks are green.
  - `SPEC.md` still describes the env-file flow and is reduced at cleanup.

- [x] **Task 11 (follow-up request): GHCR storage**. You asked for `latest` to save storage. Kept
  the unique tags instead, because re-pushing `latest` leaves every old image as an untagged version
  and breaks Flux image automation. GitHub's billing docs also say public packages are free.
  - Added opt-in cleanup to `cms-api-ghcr-publish` using `actions/delete-package-versions@v5`: keep
    10 versions (5 releases), package and owner derived from `CMS_API_IMAGE_REPO`, gated by
    `vars.CMS_API_GHCR_CLEANUP == 'true'`. The first run deletes the pre-Flux `latest` images, and
    `ignore-versions` can't protect tags because it matches digests (checked in the action source).
  - `check-ci.py` passes, including a test of the package-name derivation.
  - Updated the deployment doc and the techstack table.

### Checkpoint: Complete
- [x] Every SPEC Success Criterion is ticked.
- [ ] Five-axis review (`/review`).
- [ ] Reduce `apps/cms-api/SPEC.md` back to the minimal pointer (workflow step 7).
- [x] Commit (Yes/No confirmation). Phase 4 committed before `/review` at your request; review + SPEC reduction still open.
- [ ] Owner, manual: create the namespace, Secret and ConfigMap, copy `k8s/flux/` to the GitOps
      repo, run the migration, then check that the first master push rolls the Deployment.

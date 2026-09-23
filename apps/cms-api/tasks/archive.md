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

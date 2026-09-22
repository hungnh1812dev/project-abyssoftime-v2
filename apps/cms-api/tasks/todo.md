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

- [ ] **Checkpoint C** — Docs read-through for consistency. Commit.

## Phase 4 — Review & cleanup

- [ ] **T13 — Five-axis review.** Correctness, readability, architecture, security, performance —
  focused on `prisma.service.ts`'s simplification, the Dockerfile's non-root/no-secrets-baked-in
  properties, and whether the `migrator` target's broader `deps`-stage footprint is acceptable for a
  job-only image.
  - Deps: Checkpoint C. Size: M

- [ ] **T14 — Reduce `apps/cms-api/SPEC.md` to a minimal pointer.** Once `dockerfile.md` +
  `dockerfile-techstack.md` fully capture the implementation, strip SPEC.md back down (per this
  project's established convention), pointing to those docs rather than repeating detail.
  - Deps: T13. Size: XS

- [ ] **Checkpoint D** — Final review sign-off. Ask for explicit commit confirmation (exact staged
  files + full commit message) before committing, per `docs/rules/workflow.md`'s commit rules.

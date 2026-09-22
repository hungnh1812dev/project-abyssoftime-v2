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

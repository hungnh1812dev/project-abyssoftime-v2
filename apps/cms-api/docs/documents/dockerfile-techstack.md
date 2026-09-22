# Production Dockerfile — Tech/Pattern/Design Decisions

Comparison tables for the choices made building `apps/cms-api/Dockerfile`, per repo root
`docs/workflow.md`'s "Decision rationale" rule. See [dockerfile.md](./dockerfile.md) for the module's
full implementation writeup, and `SPEC.md` for the full spec (including the postgres-only correction
found during planning).

## Base image: `oven/bun:1-alpine` (chosen) vs. `-slim` vs. full `oven/bun:1`

| Criteria | `oven/bun:1-alpine` (chosen) | `oven/bun:1-slim` | `oven/bun:1` (full, Debian) |
| --- | --- | --- | --- |
| Base image size (measured, this machine) | **124.4MB** | 261.8MB | 328.6MB |
| Existing precedent in this repo | `apps/cms-admin/Dockerfile` already uses it | None | None |
| libc | musl — the only native addon this project ships (`better-sqlite3`, a *library choice*, not used by `PrismaService` after the postgres-only refactor) is not built for Alpine by default, but isn't required at runtime either, so this is a non-issue here | glibc (Debian slim) | glibc (Debian full) |
| Package manager tooling included | None beyond what Bun itself needs | Same | Full Debian tooling (apt, etc.) — irrelevant for a `CMD ["bun", ...]` runtime image |
| **Verdict** | **Chosen** — smallest base, already the repo's convention, and the 500MB budget makes every MB of base image count directly against the target | Rejected — 137MB larger than Alpine for no runtime benefit this project needs | Rejected — largest option, no runtime benefit this project needs |

## `PrismaService` DB support: postgres-only (chosen) vs. keep multi-driver, Docker-scope only

SPEC.md §3.3 originally planned to keep `mysql`/`sqlite` support in the codebase and only exclude the
unused adapter packages from the `runner` image, by converting `PrismaService`'s three static adapter
imports to dynamic `import()` inside each `switch` case.

| Criteria | Dynamic `import()` per branch (original plan) | Postgres-only in source (chosen) |
| --- | --- | --- |
| Technically possible? | **No** — `PrismaService extends PrismaClient`, and `PrismaClient`'s constructor needs the adapter instance synchronously at `super(...)` time. A subclass constructor cannot `await` a `Promise` (what a dynamic `import()` returns) before calling `super()` — there's no way to make only the `mysql`/`sqlite` branches lazy without a much bigger restructuring (e.g. an async NestJS factory provider) | Yes — one static import, no `switch`, no async concern |
| Actual repo state | N/A | `prisma/mysql/schema.prisma` and `prisma/sqlite/schema.prisma` were already non-functional 8-line stub files (generator + datasource only, **zero models** — the real 141-line schema with every model lived only under `prisma/postgresql/`). `docs/documents/media.md` and `docs/documents/content-type.md` already stated in writing that this repo "is Postgres-only." The `mysql`/`sqlite` `DB_DRIVER` branches were therefore already broken in practice (constructing a real adapter against a schema with no models) |
| `package.json` / image impact | Adapter packages stay installed everywhere (dev + a "multi-driver" image variant); `runner` stage needs a manual `rm -rf node_modules/@prisma/adapter-{mariadb,better-sqlite3} node_modules/{mariadb,better-sqlite3}` prune step | `@prisma/adapter-mariadb`/`@prisma/adapter-better-sqlite3` removed from `package.json` entirely — `bun install --production` in `prod-deps` is already clean, no prune step needed |
| Effort | Blocked on the constructor problem above — would need a bigger async-factory-provider redesign just to unblock the *original* plan | Removing three lines' worth of switch branches, dropping `DB_DRIVER`/`SUPPORTED_DB_DRIVERS`/`DbDriver`, deleting two stub files |
| **Verdict** | Rejected — not achievable without a disproportionate redesign for code paths that were already non-functional | **Chosen**, decision made with the user after the constructor blocker surfaced during `/build`; low-risk given the actual repo state above |

## Migrations strategy: separate `migrator` target (chosen) vs. migrate-on-boot in `runner`

| Criteria | Migrate-on-boot (run `prisma migrate deploy` inside `runner`'s `CMD`/entrypoint before starting the app) | Separate `migrator` target (chosen) |
| --- | --- | --- |
| `runner` image size | The `prisma` CLI (42MB) + its own dependencies — `@prisma/studio-core` (42MB), `@prisma/dev` (18MB), `@prisma/engines` (24MB) — would need to stay in the always-on `runner` image just to run migrations once per deploy, directly fighting the 500MB budget this task exists to hit | `prisma`/`@prisma/client` live only in `devDependencies`, excluded from `runner`'s `prod-deps` install entirely — `migrator`'s larger footprint (full `deps` stage + source) is isolated to a target that's never the always-on production image |
| Safety under multiple replicas | A k8s `Deployment` scaling to N replicas means N pods independently racing to run `prisma migrate deploy` against the same database on every rollout — Prisma's migration lock reduces but doesn't eliminate the awkwardness (extra failed/retried attempts, longer rollout, noisy logs) | Runs as a single one-off `Job`/CI step before the `Deployment` rolls out — exactly one execution, no race, ordinary practice for stateful schema changes |
| Existing precedent in this repo | None — `apps/cms-admin` is static (nginx), no migrations | None either way — first time this repo ships a production migration story, but "migration as a separate job, not baked into app boot" is the common pattern in Node/Prisma deployments generally |
| Complexity | Simpler `Dockerfile` (one fewer target), but pushes complexity into `runner`'s entrypoint (wait-for-db, migration-failure handling, retry-vs-crash-loop semantics all now gate app startup) | One extra Dockerfile stage; migration failure/success is a distinct, independently observable step (`docker build --target migrator` / a k8s `Job`) rather than entangled with app boot |
| **Verdict** | Rejected — the size cost alone contradicts this task's core objective, and coupling migrations to every pod's boot is a worse operational shape | **Chosen** |

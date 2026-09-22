# Spec -

No active spec. See `docs/documents/dockerfile.md` and `docs/documents/dockerfile-techstack.md` for the
completed Production Dockerfile feature — `apps/cms-api` now ships a 5-stage `Dockerfile`
(`deps`/`build`/`prod-deps`/`migrator`/`runner`, `runner` the default target) producing a 438.50MB
production image, backed by a postgres-only refactor of `PrismaService`/`env.validation.ts`/
`scripts/prisma.ts`/`prisma.config.ts` (multi-driver mysql/sqlite support removed entirely, not just
Docker-scoped) and a `tsc-alias` fix for a pre-existing broken `start:prod`.

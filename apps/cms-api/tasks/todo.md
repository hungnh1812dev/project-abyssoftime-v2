# Todo — Refresh Token Blacklist & Logout

See `tasks/plan.md` for full context, corrections found during planning, and rationale. See
`SPEC.md` for the spec (objective, confirmed assumptions, boundaries, success criteria).

**Plan reviewed and approved 2026-08-12.** Redis miss semantics resolved to the sticky-degraded
cache, env vars to `REDIS_ENABLED` + `REDIS_URL`. One minor open question remains (Redis key
prefix, `tasks/plan.md`) and only affects T9.

## Phase 1 — Foundation (no behavior change yet)

- [x] **T1 — `jti`/`exp` on the refresh payload.** `RefreshTokenPayload` gains `jti?: string` and
  `exp?: number` (both optional, with the same "minted before this field existed" comment
  `rememberMe` already carries). `JwtTokenService.signRefreshToken` generates the jti internally via
  `randomUUID()` from `node:crypto` and still returns just the token string (plan Correction 4).
  - Acceptance: every signed refresh token decodes to a payload with a unique UUID `jti`; two
    consecutive calls produce different jtis; `signAccessToken` is untouched.
  - Verify: `bun run test` — extend `jwt-token.service.spec.ts` with a jti-uniqueness case.
  - Files: `src/common/types/jwt-payload.ts`, `src/common/token/jwt-token.service.ts`,
    `src/common/token/jwt-token.service.spec.ts`
  - Deps: none. Size: S

- [x] **T2 — `RefreshTokenBlacklist` Prisma model + migration.** Postgres only — the mysql/sqlite
  schemas are empty stubs (plan Correction 1). Columns: `jti String @id`, `userId String? @map("user_id")`,
  `expiresAt DateTime @map("expires_at")`, `reason String`, `createdAt DateTime @default(now()) @map("created_at")`;
  `@@index([expiresAt])`, `@@map("refresh_token_blacklist")`.
  - Acceptance: `bun run prisma:generate` emits `prisma.refreshTokenBlacklist`; a new timestamped
    migration exists under `prisma/postgresql/migrations/*_add_refresh_token_blacklist/`.
  - Verify: `bun run prisma:generate && bun run prisma:migrate && bun run build`.
  - Files: `prisma/postgresql/schema.prisma`, `prisma/postgresql/migrations/<ts>_add_refresh_token_blacklist/migration.sql`
  - Deps: none (parallel with T1). Size: S

- [x] **T3 — Blacklist ports + Postgres-backed store.** `ITokenBlacklistStore` /
  `ITokenBlacklistCache` / `BlacklistEntry` and the `TOKEN_BLACKLIST_STORE` / `TOKEN_BLACKLIST_CACHE`
  `Symbol` DI tokens (plan Correction 3); `PrismaTokenBlacklistStore` implementing the store —
  `blacklist()` upserts (idempotent: re-blacklisting the same jti must not throw on the PK),
  `isBlacklisted()` finds by jti filtered on `expiresAt > now()`.
  - Acceptance: store writes and reads a jti; an expired row reads back as not blacklisted;
    blacklisting the same jti twice resolves without error.
  - Verify: `bun run test` — new `prisma-token-blacklist.store.spec.ts` mocking `PrismaService`
    (no `coverageThreshold` entry, per `docs/rules/workflow.md`).
  - Files: `src/common/token-blacklist/token-blacklist.port.ts`,
    `src/common/token-blacklist/prisma-token-blacklist.store.ts`,
    `src/common/token-blacklist/prisma-token-blacklist.store.spec.ts`
  - Deps: T2. Size: S

- [x] **T4 — `TokenBlacklistService` + `@Global()` module.** The service injects the store (always)
  and an optional cache (`null` for now — Phase 4 fills it in): `blacklist()` writes the store then
  mirrors to the cache if present; `isBlacklisted()` asks the cache first and falls through to the
  store on `null`. `TokenBlacklistModule` is `@Global()` like `TokenModule`, binds
  `TOKEN_BLACKLIST_STORE → PrismaTokenBlacklistStore` and `TOKEN_BLACKLIST_CACHE → null`, exports
  the service; registered in `AppModule` next to `TokenModule`.
  - Acceptance: service resolves through DI at boot; with a null cache every read hits the store;
    with a stub cache returning `null` the read still falls through to the store.
  - Verify: `bun run test` (new `token-blacklist.service.spec.ts`) + `bun run build`.
  - Files: `src/common/token-blacklist/token-blacklist.service.ts`,
    `src/common/token-blacklist/token-blacklist.service.spec.ts`,
    `src/common/token-blacklist/token-blacklist.module.ts`, `src/app.module.ts`
  - Deps: T3. Size: S

- [x] **Checkpoint A** — `bun run build && bun run lint && bun run test:cov` green. Nothing calls the
  blacklist yet, so **every existing test must pass unmodified** — any change to an existing
  assertion here means T1 leaked a behavior change. Commit (this checklist's ticks go in the same
  commit as the phase's code).

## Phase 2 — Logout actually revokes (first vertical slice)

- [x] **T5 — `JwtRefreshStrategy.validate()` rejects blacklisted jtis.** Inject
  `TokenBlacklistService`; `validate()` becomes async — when `payload.jti` is present and
  blacklisted, throw `UnauthorizedException`; when the jti is absent (pre-migration token), skip the
  check and pass through as today.
  - Acceptance: blacklisted jti → `401 "Invalid or expired refresh token"` (the existing generic
    message via `JwtRefreshGuard.handleRequest`, no new wording); non-blacklisted jti → unchanged;
    missing jti → unchanged, no store call.
  - Verify: `bun run test` — extend `jwt-refresh.strategy.spec.ts` with all three cases; the
    extractor cases must still pass untouched.
  - Files: `src/common/strategies/jwt-refresh.strategy.ts`,
    `src/common/strategies/jwt-refresh.strategy.spec.ts`
  - Deps: T4. Size: S

- [x] **T6 — `LogoutService` + controller/module wiring.** New
  `application/services/logout.service.ts` (plan Correction 7): takes the raw cookie value, and when
  it verifies, blacklists `{ jti, userId: sub, expiresAt: new Date(exp * 1000), reason: "logout" }`;
  any verification failure is swallowed so logout stays a public, always-`200`, idempotent route
  (SPEC.md assumption 5). Controller reads the cookie off `@Req()`, awaits the service, then clears
  the cookie exactly as today.
  - Acceptance: valid cookie → blacklist written, `200`; missing/garbage/expired cookie → `200`,
    no write, no throw; the `Set-Cookie` clearing behavior is byte-identical to today.
  - Verify: `bun run test` — new `logout.service.spec.ts` + extended `auth.controller.spec.ts`.
  - Files: `src/modules/auth/application/services/logout.service.ts`,
    `src/modules/auth/application/services/logout.service.spec.ts`,
    `src/modules/auth/presentation/auth.controller.ts`,
    `src/modules/auth/presentation/auth.controller.spec.ts`,
    `src/modules/auth/auth.module.ts`
  - Deps: T5. Size: M

- [x] **Checkpoint B** — `bun run build && bun run lint && bun run test:cov` green. New
  `test/refresh-token-blacklist.e2e-spec.ts`: login → logout → `/auth/refresh` with that cookie =
  `401`; login → `/auth/refresh` **without** logging out = `200` (regression guard). `bun run test:e2e`
  green; created rows cleaned up in `afterAll`. Manual: confirm one `refresh_token_blacklist` row
  with `reason = 'logout'` and the right `expires_at`. Commit.

## Phase 3 — Rotation makes refresh tokens single-use

- [x] **T7 — `RefreshTokenService` blacklists the jti it just consumed.** `execute()` takes the
  verified payload's `jti`/`exp` alongside `sub`/`rememberMe`; after the user/role lookups and token
  signing succeed, writes `{ jti, userId: sub, expiresAt, reason: "rotation" }` as the **last** step
  before returning (plan's fail-safe ordering). Skip the write when the old token carried no `jti`.
  Controller passes the new fields through from `req.user`.
  - Acceptance: a successful refresh blacklists the old jti; a failed refresh (unknown user, no
    role) blacklists nothing; a pre-migration token without a jti refreshes successfully with no write.
  - Verify: `bun run test` — extend `refresh-token.service.spec.ts` and `auth.controller.spec.ts`.
  - Files: `src/modules/auth/application/services/refresh-token.service.ts`,
    `src/modules/auth/application/services/refresh-token.service.spec.ts`,
    `src/modules/auth/presentation/auth.controller.ts`,
    `src/modules/auth/presentation/auth.controller.spec.ts`
  - Deps: T6. Size: S

- [x] **Checkpoint C** — full suite + `bun run test:e2e` green, with a new e2e case: `/auth/refresh`
  twice with the *same* cookie → second call `401`; the rotated-to token still works. **Manual
  `cms-admin` walkthrough** (the "admin" half of this feature — no code changes there, plan
  Correction 6): log in, click logout, confirm the old session cannot refresh; then log in again and
  confirm normal navigation still refreshes cleanly across the 15-minute access-token boundary
  (this is the regression that would bite real users hardest). Commit.

## Phase 4 — Optional Redis cache

- [x] **T8 — Env vars + `ioredis` + lazy client provider.** Add `REDIS_ENABLED`
  (bool, default `false`) and `REDIS_URL` (string, default `""`) to `EnvironmentVariables` and
  `.env.example`; add `ioredis` to `dependencies` (SPEC.md assumption 6). `redis-client.provider.ts`
  is a `useFactory` that returns `null` when the flag is off — **the client is never constructed**,
  so nothing connects.
  - Acceptance: app boots with the flag off and makes zero Redis connection attempts; with the flag
    on and a valid `REDIS_URL`, a client is created; validation rejects the flag being on with an
    empty `REDIS_URL`.
  - Verify: `bun run test` + `bun run build`; boot locally with the flag off and confirm no Redis
    traffic (`redis-cli monitor`, or simply no connection error with no Redis running).
  - Files: `src/config/env.validation.ts`, `.env.example`, `package.json`,
    `src/common/token-blacklist/redis-client.provider.ts`
  - Deps: T4 (independent of T5–T7). Size: S

- [ ] **T9 — `RedisTokenBlacklistCache` + service composition.** Implements `ITokenBlacklistCache`
  with the sticky-degraded behavior from plan Correction 2: `blacklist()` does
  `SET refresh-blacklist:<jti> <reason> PX <ms-until-exp>`; `isBlacklisted()` returns `true`/`false`
  while healthy and `null` once degraded; **any** Redis error (read or write) logs and permanently
  flips `trusted = false` for the process. Bind it into `TokenBlacklistModule` in place of the `null`
  cache when the client exists.
  - Acceptance: healthy hit → `true`; healthy miss → `false`; after any thrown Redis error → every
    subsequent call returns `null` (so `TokenBlacklistService` falls through to Postgres) and no
    further Redis calls are attempted; TTL is derived from `expiresAt`, never a fixed constant.
  - Verify: `bun run test` — new `redis-token-blacklist.cache.spec.ts` with a mocked ioredis client
    (no real Redis in unit tests); extend `token-blacklist.service.spec.ts` for the cache-present paths.
  - Files: `src/common/token-blacklist/redis-token-blacklist.cache.ts`,
    `src/common/token-blacklist/redis-token-blacklist.cache.spec.ts`,
    `src/common/token-blacklist/token-blacklist.module.ts`,
    `src/common/token-blacklist/token-blacklist.service.spec.ts`
  - Deps: T8. Size: M

- [ ] **Checkpoint D** — Flag **off** (the default): `build`/`lint`/`test:cov`/`test:e2e` all green
  and zero Redis connection attempts at boot. Flag **on** against a local Redis: Checkpoint B and C
  scenarios pass again by hand, and the blacklist key is visible in Redis with a sane TTL. Then kill
  Redis mid-session and confirm `/auth/refresh` and `/auth/logout` keep working against Postgres
  instead of erroring. Commit.

## Phase 5 — Docs, review, cleanup (`docs/rules/workflow.md` steps 4–8)

- [ ] **T10 — New module docs.** `docs/documents/token-blacklist.md` (ports, the two stores, the
  service's compose logic, env flags, the sticky-degraded rule and *why*, known gaps: no expired-row
  sweep, pre-migration tokens unrevokable, access tokens still valid to their 15-minute expiry) and
  `docs/documents/token-blacklist-techstack.md` (plan Correction 2's options table + an
  ioredis-vs-alternatives table, per the decision-rationale rule).
  - Verify: both files exist and are linked from `docs/ENTRYPOINT.md`.
  - Files: `docs/documents/token-blacklist.md`, `docs/documents/token-blacklist-techstack.md`,
    `docs/ENTRYPOINT.md`
  - Deps: T9. Size: S

- [ ] **T11 — Update existing docs + stale-wording sweep.** Rewrite `docs/documents/auth.md`'s
  "No server-side token revocation" known gap, its logout/refresh endpoint rows, and the
  `JwtRefreshStrategy`/`RefreshTokenPayload` descriptions. Then **grep the whole repo** for
  `no server-side token revocation`, `stateless`, `remains valid until`, and `logout` and fix every
  stale claim — a fixed file list is exactly what went wrong in the JWT Bearer migration closeout.
  Update `docs/api-reference.md` and `docs/cms-admin-integration.md` if the logout/refresh contract
  description changes, and the Swagger `@ApiOperation`/`@ApiResponse` text on the two touched routes.
  - Verify: `grep -ri "no server-side token revocation" .` returns nothing outside the changelog.
  - Files: `docs/documents/auth.md`, `docs/api-reference.md`, `docs/cms-admin-integration.md`,
    `docs/documents/swagger.md`, `src/modules/auth/presentation/auth.controller.ts` (Swagger text)
  - Deps: T10. Size: M

- [ ] **T12 — Five-axis review** (correctness, readability, architecture, security, performance) via
  `agent-skills:code-reviewer`. Security axis must explicitly cover: the blacklist check cannot be
  bypassed by omitting `jti`; no raw token or JWT is ever logged; the degraded-cache path cannot
  accept a revoked token; error messages leak nothing about *why* a refresh failed.
  - Verify: findings triaged; anything Critical/Important fixed and re-verified.
  - Deps: T11. Size: S

- [ ] **T13 — Cleanup.** Reduce `SPEC.md` back to a pointer at `docs/documents/token-blacklist.md`
  and `auth.md`, per `docs/rules/workflow.md`'s root-docs rule.
  - Files: `SPEC.md`
  - Deps: T12. Size: XS

- [ ] **Checkpoint E (final)** — Re-verify every success criterion in `SPEC.md` against the shipped
  code, not against this checklist. `bun run build && bun run lint && bun run test:cov && bun run test:e2e`
  green. Commit.

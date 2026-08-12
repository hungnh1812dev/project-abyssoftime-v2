# Spec: Refresh Token Blacklist & Logout

## Assumptions

Confirmed with the user (2026-08-12):

1. **Store relationship** — DB (Prisma) is always the source of truth for every blacklist write. Redis is an optional accelerator: when enabled via env flag, writes also mirror to Redis (TTL = token's remaining lifetime) and reads check Redis first. A Redis **miss** is treated as "not blacklisted" **only while the cache is healthy** — see `tasks/plan.md` Correction 2: planning found that a failed mirror write would otherwise leave a revoked token accepted forever. Resolved with a sticky-degraded cache: any Redis error (read *or* write) permanently untrusts the cache for that process, after which every check falls through to the DB.
2. **Token identity** — a new `jti` (UUID, `node:crypto.randomUUID()`) claim is added to the refresh token payload at sign time. Blacklist rows/keys are keyed by `jti`, not the raw token. Refresh tokens issued before this ships have no `jti` and simply can't be blacklisted — they age out naturally within their existing 7d/30d TTL.
3. **Rotation = single-use refresh tokens** — every `POST /auth/refresh` blacklists the token it just consumed (reason `rotation`), in addition to `POST /auth/logout` blacklisting the current one (reason `logout`). A stolen-and-already-used refresh token is rejected on reuse with the existing generic `401 "Invalid or expired refresh token"` message (no detail leaked about *why* it failed).
4. **Admin scope** — no new `cms-admin` UI. `AuthContext.logout()` already calls `POST /auth/logout`; this spec only makes that call actually revoke server-side state. No "view/revoke other users' sessions" admin capability is being built.
5. **`logout` stays public, no guard added.** Today `POST /auth/logout` has no guard and always returns `200`, even with no cookie present (idempotent). The handler will `try { verifyRefreshToken(cookie) } catch { /* ignore */ }` and only blacklist when verification succeeds, preserving today's "always succeeds" UX.
6. **`ioredis` is a hard `dependencies` entry**, not `optionalDependencies` — always installed, inert when `REDIS_ENABLED=false`.
7. **`RefreshTokenBlacklist` gets a nullable `userId` column** even though nothing queries by it in this spec — groundwork for a future "logout everywhere"/admin-revoke feature, costs nothing since `sub` is already available at every call site.

Additional implementation decisions made while drafting this spec (not yet confirmed — flag if wrong):

8. **New shared primitive lives in `src/common/token-blacklist/`**, not `src/modules/*`. It's infrastructure consumed by `JwtRefreshStrategy`/`RefreshTokenService`/the logout handler — same category as the existing `common/token/` (`JwtTokenService`) — not a CRUD-exposed business module.
9. **Prisma model deviates from the `documentId`-as-`@id` convention** used by `Permission`/`Role`/`User`/etc. `RefreshTokenBlacklist` isn't a client-facing CRUD resource; `jti` (already a UUID) serves as its natural primary key, so there's no separate `documentId`/`updatedAt`/`updatedBy`.
10. **No cleanup job for expired blacklist rows in this iteration.** Queries always filter `expiresAt > now()`, so expired rows are functionally ignored; the table grows unbounded until a future scheduled sweep is built. Flagged as a known gap, not blocking.
11. **Redis client: `ioredis`**, connected via a single `REDIS_URL` env var (not discrete host/port/password) — matches how most Redis hosting (Upstash, Render Redis) hands out connection strings. See `docs/documents/token-blacklist-techstack.md` (to be written during Build) for the full ioredis-vs-alternatives comparison table required by this repo's decision-rationale rule.
12. **Access tokens are untouched.** They stay stateless/DB-free by design (`JwtAuthGuard` never hits the DB) — blacklisting only ever applies to refresh tokens. A leaked *access* token remains valid until its 15-minute natural expiry regardless of logout; this is the existing accepted tradeoff, unchanged.

## Objective

Today, refresh tokens are stateless JWTs with no server-side record (`docs/documents/auth.md`'s "No server-side token revocation" known gap) — `POST /auth/logout` only clears the client's cookie; the token itself remains valid until it naturally expires or is rotated out (and even then, the rotated-out token stays valid too). This spec closes that gap:

1. Persist refresh-token revocations in the DB (`jti` + expiry + reason), so there's a durable blacklist to check against.
2. Make `/auth/refresh` actually **check** that blacklist (not just verify the JWT signature), via a store that can run against Redis (fast path, optional) and/or the DB (always-on, authoritative), switchable per environment.
3. Wire real revocation into both the rotation flow (old token blacklisted every time a new one is issued — single-use refresh tokens) and the logout flow (current token blacklisted on explicit logout).

**Users:** every authenticated end-user/admin session in `cms-api`, consumed transparently by `cms-admin` (no admin-side code changes — see Assumption 4).

**Success looks like:** a refresh token that has been logged out, or already rotated past, is rejected by `/auth/refresh` with `401`, while a still-valid, not-yet-used refresh token continues to work exactly as today.

## Tech Stack

- NestJS 11 / `@nestjs/passport` + `passport-jwt` (existing) — no strategy-shape change beyond a new `jti`/`exp` field on the decoded payload.
- Prisma 7 — new model added to `prisma/postgresql/schema.prisma` only; the `prisma/mysql` and `prisma/sqlite` schemas are empty stubs carrying no models (see `tasks/plan.md` Correction 1).
- **New dependency:** `ioredis` (only used when `REDIS_ENABLED=true`; the DB-only path needs no new package).
- `node:crypto.randomUUID()` for `jti` generation — no new `uuid` package (matches existing precedent: `randomInt`/`randomBytes` used elsewhere in `auth` for OTP/reset tokens).

## Commands

```
Build:        bun run build
Test:         bun run test
Test (cov):   bun run test:cov
Test (e2e):   bun run test:e2e
Lint:         bun run lint          # never `bunx eslint .` directly — see docs/rules/workflow.md
Dev:          bun run start:dev
Prisma gen:   bun run prisma:generate
Prisma migrate (dev): bun run prisma:migrate
```

## Project Structure

```
apps/cms-api/
  prisma/{postgresql,mysql,sqlite}/schema.prisma   → add `RefreshTokenBlacklist` model to all 3
  src/common/token/
    jwt-token.service.ts                           → signRefreshToken generates + returns `jti`; RefreshTokenPayload gains `jti`
  src/common/token-blacklist/                       → NEW shared primitive module (see Assumption 6)
    token-blacklist.port.ts                         → ITokenBlacklistStore interface + DI token
    prisma-token-blacklist.store.ts                 → DB-backed implementation (always active)
    redis-token-blacklist.store.ts                  → Redis-backed cache implementation (conditional)
    redis-client.provider.ts                        → lazy ioredis client factory, only connects when enabled
    token-blacklist.service.ts                      → the injected service: DB-always-write + optional-Redis-mirror/read-first logic
    token-blacklist.module.ts                       → @Global(), like TokenModule
  src/common/strategies/jwt-refresh.strategy.ts     → validate() also checks TokenBlacklistService.isBlacklisted(payload.jti)
  src/common/types/jwt-payload.ts                   → RefreshTokenPayload gains `jti: string`
  src/modules/auth/application/services/
    refresh-token.service.ts                        → blacklist old jti (reason "rotation") before minting the new pair
  src/modules/auth/presentation/auth.controller.ts  → logout handler decodes+blacklists (reason "logout") when a valid cookie is present
  src/config/env.validation.ts                       → new env vars (see Boundaries/env below)
  docs/documents/token-blacklist.md                  → NEW module doc (per workflow.md step 5)
  docs/documents/token-blacklist-techstack.md         → NEW decision-rationale table (ioredis vs alternatives)
  docs/documents/auth.md                              → updated: logout/refresh sections, "Known gaps" entry removed/rewritten
```

## Code Style

Follow existing repo conventions exactly (see `apps/cms-api/src/modules/access-tokens/*` as the closest precedent for a token-shaped entity/repository):

```ts
// src/common/token-blacklist/token-blacklist.port.ts
export interface ITokenBlacklistStore {
  blacklist(entry: { jti: string; userId: string | null; expiresAt: Date; reason: "logout" | "rotation" }): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean>;
}
export const TOKEN_BLACKLIST_STORE = Symbol("TOKEN_BLACKLIST_STORE");
```

- DI tokens as `Symbol(...)` constants, matching `USER_REPOSITORY`/`EMAIL_SENDER`/etc.
- Ports named `I<Thing>`, one interface per file under a `*.port.ts`/`domain/repositories/*.repository.ts` suffix, consistent with `IEmailSender`/`IAccessTokenRepository`.
- No comments explaining *what* the code does — only non-obvious *why* (e.g. why a Redis miss is authoritative), matching the terse style already in `jwt-token.service.ts`.

## Testing Strategy

- **Jest unit tests**, mocked repositories/stores — same pattern as every other service in `auth`/`access-tokens` (e.g. `refresh-token.service.spec.ts` already exists and gets extended, not replaced).
- New spec files: `token-blacklist.service.spec.ts` (DB-always-write, Redis-mirror-when-enabled, Redis-miss-vs-Redis-error branches), `prisma-token-blacklist.store.spec.ts`, `redis-token-blacklist.store.spec.ts` (mocked `ioredis` client, no real Redis in unit tests).
- `jwt-refresh.strategy.spec.ts` — extend with a blacklisted-jti → rejection case.
- `refresh-token.service.spec.ts` — extend with "old jti gets blacklisted" assertion.
- `auth.controller.spec.ts` — extend logout tests: valid cookie → blacklist called; missing/invalid cookie → still `200`, blacklist not called.
- No `coverageThreshold` entries for the Prisma-backed store or the controller (per `docs/rules/workflow.md`'s existing exclusion — see [[feedback_coverage_threshold_scope]]).
- e2e: extend `test/` with a login → refresh → refresh-again-with-old-token (expect `401`) round trip, and a login → logout → refresh-with-that-token (expect `401`) round trip, run against the DB-only path (Redis disabled) in CI by default.
- Manual verification (per this module's existing pattern of tracking it explicitly, not skipping it): real DB walkthrough of both rotation-reuse-rejected and logout-then-refresh-rejected, with `REDIS_ENABLED=true` against a local Redis at least once.

## Boundaries

- **Always do:** run `bun run test:cov`/`bun run build`/`bun run lint` before considering any task done; keep access-token behavior completely untouched. (An earlier draft of this spec required adding the model to all 3 Prisma schemas — planning found the mysql/sqlite schemas are empty stubs holding no models at all, so the model goes in `prisma/postgresql/schema.prisma` only. See `tasks/plan.md` Correction 1.)
- **Ask first:** the exact new env var names/defaults (proposed below — confirm before implementing); whether to add `ioredis` as a `dependencies` vs `optionalDependencies` entry; any change to the generic `401` error messages.
- **Never do:** log a raw refresh token or full JWT anywhere (jti/reason only); make `/auth/refresh` or `/auth/logout` hit Redis synchronously in a way that hard-fails the request when `REDIS_ENABLED=false` (Redis code path must be fully inert when disabled — no connection attempts, no import-time side effects).

### New env vars (`src/config/env.validation.ts`) — confirmed 2026-08-12

```
REDIS_ENABLED = false   // boolean, default false
REDIS_URL = ""          // required only when the above is true
```

## Success Criteria

- [ ] `RefreshTokenBlacklist` model exists in `prisma/postgresql/schema.prisma`, migrated.
- [ ] Logging in, then calling `/auth/refresh` twice with the **same** (first) refresh token cookie → second call returns `401`.
- [ ] Logging in, then `/auth/logout`, then `/auth/refresh` with the (now logged-out) cookie → `401`.
- [ ] A legitimate, not-yet-used, not-logged-out refresh token still succeeds at `/auth/refresh` exactly as today.
- [ ] With `REDIS_ENABLED=false` (default), the app boots and all of the above pass with zero Redis connection attempts.
- [ ] With `REDIS_ENABLED=true` and a real `REDIS_URL`, the same scenarios pass, and killing Redis mid-session causes checks to fall back to DB rather than hard-failing.
- [ ] `cms-admin`'s existing logout button, unmodified, now actually invalidates the session server-side (verified by hitting `/auth/refresh` with the old cookie afterward and getting `401`).
- [ ] `bun run test:cov`, `bun run build`, `bun run lint`, `bun run test:e2e` all clean.
- [ ] `docs/documents/auth.md`, `docs/documents/token-blacklist.md`, `docs/documents/token-blacklist-techstack.md`, `docs/api-reference.md` (if response/error shapes change), `docs/cms-admin-integration.md` (if relevant) all updated — grep the whole repo for stale "no server-side token revocation" wording before calling docs done (see [[project_jwt_bearer_token_migration]]'s lesson: a task's file list doesn't reliably scope every doc mentioning the old behavior).

## Open Questions

All spec-level questions resolved as of 2026-08-12 (env vars confirmed as `REDIS_ENABLED` + `REDIS_URL`; Redis cache-miss semantics resolved to the sticky-degraded design). One implementation-level question remains in `tasks/plan.md` — the Redis key prefix — and only affects Phase 4.

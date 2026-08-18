# Token Blacklist Module

`src/common/token-blacklist/**` — shared primitive (not a `src/modules/*` feature module) that
gives refresh tokens server-side revocation. Registered as a `@Global()` `TokenBlacklistModule` in
`AppModule` next to `TokenModule`, so `JwtRefreshStrategy` (`common/strategies/`) and the `auth`
module's services can inject `TokenBlacklistService` with no explicit import and no cycle. Closes
the "no server-side token revocation" gap recorded in [auth.md](./auth.md).

## Why a `jti`

Refresh tokens carried only `{ sub, rememberMe }` — no unique identifier, so there was nothing to
revoke *by*. `common/token/jwt-token.service.ts`'s `signRefreshToken` now generates a `jti`
internally via `randomUUID()` (`node:crypto`) and merges it into the signed payload; it still
returns just the token string — no caller needs the *new* token's jti, since logout/rotation both
blacklist the *old* jti, which arrives already decoded on `req.user`. `RefreshTokenPayload`
(`common/types/jwt-payload.ts`) declares `jti?: string` and `exp?: number` as **optional**, same
precedent as the existing `rememberMe?: boolean`: a token minted before this shipped carries
neither, and every reader treats their absence as "cannot be blacklisted" rather than crashing.
`exp` is the standard JWT claim (Unix seconds) `passport-jwt`/`jsonwebtoken` merge onto the decoded
payload at verify time — `expiresAt = new Date(payload.exp * 1000)` is exact, no `rememberMe`
7d/30d re-derivation needed.

## Two ports, not one

The authoritative store and the optional cache have genuinely different contracts — the store
always answers definitively, the cache may not know (see
[token-blacklist-techstack.md](./token-blacklist-techstack.md) for why). `token-blacklist.port.ts`:

```ts
export interface BlacklistEntry {
  jti: string;
  userId: string | null;
  expiresAt: Date;
  reason: "logout" | "rotation";
}

export interface ITokenBlacklistStore {   // Postgres — authoritative, always present
  blacklist(entry: BlacklistEntry): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean>;
}
export const TOKEN_BLACKLIST_STORE = Symbol("TOKEN_BLACKLIST_STORE");

export interface ITokenBlacklistCache {   // Redis — optional, may be unavailable/degraded
  blacklist(entry: BlacklistEntry): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean | null>;   // null = "don't know, ask the store"
}
export const TOKEN_BLACKLIST_CACHE = Symbol("TOKEN_BLACKLIST_CACHE");
```

## The two stores

- **`PrismaTokenBlacklistStore`** (`prisma-token-blacklist.store.ts`) — the always-present,
  authoritative implementation of `ITokenBlacklistStore`. `blacklist()` upserts on `jti` (the
  primary key), so re-blacklisting the same jti twice never throws on the PK. `isBlacklisted()`
  finds by `jti` and returns `true` only if the row exists **and** `expiresAt` is still in the
  future — an expired row reads back as not blacklisted rather than needing a separate sweep to
  "become" unblacklisted.
- **`RedisTokenBlacklistCache`** (`redis-token-blacklist.cache.ts`) — optional fast path, only
  constructed when `REDIS_ENABLED=true` and a client exists (see [Redis wiring](#redis-wiring-phase-4)
  below). Implements the **sticky-degraded** behavior chosen in
  [token-blacklist-techstack.md](./token-blacklist-techstack.md): `blacklist()` does
  `SET refresh-blacklist:<jti> <reason> PX <ms-until-exp>` (TTL always derived from
  `entry.expiresAt`, never a fixed constant — a zero-or-negative TTL is skipped rather than sent to
  Redis). `isBlacklisted()` returns `true`/`false` while healthy. **Any** Redis error, on a read or
  a write, permanently flips an in-process `trusted` flag to `false` (logged via `Logger.error`,
  never the raw token/JTI beyond what's already logged) — every call after that returns `null`
  without touching Redis again, so `TokenBlacklistService` falls through to Postgres for the rest of
  the process's life. It does not re-arm itself; only a process restart clears it.

## `TokenBlacklistService`

`token-blacklist.service.ts` — the only thing `JwtRefreshStrategy`/`LogoutService`/
`RefreshTokenService` talk to. Composes the two ports:

- `blacklist(entry)` — always writes to the store first, then mirrors to the cache **if one is
  bound** (`null` when Redis is disabled). Used by `LogoutService`, where idempotent upsert semantics
  are correct (logout has nothing to race against).
- `tryClaim(entry)` — atomic version used by `RefreshTokenService` to close a TOCTOU race (see
  [Concurrency: atomic claim vs. check-then-write](#concurrency-atomic-claim-vs-check-then-write)
  below). Delegates to `store.tryClaim(entry)` (a Postgres unique-constraint `INSERT`, not an
  upsert); mirrors to the cache **only when the claim wins** (`true`) — a losing claim has nothing
  new to mirror, the winner's write already covers that jti. Returns the store's boolean verbatim.
- `isBlacklisted(jti)` — asks the cache first (when bound); a `null` result (cache absent, or
  degraded) falls through to the store. A `true`/`false` cache result is returned as-is, no store
  call.

`TokenBlacklistModule` (`token-blacklist.module.ts`) is `@Global()`, binds
`TOKEN_BLACKLIST_STORE → PrismaTokenBlacklistStore` unconditionally and
`TOKEN_BLACKLIST_CACHE → RedisTokenBlacklistCache | null` via a `useFactory` reading the Redis
client provider — `null` when the client doesn't exist, so `TokenBlacklistService`'s constructor
always receives a real store and an optionally-`null` cache. Registered in `AppModule` next to
`TokenModule`.

## Callers

- **`JwtRefreshStrategy.validate()`** (`common/strategies/jwt-refresh.strategy.ts`) — when
  `payload.jti` is present, awaits `tokenBlacklistService.isBlacklisted(jti)`; a blacklisted jti
  throws a bare `UnauthorizedException()`, which `JwtRefreshGuard.handleRequest` turns into the
  existing generic `401 "Invalid or expired refresh token"` — a blacklisted token is
  indistinguishable from an invalid one, by design (see [Security notes](#security-notes)). When
  `jti` is absent (a pre-migration token), the check is skipped entirely — no store/cache call — and
  the token validates exactly as it did before this feature shipped.
- **`LogoutService`** (`modules/auth/application/services/logout.service.ts`) — the first service
  logout ever had (previously inline `res.clearCookie()` in the controller, per `auth.md`'s
  "no service" note). `execute(refreshToken: string | undefined)` verifies the cookie value via
  `JwtTokenService.verifyRefreshToken`; any failure (missing, garbage, expired) is swallowed and the
  method returns — logout stays a public, always-`200`, idempotent route. On success, and only when
  the decoded payload carries both `jti` and `exp`, blacklists
  `{ jti, userId: sub, expiresAt: new Date(exp * 1000), reason: "logout" }` — wrapped in its own
  try/catch (`Logger.error` on failure, error/stack only, never the token) so a transient DB error on
  the write doesn't turn this into a `500`: the client still gets a normal `200` and its cookie still
  gets cleared, and the token simply stays valid until it naturally expires, same as it would have
  before this feature existed. The controller clears the `refresh_token` cookie unconditionally
  afterward regardless of whether the write succeeded — byte-identical `Set-Cookie` behavior to
  before this feature.
- **`RefreshTokenService.execute()`** (`modules/auth/application/services/refresh-token.service.ts`)
  — takes the verified payload's `jti`/`exp` as optional trailing parameters (from `req.user`, set
  by `JwtRefreshStrategy`). After the user/role lookups resolve, and only if the old token carried
  both `jti` and `exp`, **atomically claims** it via `tokenBlacklistService.tryClaim({ jti, userId:
  sub, expiresAt: new Date(exp * 1000), reason: "rotation" })` — **before** signing the new
  access/refresh pair. Losing the claim (the jti was already claimed by a concurrently-racing refresh
  of the same cookie, or already logged out) throws the same generic `401` immediately, before any
  new tokens are minted. See
  [Concurrency: atomic claim vs. check-then-write](#concurrency-atomic-claim-vs-check-then-write)
  for why this has to be atomic and can't be a plain check-then-write. Pre-migration tokens (no
  `jti`/`exp`) skip the claim entirely and go straight to signing, as before.

## Concurrency: atomic claim vs. check-then-write

Found during the five-axis review, not the original plan: a naive "check `isBlacklisted()`, then
`blacklist()` if not" pair inside `RefreshTokenService.execute()` is not atomic. Two concurrent
`/auth/refresh` requests replaying the same not-yet-consumed cookie can both pass the "not
blacklisted yet" check before either write lands, and both mint a valid new access/refresh pair —
silently defeating "rotation makes refresh tokens single-use," the exact guarantee Phase 3 exists to
provide. This isn't theoretical: reverting `tryClaim()` back to a plain check-then-write locally and
firing two concurrent `/auth/refresh` calls at the same cookie via `Promise.all` reproduced a
double-`200` roughly 1 in 5 runs against real Postgres.

`tryClaim()` closes it with a database-enforced primitive instead of an application-level lock: an
`INSERT` (`prisma.refreshTokenBlacklist.create`, not `upsert`) against `jti`'s `@id` unique
constraint. The first concurrent caller's `INSERT` succeeds; every other caller's `INSERT` on the
same jti hits the constraint and Prisma surfaces it as `P2002`, which `PrismaTokenBlacklistStore`
translates to `tryClaim()` returning `false` rather than throwing. `RefreshTokenService` calls this
**before** signing new tokens, so a losing claim never mints a pair — closing the race requires no
row locking, `SELECT ... FOR UPDATE`, or serializable transaction, just Postgres's own constraint
enforcement, which is atomic by construction regardless of how many concurrent connections race it.

This does shift *when* the write happens relative to signing — no longer strictly "last," now
"right after the user/role lookups resolve, before signing" — which narrows but doesn't eliminate
the original fail-safe reasoning (plan Correction: write last so a failed write can't revoke the old
token without successfully issuing a new one). The remaining window is signing itself
(`JwtTokenService.signAccessToken`/`signRefreshToken`, synchronous in-memory HMAC operations with no
I/O) — realistically not a failure mode, unlike the DB round-trips that precede it.

`LogoutService` keeps the plain `blacklist()` (upsert): logout has no concurrent-replay concern to
close — blacklisting the same jti twice (e.g. a user double-clicking logout, or a race between
logout and a concurrent refresh of the same session) is safe either way. If a racing refresh's
`tryClaim()` wins first, a subsequent logout's `blacklist()` upsert just overwrites `reason` from
`"rotation"` to `"logout"` harmlessly; if logout's upsert lands first, a racing refresh's `tryClaim()`
correctly loses (the row already exists) and is rejected — the token was already logged out.

## Redis wiring (Phase 4)

Entirely optional, default-off performance layer — Phases 1–3 deliver the whole feature on Postgres
alone; see [token-blacklist-techstack.md](./token-blacklist-techstack.md) for why Redis was kept
last and behind a flag.

- **`REDIS_ENABLED`** (bool, default `false`) / **`REDIS_URL`** (string, default `""`) —
  `src/config/env.validation.ts`. `REDIS_URL` is only validated as required (`@ValidateIf` +
  `@IsString @MinLength(1)`) when `REDIS_ENABLED === true`; both are treated as general
  infrastructure config, not blacklist-specific, so a future feature can share the same connection.
- **`redis-client.provider.ts`** — a `useFactory` (`createRedisClient`) returning `null` when the
  flag is off. **No `Redis` instance is ever constructed** in that branch — not "constructed but not
  connected" — so a disabled flag makes zero connection attempts, verified at Checkpoint D. When
  enabled, constructs `new Redis(REDIS_URL, { maxRetriesPerRequest: 1 })` — deliberately not
  ioredis's default retry count (20, with growing backoff): a low retry count is what makes a
  Redis outage fail a command in milliseconds instead of tens of seconds, so the sticky-degraded
  cache gets to flip `trusted = false` and hand off to Postgres promptly instead of leaving
  `/auth/refresh`/`/auth/logout` hanging near a request timeout.
- **`redis-client-lifecycle.ts`** — `RedisClientLifecycle implements OnModuleDestroy`, calls
  `client?.disconnect()` on module teardown. Without it, ioredis's background reconnect socket keeps
  the Node/Bun process alive past `app.close()`, which would hang a graceful shutdown or an e2e
  test's `afterAll`.
- **`TokenBlacklistModule`** binds `TOKEN_BLACKLIST_CACHE` from the client: `null` when the client
  is `null`, a real `RedisTokenBlacklistCache` wrapping the client otherwise.

## Prisma model

`RefreshTokenBlacklist` — **Postgres only** (`prisma/postgresql/schema.prisma`); the `mysql`/
`sqlite` schemas are empty generator/datasource stubs with zero models, unlike every other entity
in this project, so the model isn't duplicated there (see
[token-blacklist-techstack.md](./token-blacklist-techstack.md)).

```prisma
model RefreshTokenBlacklist {
  jti       String   @id
  userId    String?  @map("user_id")
  expiresAt DateTime @map("expires_at")
  reason    String
  createdAt DateTime @default(now()) @map("created_at")

  @@index([expiresAt])
  @@map("refresh_token_blacklist")
}
```

No `documentId`/`updatedAt`/`updatedBy` columns — unlike this project's client-facing CRUD
entities, this table is never read/written by an admin UI, and `jti` (already a UUID) is a natural
primary key. The nullable `userId` column is groundwork for a future "log out everywhere" feature;
nothing in this feature queries by it yet.

The migration (`prisma/postgresql/migrations/<ts>_add_refresh_token_blacklist/migration.sql`)
could not be generated via the usual `bun run prisma:migrate` (`prisma migrate dev`) — the local
dev DB's ~19 content-engine tables (`documents_*`, `components_*`, created at runtime by
schema-as-code sync, see [content-type.md](./content-type.md)) are invisible to Prisma's migration
history and triggered a drift check demanding a full schema reset. Worked around with the standard
non-destructive path: hand-wrote `migration.sql` matching Prisma's own generated format, applied it
via `prisma db execute --file`, then registered it with `prisma migrate resolve --applied`. Any
future migration in this repo against a populated dev DB will hit the same drift warning; same
workaround applies.

## Security notes

- A blacklisted refresh token produces the exact same `401 "Invalid or expired refresh token"` as
  a malformed or expired one — `JwtRefreshGuard.handleRequest`'s existing `if (err || !user)` branch
  already does this once `validate()` throws, so no new error message exists to distinguish "this
  token is bad" from "this token was revoked."
- The blacklist check cannot be bypassed by a client omitting `jti` from a *new* login — `jti` is
  generated server-side inside `signRefreshToken` and never accepted from client input; omitting it
  is only possible for tokens that predate this feature entirely.
- Neither the raw refresh token nor the decoded JWT payload is ever logged anywhere in this
  module — `RedisTokenBlacklistCache`'s error log includes the error/stack only, never the jti or
  token value.
- The degraded-cache path cannot accept a revoked token: a degraded Redis returns `null` (not
  `false`) from `isBlacklisted`, and `TokenBlacklistService` treats `null` as "ask the store" rather
  than "not blacklisted" — Postgres remains authoritative regardless of Redis's health.

## Known gaps

- **No expired-row sweep.** `refresh_token_blacklist` grows unbounded; reads filter on `expiresAt`
  so correctness isn't affected, but nothing ever deletes old rows. A scheduled cleanup job is
  explicitly out of scope for this feature.
- **Pre-migration tokens are unrevokable.** A refresh token signed before this feature shipped
  carries no `jti`, so `JwtRefreshStrategy`/`LogoutService`/`RefreshTokenService` all skip the
  blacklist check/write for it — it stays valid until it naturally expires (up to its original 7d/
  30d TTL). Accepted tradeoff, not a bug: typed as optional specifically so these tokens don't crash
  a reader.
- **Access tokens are still valid to their own 15-minute expiry after logout/rotation.** This
  feature only revokes refresh tokens; an access token already issued to a client keeps working
  until it naturally expires, same as before this feature (see `auth.md`'s access-token design —
  self-contained on purpose, `JwtAuthGuard` never hits the DB).
- **`userId` on `BlacklistEntry`/the Prisma row is write-only for now.** Populated on every write,
  queried by nothing — groundwork for a future "log out everywhere for this user" feature.

## Tests

Unit tests (Jest, no `coverageThreshold` entries — this module's Prisma-backed store follows
repo root `docs/workflow.md`'s rule against gating Prisma files) live next to each source file:
`prisma-token-blacklist.store.spec.ts` (mocked `PrismaService`: write/read round trip, expired row
reads as not-blacklisted, double-blacklist doesn't throw, plus `tryClaim()`: `true` on a successful
`create`, `false` on a mocked `P2002`, rethrows any other error), `token-blacklist.service.spec.ts`
(null cache falls through to store on every read; a stub cache returning `null` falls through; a
`true`/`false` cache result short-circuits the store; `tryClaim()` mirrors to the cache only on a
winning claim, never on a losing one), `redis-client.provider.spec.ts` (flag off →
`null`, no `Redis` construction; flag on → a client is constructed with the configured URL),
`redis-client-lifecycle.spec.ts` (`onModuleDestroy` calls `disconnect()` when a client exists,
no-ops when `null`), `redis-token-blacklist.cache.spec.ts` (mocked ioredis client: healthy hit/miss,
any thrown error on read or write degrades `trusted` permanently and every later call short-circuits
to `null` without touching the client again, TTL derived from `expiresAt` not a constant, a
zero/negative TTL is skipped), `token-blacklist.module.spec.ts` (DI wiring: cache binds to a real
`RedisTokenBlacklistCache` when a client exists, `null` otherwise).

`common/strategies/jwt-refresh.strategy.spec.ts` extends the existing extractor-case coverage with
the three blacklist branches: blacklisted jti → throws; non-blacklisted jti → passes through
unchanged; missing jti → passes through, no store/cache call.
`modules/auth/application/services/logout.service.spec.ts` covers the write/no-write branches
described under [Callers](#callers) above, plus a blacklist-write-failure case (mocked rejection):
`execute()` still resolves without throwing.
`modules/auth/application/services/refresh-token.service.spec.ts` covers the claim/no-claim branches
and, critically, the losing-the-race case: `tryClaim()` resolving `false` throws
`UnauthorizedException` **and** asserts `signAccessToken`/`signRefreshToken` were never called — the
whole point of claiming before signing.

`test/refresh-token-blacklist.e2e-spec.ts` (real Postgres, cleaned up in `afterAll`): login → logout
→ `/auth/refresh` with that cookie → `401`; login → `/auth/refresh` **without** logging out → `200`
(regression guard); `/auth/refresh` twice with the same cookie → the second call → `401` (rotation
single-use), the rotated-to token still works; and a genuine concurrency case — two `/auth/refresh`
calls fired via `Promise.all` at the same still-valid cookie → exactly one `200` and one `401` (see
[Concurrency](#concurrency-atomic-claim-vs-check-then-write)). This last case was verified against
both implementations by hand during the review-driven fix: reverting `tryClaim()` to a plain
check-then-write made it fail intermittently (~1 in 5 runs, both calls returning `200`); the shipped
`tryClaim()` implementation passed 8/8 repeated runs.

## Verified state (2026-08-12)

`bun run build`, `bun run lint`, `bun run test` (1068 tests), and `bun run test:e2e` (79 tests) all
pass. Manually verified: with `REDIS_ENABLED=false` (default), app boots with zero Redis connection
attempts. With `REDIS_ENABLED=true` against a local Redis, the Checkpoint B/C login→logout→refresh
and refresh-twice scenarios pass again by hand, and the `refresh-blacklist:<jti>` key is visible in
Redis with a sane TTL; killing Redis mid-session, both `/auth/refresh` and `/auth/logout` keep
working against Postgres instead of erroring. Manual `cms-admin` walkthrough (no code changes needed
there — confirmed during planning, see
[token-blacklist-techstack.md](./token-blacklist-techstack.md)): log in, click logout, confirm the
old session cannot refresh; log in again and confirm normal navigation refreshes cleanly across the
15-minute access-token boundary.

**Five-axis review fix cycle (2026-08-12):** `agent-skills:code-reviewer` found two Important issues,
both fixed and re-verified the same day: (1) `LogoutService`'s blacklist write wasn't wrapped in
try/catch, so a transient DB error would 500 a route documented as always-`200`/idempotent — fixed
by swallowing and logging the failure, matching the existing pattern for a verification failure; (2)
the TOCTOU race described under
[Concurrency](#concurrency-atomic-claim-vs-check-then-write) — fixed by replacing the check-then-write
pair with the atomic `tryClaim()` (Postgres unique-constraint `INSERT`). No Critical findings; all
four required security properties (jti unforgeable, no raw-token logging, degraded-cache fails safe,
generic error messages) were confirmed correct as originally shipped, no changes needed there.

# Plan: Refresh Token Blacklist & Logout

See `SPEC.md` for the full spec (objective, confirmed assumptions, boundaries, success criteria).
This plan implements it, with corrections found during planning (below) that the spec did not
anticipate.

## Context

Refresh tokens today are stateless JWTs carrying `{ sub, rememberMe }` — no unique identifier, no
server-side record, no revocation. `POST /auth/logout` only calls `res.clearCookie()`; the token
itself stays valid until natural expiry (7d, or 30d for `rememberMe`), and a rotated-out token from
`/auth/refresh` stays valid too. `docs/documents/auth.md` records this as the accepted "No
server-side token revocation" gap. This plan closes it: refresh tokens gain a `jti`, revocations are
persisted in Postgres (optionally mirrored to Redis), `JwtRefreshStrategy` checks that blacklist, and
both logout and rotation write to it.

## Corrections found during planning (supersede SPEC.md)

1. **Only `prisma/postgresql/schema.prisma` has models — the mysql and sqlite schemas are empty
   8-line stubs** (`generator` + `datasource` blocks only, zero `model` declarations). SPEC.md's
   Project Structure says "add `RefreshTokenBlacklist` to all 3" and its Boundaries say "never add
   the model to just one schema" — both are wrong given the actual repo state. Adding the model to
   the stubs would leave them holding one model and none of the other six. **Decision: postgresql
   only**, matching how `AccessToken`/`User`/`Role`/etc. already live. The `mysql`/`sqlite` stubs
   stay untouched; `scripts/prisma.ts`'s driver switch keeps working exactly as before.

2. **SPEC.md's "a Redis miss is authoritative" rule has a correctness hole.** The spec reasons that
   because Redis mirrors every DB write, a miss means "not blacklisted". That holds only if the
   mirror write never fails. If the DB write succeeds and the Redis write then throws (connection
   drop mid-request), the entry exists only in Postgres — and every later check reads Redis, misses,
   and **accepts a token that was logged out**. This is a silent auth bypass, not a cache-staleness
   annoyance. Options considered:

   | Option | Read on cache miss | On mirror-write failure | Correct? | Cost on the happy path |
   | --- | --- | --- | --- | --- |
   | **A** — spec as written | trust the miss | log + continue | ❌ revoked token accepted | 1 Redis read |
   | **B** — miss → always check DB | fall through to DB | log + continue | ✅ | 1 Redis read **+ 1 DB read** (cache buys nothing) |
   | **C** — fail the request | trust the miss | throw → 500 | ✅ | 1 Redis read, but Redis down ⇒ logout/refresh 500 |
   | **D** — sticky-degraded cache ✅ **chosen** | trust the miss **while healthy**; fall through to DB once degraded | log + mark cache untrusted for the process lifetime | ✅ | 1 Redis read |

   **Chosen: D.** Any Redis error (read *or* write) flips an in-process `trusted` flag to `false`
   permanently; from then on the cache reports "unknown" and every check falls through to Postgres.
   It stays false until the process restarts — re-arming it would wrongly trust a cache that missed
   writes during the outage. This is the only option that is both correct and keeps the cache's
   read benefit, and it satisfies SPEC.md's success criterion "killing Redis mid-session causes
   checks to fall back to DB rather than hard-failing". The comparison table above goes into
   `docs/documents/token-blacklist-techstack.md` per `docs/rules/workflow.md`'s decision-rationale
   rule.

3. **Two ports, not one.** Correction 2 means the authoritative store and the optional cache have
   genuinely different contracts — the store always answers definitively, the cache may not know.
   SPEC.md's single `ITokenBlacklistStore` becomes:

   ```ts
   export interface ITokenBlacklistStore {   // Postgres — authoritative, always present
     blacklist(entry: BlacklistEntry): Promise<void>;
     isBlacklisted(jti: string): Promise<boolean>;
   }

   export interface ITokenBlacklistCache {   // Redis — optional, may be unavailable/degraded
     blacklist(entry: BlacklistEntry): Promise<void>;
     isBlacklisted(jti: string): Promise<boolean | null>;   // null = "don't know, ask the store"
   }
   ```

4. **`signRefreshToken` generates the `jti` internally and still returns just the token string.**
   SPEC.md's Project Structure says it "generates + returns `jti`". No caller ever needs the *new*
   token's jti — logout and rotation both blacklist the *old* jti, which arrives already decoded on
   `req.user`. Returning it would widen `LoginResult` and every call site for nothing.

5. **Expiry comes from the token's own `exp` claim, not from re-deriving the 7d/30d TTL.**
   `passport-jwt` puts the standard `exp` (Unix seconds) on the decoded payload, so
   `expiresAt = new Date(payload.exp * 1000)` is exact and needs no `rememberMe` branch. Both
   `jti` and `exp` are declared **optional** on `RefreshTokenPayload`, matching the existing
   precedent set by `rememberMe`: tokens minted before this ships carry neither, and readers must
   treat their absence as "cannot be blacklisted" rather than crashing.

6. **`cms-admin` needs zero code changes — confirmed, not assumed.** `src/context/AuthContext.tsx`
   already calls `api.post("/auth/logout")`, and `src/lib/api.ts` creates the axios instance with
   `withCredentials: true`, so the `refresh_token` cookie is already sent on that request. The
   "admin" half of this feature is a manual browser walkthrough (Checkpoint C), not an
   implementation task.

7. **Logout gets its own `LogoutService`, not inline controller logic.** Today logout is the one
   route with no service (`— (inline, no service)` in `docs/documents/auth.md`'s endpoint table).
   Decoding a JWT and writing to a blacklist is business logic; every other route in this module
   delegates to `application/services/*`. Keeping it inline would put a `try/catch` around
   `verifyRefreshToken` inside a presentation-layer method.

## Architecture Decisions

- **New shared primitive at `src/common/token-blacklist/`**, registered as a `@Global()` module in
  `AppModule` next to `TokenModule` — same category as `common/token/`'s `JwtTokenService`, not a
  CRUD business module. `JwtRefreshStrategy` (in `common/strategies/`) can then inject it without
  `AuthModule` importing anything new, and without a cycle: `TokenBlacklistModule` depends only on
  the already-`@Global()` `PrismaModule` plus `ConfigService`.
- **`jti` is a `randomUUID()`** from `node:crypto` — no `uuid` package, matching the existing
  `randomInt`/`randomBytes` precedent in this module's OTP and reset-token code.
- **`RefreshTokenBlacklist` uses `jti` as its primary key**, with no `documentId`/`updatedAt`/
  `updatedBy` columns. It is not a client-facing CRUD resource, and `jti` is already a UUID. A
  nullable `userId` column is included as groundwork for a future "log out everywhere" feature
  (confirmed in SPEC.md assumption 7); nothing in this plan queries by it.
- **The blacklist write is the last step of `RefreshTokenService.execute()`**, after the user/role
  lookups and token signing. If it throws, `execute()` throws, the controller never reaches
  `setRefreshCookie`, and the client keeps a still-valid old token — a consistent state. Writing it
  first would risk revoking the old token and then failing to issue a new one, locking the user out.
- **`ignoreExpiration: false` stays** on `JwtRefreshStrategy`, so expired tokens are rejected by
  `passport-jwt` before `validate()` runs — the blacklist never sees them and never needs to store
  them past their `exp`.
- **Rejection reuses the existing generic `401 "Invalid or expired refresh token"`.** A blacklisted
  token must be indistinguishable from an invalid one; `JwtRefreshGuard.handleRequest`'s existing
  `if (err || !user)` branch already produces exactly that message when `validate()` throws.

## Dependency Graph

```
T1 jti + exp on the payload
 │
 ├─→ T2 Prisma model + migration
 │       │
 │       └─→ T3 ports + Prisma store
 │               │
 │               └─→ T4 TokenBlacklistService + @Global() module
 │                       │
 │                       ├─→ T5 JwtRefreshStrategy checks the blacklist ──┐
 │                       │                                                 ├─→ T7 rotation blacklists
 │                       └─→ T6 LogoutService + controller ────────────────┘        the consumed jti
 │                                    (logout works end-to-end)
 │
 └─→ T8 env + ioredis client ─→ T9 Redis cache + service composition
                                     (optional fast path, no behavior change)
```

Phases 1–3 deliver the whole feature on Postgres alone. Phase 4 (Redis) is a pure performance layer
bolted on behind a default-off flag — deliberately last, so a Redis problem can never block the
security fix.

## Task List

### Phase 1 — Foundation (no behavior change yet)

- **T1** — `jti`/`exp` on the refresh payload. S
- **T2** — `RefreshTokenBlacklist` Prisma model + migration. S
- **T3** — Blacklist ports + Postgres-backed store. S
- **T4** — `TokenBlacklistService` + `@Global()` `TokenBlacklistModule` + `AppModule` wiring. S

**Checkpoint A** — `bun run build && bun run lint && bun run test:cov` green. Nothing calls the
blacklist yet, so every existing test must still pass unmodified. Commit.

### Phase 2 — Logout actually revokes (first vertical slice)

- **T5** — `JwtRefreshStrategy.validate()` rejects blacklisted jtis. S
- **T6** — `LogoutService` + controller/module wiring. M

**Checkpoint B** — full suite green + new e2e: login → logout → `/auth/refresh` with that cookie =
`401`; login → `/auth/refresh` without logging out still = `200`. Manual: confirm one row lands in
`refresh_token_blacklist` with `reason = 'logout'`. Commit.

### Phase 3 — Rotation makes refresh tokens single-use

- **T7** — `RefreshTokenService` blacklists the jti it just consumed. S

**Checkpoint C** — full suite green + new e2e: `/auth/refresh` twice with the *same* cookie = `401`
on the second call. **Manual `cms-admin` walkthrough** (the "admin" half of the feature): log in,
click logout, confirm the session is dead server-side, and confirm normal navigation still refreshes
cleanly across the 15-minute access-token boundary. Commit.

### Phase 4 — Optional Redis cache

- **T8** — Env vars + `ioredis` dependency + lazy client provider. S
- **T9** — `RedisTokenBlacklistCache` + service composition. M

**Checkpoint D** — with the flag off (default): full suite + e2e green and **zero Redis connection
attempts** at boot. With the flag on against a local Redis: Checkpoint B and C scenarios still pass;
then kill Redis mid-session and confirm checks degrade to Postgres instead of erroring. Commit.

### Phase 5 — Docs, review, cleanup (`docs/rules/workflow.md` steps 4–8)

- **T10** — `docs/documents/token-blacklist.md` + `token-blacklist-techstack.md`. S
- **T11** — Update `auth.md` + repo-wide stale-wording sweep + Swagger/reference docs. M
- **T12** — Five-axis review. S
- **T13** — Cleanup: `SPEC.md` back to a pointer. XS

**Checkpoint E (final)** — every success criterion in `SPEC.md` re-verified against shipped code;
`build`/`lint`/`test:cov`/`test:e2e` green; review findings resolved. Commit.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Redis mirror write fails ⇒ later miss accepts a revoked token | **High** (silent auth bypass) | Correction 2's sticky-degraded cache; any Redis error permanently untrusts the cache for that process and reads fall through to Postgres |
| `ioredis` connects (or throws) at boot even when the flag is off | Med (breaks default-off deployments) | The provider is a `useFactory` returning `null` when disabled — the client is never constructed. Checkpoint D asserts zero connection attempts explicitly |
| Blacklist write fails mid-rotation ⇒ user locked out | Med | Write last in `execute()`; on throw the controller never sets a new cookie, so the old still-valid token survives |
| Pre-existing refresh tokens carry no `jti` and cannot be revoked | Low | Accepted and documented; they age out within their existing 7d/30d TTL. `jti`/`exp` typed optional so they never crash a reader |
| `refresh_token_blacklist` grows unbounded | Low→Med over time | Reads filter on `expiresAt`; a scheduled sweep is explicitly out of scope, recorded as a known gap in `token-blacklist.md` |
| e2e tests leave blacklist rows in the shared dev DB | Low | Delete created rows in `afterAll`, as `auth-bearer-conflict.e2e-spec.ts` already does for its API tokens |
| Every `/auth/refresh` gains a DB round trip | Low | Indexed primary-key lookup, once per session per 15 minutes; Phase 4's cache exists precisely to remove it |
| Docs elsewhere still claim "no server-side token revocation" | Med (docs actively wrong) | T11 is an explicit repo-wide grep sweep, not a fixed file list — the lesson recorded from the JWT Bearer migration closeout |

## Notes found during implementation

- **T2 could not use `bun run prisma:migrate` (`prisma migrate dev`) as planned.** The local dev DB
  has ~19 tables (`documents_*`, `components_*`) created at runtime by the content-engine's
  schema-as-code sync (see `docs/documents/content-type.md`) — expected, but invisible to Prisma's
  migration history. `migrate dev`'s drift check saw those as unexplained drift and demanded a full
  `public` schema reset ("All data will be lost"), which was refused. Used the standard non-destructive
  workaround instead: hand-wrote `migration.sql` matching Prisma's own generated format (cross-checked
  against `20260724112511_add_access_tokens/migration.sql`'s naming conventions), applied it with
  `prisma db execute --file`, then registered it with `prisma migrate resolve --applied` so
  `prisma migrate status` reports clean. End state is identical to what `migrate dev` would have
  produced; only the path there differed. Future migrations in this repo will hit the same drift
  warning against a populated dev DB — same workaround applies.

## Resolved during plan review (2026-08-12)

1. **Correction 2 → option D confirmed.** Sticky-degraded cache: any Redis error, read or write,
   permanently untrusts the cache for that process and reads fall through to Postgres.
2. **Env vars confirmed as `REDIS_ENABLED` + `REDIS_URL`** — not `TOKEN_BLACKLIST_REDIS_ENABLED`.
   Redis is treated as general infrastructure rather than a blacklist-specific toggle, so a later
   feature can share the same connection. `SPEC.md`'s proposed-env-vars section is updated to match.

## Open Questions

1. **Redis key prefix** — proposing `refresh-blacklist:<jti>` so one Redis instance can be shared
   with future caches. Confirm if you have a house convention; otherwise T9 ships with that prefix.

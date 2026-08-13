# Refresh Token Blacklist — Tech/Pattern/Design Decisions

Comparison tables for the choices made building `src/common/token-blacklist/**`, per
`docs/rules/workflow.md`'s "Decision rationale" rule. See
[token-blacklist.md](./token-blacklist.md) for the module's full implementation writeup.

## Cache-miss semantics on Redis failure: sticky-degraded (chosen) vs. three alternatives

The original spec reasoned that because Redis mirrors every DB write, a cache miss means "not
blacklisted." That holds only if the mirror write never fails. If the Postgres write succeeds and
the Redis mirror write then throws (e.g. a connection drop mid-request), the entry exists only in
Postgres — and every later check reads Redis, misses, and **accepts a token that was already logged
out**. That's a silent auth bypass, not a cache-staleness annoyance, so it drove the cache's whole
design rather than being an edge case bolted on after.

| Option | Read on cache miss | On mirror-write failure | Correct? | Cost on the happy path |
| --- | --- | --- | --- | --- |
| A — trust every miss | trust the miss | log + continue | ❌ revoked token accepted | 1 Redis read |
| B — miss always checks DB | fall through to DB | log + continue | ✅ | 1 Redis read **+ 1 DB read** (cache buys nothing) |
| C — fail the request on any Redis error | trust the miss | throw → `500` | ✅ | 1 Redis read, but Redis down ⇒ logout/refresh `500` |
| **D — sticky-degraded cache (chosen)** | trust the miss **while healthy**; fall through to DB once degraded | log + permanently mark the cache untrusted for the process | ✅ | 1 Redis read |

**Chosen: D.** Any Redis error — read *or* write — flips an in-process `trusted` flag to `false`
permanently (`RedisTokenBlacklistCache.degrade()`); from then on `isBlacklisted()` returns `null`
("unknown, ask the store") and every check falls through to Postgres for the rest of that process's
life. It doesn't re-arm on its own — re-arming after an outage would wrongly trust a cache that
missed writes *during* the outage, reintroducing the exact bypass this design exists to close; a
process restart (which also gets a fresh, empty cache) is the only reset. D is the only option that
is both correct (Postgres stays authoritative the moment Redis can't be trusted) and keeps the
cache's read-latency benefit on the common case, and it's what makes "kill Redis mid-session, and
`/auth/refresh`/`/auth/logout` keep working against Postgres instead of erroring" — the module's
actual success criterion — hold structurally rather than by accident.

## Redis client library: `ioredis` (chosen) vs. `redis` (node-redis) vs. no cache at all

| Criteria | `ioredis` (chosen) | `redis` (node-redis v4+) | No Redis cache (Postgres-only, defer Phase 4) |
| --- | --- | --- | --- |
| Fit for a fail-fast, sticky-degraded cache | `maxRetriesPerRequest` is a first-class constructor option — set to `1` so a failed command surfaces in milliseconds, not the library's default backoff, which is exactly what lets the sticky-degraded flip happen promptly | Retry/backoff is configured via a `socket.reconnectStrategy` callback — same end result reachable, but no single option as directly named for "give up fast per command" | N/A — no client to configure |
| Existing precedent in this repo | None yet, but `ioredis`'s API (`.set(key, value, "PX", ms)`, promise-based, typed) matches this project's existing style of thin wrappers over well-typed client libraries (e.g. `bcryptjs`, `@nestjs/jwt`) | Also promise-based and typed; no existing repo precedent either way | Zero new dependency — the simplest option, and Phases 1–3 already deliver the full feature without it |
| Lazy/optional construction | `useFactory` returning `null` when `REDIS_ENABLED` is off works cleanly — the import itself has no side effects, only `new Redis(...)` connects | Same shape works equally well | Trivially true — there's nothing to construct |
| TTL/key operations needed here | `SET key value PX ms` in one call | Same operation available, slightly different call shape (`set(key, value, { PX: ms })`) | N/A |
| **Verdict** | **Chosen** — no meaningfully better fit than `redis`, but `ioredis`'s per-request retry option is a slightly more direct match for this design's fail-fast requirement, and its API reads naturally against the rest of this module | Viable alternative; would have worked equally well, no compelling reason to prefer it over `ioredis` here | Rejected as the *permanent* answer (an indexed Postgres lookup on every 15-minute refresh has a real, if small, cost this cache exists to remove) but correctly chosen as the **Phase 1–3 default** — Redis is Phase 4, deliberately last, so a Redis problem can never block the underlying security fix |

## Prisma schema placement: Postgres-only (chosen) vs. all three schemas

SPEC.md originally called for adding `RefreshTokenBlacklist` to all three Prisma schemas
(`postgresql`/`mysql`/`sqlite`) and treated "never add the model to just one schema" as a hard
boundary, on the assumption all three carry the same entities today.

| Criteria | All three schemas (spec as written) | Postgres only (chosen) |
| --- | --- | --- |
| Actual repo state | `mysql`/`sqlite` schemas are empty 8-line stubs (`generator` + `datasource` blocks only) — every existing entity (`User`, `Role`, `AccessToken`, etc.) already lives in `postgresql` only | Matches how every other model in this project already lives |
| Consistency | Adding the model to the stubs would leave them holding **one** model and none of the other six — less consistent, not more | Stubs stay untouched; `scripts/prisma.ts`'s driver switch keeps working exactly as before |
| Effort | Requires writing/maintaining schema and migration logic for two backends nothing else uses yet | One schema, one migration |
| **Verdict** | Rejected — contradicted by the actual repo state, and would have made the schemas *less* consistent with every existing entity | **Chosen** |

## Env var naming: `REDIS_ENABLED`/`REDIS_URL` (chosen) vs. blacklist-scoped names

| Criteria | `TOKEN_BLACKLIST_REDIS_ENABLED`/`_URL` | `REDIS_ENABLED`/`REDIS_URL` (chosen) |
| --- | --- | --- |
| Scope | Ties the connection config to one feature | Treats Redis as general infrastructure — a future feature (rate limiting, session cache, etc.) can share the same connection config without a rename |
| Clarity today | Slightly more explicit about *why* Redis exists right now | Still unambiguous — this is the only Redis consumer in the codebase as of this writing, and the module docs make the link explicit |
| **Verdict** | Rejected | **Chosen**, confirmed during plan review (2026-08-12) |

## Closing rotation's TOCTOU race: atomic `tryClaim` (chosen) vs. three alternatives

Found by the five-axis review (`agent-skills:code-reviewer`), not the original plan:
`RefreshTokenService`'s original design — `isBlacklisted(jti)` check, sign new tokens, `blacklist()`
write, in that order — is a classic check-then-write race. Two concurrent `/auth/refresh` requests
replaying the same not-yet-consumed cookie can both pass the check before either write lands, and
both mint a valid pair, defeating "rotation makes refresh tokens single-use." Empirically confirmed:
reverting to the check-then-write version and firing two concurrent requests at the same cookie via
`Promise.all` against real Postgres produced a double-`200` in roughly 1 of every 5 runs.

| Option | Mechanism | Closes the race? | Cost | Complexity added |
| --- | --- | --- | --- | --- |
| A — leave as check-then-write | `isBlacklisted()` then `blacklist()` | ❌ | 1 extra read | None (status quo) |
| B — app-level mutex (per-jti in-memory lock) | `Map<jti, Promise>` guarding `execute()` | ✅ within one process; ❌ across replicas — this app has no shared lock across horizontally-scaled instances | Low latency | New primitive to build/maintain, and a false sense of safety once deployed behind >1 instance |
| C — `SELECT ... FOR UPDATE` / serializable transaction | Row-lock or transaction-level isolation around the read-then-write | ✅ | Higher — an explicit transaction wrapping every rotation, plus retry logic for serialization failures (same P2034 pattern as `completeVerification`, see `auth-issues-fix.md` #1) | Meaningful — a new transactional code path just for this one check |
| **D — atomic claim via unique-constraint `INSERT` (chosen)** | `tryClaim()`: `prisma.refreshTokenBlacklist.create()` against `jti`'s existing `@id` primary key; a losing racer's `INSERT` hits the constraint and Prisma surfaces `P2002`, translated to `false` | ✅, and correctly **across replicas** — the guarantee lives in Postgres itself, not in any one process's memory | Same as the write this feature already needed to do — no extra read, no extra round trip vs. the buggy version | None — reuses the existing `jti` primary key, no new table/column/transaction machinery |

**Chosen: D.** Both B and C would work but add machinery this problem doesn't need — Postgres
already enforces uniqueness on `jti` for free, since it's the table's primary key. Turning the
existing "read-then-write" into "attempt-write, treat a conflict as the answer" needed one new store
method (`tryClaim`, an `INSERT` instead of the `blacklist()` `upsert`) and reordering
`RefreshTokenService.execute()` to call it before signing instead of after — no new locking
primitive, no transaction, and (unlike B) it's correct even if this app is later deployed across
multiple instances/replicas, since the atomicity guarantee is enforced by Postgres itself rather
than by anything held in one process's memory. See [token-blacklist.md](./token-blacklist.md#concurrency-atomic-claim-vs-check-then-write)
for the full mechanism and the ordering tradeoff it reopens (the claim is no longer the *literal
last* step before returning, narrowing but not eliminating the original "write last" fail-safe
reasoning — the only remaining window is synchronous, in-memory token signing, not a DB round trip).

## `cms-admin`: zero code changes needed (confirmed, not assumed)

Not a tech-stack choice, but resolved the same way — by checking the actual code rather than the
spec's assumption. `apps/cms-admin/src/context/AuthContext.tsx` already calls
`api.post("/auth/logout")`, and `apps/cms-admin/src/lib/api.ts` creates its axios instance with
`withCredentials: true`, so the `refresh_token` cookie this feature blacklists is already sent on
that request. The "admin" half of this feature is the manual browser walkthrough recorded in
[token-blacklist.md](./token-blacklist.md#verified-state-2026-08-12), not an implementation task.

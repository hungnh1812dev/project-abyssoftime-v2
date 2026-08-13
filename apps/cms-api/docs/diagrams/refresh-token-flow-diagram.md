# Refresh token flow — rotation and logout

Scope: `POST /auth/refresh` and `POST /auth/logout`, from the `refresh_token` cookie to
response (a rotated `accessToken` in the JSON body plus a rotated `refresh_token`
cookie). Read directly from `src/common/strategies/jwt-refresh.strategy.ts`,
`src/common/guards/jwt-refresh.guard.ts`,
`src/modules/auth/application/services/refresh-token.service.ts`,
`src/modules/auth/application/services/logout.service.ts`,
`src/common/token-blacklist/token-blacklist.service.ts`, and
`src/modules/auth/presentation/auth.controller.ts` — not inferred. Cross-referenced
against `docs/documents/auth.md` and `docs/documents/token-blacklist.md` for narrative
context only. See `login-flow-diagram.md` for how the pair is first issued and
`auth-jwt-flow-diagram.md` for how the access token is verified on every other request.

## Diagram — refresh sequence

```mermaid
sequenceDiagram
    participant C as Client
    participant Guard as JwtRefreshGuard
    participant RS as JwtRefreshStrategy
    participant TB as TokenBlacklistService
    participant Ctl as AuthController
    participant Refresh as RefreshTokenService
    participant U as IUserRepository
    participant R as IRoleRepository
    participant JWT as JwtTokenService

    C->>Guard: POST auth/refresh, Cookie refresh_token
    Guard->>RS: AuthGuard jwt-refresh, single strategy, no fallback
    RS->>RS: jwtRefreshCookieExtractor reads req.cookies.refresh_token
    alt cookie missing or empty or non-string
        RS-->>Guard: no token, Passport info = No auth token
        Guard-->>C: 401 Missing refresh token
    else cookie present
        RS->>RS: verify signature and expiry against JWT_REFRESH_SECRET, ignoreExpiration false
        alt signature invalid or expired or malformed
            RS-->>Guard: verification failure
            Guard-->>C: 401 Invalid or expired refresh token
        else valid
            alt payload.jti present
                RS->>TB: isBlacklisted(jti)
                TB-->>RS: true or false
                alt blacklisted (already logged out, or already rotated out)
                    RS-->>Guard: throws UnauthorizedException
                    Guard-->>C: 401 Invalid or expired refresh token
                end
            end
            RS->>RS: validate(payload) passes through once not blacklisted<br/>(or jti absent — pre-migration token, check skipped, no DB/cache call)
            RS-->>Guard: req.user = sub, rememberMe, jti, exp
        end
    end

    Guard->>Ctl: continue, req.user = sub, rememberMe, jti, exp
    Ctl->>Refresh: execute(sub, rememberMe, jti, exp)

    Refresh->>U: findById(sub)
    alt user not found
        Refresh-->>C: 401 Invalid or expired refresh token
    else found
        Refresh->>Refresh: check user.roleId present
        alt no role assigned
            Refresh-->>C: 401 Invalid or expired refresh token
        else has role
            Refresh->>R: findById(user.roleId)
            alt role not found
                Refresh-->>C: 401 Invalid or expired refresh token
            else role found
                Note over Refresh,R: unlike JwtStrategy, this path always re-reads<br/>role/permissions from the DB — a role change since<br/>the last token issue takes effect right here
                alt old jti and exp present
                    Refresh->>TB: tryClaim old jti, userId sub, expiresAt from exp, reason rotation
                    Note over Refresh,TB: atomic Postgres INSERT on jti's unique constraint —<br/>not a plain check-then-write. Called BEFORE signing,<br/>so a losing claim (concurrent replay of the same<br/>cookie, or already logged out) mints nothing
                    TB-->>Refresh: true (claimed) or false (already claimed)
                    alt claim lost
                        Refresh-->>C: 401 Invalid or expired refresh token
                    end
                end
                Refresh->>JWT: sign new access token, sub/roleSlug/level/permissions, 15m TTL
                Refresh->>JWT: sign new refresh token, sub/rememberMe, 7d or 30d TTL, new jti
                JWT-->>Refresh: access token, refresh token, refreshTokenMaxAgeMs
                Refresh-->>Ctl: tokens
                Ctl->>C: Set-Cookie refresh_token, httpOnly, secure, sameSite, maxAge refreshTokenMaxAgeMs
                Ctl-->>C: 200, body message Token refreshed, accessToken
            end
        end
    end
```

## Diagram — logout

```mermaid
sequenceDiagram
    participant C as Client
    participant Ctl as AuthController
    participant Logout as LogoutService
    participant JWT as JwtTokenService
    participant TB as TokenBlacklistService

    C->>Ctl: POST auth/logout, Cookie refresh_token (optional)
    Ctl->>Logout: execute(cookie value or undefined)
    alt cookie missing
        Logout-->>Ctl: returns, no write
    else cookie present
        Logout->>JWT: verifyRefreshToken(cookie)
        alt verification fails (garbage, expired, wrong secret)
            Logout-->>Ctl: swallowed, returns, no write
        else verified
            alt jti and exp present
                Logout->>TB: blacklist jti, userId sub, expiresAt from exp, reason logout
                Note over Logout,TB: wrapped in try/catch — a write failure (e.g. a<br/>dropped DB connection) is logged, not thrown,<br/>so it can't turn this always-200 route into a 500
            else pre-migration token, no jti
                Logout-->>Ctl: returns, no write
            end
        end
    end
    Ctl->>C: clearCookie refresh_token
    Ctl-->>C: 200, message Logged out
    Note over Ctl: always 200, no guard — logout stays public and idempotent<br/>regardless of whether a blacklist write happened
```

## Notes

- **Rotation is now single-use, not just replacement — even under concurrent replay.**
  Every successful refresh still issues a brand-new access/refresh pair — the new
  access token comes back in the response body, the new refresh token overwrites the
  `refresh_token` cookie — but the refresh token just consumed is also atomically
  claimed (`reason: "rotation"`) via `tryClaim`, **before** signing, not after. A
  replay of the old cookie now fails with the same `401 Invalid or expired refresh
  token` a garbage cookie would, instead of quietly minting another valid pair. The
  "before, not after" ordering matters: an earlier version wrote the blacklist entry
  as the *last* step (after signing), which left a real check-then-write race — two
  concurrent requests replaying the same not-yet-consumed cookie could both pass an
  `isBlacklisted()` check before either write landed, each minting a valid pair. Found
  during the five-axis review (empirically reproduced: ~1-in-5 failure rate under a
  `Promise.all`-driven e2e test against real Postgres), fixed by making the claim a
  Postgres unique-constraint `INSERT` (`tryClaim`) called before any signing happens —
  see `docs/documents/token-blacklist.md`'s "Concurrency" section.
- **The one place a refresh differs from a plain authenticated request:**
  `JwtStrategy.validate` (access token, every other route) never touches the
  database — `RefreshTokenService.execute` (this flow) always re-fetches `User` and
  `Role` from Postgres before signing the next access token. That is the mechanism
  by which a permission or role change actually reaches an already-logged-in session.
- **Logout now revokes.** `POST /auth/logout` still calls `res.clearCookie()` once
  (`refresh_token` — there's no `access_token` cookie left to clear), but first hands
  the cookie's raw value to the new `LogoutService`, which blacklists its `jti` via
  `TokenBlacklistService` (Postgres-authoritative, optional sticky-degraded Redis
  cache — see `docs/documents/token-blacklist.md`). Any verification failure along the
  way (missing/garbage/expired cookie) is swallowed so the route stays public,
  always-`200`, and idempotent — it never throws, it just skips the write; a failure
  *during* the write itself (a transient DB error) is caught and logged rather than
  propagated, for the same always-`200` reason (a review-driven fix — the original
  version let a write failure 500 the route). The one remaining gap: a refresh token minted before this feature shipped carries no `jti`
  and cannot be blacklisted by either logout or rotation — it stays valid for the rest
  of its original 7d/30d TTL. A leaked access token is still exploitable for at most
  15 minutes regardless of logout, unchanged from before — access tokens are
  deliberately never persisted or checked against a blacklist.
- **`JwtRefreshGuard` has no fallback strategy** (unlike `JwtAuthGuard`, which tries
  `jwt` then `api-token`) — a missing or invalid refresh cookie fails immediately, now
  joined by a blacklisted-jti check inside `JwtRefreshStrategy.validate` itself rather
  than a separate guard.

Sources read: `src/common/strategies/jwt-refresh.strategy.ts`,
`src/common/guards/jwt-refresh.guard.ts`,
`src/modules/auth/application/services/refresh-token.service.ts`,
`src/modules/auth/application/services/logout.service.ts`,
`src/common/token-blacklist/token-blacklist.service.ts`,
`src/modules/auth/presentation/auth.controller.ts`,
`src/common/token/jwt-token.service.ts`, `docs/documents/auth.md`,
`docs/documents/token-blacklist.md`.

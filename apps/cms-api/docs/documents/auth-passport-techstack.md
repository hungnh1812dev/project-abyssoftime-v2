# Auth / Passport Integration — Tech/Pattern/Design Decisions

Comparison tables for the choices made integrating `@nestjs/passport` as the auth-strategy framework across `src/common/**` and `src/modules/auth/**`, per repo root `docs/workflow.md`'s "Decision rationale" rule. See [auth.md](./auth.md) for the module's full implementation writeup, and [auth-techstack.md](./auth-techstack.md) for the *original* auth build's decisions — including the earlier "Auth strategy library" table that rejected Passport for a single cookie-based strategy. This cycle reverses that call **on purpose**: the deciding factor changed from "one strategy today" to "lay groundwork so OAuth strategies can be added later without a second architectural migration." That earlier table's verdict is not wrong for its moment; it just weighed a different objective.

## JWT verification: custom guard (current) vs. `passport-jwt` strategy (chosen)

| Criteria | Custom `JwtAuthGuard` (current) | `passport-jwt` strategy + `AuthGuard("jwt")` (chosen) |
| --- | --- | --- |
| New dependency | None — `@nestjs/jwt` already installed | Yes — `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt` |
| Code paid down | Guard hand-rolls cookie read + `try/catch` around `verifyAccessToken` | Removes the hand-rolled cookie-parse + verify try/catch; `passport-jwt` owns extraction, signature check, and expiry check declaratively (`secretOrKey`, `ignoreExpiration: false`); `validate()` is a pure pass-through |
| Groundwork for OAuth | A bespoke guard doesn't compose — a second provider means a second bespoke guard | Every strategy (JWT, local, and future Google/GitHub/...) registers under one `PassportModule` and is invoked uniformly via `AuthGuard(name)` — the whole point of this cycle |
| Coupling introduced | None beyond `JwtTokenService` | `JwtAuthGuard.handleRequest` now branches on `passport-jwt`'s internal `info.message === "No auth token"` string to preserve today's exact `"Missing access token"` vs. `"Invalid or expired access token"` split. This couples our error wording to a library-internal message. **Known, accepted tradeoff** (confirmed with the user as preferable to collapsing to one generic message), not a gap — flagged here so a future `passport-jwt` upgrade that changes that string is a known place to re-check. |
| **Verdict** | Rejected — served well for a single strategy, but doesn't compose toward OAuth | **Chosen** — accepts one new dependency + one internal-string coupling in exchange for a composable strategy framework and less hand-rolled verify code |

## Cookie extraction: passport-jwt built-in extractors vs. custom extractor function (chosen)

| Criteria | Built-in `ExtractJwt.*` extractors | Custom `(req) => req.cookies?.[ACCESS_TOKEN_COOKIE]` (chosen) |
| --- | --- | --- |
| Cookie support | `passport-jwt` ships `fromAuthHeaderAsBearerToken`, `fromUrlQueryParameter`, `fromHeader`, `fromBodyField`, `fromExtractors` — **none read a cookie** | Reads the `access_token` httpOnly cookie directly, which is exactly where this app's token lives (login/refresh set it; the browser never sees a bearer header) |
| Is it a hack? | N/A | No — a plain `jwtFromRequest` function is the standard, documented way `passport-jwt` itself recommends for cookie-based auth (`fromExtractors([...])` / a bare function are first-class inputs to `jwtFromRequest`) |
| Behavior parity | Would require moving the token to a header — a client-facing API change | Preserves today's cookie-based contract byte-for-byte; when the cookie is absent the extractor returns `null`, which is what surfaces `passport-jwt`'s `"No auth token"` info that `handleRequest` maps to `"Missing access token"` |
| **Verdict** | Rejected — no built-in cookie extractor exists, and switching to a header would change the API contract | **Chosen** — the documented, idiomatic approach for cookie tokens |

**Superseded 2026-08-08:** this verdict was later reversed — the access token moved from this custom cookie
extractor to the built-in `ExtractJwt.fromAuthHeaderAsBearerToken()`, the very option rejected above. The
"switching to a header would change the API contract" cost is exactly what changed: `cms-admin` needed a
header-based access token for non-cookie consumers, and the API contract change was accepted deliberately (see
`docs/documents/auth.md`'s 2026-08-08 changelog entry for the full write-up and git history for the original
spec/plan). `ACCESS_TOKEN_COOKIE`/`jwtCookieExtractor` no longer exist —
`refresh_token`'s own cookie extractor (`jwtRefreshCookieExtractor`, see the Refresh-token table below) is
unaffected and still follows this table's original reasoning.

## Login: convert to `passport-local` (chosen) vs. leave `LoginService` as a plain method

| Criteria | Leave `LoginService` plain | Convert to `passport-local` + `AuthGuard("local")` (chosen) |
| --- | --- | --- |
| Consistency | Two different mental models: JWT-guarded routes go through Passport, login goes through a bespoke service call | Both guard-facing flows go through Passport — one uniform model (`AuthGuard("local")` validates credentials → `req.user`; `AuthGuard("jwt")` validates the token → `req.user`) before OAuth strategies join the same lineup |
| Blast radius | Zero beyond the JWT guard | Larger — touches `LoginService` (shrinks to token-signing), `LocalStrategy` (new, absorbs all credential logic incl. the dummy-hash timing mitigation), `AuthController.login`, and three spec files |
| Groundwork value for OAuth | None lost — the real OAuth prerequisite is the JWT-strategy/`PassportModule` scaffolding, not this | **Honestly, modest.** OAuth doesn't technically require login to be a Passport strategy. The payoff here is consistency, not a hard dependency — a future `GoogleStrategy` would sit next to `JwtStrategy`/`LocalStrategy` regardless of whether login was converted |
| Timing-attack parity | Preserved (unchanged code) | Preserved — the `DUMMY_PASSWORD_HASH` `bcrypt.compare` on the not-found path **moves verbatim** into `LocalStrategy.validate`; the error messages/status codes are byte-for-byte identical |
| **Verdict** | Viable, smaller blast radius | **Chosen — by the user's explicit call.** Three scoped options were presented via comparison (JWT-only / JWT+local / scaffold-only); the user picked JWT+local for a single uniform Passport model now, accepting that the local conversion is more a consistency investment than a technical inevitability. Stated plainly so the record reflects how the decision was actually made. |

## Refresh-token verification: manual `RefreshTokenService.execute(token)` (old) vs. `passport-jwt` strategy (chosen)

| Criteria | Manual verify inside `RefreshTokenService` (old) | `JwtRefreshStrategy` + `JwtRefreshGuard` (chosen) |
| --- | --- | --- |
| Where verification lives | `RefreshTokenService.execute(refreshToken)` calls `jwtTokenService.verifyRefreshToken()` in a try/catch, mixing "verify the token" with "re-fetch user/role and re-sign" in one method | Verification moves into `JwtRefreshStrategy` (declarative `secretOrKey`/`ignoreExpiration`, same shape as `JwtStrategy`); `RefreshTokenService.execute(sub, rememberMe)` becomes DB-fetch-and-resign only, mirroring how `LoginService` shrank once `LocalStrategy` absorbed credential checking |
| Consistency with the rest of the module | Was the one remaining hand-rolled auth check after the access-token/login Passport conversion | Closes that gap — every credential/token check (access, refresh, login, API token) now goes through Passport uniformly |
| Route protection | Controller manually read the `refresh_token` cookie and threw `UnauthorizedException` by hand before calling the service | `@UseGuards(JwtRefreshGuard)`, consistent with every other protected route |
| Cookie extraction | N/A (cookie read directly in the controller) | Same pattern as `JwtStrategy`'s `jwtCookieExtractor`: a custom `jwtRefreshCookieExtractor` reads `REFRESH_TOKEN_COOKIE`, since `passport-jwt` ships no cookie extractor |
| **Verdict** | Rejected — the correct-and-working code, but the last inconsistency with the rest of the module's Passport conversion | **Chosen** — same architectural direction already committed to elsewhere in this module |

**Known rough edge from this cycle:** the first version of `JwtRefreshStrategy` shipped with two bugs that would have been caught by the same five-axis review process as the rest of this table's decisions, but weren't (this conversion happened outside that review cycle): (1) the strategy class was never added to `AuthModule`'s `providers` array, so Nest never instantiated it and Passport never registered `"jwt-refresh"` — hitting `/auth/refresh` threw an unhandled `Unknown authentication strategy "jwt-refresh"` 500; (2) its extractor was `ExtractJwt.fromAuthHeaderAsBearerToken()` instead of a cookie extractor, so even once registered, it silently failed to find the token the client actually sends (a controlled 401 that looked like "working as designed" from the outside). Both fixed — see `docs/documents/auth-issues-fix.md` #11 for the full write-up, including two smaller follow-on findings (wrong error-message wording, an `AccessTokenPayload` type-pollution workaround) caught while verifying the fix.

## Strategy provider placement: global `TokenModule` vs. `AuthModule`-local (chosen)

| Criteria | Register strategies in `@Global() TokenModule` | Register in `AuthModule` (chosen) |
| --- | --- | --- |
| `LocalStrategy` dependencies | `TokenModule` doesn't import `UserModule`/`RoleModule`, so `USER_REPOSITORY`/`ROLE_REPOSITORY` aren't resolvable there without adding those imports to a global module | `AuthModule` already imports `UserModule` + `RoleModule` — the exact providers `LocalStrategy` injects — so it resolves with zero new wiring |
| Blast radius on unrelated modules | `TokenModule` is `@Global()` and consumed by users/roles/permissions/media/document/content-type; touching it risks those consumers and violates the "minimize effect/coupling on existing modules" workflow rule | `AuthModule` is imported only into `AppModule`; adding two providers + `PassportModule.register(...)` there touches nothing else |
| Does placement affect functional scope? | No | No — and this is the key point: Passport's underlying `passport` npm package is a **mutable process-wide singleton registry** (`passport.use(name, strategy)`). NestJS's `PassportStrategy` mixin registers the strategy with that global registry as a side effect of the provider being constructed (once, at bootstrap, because `AuthModule` is imported into `AppModule`). So `AuthGuard("jwt")` invoked from a guard in *any* module finds the "jwt" strategy already registered, regardless of which Nest module instantiated it. Placement is therefore a **DI-convenience question, not a functional-scope question** — this is standard Passport/Nest behavior, not anything unique to this repo. |
| **Verdict** | Rejected — would force `UserModule`/`RoleModule` into a global module and risk `TokenModule`'s many unrelated consumers for zero functional gain | **Chosen** — strategies live where their dependencies already are; `TokenModule` stays completely untouched |

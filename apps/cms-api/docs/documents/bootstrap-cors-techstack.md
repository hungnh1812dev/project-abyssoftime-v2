# CORS Wiring — Tech/Pattern/Design Decisions

Comparison table for the choice made wiring `app.enableCors()` into `src/bootstrap/configure-app.ts`, per repo root `docs/workflow.md`'s "Decision rationale" rule. See [cors.md](./cors.md) for the module's full implementation writeup.

## Two policies on one Express app: single `enableCors(delegate)` (chosen) vs. two `app.use(cors(...))` middlewares

`/api/v1/*` needs a strict, credentialed, exact-match allowlist; `/api/v1/public/documents/*` needs an open, non-credentialed policy. Both live behind the same Express app, so achieving two policies means either one `CorsOptionsDelegate` that branches per-request, or two separate `cors` middleware instances scoped by path.

| Criteria | Two `app.use(cors(...))` calls, scoped by path | Single `app.enableCors(delegate)` (chosen) |
| --- | --- | --- |
| Header-layering risk | Verified against `node_modules/cors/lib/index.js`: a rejected origin only *omits* `Access-Control-Allow-Origin` rather than clearing a header a previous middleware already set, and `Access-Control-Allow-Credentials: true` is set unconditionally whenever `credentials: true` is configured, regardless of origin match. Two middlewares (an open one for public docs + a global strict-credentialed one) can leave a public-doc request carrying **both** an open/reflected `Access-Control-Allow-Origin` (from middleware 1, never cleared) and `Access-Control-Allow-Credentials: true` (from middleware 2, added regardless of origin match) — the exact wildcard+credentials anti-pattern this feature exists to avoid | A single delegate returns one fully-formed `CorsOptions` object per request (`{ origin: true, credentials: false }` or `{ origin: allowedOrigins, credentials: true }`, never both) — structurally cannot produce the mixed-header outcome |
| Path matching | Each `app.use(prefix, cors(...))` call still needs the *raw* path (see below), so the scoping gains nothing over an `if` inside one delegate | One `req.path.startsWith(...)` branch inside the delegate |
| Code shape | Two registrations to keep in sync (ordering matters — the more specific path-scoped one must run first) | One function, one call site, order-independent |
| **Verdict** | Rejected — real risk of both headers ending up on the same response depending on Express middleware ordering | **Chosen** — one delegate, one `CorsOptions` object per request, no header-layering possible |

## Path matching: prefixed vs. unprefixed path string

`setGlobalPrefix("api/v1")` only bakes the prefix into controller route strings at Nest bootstrap — it does not rewrite the path for `app.use()`-registered middleware (CORS runs before Nest's router). The delegate always sees the raw incoming path, so it must match on `/api/v1/public/documents/` (not `/public/documents/`). Confirmed against how `app.enableCors()` registers `cors` as Express middleware ahead of the Nest router.

## `/health` (unprefixed)

`/health` still passes through the same global CORS middleware and falls into the strict-allowlist branch by default. This is harmless — `/health` is server-to-server/monitoring traffic, never browser-fetched with credentials — and is called out explicitly here so it reads as a deliberate, understood fallthrough rather than an oversight.

## `CORS_ORIGINS`: required, no default

Fails closed at boot (matches the existing no-default pattern for `JWT_ACCESS_SECRET`/`COOKIE_SAMESITE` in `src/config/env.validation.ts`) — comma-separated exact origins, no wildcards, no regex, no reflect-any-origin logic for the strict branch.

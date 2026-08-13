# Spec: CMS-Driven Login & Role-Gated Navigation (apps/frontend)

Status: **SHIPPED** (T1–T16 complete, 2026-08-13). This spec was rewritten post-implementation to
match what actually shipped — see `tasks/plan.md`'s "Corrections found during planning" for the
full decision trail and `tasks/todo.md` for per-task status.
Target app: `apps/frontend`
Depends on: `apps/cms-api` (auth + `header` content type)

---

## Assumptions

These held throughout implementation, unchanged from the original draft:

1. `apps/frontend-v2` is out of scope. Nothing in this spec ports to it.
2. The public site's user accounts are the **same** accounts as cms-admin's — one `User` table in cms-api, one role ladder. There is no separate "site visitor" identity.
3. Registration/OTP/forgot-password flows are **out of scope**. The frontend only does login / logout / me / refresh. Accounts are created via cms-admin (or, for test accounts, cms-api's own `/auth/register` + `/auth/verify-otp`).
4. Nav content is fetched **server-side with the service API token** (`GRAPHQL_TOKEN`), not with the user's token — cms-api's GraphQL requires an API token, and the user's own JWT is not accepted there. Role filtering happens in the Next.js layer.
5. `requiresRole` is authored per nav item in the CMS and is **advisory for display**; the route guard is the enforcement point. Both read the same source (`src/lib/nav/nav-rules-cache.ts`) so they cannot drift.
6. Locale prefix (`/en`, `/vi`) is stripped before any path matching, via one shared `stripLocale()` helper (`src/lib/nav/strip-locale.ts`).
7. Denied direct-URL access → redirect to the login page with a `returnTo` param (not 404, not a 403 page). Anonymous and insufficient-role are treated the same to avoid leaking which paths exist.

---

## Objective

Replace the shared-passcode gate on the public site with **real per-user login against cms-api**, and drive both the header navigation and the route-access rules from a **single CMS-authored source** (the `header` single-type).

### User stories

- **As a visitor**, I see a "Login" button in the header bar and only the nav links that are public.
- **As a logged-in user**, the header shows my name (or email, if no name is on file) in a dropdown containing a "Logout" button, and the nav reveals every link my role is allowed to see.
- **As a user who types a protected URL directly**, I am redirected to login instead of seeing the page — the nav being hidden is not the only defence.
- **As a content editor**, I control the site's nav labels, links, and which role each link requires from the CMS, without a frontend deploy.

### Non-goals

- Registration, OTP verification, forgot/reset password on the public site.
- Per-document/per-record authorization (cms-api already owns that for the CMS itself).
- Role management UI on the public site.
- Migrating `apps/frontend-v2`.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.2 (App Router, React 19.2) | existing |
| Runtime/PM | Bun | `bun@1.3.14` in the monorepo |
| Styling | Tailwind CSS 3.3 + shadcn/radix | existing |
| Client fetch | SWR 2.4 | existing |
| Server fetch | `src/api/graphqlApi.ts` + `registry.ts` service pattern | existing |
| Auth source | `apps/cms-api` REST `/auth/*` | already shipped |
| Content source | `apps/cms-api` GraphQL `header` single-type | already shipped |
| Session transport | **Auth.js v5** (`next-auth@5.0.0-beta.32`, exact-pinned), Credentials provider | **shipped** — supersedes the hand-rolled BFF cookie originally specced below (D1) |
| Unit tests | `bun test` (built into Bun) | **shipped**, `src/lib/{auth,nav}/**/*.test.ts` |
| E2E | Playwright 1.59 | existing |

---

## Decisions & Rationale

### D1 — Session strategy: Auth.js v5, not a hand-rolled BFF

| Option | SSR knows role? | XSS can steal token? | Nav flicker | OAuth later | Verdict |
|---|---|---|---|---|---|
| **Auth.js v5 + Credentials provider** | Yes | No | None | Add a provider to `auth.config.ts` | **Chosen** |
| Hand-rolled BFF: Next route handlers + `abyss_session` httpOnly cookie | Yes | No | None | Would need a rewrite | Rejected |
| Client-held token in memory + SWR | No | No (but refresh races) | Yes, every load | — | Rejected |
| Token in `localStorage` | No | Yes | Yes | — | Rejected |

The original draft (below, superseded) specced a hand-rolled BFF with a custom `abyss_session`
cookie sealed by our own `jose`-based crypto. That was reversed once OAuth (Google/GitHub) was
confirmed as being on the roadmap — Auth.js is purpose-built for exactly that case, and adopting it
now also removes hand-rolled cookie crypto and closes a CSRF gap the original draft never
addressed. The session cookie is `authjs.session-token`, JWE-sealed by the library itself; the
access/refresh tokens travel inside it, never as separate cookies. Server Components and
`src/proxy.ts` read the session via `auth()`, so the header renders already-filtered and the route
guard runs before the page streams — the access token never reaches client JS.

### D2 — Role matching: exact slug allow-list

| Option | New role added → CMS edits | "admin and above" | Editor must know | Verdict |
|---|---|---|---|---|
| **Exact slug allow-list** (`"admin,super_admin"`) | Every affected nav item | Written out explicitly | Slug names | **Chosen** |
| Numeric level threshold (`level >=`) | None | Free | Slug names + ladder | Rejected |
| Raw level number in CMS | None | Free | The numeric ladder | Rejected |

Chosen for explicitness: what a nav item permits is readable directly in the CMS with no second
lookup and no hidden ladder semantics. The cost — re-editing nav items when a role is added — is
accepted because the role set is small and stable. **Important for CMS authors:** this is an
allow-list, not a hierarchy — `requiresRole: "admin"` alone locks out `super_admin` too, since it
isn't in that literal list. Every role that should see an item must be spelled out
(`"admin,super_admin"`), confirmed the hard way during T1's real content authoring (`tasks/plan.md`
Correction 17).

### D3 — Passcode gate removed entirely

`SessionGuard`, `PROTECTED_PATHS`, `app/actions/app-auth.ts`, `src/libs/session.ts`,
and the passcode `/auth` page are deleted (T14). `src/libs/` no longer exists as a directory — new
code lives in `src/lib/` (see D9). `APP_PASSCODE` and `SESSION_SECRET` env vars are retired and
appear nowhere in the repo. `useSessionTimeout` was **not** deleted — see D7.

### D4 — Denied access redirects, it does not 404

Anonymous and insufficient-role both redirect to `/{locale}/auth?returnTo=<path>`. Same outcome for
both so the response does not reveal whether a path exists.

### D5 — Unlisted paths are public, legacy paths audited first

Paths with no matching CMS nav entry are public by default (fail-open). Before the passcode gate
was removed, T1 audited every entry in the old `PROTECTED_PATHS` array into the CMS nav with an
explicit `requiresRole`, so nothing that used to be gated silently became public at T14. One
deliberate exception: `/cv-2` has no CMS nav entry and is therefore public for every role — the
site's nav was restructured (a `Learning` parent replaced the old flat CV/`cv-2` entries) and the
page's author confirmed `/cv-2` is a "fake page," not a feature that needs gating (Correction 17).

### D6 — `bun test` for pure logic, 100% branch coverage

`apps/frontend` had no unit-test runner before this feature. `bun test` (built into Bun, zero new
dependencies) covers `src/lib/auth/` and `src/lib/nav/` — small, branch-heavy, total functions
where every branch is a security decision. E2E cannot cover that matrix economically.

### D7 — `useSessionTimeout` repurposed, not deleted

The original draft listed it for deletion. It's used by `src/views/secret/Secret.tsx` and
`src/views/account/AccountManager.tsx` — deleting it would break both. Instead it's re-pointed at
the real Auth.js token expiry (`useSession()`'s `accessTokenExpires`) instead of the old
idle-activity timer, with "extend session" calling `update()`, which round-trips through the `jwt`
callback and forces a refresh (D10). `Secret.tsx`/`AccountManager.tsx` needed no changes — the
hook's public props (`enabled`, `onExpire`) are unchanged.

### D8 — Login page: email + password + remember-me, inline errors

`/{locale}/auth` is a plain email/password form in the existing Card shell (`AuthPage.tsx`), with a
remember-me checkbox (drives cms-api's refresh-token lifetime) and inline error messages —
`signIn("credentials", { redirect: false })` renders errors in place instead of Auth.js's default
navigation to `?error=CredentialsSignin`. `returnTo` is validated as same-origin-relative
(`src/lib/auth/safe-return-to.ts`) before being used as a redirect target, to block open redirects.

### D9 — New code lives in `src/lib/`, not `src/libs/`

The original draft's Project Structure said `src/libs/`. The repo has both directories: `@/lib/` is
imported 75× (`utils.ts`, `crypto.ts`, `health/`, `html-parser/`), `@/libs` only 3× and solely for
the `session.ts` that D3 deletes. Using `src/libs/` would have grown a directory that no longer
exists post-T14.

### D10 — Refresh coalescing is ours, Auth.js's isn't (the highest-risk decision in this feature)

Auth.js's own documentation for refreshing tokens inside the `jwt` callback admits "a race-condition
might occur if multiple requests will try to refresh the token at the same time" and ships no
coalescing. cms-api blacklists a refresh token the instant it's consumed (`tryClaim()` — see
[[project-refresh-token-blacklist]]), so two parallel Server Component requests crossing an expiry
boundary would, under Auth.js's naive pattern, cause the second request's refresh attempt to hit an
already-blacklisted token and force-log-out a user who did nothing wrong.

The mitigation, in `src/lib/auth/refresh-coalescer.ts`: a module-level in-flight map keyed on the
refresh token (same shape as `src/lib/health/healthCache.ts`'s single-flight pattern), so N
concurrent requests that cross an expiry boundary produce **exactly one** underlying
`cmsRefresh()` call — every other caller awaits that same in-flight promise instead of issuing its
own. Refresh triggers on an early 60-second skew window before `accessTokenExpires` (not at exact
expiry, to avoid a request racing the boundary itself), or unconditionally when `trigger ===
"update"` (the "extend session" action from D7's `useSessionTimeout`) — but **not** on every request
once `token.error === "RefreshTokenError"` is already set, so an already-blacklisted token doesn't
get retried against cms-api on every subsequent request forever. On failure, the `session` callback
nulls `roleSlug`/`name`/`email` in its output (not just a flag), so the proxy's/`requireRole()`'s
existing `roleSlug`-based gating fails closed on the very next request through the same mechanism as
an anonymous visitor, without a second code path.

Verified: 10 concurrent requests fired across a shortened access-token TTL boundary produce exactly
one `POST /auth/refresh` call server-side.

### D11 — Auth.js pinned exactly, no `^`

`next-auth@5.0.0-beta.32` is pinned with no caret. It's a beta; betas in this line have shipped
breaking changes between versions. Upgrading is a deliberate, tested task, not an incidental
`bun install` side effect.

---

## Contract with cms-api

### Auth endpoints (already shipped — **no cms-api changes required**)

| Endpoint | Method | Request | Response | Notes |
|---|---|---|---|---|
| `/auth/login` | POST | `{ email, password, rememberMe? }` | `{ message, accessToken }` + sets `refresh_token` httpOnly cookie | 401 unknown email/wrong password, 403 unverified |
| `/auth/refresh` | POST | — (sends `refresh_token` cookie) | `{ message, accessToken }` + rotated cookie | consumed token is blacklisted; 401 if reused |
| `/auth/logout` | POST | — | `{ message }` + clears cookie | revokes the refresh token |
| `/auth/me` | GET | `Authorization: Bearer <accessToken>` | `MeResponseDto` | includes `role: { slug, name, level, permissions }` |

cms-api's `refresh_token` `Set-Cookie` is **not** relied on as a browser cookie — it only works
same-site, and cms-api is a separate origin in production. `cms-auth.client.ts` instead pulls the
raw token off the login response's `Set-Cookie` header (`Response.headers.getSetCookie()`) and
carries it inside the Auth.js JWE.

### Seeded roles

| Slug | Name | Level |
|---|---|---|
| `super_admin` | Super Admin | 100 |
| `admin` | Admin | 50 |
| `editor` | Editor | 20 |
| `guest` | Guest | 0 |

Levels are **not** used for gating under D2, but `role.slug` is, and `role.name`/email is what the
header dropdown displays.

### `header` content type (`apps/cms-api/content-types/header.json`)

The real field names differ from the original draft below — confirmed live against the running
server: it's `nav` (not `navigations`) and each item's label field is `title` (not `name`).

```jsonc
{
  "slug": "header", "kind": "single",
  "fields": [
    { "name": "name", "type": "text" },
    { "name": "nav", "type": "component", "repeatable": true, "fields": [
      { "name": "title",         "type": "text" },
      { "name": "requiresRole",  "type": "text" },   // "" | "all" | "admin,super_admin"
      { "name": "link",          "type": "text" },
      { "name": "subNavigations", "type": "component", "repeatable": true, "fields": [
        { "name": "title", "type": "text" },
        { "name": "requiresRole", "type": "text" },
        { "name": "link", "type": "text" }
      ]}
    ]},
    { "name": "author", "type": "component", "fields": [
      { "name": "btnLoginText",  "type": "text" },
      { "name": "btnLogoutText", "type": "text" }
    ]}
  ]
}
```

The document must be **published** — `draftToPublish` is `true`, and the single-type resolver
returns the published row by default, so an unpublished document yields `data.header === null`
rather than an error (`header(status: "draft")` reads the draft explicitly).

**Gap vs. the original sketch:** a `description` (rich text) per nav item, for dropdown/mega-menu
subtitles, was never added. Deferred — see the resolved Q1 below.

### `requiresRole` grammar

```
requiresRole := "" | "all" | slug ("," slug)*
```

- `""`, missing, or `"all"` → **public**, visible to everyone including anonymous.
- Otherwise → a comma-separated allow-list of role slugs. Whitespace around slugs is trimmed; matching is case-insensitive on the trimmed slug.
- An unrecognised slug never matches — it fails closed (item hidden, route denied).
- A child's `requiresRole` is evaluated **independently** of its parent. A parent visible to `all` may hold children restricted to `admin`. A parent that is hidden hides its children regardless of their own rule.

### Real shipped content (as of 2026-08-13)

The illustrative example in the original draft (`/cv-2` + `/cv-2/main`) does not match what's
actually published. The real `header.nav`, confirmed live:

| Item | Link | `requiresRole` |
|---|---|---|
| Home | `/` | public |
| CV | `/cv` | public |
| Learning (parent, no own link) | — | `admin,super_admin` |
| ↳ Develop: Architecture / Go / React | `/learning/develop/{architecture,go,react}` | `admin,super_admin` |
| ↳ English: Vocabulary / Game | `/learning/english`, `/learning/english/game` | `admin,super_admin` |
| Vaccine | `/vaccine` | `admin,super_admin` |
| Interview (parent) | — | `admin,super_admin` |
| ↳ Questions / Answers | `/interview`, `/interview/answers` | `admin,super_admin` |
| Secret | `/secret` | `super_admin` |
| Account | `/account` | `super_admin` |

`/cv-2` has **no** nav entry (D5) — it's public by the fail-open default for unlisted paths, not
because it's marked `"all"`.

Resulting visibility:

| Path | anonymous | guest | editor | admin | super_admin |
|---|---|---|---|---|---|
| `/`, `/cv`, `/cv-2` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/vaccine`, `/learning/*`, `/interview*` | ✗ | ✗ | ✗ | ✓ | ✓ |
| `/secret`, `/account` | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## Route Access Rules

### Matching

A request path (locale stripped via `stripLocale()`) is matched against every `link` in the header
tree, via `buildRouteRules()`/`resolveRule()` (`src/lib/nav/route-rules.ts`). The **longest matching
prefix wins**.

- Exact match, or prefix match on a `/` boundary (e.g. a rule on `/foo` covers `/foo/anything`, but not `/foo-bar`).
- `/` matches only the exact home path — never used as a prefix, or it would swallow the whole site.

### Default for unlisted paths

Paths with **no** matching nav entry are **public** (D5) — see the `/cv-2` note above for the one
case where this is load-bearing today.

### Enforcement points (defence in depth)

1. **`src/proxy.ts`** — runs before the page, composed as `auth(async (req) => …)` (not the
   documented `export { auth as proxy }`, which would silently drop the existing health gate and
   i18n rewrite). Reads `req.auth`'s role slug, resolves the rule via
   `src/lib/nav/nav-rules-cache.ts` (a stale-while-revalidate cache shaped like
   `healthCache.ts`, 300s TTL), redirects on denial. Primary enforcement. On a header fetch that has
   **never once** succeeded (`rules === null`, no stale cache to fall back on), it denies anonymous
   visitors on a hardcoded `KNOWN_PROTECTED_PATHS` list — a literal copy of the old
   `PROTECTED_PATHS` — rather than fail open.
2. **Header rendering** — `filterNavTree()` runs server-side inside `HeaderBar` before the first
   byte, so a disallowed link is never in the HTML, not just CSS-hidden. Presentation, not
   enforcement on its own.
3. **`requireRole(path, locale)`** (`src/lib/auth/require-role.ts`) — an explicit assertion inside
   protected Server Components (`/secret`, `/account`), reading the *same* `nav-rules-cache`
   singleton as the proxy so the two guards can't drift onto different answers for the same path.
   Keeps a page safe if it's ever excluded from the proxy matcher.

Layer 2 alone is not enforcement. Layers 1 and 3 are.

---

## Session Design

*(Rewritten around Auth.js v5 — see D1. The original hand-rolled-BFF design this section specced is
superseded.)*

### Cookie

| Cookie | Set by | Contents | Flags |
|---|---|---|---|
| `authjs.session-token` | Auth.js | JWE containing `{ accessToken, refreshToken, accessTokenExpires, roleSlug, name, email, error? }` | `httpOnly`, `secure` (prod), `sameSite=lax`, `path=/` |

There's exactly one cookie — cms-api's own `refresh_token` `Set-Cookie` is never relayed to the
browser (see Contract section above). Both tokens live inside the single Auth.js-managed JWE. The
`session` callback strips `accessToken`/`refreshToken` before anything reaches client JS — enforced
at the type level, since they're deliberately absent from the augmented `User`/`Session` interfaces,
so `Session.user` structurally cannot carry them. `curl localhost:4000/api/auth/session` returns
`{ user: { name, email, roleSlug }, accessTokenExpires, error? }` and nothing token-shaped.

### Flows

**Login**
1. `AuthPage.tsx` calls `signIn("credentials", { email, password, rememberMe, redirect: false })`.
2. Auth.js's `authorize()` (`auth.config.ts`) calls cms-api `POST /auth/login`, then `GET /auth/me`,
   via `src/lib/auth/cms-auth.client.ts`. A `403` (unverified account) surfaces as a distinct
   `UnverifiedAccountError` `code`, separate from a plain `401`, so the login form can show a
   different inline message.
3. The `jwt` callback persists `accessToken`, `refreshToken`, `accessTokenExpires`, and `roleSlug`
   into the encrypted token on first sign-in.
4. The `session` callback reconstructs a client-safe view: `{ user: { name, email, roleSlug },
   accessTokenExpires, error? }` — never the tokens themselves.
5. On success, `AuthPage.tsx` navigates to `safeReturnTo(returnTo)` and calls `router.refresh()` so
   Server Components (the header included) re-render with the new session.

**Session read (server)**
`auth()` (from `auth.ts`) reads and decrypts the session cookie. Server Components, `proxy.ts`, and
`requireRole()` all read the same function.

**Refresh (D10)**
The `jwt` callback refreshes proactively on an early 60s skew window before `accessTokenExpires` (or
on `trigger === "update"`, i.e. `useSessionTimeout`'s "extend session"), routed through
`refresh-coalescer.ts`'s single-flight map so parallel requests crossing the boundary produce exactly
one `cms-api /auth/refresh` call. On failure, `token.error = "RefreshTokenError"` is set and
surfaced through `session`, which the proxy/`requireRole()` treat as an anonymous visitor on the
next request.

**Logout**
`UserMenu.tsx`'s logout handler first calls `POST /api/auth/logout-remote` (reads the refresh token
via `next-auth/jwt`'s `getToken()`, since the `session` callback deliberately strips it before
`auth()` ever sees it) to revoke server-side at cms-api, **then** `signOut({ redirect: false })` to
drop the local Auth.js cookie, then `router.refresh()`. Doing only `signOut()` would leave cms-api's
refresh token live and replayable.

### Failure behaviour

| Condition | Behaviour |
|---|---|
| cms-api unreachable during login | Login form shows the fallback inline error. Existing health gate (`proxy.ts` → `/unhealthy`) still applies first. |
| Access token expired, refresh succeeds | Transparent; request proceeds (D10). |
| Access token expired, refresh fails (401/blacklisted) | `token.error = "RefreshTokenError"`; session fields null out; next protected request redirects to login. |
| Header content fetch has never once succeeded | Route guard denies anonymous visitors on `KNOWN_PROTECTED_PATHS` (a legacy-path safety net) rather than fail open. Header content fetch failing *after* a successful fetch serves the last good cached rules (stale-while-revalidate). |
| GraphQL response is a 200 with `errors[]` (e.g. token permission issue) | `graphqlApi.ts`'s `graphqlFetch` falls back to the dev-only mock (same gate as the network-failure path) rather than throwing uncaught inside a Server Component. |

---

## Commands

```bash
# from apps/frontend
bun run dev              # next dev --turbopack --port 4000
bun run build             # next build
bun run start             # next start --port 5005
bun run lint               # eslint ./src   ← always this, never `bunx eslint .`
bun run analyze            # ANALYZE=true next build
bun test                   # unit tests — src/lib/{auth,nav}/**/*.test.ts

# E2E (Playwright) — requires dev server on :4000 and a running cms-api
bunx playwright test
bunx playwright test e2e/auth-login.test.ts
bunx playwright test --ui

# cms-api (separate terminal, from apps/cms-api)
bun run start:dev        # serves REST + GraphQL on :8080
```

### Environment variables (`apps/frontend`)

| Var | Purpose | Status |
|---|---|---|
| `AUTH_SECRET` | Auth.js's JWE signing/encryption key for `authjs.session-token`; the app fails loudly at build/boot if unset | **new** |
| `CMS_API_URL` | REST base for `/auth/*` — **include the `/api/v1` prefix**, e.g. `http://localhost:8080/api/v1` (not documented in `.env.example` today — a known doc gap, Correction 17) | **new** |
| `GRAPHQL_URL` | CMS GraphQL endpoint — bare path, no `/api/v1`, e.g. `http://localhost:8080/graphql` | existing |
| `GRAPHQL_TOKEN` | service API token for content fetches (`document:read` on `header`, minted via cms-admin's Users → Access Tokens) | existing |
| `APP_PASSCODE` | shared passcode | **removed (D3)** — appears nowhere in the repo |
| `SESSION_SECRET` | old HMAC session key | **removed (D3)** — appears nowhere in the repo |

`.env.example` still needs a pass to reflect this table exactly (drop the stale "Strapi CMS"
labels/`STRAPI_API_TOKEN`, add `CMS_API_URL`'s `/api/v1` note) — flagged, not yet done as of this
rewrite; see `tasks/plan.md` Correction 21.

---

## Project Structure

What actually shipped, in the existing conventions:

```
apps/frontend/
├── src/
│   ├── auth.config.ts                Edge-safe provider list — Credentials provider, jwt/session callbacks
│   ├── auth.ts                       NextAuth({...authConfig}) → { handlers, auth, signIn, signOut }
│   ├── app/
│   │   ├── api/auth/
│   │   │   ├── [...nextauth]/route.ts    re-exports Auth.js's handlers
│   │   │   └── logout-remote/route.ts    POST → cms-api /auth/logout (reads refresh token via getToken())
│   │   └── [locale]/(main)/
│   │       ├── layout.tsx                calls auth(), wraps children in <SessionProvider>
│   │       ├── auth/page.tsx             renders AuthPage with a validated returnTo
│   │       ├── secret/page.tsx           requireRole() guard
│   │       └── account/page.tsx          requireRole() guard
│   ├── proxy.ts                      health gate → role guard (composed auth()) → i18n rewrite
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── cms-auth.client.ts        cmsLogin/cmsGetMe/cmsLogout/cmsRefresh — server-only
│   │   │   ├── decode-token-expiry.ts    reads `exp` off cms-api's JWT, no verification (Edge-safe)
│   │   │   ├── safe-return-to.ts         same-origin-relative validation for returnTo
│   │   │   ├── refresh-coalescer.ts      single-flight refresh map (D10) + .test.ts
│   │   │   └── require-role.ts           requireRole(path, locale) for Server Components
│   │   └── nav/
│   │       ├── role-match.ts             isRoleAllowed() + .test.ts
│   │       ├── nav-filter.ts             filterNavTree() + .test.ts
│   │       ├── route-rules.ts            buildRouteRules()/resolveRule() + .test.ts
│   │       ├── strip-locale.ts           shared locale-stripping helper + .test.ts
│   │       └── nav-rules-cache.ts        stale-while-revalidate cache + isAccessDenied() + .test.ts
│   ├── hooks/useSessionTimeout.ts    repurposed at real token expiry, not deleted (D7)
│   ├── types/next-auth.d.ts          Session/JWT module augmentation (roleSlug, accessTokenExpires, error)
│   ├── components/
│   │   ├── auth/
│   │   │   ├── LoginButton.tsx           header CTA, label from CMS btnLoginText
│   │   │   └── UserMenu.tsx              dropdown: name/email + logout, label from btnLogoutText
│   │   └── layouts/header/
│   │       ├── HeaderBar.tsx             Server Component: auth() + getHeader() + filterNavTree()
│   │       ├── HeaderNav.tsx             desktop nav, consumes filtered nav
│   │       └── HeaderMobileMenu.tsx      same, mobile sheet
│   ├── views/
│   │   ├── header/
│   │   │   ├── header.service.ts         registerService + getHeader()
│   │   │   ├── header.queries.ts         HEADER_QUERY
│   │   │   └── header.types.ts           HeaderData, HeaderNavItem
│   │   └── auth/AuthPage.tsx             email/password/remember-me form, inline errors
│   └── mocks/header.ts               dev-only fallback when cms-api/GraphQL is unreachable
└── e2e/
    ├── test-helpers.ts               loginAs(page, role, targetPath)
    ├── auth-login.test.ts            returnTo round-trip, logout journey
    ├── nav-role-visibility.test.ts   anonymous/admin/super_admin link visibility
    ├── route-guard.test.ts           direct-URL redirect enforcement
    └── (7 pre-existing specs)        migrated off the passcode form onto loginAs()
```

**Deleted at T14 (D3):** `src/components/auth/SessionGuard.tsx`, `src/libs/session.ts` (and
`src/libs/` entirely), `src/app/actions/app-auth.ts`, `src/components/layouts/header/header.data.ts`
(deleted at T3).

---

## Code Style

Match the existing service/registry pattern exactly. Reference — `src/views/header/header.service.ts`:

```ts
import { unifyFetch } from "@/api/fetcher";
import graphqlApi from "@/api/graphqlApi";
import { registerService } from "@/api/registry";

import { HEADER_QUERY } from "./header.queries";
import type { HeaderData } from "./header.types";

export const HEADER_KEY = "header" as const;

async function _fetchHeader(): Promise<HeaderData | null> {
  const data = await graphqlApi.fetch<HeaderData>({
    body: { query: HEADER_QUERY },
    selectKey: "header",
    mock: "header",
    next: { revalidate: 300, tags: ["header"] },
  });
  return data ?? null;
}

registerService({ key: HEADER_KEY, driver: "graphql", execute: _fetchHeader });

export async function getHeader(): Promise<HeaderData | null> {
  return unifyFetch<HeaderData | null>({ apiKey: HEADER_KEY });
}
```

Pure role logic stays dependency-free and directly unit-testable — `src/lib/nav/role-match.ts`:

```ts
const PUBLIC_TOKENS = new Set(["", "all"]);

// "" / missing / "all" → public. Otherwise a comma-separated allow-list of role slugs.
export function isRoleAllowed(
  requiresRole: string | null | undefined,
  roleSlug: string | null | undefined,
): boolean {
  const raw = (requiresRole ?? "").trim().toLowerCase();
  if (PUBLIC_TOKENS.has(raw)) return true;
  if (!roleSlug) return false;

  return raw
    .split(",")
    .map((slug) => slug.trim())
    .includes(roleSlug.trim().toLowerCase());
}
```

### Conventions

- Named exports for components (`export { HeaderBar }`), default export only for the api singletons.
- `React.FC` typing on components, matching `HeaderBar.tsx`.
- `"use client"` only where interactivity demands it — `UserMenu`, `AuthPage`. `HeaderBar` is a Server Component.
- Import order enforced by `@trivago/prettier-plugin-sort-imports`: external → `@/` aliases → relative.
- `_privateFn` underscore prefix for module-local helpers, as in `home.service.ts`.
- Comments explain **why**, not what — match the density of `proxy.ts`.
- Locale stripping goes through the one shared `stripLocale()` helper.

---

## Testing Strategy

| Level | Runner | Location | Covers |
|---|---|---|---|
| Unit | `bun test` | `src/lib/{auth,nav}/**/*.test.ts` | `isRoleAllowed`, `filterNavTree`, `buildRouteRules`/`resolveRule`, `stripLocale`, `isAccessDenied`, the refresh coalescer |
| E2E | Playwright | `e2e/*.test.ts` | login/logout journeys, nav visibility per role, direct-URL guard |

### Required unit cases (shipped)

- `isRoleAllowed`: `""` / `undefined` / `"all"` → public; single slug; multi-slug; whitespace `"admin, super_admin"`; case variance; unknown slug fails closed; anonymous (`roleSlug` nullish) against a non-public rule.
- `filterNavTree`: parent public + child restricted; parent restricted hides children; empty parent after filtering is dropped only if it has no own `link`.
- `resolveRule`: longest-prefix wins; `/` never acts as a prefix; a rule on `/foo` doesn't match `/foo-bar`; unlisted path → public.
- `isAccessDenied` (`nav-rules-cache.ts`): 12 cases covering the `rules === null` (`KNOWN_PROTECTED_PATHS`) fallback separately from the normal resolved-rules path.
- Refresh coalescer: 10 concurrent calls for the same refresh token → exactly one underlying call (D10).

There is no session seal/unseal module — that was specific to the superseded hand-rolled-BFF design
(D1) and doesn't exist under Auth.js, which owns its own cookie encryption.

### Required E2E cases (shipped, `e2e/{auth-login,nav-role-visibility,route-guard}.test.ts`)

- Anonymous sees the Login link and only public nav (`Home`, `CV`); no `Vaccine`/`Secret`/`Account` link in the `<header>` DOM.
- `admin` → admin-gated links (e.g. `Vaccine`) appear; `Secret`/`Account` still absent.
- `super_admin` → `Secret` and `Account` links appear too.
- Anonymous hits `/en/secret` directly → redirected to `/en/auth?returnTo=%2Fen%2Fsecret`; after login, lands on `/en/secret`.
- `admin` hits `/en/secret` directly → redirected, not rendered.
- Logout → Login link back, protected links gone from the header, protected URL redirects again — without a hard reload.

(The original draft's example used `/cv-2/main`, which doesn't exist in the real shipped nav — see
the Contract section's "Real shipped content" table.)

### Coverage

Pure modules in `src/lib/auth/` and `src/lib/nav/` target **100% branch coverage** — they are small,
total functions, and every branch is a security decision. Per project convention, no blanket 80%
threshold is imposed on route handlers or components (or on Prisma/controller-style files, per this
project's general coverage convention).

### Existing E2E migration (shipped, T15)

All 7 pre-existing specs moved off `unlockAndGoto()`/the passcode form onto
`loginAs(page, role, targetPath)` in `e2e/test-helpers.ts`, which fills the real Credentials form
using per-role env credentials (`E2E_<ROLE>_EMAIL`/`E2E_<ROLE>_PASSWORD` — **not yet set in
`.env.local`** as of this rewrite; a live green run of the full suite is owed until they are, see
`tasks/plan.md` Corrections 19-20). `cv-spacing.test.ts` dropped its login step entirely since `/cv`
is public; `secret-file-loader.test.ts` gained one since `/secret` is newly gated (it was never in
the old `PROTECTED_PATHS`).

---

## Boundaries

**Always**
- Enforce access in `proxy.ts` and/or `requireRole()`. Hiding a link is never the enforcement.
- Keep tokens inside the Auth.js-managed httpOnly session cookie. Never return an access token from a route body.
- Fail closed on unknown/unparseable `requiresRole` and on a header fetch that has never once succeeded.
- Strip the locale prefix before path matching.
- Run `bun run lint` before every commit (never `bunx eslint .` directly).
- Update this spec first when a decision changes, then the code.

**Ask first**
- Changing `apps/cms-api/content-types/header.json` (adds a migration for existing content).
- Adding any npm dependency.
- Upgrading `next-auth` off the pinned `5.0.0-beta.32` (D11).
- Changing the unlisted-path default from public to denied (D5/Q2, resolved as fail-open).
- Touching anything in `apps/cms-admin` or `apps/frontend-v2`.

**Never**
- Read the session cookie from client-side JS.
- Put role logic only in the component layer.
- Commit secrets, or a real `AUTH_SECRET` default that ships to prod.
- Send the user's access token to the GraphQL content endpoint — it only accepts API tokens.
- Delete or skip a failing E2E test to make the suite pass.

---

## Success Criteria

1. ✅ `apps/frontend` header renders `name`, nav items, and login/logout labels sourced from the CMS `header` single-type — `header.data.ts` no longer exists.
2. ✅ Anonymous visitor sees a Login button; nav shows only items whose `requiresRole` is empty/`all`.
3. ✅ Successful login replaces the button with a dropdown showing the user's name/email and a Logout button labelled from `author.btnLogoutText`.
4. ✅ Nav items whose `requiresRole` excludes the current role are absent from the server-rendered HTML — not hidden with CSS.
5. ✅ Direct navigation to a path governed by a `requiresRole` the user does not satisfy redirects to `/{locale}/auth?returnTo=<path>`, both anonymous and under-privileged.
6. ✅ After login from a `returnTo` redirect, the user lands on the originally requested path.
7. ✅ Logout revokes the refresh token server-side (cms-api `/auth/logout`), clears the session cookie, and the previously visible protected links disappear without a hard reload.
8. ✅ An expired access token is refreshed transparently (D10); a blacklisted/failed refresh forces re-login.
9. ✅ Zero auth flicker: the first painted HTML already reflects the correct role.
10. **Partial** — `bun run lint` and `bun test` are clean; `bunx playwright test` is not yet fully green — blocked on `E2E_<ROLE>_EMAIL`/`PASSWORD` not being set in `.env.local` (Corrections 19-20), not on any code defect (the credential-gated specs fail with an explicit named error, not a timeout).
11. ✅ `APP_PASSCODE` and `SESSION_SECRET` appear nowhere in the repo.
12. ✅ Unit tests for `src/lib/auth/` and `src/lib/nav/` at 100% branch coverage.

---

## Resolved Open Questions

**Q1 — `description` field on nav items.** **Deferred.** Presentational and independent of gating;
`header.json` has no such field and adding it means a content migration. No follow-up scheduled.

**Q2 — Default for paths not in the CMS nav.** **Resolved as fail-open (D5)**, paired with T1's
audit of every `PROTECTED_PATHS` entry into the CMS nav before the passcode gate was removed at
T14. The one path that ended up genuinely unlisted (`/cv-2`) was a deliberate call, not an oversight
— see D5.

**Q3 — Unit test runner.** **Resolved: `bun test`** (D6). `src/lib/{auth,nav}/**/*.test.ts`, wired
via `"test": "bun test src"` in `package.json` — scoped to `src`, not bare `bun test`, since Bun's
default test glob otherwise also picks up `e2e/*.test.ts`, which are Playwright specs and fail
outright under Bun's runner (`test.describe() did not expect to be called here`). Found and fixed
during this doc pass (Correction 21) — every prior verification in this plan ran the already-scoped
`bun test src` by hand and never exercised the bare `package.json` script.

**Q4 — What does the login page look like?** **Resolved (D8):** same Card shell, email + password +
remember-me + inline error, no link to cms-admin (out of scope, non-goal).

**Q5 — Does the user's role affect anything beyond nav and route access?** **Resolved: no.** Role
governs nav visibility and route access only; CV/learning content itself doesn't vary by role.

---

## Known gaps and follow-ups (not covered by this feature)

- **`.env.example` is stale** — still labels `GRAPHQL_URL`/`STRAPI_API_TOKEN` as "Strapi CMS" and
  doesn't document `CMS_API_URL`'s required `/api/v1` suffix or the new `E2E_<ROLE>_EMAIL`/
  `E2E_<ROLE>_PASSWORD` test-credential vars. Flagged in `tasks/plan.md` Correction 21; not fixed as
  part of this rewrite (outside what this assistant's environment permits editing).
- **`/cv` and `/cv-2` 500 for every role** — unrelated pre-existing bug (`tasks/plan.md` Correction
  18): no CV content has ever been seeded in this cms-api instance, and
  `CvElegantPageContent.tsx:26` doesn't null-check `data.position`. Not part of this feature's scope.
- **A fully green `bunx playwright test` run is owed** until `E2E_ADMIN_EMAIL`/`PASSWORD` and
  `E2E_SUPER_ADMIN_EMAIL`/`PASSWORD` exist in `.env.local` for the accounts provisioned in
  Correction 17.

---

## Next Steps

Implementation is complete (T1–T16). Remaining before Checkpoint F fully closes:

1. Set `E2E_ADMIN_EMAIL`/`PASSWORD` and `E2E_SUPER_ADMIN_EMAIL`/`PASSWORD` in `.env.local`, then
   confirm `bunx playwright test` is fully green.
2. Bring `.env.example` up to date per "Known gaps" above.
3. `/agent-skills:review` per `tasks/todo.md`'s Checkpoint F.

# Plan: CMS-Driven Login & Role-Gated Navigation

See `SPEC.md` for the full spec (objective, confirmed assumptions, boundaries, success criteria).
This plan implements it, with corrections found during planning (below) that the spec did not
anticipate.

**Auth:** Auth.js v5 (`next-auth@5.0.0-beta.32`), Credentials provider.
**Plan reviewed and approved 2026-08-12.**

## Context

`apps/frontend` currently gates its pages behind a **single shared passcode**. `SessionGuard` runs
client-side, compares against `APP_PASSCODE`, and stores an HMAC blob in `sessionStorage` against a
hardcoded `PROTECTED_PATHS` array. There is no notion of *who* is browsing — only whether they know
the passcode. Separately, the header nav is a hardcoded `NAV_ITEMS` array, so adding a link needs a
deploy.

Meanwhile `apps/cms-api` already ships everything needed for real identity: `/auth/login|refresh|logout|me`,
a role ladder (`super_admin` 100 → `admin` 50 → `editor` 20 → `guest` 0), refresh-token rotation with
blacklisting, and a `header` single-type whose nav items **already carry `requiresRole`**.

This plan wires the two together: real per-user login, and a header whose links *and* route-access
rules both come from one CMS-authored source. Outcome — an editor controls site navigation and who
may reach each page from the CMS, and the frontend enforces it server-side with no auth flicker.

**No `apps/cms-api` changes are required.**

## Corrections found during planning (supersede SPEC.md)

1. **Auth.js v5 replaces the hand-rolled BFF session.** SPEC.md specifies a bespoke `abyss_session`
   cookie with our own seal/unseal. Superseded: OAuth (Google/GitHub) is on the roadmap, which is
   the case Auth.js is built for, and it also removes hand-rolled cookie crypto and closes a CSRF
   gap the spec never addressed. `AUTH_SECRET` replaces `SESSION_COOKIE_SECRET`; the session cookie
   is `authjs.session-token`, JWE-sealed by the library.

2. **New code goes in `src/lib/`, not `src/libs/`.** SPEC.md's Project Structure says `src/libs/`.
   The repo has both directories: `@/lib/` is imported 75× (`utils.ts`, `crypto.ts`, `health/`,
   `html-parser/`), `@/libs` only 3× and solely for the `session.ts` that T14 deletes. Using
   `src/libs/` would grow a directory we are about to remove. `src/libs/` disappears entirely at T14.

3. **`useSessionTimeout` is repurposed, not deleted.** SPEC.md lists it for deletion. It is used by
   `src/views/secret/Secret.tsx` and `src/views/account/AccountManager.tsx` — deleting it breaks both
   pages. It is re-pointed at token expiry instead, with "extend session" triggering a session
   refresh, keeping the existing warning/countdown UX.

4. **Auth.js's documented Next 16 proxy export would silently delete the health gate and i18n.**
   The docs say `export { auth as proxy } from "@/auth"`. This repo's `src/proxy.ts` already runs a
   health gate (`getApiHealth` → rewrite to `/unhealthy`) and the i18n locale rewrite. T11 **composes**
   — `export const proxy = auth(async (req) => …)` — preserving health-gate → role-guard → i18n order.

5. **Auth.js's refresh-rotation pattern races against cms-api's blacklist.** Their guide states a
   "race-condition might occur if multiple requests will try to refresh the token at the same time"
   and ships no coalescing. `cms-api` blacklists a refresh token the moment it is consumed
   (`tryClaim()`), so two parallel RSC requests crossing an expiry boundary log the user out. T13
   routes rotation through a module-level single-flight coalescer (same shape as
   `src/lib/health/healthCache.ts`), refreshes on an early skew window, and surfaces failure as a
   forced re-login rather than a silent broken state. **This is the highest-risk task in the plan.**

6. **cms-api's `refresh_token` cookie cannot be relied on cross-origin.** SPEC.md's BFF design
   relays cms-api's `Set-Cookie` to the browser, which only works same-site. cms-api is a separate
   origin in production. The refresh token is instead captured from the login response and carried
   inside the Auth.js JWE.

7. **The `header` document must be *published* or the nav is empty.** `header.json` sets
   `"draftToPublish": true`, and the GraphQL single-type resolver returns the published row by
   default — an unpublished document yields `data.header === null`, not an error. `header(status: "draft")`
   reads the draft.

8. **T1's real content authoring is deferred; T2 uses the mock (2026-08-12).** The `header`
   content-type already exists in cms-api (`content-types/header.json`) and was synced via
   `bun run prisma:generate`. Creating the actual published document + per-role test users is
   deferred — `src/mocks/header.ts` is the interim source of truth in dev, exactly like every other
   view's `restfulApi` → `MockView` fallback. Two things worth recording while this was verified live
   against the running cms-api (`:8080`):
   - **SPEC.md's/T1's `navigations`/`name` field names are stale.** The actual schema
     (`content-types/header.json`) uses `nav` (not `navigations`) and `title` (not `name`) per item.
     Confirmed via a live GraphQL query against the running server — `nav`/`title`/`subNavigations`
     resolve; `navigations`/`name` would not.
   - **A GraphQL resolver error returned with HTTP 200 is not caught by the mock fallback.**
     `restfulApi.fetch`'s dev-mock fallback only triggers on a thrown fetch (network failure) or a
     non-2xx HTTP status. `graphqlApi.ts`'s `graphqlFetch` throws separately, *after* `restfulApi.fetch`
     already returned successfully, whenever the GraphQL response body carries a 200-status
     `errors[]` (e.g. `UNAUTHENTICATED` from `assertApiTokenPermission` once `header`'s real
     `document:read` auth is enforced) — that throw has no catch, so it does not fall back to mock.
     This is pre-existing in shared `src/api/graphqlApi.ts` (every service using it is equally
     affected), reproduced only when cms-api is reachable but rejects the request — not exercised by
     T2's "stop cms-api → mock renders" verify step, which covers the network-failure path only.
     Confirmed harmless for T2 (mock renders correctly when cms-api is unreachable, and the header
     schema field names are verified correct); flagged here since it will surface for real once a
     `GRAPHQL_TOKEN` is wired up without matching permissions, or once **any** authenticated
     content-type ships.

9. **The gap above stopped being hypothetical at T3 (2026-08-12) and got fixed.** `GRAPHQL_URL` in
   this dev environment already points at the live cms-api on `:8080`, and `header`'s real
   `document:read` auth is already enforced — so `getHeader()` hit the 200-with-`errors[]` case on
   every request, threw uncaught inside `graphqlFetch`, and the header silently rendered as nothing
   (no error boundary catches an uncaught throw from a Server Component's async body). Confirmed via
   the raw page HTML (`main` shell empty, RSC stream carrying the `GraphQL request failed` error for
   the `HeaderBar` segment). Fixed in `graphqlApi.ts`: `graphqlFetch` now falls back to `MockView[mock]`
   (dev-only, same gate as `restfulApi.ts`) when the response carries GraphQL-level errors, not just
   on a thrown/non-2xx fetch. This is a shared-file change beyond T3's declared `Files:` list, but
   necessary — T3 cannot pass its own "nav items ... from the CMS" acceptance criterion without it in
   this environment. Verified after the fix: all 11 nav links (`/`, `/cv`, `/cv-2`, `/vaccine`,
   `/learning/english`, `/learning/develop/{react,architecture,go}`, `/interview`,
   `/interview/answers`, `/secret`, `/account`) present in the RSC payload, no thrown error.

10. **T6's live curl verify step is deferred, not skipped (2026-08-12).** T6's own Verify line
    (`curl -i -X POST .../api/auth/callback/credentials`) needs a running cms-api plus a real test
    account, and both are still blocked on T1 (deferred, Correction 8) — there is no verified test
    user yet. Verified instead: `bun test src` (11 new cases covering `cmsLogin`/`cmsGetMe`,
    including the 401-vs-403 distinction and Set-Cookie parsing), `bun run lint`, `bunx tsc --noEmit`
    all clean, and `bun run build` — which fails *only* at `Failed to collect page data for
    /api/auth/[...nextauth]` with the exact `AUTH_SECRET must be set` message, i.e. the fail-loud
    behaviour the acceptance criterion asks for, triggered because no `AUTH_SECRET` exists in this
    environment yet (not written to `.env.local` — outside this assistant's permitted file access).
    The live curl check is still owed once `AUTH_SECRET`/`CMS_API_URL` are set locally and T1
    produces a real account.

## Resolved open questions

| Q | Resolution |
|---|---|
| Q1 — `description` per nav item | **Deferred.** Presentational and independent of gating; `header.json` has no such field and adding it means a content migration. |
| Q2 — unlisted paths | **Public**, but T1 audits every current `PROTECTED_PATHS` entry into the CMS nav *before* T14 removes the passcode. |
| Q3 — unit test runner | **Add `bun test`** — built into Bun, zero new deps. The role/route logic is branch-heavy and every branch is a security decision. |
| Q4 — login page scope | Email + password + remember-me + inline error, in today's Card shell. `rememberMe` drives cms-api's refresh-token lifetime. |
| Q5 — role beyond nav | **No.** Role governs nav visibility and route access only. |

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Auth.js v5 + Credentials provider; cms-api stays the identity source | OAuth is on the roadmap; avoids a later migration |
| D2 | `requiresRole` = `""`/`"all"` → public, else comma-separated slug allow-list | Explicit and readable in the CMS; no hidden level ladder |
| D3 | Passcode gate removed entirely | Real login supersedes it |
| D4 | Denied → redirect `/{locale}/auth?returnTo=<path>`, same for anonymous and under-privileged | Doesn't leak which paths exist |
| D5 | Unlisted paths public, legacy paths audited into the CMS first | Fail-open default without silently exposing today's gated pages |
| D6 | `bun test` for pure logic, 100% branch coverage | Every branch is a security decision |
| D7 | `useSessionTimeout` repurposed (Correction 3) | Two views depend on it |
| D8 | Login page: email + password + remember-me + inline error | Q4 |
| D9 | New code in `src/lib/` (Correction 2) | Matches the 75:3 import split |
| D10 | Refresh coalescing is ours, not Auth.js's (Correction 5) | cms-api blacklists consumed tokens |
| D11 | Auth.js pinned exactly, no `^` | It is `5.0.0-beta.32`; betas have shipped breaking changes |

## Dependency graph

```
T1 CMS content authored (+ test users)
 └─> T2 header service ──> T3 header renders CMS nav        [Phase 1: nav is CMS-driven]
      │                     │
      ├─> T4 role-match ────┤
      │    └─> T5 nav-filter + route-rules                  [Phase 2: pure logic, tested]
      │         │
      ├─> T6 Auth.js wiring ─> T7 jwt/session callbacks
      │                          └─> T8 login page
      │                               └─> T9 header auth UI  [Phase 3: can log in]
      │                                    ├─> T10 nav filtering
      │                                    ├─> T11 proxy guard (composed with auth())
      │                                    └─> T12 requireRole()
      │                                         │            [Phase 4: gating live]
      │                                         ├─> T13 refresh + coalescing + idle timeout
      │                                         └─> T14 delete passcode gate
      │                                              │       [Phase 5: teardown]
      └──────────────────────────────────────────────┴─> T15/T16 E2E, T17 docs
```

T4/T5 (pure logic) and T6/T7 (Auth.js wiring) have no dependency on Phase 1 and can be built in
parallel with it. Everything from T10 onward is strictly sequential.

## Key mechanics discovered during exploration

- **GraphQL query is `header(status: String)`** — camelCase of the slug, per
  `src/modules/graphql/domain/naming.ts` in cms-api. Components nest flat, no `data`/`attributes`
  wrapper. `selectKey: "header"`.
- GraphQL requires an API token with `document:read` or `document:read:header` — the **service token**
  (`GRAPHQL_TOKEN`), never the user's JWT. The user's JWT is not accepted there at all.
- **`i18n` rewrites, it does not redirect** — `/secret` stays `/secret` in the URL bar while
  rendering `/en/secret`. Path matching must handle both prefixed and unprefixed URLs. This also
  makes Auth.js's single static `pages.signIn: "/auth"` work despite `[locale]` routing.
- Credentials failure redirects to `?error=CredentialsSignin&code=credentials` by default — use
  `signIn("credentials", { redirect: false })` to render errors inline instead.
- `src/lib/health/healthCache.ts` is a ready-made stale-while-revalidate + `waitUntil` single-flight
  cache. Reuse its shape for both the nav route rules (T11) and the refresh coalescer (T13).
- `proxy.ts`'s matcher already excludes `api`, so `/api/auth/[...nextauth]` is naturally exempt.
- Reuse the existing service/registry pattern (`src/views/home/home.service.ts`,
  `src/api/fetcher.ts`, `src/api/registry.ts`) for the header fetch — do not add a new fetch path.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Refresh race trips cms-api's blacklist → users randomly logged out | **High** | D10: single-flight coalescer + early-skew refresh + explicit error state. T13 asserts 10 parallel requests → exactly 1 refresh call |
| T1 audit misses a path → a gated page goes public at T14 | **High** | T1 acceptance explicitly diffs against `PROTECTED_PATHS`; Checkpoint D is a hard gate before T14 |
| Following Auth.js's `export { auth as proxy }` verbatim drops the health gate + i18n | **High** | T11 composes instead; acceptance re-verifies `/unhealthy` and locale rewrite |
| Auth.js beta churn breaks a later install | Med | D11 pins `5.0.0-beta.32` exactly; upgrades become a deliberate task |
| Access/refresh token leaking into the client session payload | Med | T7 asserts `/api/auth/session` is token-free; the `session` callback is the only client-facing surface |
| GraphQL fetch in the proxy adds latency to every request | Med | Reuse `healthCache`'s stale-while-revalidate + `waitUntil`; 300s TTL |
| i18n rewrite breaks path matching or `returnTo` | Med | T5 ships a shared `stripLocale`; T11 covers prefixed and unprefixed URLs |
| Redirect loop on `/auth` | Med | `/auth` explicitly exempt in T11; E2E asserts no loop |
| Header unpublished → `data.header` is `null`, nav empties | Med | Correction 7; mock fallback + deny-known-non-public on fetch failure |
| Deleting `SessionGuard` breaks the 7 existing E2E tests | Low | Known and sequenced — T15 immediately follows T14 |

## End-to-end verification

```bash
# Terminal 1 — cms-api (header must be PUBLISHED, draftToPublish is true)
cd apps/cms-api && bun run start:dev

# Terminal 2 — frontend
cd apps/frontend && bun run dev

bun test                  # pure logic, 100% branch on src/lib/{auth,nav}
bun run lint              # never `bunx eslint .`
bun run build
bunx playwright test      # 7 migrated + 3 new specs
```

**Manual matrix** — for each of anonymous / `guest` / `editor` / `admin` / `super_admin`:

1. View-source the homepage; confirm only permitted links are in the HTML (not CSS-hidden).
2. Direct-navigate to `/secret`, `/account`, `/cv-2/main`; confirm 200 or redirect per the SPEC.md matrix.
3. Log in from a `returnTo` redirect; confirm landing on the originally requested path.
4. Log out; confirm links vanish, protected URLs redirect, and the cms-api refresh token is revoked.

**Refresh-race check (T13 — the one that needs proving):**

```bash
# with a short access-token TTL on cms-api, across the expiry boundary
seq 1 10 | xargs -P10 -I{} curl -s -b cookies.txt localhost:4000/secret -o /dev/null
# assert cms-api logged exactly ONE POST /auth/refresh
```

## Roadmap seam (not built now)

OAuth is the reason Auth.js was chosen. Adding Google/GitHub later means adding the provider to
`auth.config.ts` and deciding how an OAuth identity maps onto a cms-api user + role — cms-api
currently issues roles only through its own registration/OTP flow, so that mapping is the open design
question, not the Auth.js wiring.

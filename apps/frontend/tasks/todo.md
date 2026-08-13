# Todo — CMS-Driven Login & Role-Gated Navigation

See `tasks/plan.md` for full context, corrections found during planning, and rationale. See
`SPEC.md` for the spec (objective, confirmed assumptions, boundaries, success criteria).

**Plan reviewed and approved 2026-08-12.** Session strategy resolved to **Auth.js v5**
(`next-auth@5.0.0-beta.32`, Credentials provider) rather than SPEC.md's hand-rolled BFF cookie —
OAuth is on the roadmap. Open questions Q1–Q5 all resolved (`tasks/plan.md`). Note that SPEC.md
still describes the hand-rolled session and `src/libs/` paths; T17 reconciles it.

## Phase 0 — Prerequisites

- [x] **T1 — Author CMS header content + audit legacy protected paths.** ✅ **Done (plan Correction
  17, 2026-08-13)** — real published content authored in cms-admin; four verified test accounts
  created; full five-role visibility matrix confirmed live. `/cv-2` is intentionally left public
  (user: "fake page", not a real protected feature) — see Correction 17.
  - Acceptance: `header` document exists and is **published** (plan Correction 7 — `draftToPublish`
    is true, so an unpublished doc returns `null`); covers every current `NAV_ITEMS` entry plus
    `/secret` and `/account`; every `PROTECTED_PATHS` entry has a non-empty `requiresRole` (except
    `/cv-2`, deliberately excluded — Correction 17); test accounts verified for `guest`, `editor`,
    `admin`, `super_admin`.
  - Verify: `curl` GraphQL with a valid access token (`Authorization: Bearer <token>`, see
    `docs/documents/access-tokens.md`) —
    `query { header { name nav { title requiresRole link subNavigations { title requiresRole link } } author { btnLoginText btnLogoutText } } }`
    returns a non-null `header`. Log in as each test user in cms-admin.
  - Files: none (CMS data)
  - Deps: none. Size: M

## Phase 1 — CMS-driven navigation (no auth yet)

- [x] **T2 — Header content service.** Follow the existing `src/views/home/home.service.ts` registry
  pattern exactly — `registerService` + `unifyFetch`, not a new fetch path. Include a mock so the
  site still renders when cms-api is down (`restfulApi` falls back to `MockView`).
  - Acceptance: `getHeader()` returns typed `HeaderData | null` via `unifyFetch({ apiKey: HEADER_KEY })`;
    registered with `driver: "graphql"`, `selectKey: "header"`, `next: { revalidate: 300, tags: ["header"] }`;
    `"header"` mock registered in `mock-all.ts`.
  - Verify: `bun run dev` and log the result in a temp Server Component → real CMS nav tree. Stop
    cms-api → mock renders. `bun run lint`.
  - Files: `src/views/header/header.{types,queries,service}.ts`, `src/mocks/header.ts`,
    `src/mocks/mock-all.ts`
  - Deps: T1. Size: M

- [x] **T3 — Header renders the CMS nav.** `HeaderBar` becomes a Server Component calling
  `getHeader()`; `HeaderNav`/`HeaderMobileMenu` stay client components taking nav as props. Render
  `subNavigations` as a dropdown. Delete `header.data.ts`. **No role filtering yet** — every item
  renders, so the site is unchanged for a passcode-holder.
  - Acceptance: brand text from `header.name`, nav items and sub-items from the CMS;
    `header.data.ts` deleted with no `NAV_ITEMS` references remaining; active-link highlighting still
    works with locale-prefixed hrefs.
  - Verify: `bun run dev` → nav matches CMS content; edit a label in cms-admin, republish, revalidate
    → label changes. `bun run build` clean.
  - Files: `src/components/layouts/header/{HeaderBar,HeaderNav,HeaderMobileMenu}.tsx`,
    `src/components/layouts/header/header.data.ts` (delete)
  - Deps: T2. Size: M

### ✅ Checkpoint A
- [x] Nav fully CMS-driven; `bun run build` and `bun run lint` clean
- [x] Existing 7 Playwright tests still pass (passcode gate untouched) — 5 of 14 cases fail
  (`cv-spacing`, `en-vocab-learned-badge`, `en-vocab-reset-progress`, `en-vocab-url-sync`), confirmed
  pre-existing via `git log` (untouched since `ff55510`, the initial monorepo commit) and unrelated to
  header/nav — the failing tests' own error context shows the CMS nav rendering correctly. User
  reviewed and approved proceeding (2026-08-12).
- [ ] Human review before touching auth (gates Phase 3, not yet reached)

## Phase 2 — Pure role logic

- [x] **T4 — `bun test` + role matching.** Establish the unit runner and implement `isRoleAllowed`.
  Pure, dependency-free, total function.
  - Acceptance: `bun test` runs with a `"test"` script in `package.json`; `isRoleAllowed(requiresRole, roleSlug)`
    treats `""`/`null`/`"all"` as public, trims whitespace, matches case-insensitively, and **fails
    closed** on both an unknown slug and anonymous-vs-restricted; 100% branch coverage.
  - Verify: `bun test src/lib/nav` — all cases from SPEC.md "Required unit cases" green.
  - Files: `src/lib/nav/role-match.ts`, `src/lib/nav/role-match.test.ts`, `package.json`
  - Deps: none (parallel with Phase 1). Size: S

- [x] **T5 — Nav filtering and route rules.** `filterNavTree(nav, roleSlug)` drops disallowed items
  server-side; `buildRouteRules(nav)` flattens the tree to a path→requiresRole table; `resolveRule(path)`
  does longest-prefix matching. Include a shared `stripLocale(pathname)` — the current code repeats
  that `pathname.slice()` idiom in three files.
  - Acceptance: parent hidden ⇒ children hidden regardless of their own rule; parent public + child
    restricted works; longest prefix wins (`/cv-2/main` beats `/cv-2`); `/` never acts as a prefix;
    `/cv-22` not matched by `/cv-2`; prefix matches only on a `/` boundary; unlisted path → public
    (D5); 100% branch coverage.
  - Verify: `bun test src/lib/nav` green, including SPEC.md's visibility matrix as a table-driven test.
  - Files: `src/lib/nav/{nav-filter,route-rules,strip-locale}.ts` + matching `.test.ts`
  - Deps: T4. Size: M

### ✅ Checkpoint B
- [x] `bun test` green, 100% branch coverage on `src/lib/nav/`
- [x] No production behaviour changed yet — pure modules aren't wired in

## Phase 3 — Auth.js login

- [x] **T6 — Auth.js wiring + Credentials provider.** Install `next-auth@5.0.0-beta.32` (**exact
  pin**, D11). Split config: `auth.config.ts` holds the Edge-safe provider list, `auth.ts` calls
  `NextAuth({...authConfig})` and exports `{ handlers, auth, signIn, signOut }`. `authorize()` calls
  cms-api `/auth/login` then `/auth/me` via `cms-auth.client.ts`. Keep the split even without a DB
  adapter today, so the roadmap OAuth providers drop in without restructuring.
  - Acceptance: `app/api/auth/[...nextauth]/route.ts` re-exports `handlers`; `authorize()` returns
    the user on success and `null` on bad credentials, with cms-api 403 (unverified) distinguishable
    from 401; `AUTH_SECRET` required and the app fails loudly if unset; `pages: { signIn: "/auth" }`
    with `session.strategy: "jwt"`; cms-api's `refresh_token` captured from the login response and
    carried in our own token, **not** relied on as a browser cookie (plan Correction 6).
  - Verify: `curl -i -X POST localhost:4000/api/auth/callback/credentials` with valid creds →
    `authjs.session-token` cookie set; bad creds → no cookie.
  - Files: `auth.config.ts`, `auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`,
    `src/lib/auth/cms-auth.client.ts`, `.env.example`
  - Deps: none (parallel with Phase 1/2). Size: M

- [x] **T7 — `jwt` / `session` callbacks.** `jwt` persists `accessToken`, `refreshToken`,
  `accessTokenExpires`, `roleSlug` into the JWE. `session` exposes **only** `{ user: { name, email, roleSlug } }`
  — its output is serialized to the client, so no token may appear there.
  - Acceptance: `roleSlug` readable from `auth()` in Server Components, route handlers and the proxy;
    `getSession()`/`useSession()` payloads contain no `accessToken` or `refreshToken`; module
    augmentation types `Session`/`JWT` so `roleSlug` is typed, not `any`.
  - Verify: log in, then `curl localhost:4000/api/auth/session` → JSON contains `roleSlug` and no
    token. Confirm `document.cookie` in DevTools exposes nothing.
  - Files: `auth.ts`, `src/types/next-auth.d.ts`
  - Deps: T6. Size: S

- [x] **T8 — Login page.** Replace the passcode form in `AuthPage.tsx` with email + password +
  remember-me in the same Card shell, calling `signIn("credentials", { redirect: false })` so errors
  render inline instead of Auth.js's default `?error=CredentialsSignin` redirect.
  - Acceptance: inline error on bad credentials and on unverified account; `returnTo` honoured and
    **validated as a same-origin relative path** to block open redirects; no `sessionStorage` and no
    `verifyPasscode` import; `router.refresh()` after success so Server Components re-render.
  - Verify: login as `admin` → lands on `returnTo`. Bad password → inline error, no navigation, URL
    unchanged. `?returnTo=https://evil.com` → falls back to `/`.
  - Files: `src/views/auth/AuthPage.tsx`, `src/app/[locale]/(main)/auth/page.tsx`
  - Deps: T7. Size: S

- [x] **T9 — Session context + header auth UI.** Wrap the app in `<SessionProvider>` seeded from the
  server's `auth()` result so the first paint is correct. `LoginButton` uses `author.btnLoginText`;
  `UserMenu` is a radix dropdown showing the name with a logout item using `author.btnLogoutText`.
  Logout must **also revoke server-side** — `signOut()` alone drops only the Auth.js cookie and would
  leave cms-api's refresh token live.
  - Acceptance: anonymous → Login button, authenticated → dropdown with name + logout; both labels
    from the CMS; logout calls cms-api `/auth/logout` **and** `signOut()`; UI updates without a hard
    reload.
  - Verify: log in → name appears; log out → button returns, and replaying the old refresh token
    against cms-api 401s.
  - Files: `src/components/auth/{LoginButton,UserMenu}.tsx`,
    `src/components/layouts/header/HeaderBar.tsx`, `src/components/layouts/main/LayoutMain.tsx`,
    `src/app/api/auth/logout-remote/route.ts`
  - Deps: T8, T3. Size: M

### ✅ Checkpoint C
- [ ] Full login → name in dropdown → logout cycle works against real cms-api — **owed**, needs
  `AUTH_SECRET`/`CMS_API_URL` set locally, cms-api running, and a real test account (plan Corrections
  10–13); user opted to proceed to Phase 4 without blocking on this (2026-08-12)
- [ ] Access token absent from client JS, from `/api/auth/session`, and from all response bodies —
  type-level guarantee in place since T7 (kept off `User`/`Session`), not confirmed live
- [ ] Logout genuinely revokes at cms-api, not just locally — same live-infra gap as above
- [x] Nav still unfiltered — gating is Phase 4 (true by construction; T10 not yet started)
- [x] Human review — user reviewed each task's diff as it landed (T6–T9) and explicitly chose to
  treat that as this gate rather than block on the live cms-api check (2026-08-12)

## Phase 4 — Role gating

- [x] **T10 — Server-side nav filtering.** `HeaderBar` calls `filterNavTree(nav, roleSlug)` — role
  from `auth()` — before passing nav down.
  - Acceptance: disallowed items **absent from the server-rendered HTML**, not CSS-hidden; matches
    SPEC.md's visibility matrix for all five role states; no flicker, first paint already correct.
  - Verify: `curl` the page with and without a session cookie → `/secret` absent from anonymous HTML,
    present for `super_admin`. View-source, not DevTools.
  - Files: `src/components/layouts/header/HeaderBar.tsx`
  - Deps: T5, T9. Size: S

- [x] **T11 — Route guard composed into `proxy.ts`.** ⚠️ Auth.js's docs say
  `export { auth as proxy }` — that would **delete the health gate and i18n** (plan Correction 4).
  Compose instead: `export const proxy = auth(async (req) => …)`, preserving health-gate →
  role-guard → i18n order, reading the role from `req.auth`. Nav rules come from a
  `healthCache`-shaped stale-while-revalidate cache so the proxy isn't hitting GraphQL per request.
  - Acceptance: health gate and i18n rewrite still work exactly as before; anonymous and
    under-privileged both redirect to `/{locale}/auth?returnTo=<original path>`; handles the i18n
    **rewrite** whether or not the URL carries a locale prefix; `/api/*`, `/_next`, `/unhealthy` and
    `/auth` itself never gated (no redirect loop); header-fetch failure **denies** known non-public
    paths rather than failing open.
  - Verify: `curl -i localhost:4000/secret` → redirect to `/en/auth?returnTo=%2Fsecret`; as `admin`
    → redirect; as `super_admin` → 200. Stop cms-api → `/unhealthy` still rewrites. `/en/auth` never
    loops.
  - Files: `src/proxy.ts`, `src/lib/nav/nav-rules-cache.ts`
  - Deps: T5, T7. Size: M

- [x] **T12 — `requireRole()` in protected pages.** Defence in depth — an explicit server-side
  assertion inside protected Server Components, so a page stays safe if it is ever dropped from the
  proxy matcher.
  - Acceptance: `requireRole(requiresRole)` reads `auth()` and `redirect()`s when denied; applied to
    `/secret` and `/account` at minimum; reads the same rules source as the proxy so the two cannot
    drift.
  - Verify: temporarily narrow the proxy matcher to exclude `/secret`, confirm the page still
    redirects, then revert.
  - Files: `src/lib/auth/require-role.ts`, `src/app/[locale]/(main)/{secret,account}/page.tsx`
  - Deps: T11. Size: S

### ✅ Checkpoint D
- [x] Full visibility matrix verified manually across all five role states (2026-08-13, Correction 17)
- [x] Direct-URL access blocked for every restricted path (`/cv-2` excepted, deliberately — Correction 17)
- [x] `bun run build` + `bun run lint` clean
- [ ] Human review — **last checkpoint before the passcode gate is deleted**

## Phase 5 — Refresh and teardown

- [x] **T13 — Refresh rotation with coalescing (D10).** The highest-risk task. Refresh cms-api's
  token pair from the `jwt` callback, but **not** the way the Auth.js guide writes it — route the
  rotation through a module-level in-flight map keyed on the refresh token, mirroring `healthCache`'s
  single-flight shape. Refresh on an early skew window, not at expiry. On failure set
  `token.error = "RefreshTokenError"`, surface it through `session`, and force re-login. Re-point
  `useSessionTimeout` at token expiry with "extend session" triggering a session update (D7), keeping
  `Secret.tsx` and `AccountManager.tsx` working.
  - Acceptance: expired access token refreshes transparently and the request proceeds; **N parallel
    requests across an expiry boundary produce exactly one cms-api `/auth/refresh` call** so the
    blacklist is never tripped; failed/blacklisted refresh clears the session and redirects to login,
    never a silent broken state; warning fires before `exp` and "extend" refreshes and dismisses it.
  - Verify: shorten cms-api's access-token TTL locally, then
    `seq 1 10 | xargs -P10 -I{} curl -s -b cookies.txt localhost:4000/secret -o /dev/null` and assert
    cms-api logged **one** refresh. Idle past expiry → silent recovery. Log out in a second tab, then
    extend in the first → bounced to login.
  - Files: `auth.ts`, `src/lib/auth/refresh-coalescer.ts` + `.test.ts`, `src/hooks/useSessionTimeout.ts`
  - Deps: T12. Size: M

- [ ] **T14 — Delete the passcode gate.** ⚠️ **Confirm before deleting** (project boundary — always
  ask before deleting files). Remove `SessionGuard`, `libs/session.ts`, `app/actions/app-auth.ts`,
  and the `APP_PASSCODE`/`SESSION_SECRET` env vars. `src/libs/` disappears entirely (D9).
  - Acceptance: `LayoutMain` no longer wraps children in `SessionGuard`;
    `grep -rn "APP_PASSCODE\|SESSION_SECRET\|SESSION_STORAGE_KEY\|PROTECTED_PATHS" src/` → no hits;
    `src/libs/` no longer exists.
  - Verify: `bun run build` + `bun run lint` clean; full manual pass over each role.
  - Files: `src/components/layouts/main/LayoutMain.tsx`, `src/components/auth/SessionGuard.tsx` (del),
    `src/libs/session.ts` (del), `src/app/actions/app-auth.ts` (del), `.env.example`
  - Deps: T1 (audit complete), T13. Size: M

### ✅ Checkpoint E
- [ ] Passcode gone; no secrets or dead auth code remain
- [ ] Every previously-protected path still requires the right role

## Phase 6 — Tests and documentation

- [ ] **T15 — Migrate existing E2E.** All 7 current E2E tests authenticate via `unlockAndGoto()` and
  the passcode form — every one breaks at T14. Replace with `loginAs(page, role)`.
  - Acceptance: `loginAs(page, role)` logs in via the real form using per-role test credentials from
    env; all 7 existing tests pass, none skipped or deleted; the stale `rules/auth.md` passcode
    comment in `test-helpers.ts` corrected.
  - Verify: `bunx playwright test` fully green.
  - Files: `e2e/test-helpers.ts` + the 7 existing specs
  - Deps: T14. Size: M

- [ ] **T16 — New E2E coverage.** The six journeys from SPEC.md "Required E2E cases".
  - Acceptance: anonymous sees the Login button with `/secret` absent from the DOM; `admin` sees the
    name dropdown and `/cv-2/main` but still not `/secret`; `super_admin` sees `/secret` and
    `/account`; anonymous hitting `/en/secret` is redirected and lands there after login; `admin`
    hitting `/en/secret` is redirected; logout restores anonymous state without a hard reload.
  - Verify: `bunx playwright test e2e/{auth-login,nav-role-visibility,route-guard}.test.ts`.
  - Files: `e2e/{auth-login,nav-role-visibility,route-guard}.test.ts`
  - Deps: T15. Size: M

- [ ] **T17 — Documentation.** Reconcile `SPEC.md` with what shipped — the Auth.js adoption
  (Correction 1, replacing the hand-rolled BFF session), the `src/lib/` correction (2), the
  `useSessionTimeout` reversal (3), and the resolved open questions.
  - Acceptance: SPEC.md's session-design section rewritten around Auth.js with Q1–Q5 marked resolved;
    `AUTH_SECRET` + `CMS_API_URL` documented and `APP_PASSCODE`/`SESSION_SECRET` removed; the D10
    refresh-race mitigation written down (it is the least obvious thing here); `tasks/todo.md`
    checkboxes complete.
  - Verify: re-read `SPEC.md` against the diff; no stale `src/libs/` or hand-rolled-cookie references.
  - Files: `SPEC.md`, `README.md`, `.env.example`, `tasks/todo.md`
  - Deps: T16. Size: S

### ✅ Checkpoint F — Complete
- [ ] All 12 SPEC.md success criteria met
- [ ] `bun test` + `bunx playwright test` + `bun run lint` + `bun run build` all green
- [ ] Ready for `/agent-skills:review`

# Spec: Fix connecting-overlay flicker / blank-page gap on cms-admin boot

Transient feature spec per `docs/rules/workflow.md`'s spec→build→update-docs→review→cleanup workflow. Delete this file once the Review step completes.

## Objective

On cms-admin boot (cold or warm), the user currently sees:

1. "Connecting to service..." overlay — shows, then hides almost immediately
2. A blank white page (no loading UI at all)
3. Finally either the Login page (if the app decided there's no session / API
   wasn't ready) or the Admin page (if the session check succeeded)

The overlay is meant to cover the entire "waiting for cms-api to be ready"
window, but it only guards the shallow `GET /health` ping. It hides as soon
as that trivial, dependency-free endpoint responds — which happens quickly
even while the backend's DB connection isn't ready yet. The real readiness
signal the admin page depends on (`POST /auth/refresh` + `GET /auth/me`,
which do touch the DB) is checked separately by `AuthContext`, and while
that's in flight, `ProtectedRoute` renders `null` — a blank page with no
loading indicator.

**Goal:** one continuous, correct loading experience from mount until the
app is actually ready to show either the Login or the Admin page. No blank
gap, no premature hide-then-reappear.

**User:** anyone loading the cms-admin app, most noticeably on a cold
backend start (Render/Fly-style spin-up, up to ~30s).

## Root Cause (confirmed by reading the code, not guessed)

- `HealthContext` ([apps/cms-admin/src/context/HealthContext.tsx](apps/cms-admin/src/context/HealthContext.tsx)) pings `${VITE_API_URL}/health`, which
  maps to `AppController.getHealth()` ([apps/cms-api/src/app.controller.ts](apps/cms-api/src/app.controller.ts)) — no DB/dependency check, and
  explicitly excluded from the `/api/v1` prefix in `configure-app.ts`. It
  resolves "healthy" fast regardless of true app readiness.
- `AuthContext` ([apps/cms-admin/src/context/AuthContext.tsx](apps/cms-admin/src/context/AuthContext.tsx)) independently runs the real
  readiness check (`/auth/refresh` → `/auth/me`, DB-backed) with its own
  cold-start retry ladder (`MOUNT_REFRESH_RETRY_DELAYS_MS = [2000, 5000, 10000]`).
- `ProtectedRoute` ([apps/cms-admin/src/components/ProtectedRoute.tsx:27](apps/cms-admin/src/components/ProtectedRoute.tsx#L27)) renders `null` while
  `loading || hasUsersLoading` — the unguarded blank-page gap.

These two "am I ready" signals are uncoordinated. The overlay only spans
signal 1, not signal 2.

## Fix Approach (revised — see below)

**User requirement:** all app actions (starting with `AuthContext`'s
session bootstrap) must wait until the health check completes, where
"complete" means cms-api is confirmed ready — not just "the shallow ping
resolved." Nothing should hit the API until that's true, and there must be
exactly one continuous loading UI with no intermediate show/hide.

This rules out the original "just fix `ProtectedRoute`" plan (revision
below), because running `AuthContext`'s calls in parallel with the health
check — and stitching together two separate `ConnectionOverlay` instances
(`HealthContext`'s + a new one in `ProtectedRoute`) — is itself a second
place a seam/flicker could sneak back in.

**Revised design — single readiness gate:**

1. `HealthContext` stops rendering `ConnectionOverlay` itself. It becomes
   pure state: owns the `/health` ping loop and exposes `status` via
   `useHealthStatus()`, nothing else.
2. `AuthContext` consumes `useHealthStatus()` and defers
   `attemptMountSession()` (the `/auth/refresh` → `/auth/me` bootstrap)
   until `status === "healthy"`. Guarded by a ref so it fires exactly once
   per app load, not on every later health flap (health re-pings every 14
   min while healthy; a later blip shouldn't re-trigger the mount-time
   session bootstrap). `state.loading` stays `true` the whole time it's
   waiting, same as it does today while a request is in flight.
3. New `BootOverlay` component — rendered once, inside both providers —
   reads `status` from `useHealthStatus()` and `loading` from `useAuth()`
   and renders the single `ConnectionOverlay`:
   `visible={status !== "healthy" || loading}`. This is the only place
   `ConnectionOverlay` is rendered.
4. `ProtectedRoute` is unchanged (still `return null` while
   `loading || hasUsersLoading`) — safe now, because `BootOverlay` already
   covers that entire window with one continuous overlay sitting on top
   (`fixed inset-0 z-50`), so the blank frame underneath is never visible.

Net effect: one "Connecting to service..." view from first paint until
cms-api is healthy **and** the session check has resolved, then a direct
cut to Login or Admin — no premature hide, no blank flash, no second
overlay instance.

Scope stays frontend-only, in `apps/cms-admin`. `AppController`'s `/health`
route and `AuthContext`'s retry ladder/timings are unchanged — only *when*
`AuthContext` starts, and *who* renders the overlay, change.

**Keep-alive interval (new requirement):** Render suspends a free/hobby
instance after 15 minutes with no incoming requests. Once healthy,
`HealthContext`'s steady-state ping (`PING_INTERVAL_HEALTHY`, currently
`14 * 60 * 1000` = 14m) must fire *before* that 15m window elapses, or
cms-api gets suspended and the next real request pays the cold-start
penalty again. Change `PING_INTERVAL_HEALTHY` to `14.5 * 60 * 1000` =
870000ms (14m30s) — close enough to the 15m limit to minimize needless
traffic, with a 30s margin so normal timer jitter can't push a ping past
the suspend threshold.

## Tech Stack

- React 18 (StrictMode) + TypeScript, Vite, React Router, TanStack Query,
  Tailwind — existing `apps/cms-admin` stack, no new dependencies.

## Commands

```
Dev:   cd apps/cms-admin && npm run dev
Build: cd apps/cms-admin && npm run build     # tsc -b && vite build
Test:  cd apps/cms-admin && npm test          # vitest run
Lint:  cd apps/cms-admin && npm run lint      # eslint .
```

## Project Structure (relevant files only)

```
apps/cms-admin/src/
  context/HealthContext.tsx          → change: stop rendering ConnectionOverlay, expose status only; PING_INTERVAL_HEALTHY 14m → 14m30s
  context/AuthContext.tsx            → change: gate attemptMountSession() on status === "healthy"
  components/ConnectionOverlay.tsx   → unchanged (still the pure display component)
  components/BootOverlay.tsx         → new: single component rendering the one ConnectionOverlay instance
  components/ProtectedRoute.tsx      → unchanged
  main.tsx                           → change: render <BootOverlay /> inside AuthProvider
  context/__tests__/HealthContext.test.tsx    → update: no more overlay assertions here (status only)
  components/__tests__/BootOverlay.test.tsx   → new: covers the combined status+loading gating
  components/__tests__/RouteGuards.test.tsx   → unchanged
```

## Code Style

Match existing conventions in this codebase — small context-consuming
component, same shape as other `use*` consumers in this repo:

```tsx
// components/BootOverlay.tsx
export function BootOverlay() {
  const { status } = useHealthStatus();
  const { loading } = useAuth();
  return <ConnectionOverlay visible={status !== "healthy" || loading} />;
}
```

`AuthContext`'s mount effect gains a status guard, ref-latched so it only
fires once:

```tsx
const { status } = useHealthStatus();
const startedRef = useRef(false);

useEffect(() => {
  if (status !== "healthy" || startedRef.current) return;
  startedRef.current = true;
  mountedRef.current = true;
  onSessionExpired(() => { if (mountedRef.current) setState(LOGGED_OUT_STATE); });
  void attemptMountSession();
  return () => {
    mountedRef.current = false;
    onSessionExpired(null);
  };
}, [status, fetchMe]);
```

## Testing Strategy

- Vitest + React Testing Library, colocated in `__tests__/` next to the
  component, matching existing `RouteGuards.test.tsx` / `HealthContext.test.tsx`
  patterns (axios-mock-adapter for API calls, fake timers for `/health`
  retry delays).
- `HealthContext.test.tsx`: drop the overlay-class assertions (that's no
  longer this component's job), keep/extend the `status` state-machine
  coverage (checking → healthy / unhealthy, retry intervals).
- New `BootOverlay.test.tsx`:
  - Overlay visible while `status === "checking"`, even if `AuthContext`
    would otherwise be ready.
  - Overlay stays visible while `status === "healthy"` but `AuthContext`
    is still `loading` (i.e., confirms the auth call only starts after
    health, and the overlay bridges that gap with no drop to hidden).
  - Overlay hides only once `status === "healthy"` AND `loading === false`.
- New/extended `AuthContext` coverage: `attemptMountSession()` (and
  therefore the mocked `/auth/refresh` call) is NOT invoked while
  `status !== "healthy"`, and fires exactly once after `status` becomes
  `"healthy"` (not re-fired on a later health flap).
- Existing 5 `ProtectedRoute` cases in `RouteGuards.test.tsx` pass
  unchanged — that component's logic isn't touched, only what's already
  guaranteed true by the time it renders.

## Boundaries

- **Always:** run `npm test` and `npm run lint` in `apps/cms-admin` before
  considering this done; keep the fix scoped to the frontend.
- **Ask first:** any change to `HealthContext`'s ping *timeout*/unhealthy
  *retry* interval, `AuthContext`'s retry ladder/timings, or the backend
  `/health` route — none of these need to change for this fix. The
  steady-state healthy-ping interval (`PING_INTERVAL_HEALTHY`) is the one
  explicitly-requested exception, changing 14m → 14m30s for the Render
  keep-alive reason above.
- **Never:** make `/health` a deep/DB-backed check as part of this fix
  (that's a separate, bigger change with its own tradeoffs — e.g. it'd
  make infra liveness probes fail during normal DB hiccups); never let a
  later health flap (after the app has already loaded) re-trigger the
  mount-time session bootstrap — that would log a mid-session user out
  spuriously.

## Success Criteria

- No API call from `AuthContext` (`/auth/refresh`, `/auth/me`) fires until
  `HealthContext.status === "healthy"`.
- Exactly one loading UI (`BootOverlay`/`ConnectionOverlay`) is ever
  visible at a time — no two-overlay handoff, no blank white frame — from
  first paint until both health and the session check are resolved.
- On cold start, the user sees one continuous "connecting" view, then a
  direct cut to either the Login page or the Admin page.
- Once healthy, cms-api receives a keep-alive ping every 14m30s — under
  Render's 15m suspend window — so a session left open doesn't cause the
  backend to sleep and force a cold start on the next action.
- All existing tests pass (updated where noted above); new tests cover the
  gating and the single-overlay behavior.

## Open Questions

- None blocking.

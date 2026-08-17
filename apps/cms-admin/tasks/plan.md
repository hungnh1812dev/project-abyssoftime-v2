# Plan: Fix cms-admin boot sequence (overlay flash / blank-page gap)

Spec: `specs/cms-admin-boot-overlay-sequencing.md`. Frontend-only — no backend changes.
All paths below are relative to `apps/cms-admin/` unless given as a full repo path.

## Context

On cms-admin boot, the user sees: the "Connecting to service..." overlay shows, then hides almost
immediately, then a blank white page, then finally either the Login or the Admin page. Root cause
(confirmed by reading the code, captured in the spec): `HealthContext` and `AuthContext` run two
uncoordinated readiness checks in parallel. `HealthContext` pings a shallow, dependency-free
`GET /health` and hides its own `ConnectionOverlay` as soon as that resolves — fast, even during a
backend cold start. `AuthContext` independently runs the real, DB-backed readiness check
(`/auth/refresh` → `/auth/me`) with its own retry ladder, and while that's in flight,
`ProtectedRoute` renders `null` — an unguarded blank gap.

Two requirements came out of the spec conversation with the user:
1. **All actions must wait for health-check completion.** `AuthContext` must not fire any request
   until `HealthContext` confirms cms-api is ready — not just run in parallel with it.
2. **Exactly one continuous loading UI**, no two-overlay handoff, no blank frame.
3. **Keep-alive**: once healthy, ping every 14m30s (not 14m) — Render suspends an idle instance
   after 15 minutes with no request, so the steady-state ping must land just under that.

This plan implements the design agreed in the spec: `HealthContext` becomes pure state,
`AuthContext` gates its bootstrap on `status === "healthy"`, and a new single `BootOverlay`
component becomes the only place `ConnectionOverlay` renders.

Stack facts: React 19 + TypeScript, Vite, React Router v7, TanStack Query, Tailwind, Bun as
package manager/script runner — always `bun run lint`/`bun run test`/`bun run build`, never
`bunx eslint` directly (`docs/rules/workflow.md`'s Linting section).

## Target Design

1. `HealthContext` becomes pure state — stops rendering `ConnectionOverlay`, only exposes
   `{ status }` via `useHealthStatus()`.
2. `AuthContext` consumes `useHealthStatus()` and defers `attemptMountSession()` until
   `status === "healthy"`, guarded by a `startedRef` so it fires exactly once per app load — never
   re-triggered by a later health flap (the 14m30s steady-state ping later reporting
   unhealthy-then-healthy again must not restart the session bootstrap and spuriously log an
   active user out).
3. New `src/components/BootOverlay.tsx` reads both hooks and is the only place `ConnectionOverlay`
   renders going forward: `<ConnectionOverlay visible={status !== "healthy" || loading} />`.
4. `ProtectedRoute` stays unchanged — its `return null` gap is now safely covered by
   `BootOverlay`'s `fixed inset-0 z-50` overlay sitting on top.
5. Keep-alive: `PING_INTERVAL_HEALTHY` moves from `14 * 60 * 1000` to `14.5 * 60 * 1000` (870000ms).

## Dependency Graph

```
Task 0 (relocate SPEC.md -> apps/cms-admin/specs/, trim root SPEC.md to a pointer)
   — independent, purely a doc move, no code dependency on anything below.
   ▼
Task 1 (HealthContext: state-only + interval bump + own test fixes)
   │   — self-contained; only HealthContext.tsx (+ its test) changes. MUST land before Task 3,
   │     because Task 3 adds a second role="alert" element into 3 test trees that don't expect
   │     one until this is gone (LoginPage.test.tsx asserts role="alert" for its own error banner).
   ▼
Task 2 (AuthContext: health-gated bootstrap + shared test helper + AuthContext.test.tsx fixes)
   │   — the risky one: restructures the mount effect, adds startedRef, adds stubHealthyPing() to
   │     test-utils.tsx, updates AuthContext.test.tsx's own tree, adds the flap-safety regression
   │     test.
   ▼
Task 3 (same HealthProvider-wrap + stubHealthyPing() pattern applied to the 3 other real-
        AuthProvider test files: RouteGuards.test.tsx, AdminLayout.test.tsx, LoginPage.test.tsx)
   │   — mechanical repeat of Task 2's pattern; depends on Task 2's helper existing.
   ▼
Task 4 (BootOverlay component + main.tsx wiring)
   — purely additive; sequenced last so the Final Checkpoint's live walkthrough exercises the
     complete, coherent boot sequence in one pass.
```

## Task List

### Task 0: Relocate the spec to match repo convention

- **Description:** Move `SPEC.md`'s content to `apps/cms-admin/specs/cms-admin-boot-overlay-sequencing.md`
  (matching `media-input-documentid-fix.md`'s precedent: `# Spec: ...` header + a one-line note
  that it's a transient file deleted after Review). Replace root `SPEC.md` with a short pointer,
  per `docs/rules/workflow.md`'s "Root docs" rule.
- **Acceptance criteria:**
  - [x] `apps/cms-admin/specs/cms-admin-boot-overlay-sequencing.md` exists with the full spec
        content.
  - [x] Root `SPEC.md` is trimmed to a short pointer, no longer duplicates module detail.
- **Verify:** Manual read-through; no build/test impact (docs only).
- **Dependencies:** None.
- **Files:** `SPEC.md`, `apps/cms-admin/specs/cms-admin-boot-overlay-sequencing.md` (new).
- **Scope:** XS.

### Checkpoint 0
- [x] Confirm file move is clean; no other change yet.

---

### Task 1: `HealthContext` — stop rendering the overlay, bump the keep-alive interval

- **Description:** `HealthContext.tsx`: remove the `ConnectionOverlay` import and its render call
  — the provider now returns `<HealthContext.Provider value={{ status }}>{children}</HealthContext.Provider>`
  only. Change `PING_INTERVAL_HEALTHY` from `14 * 60 * 1000` to `14.5 * 60 * 1000` (870000ms). Do
  **not** export `PING_INTERVAL_HEALTHY`/`PING_INTERVAL_UNHEALTHY`/`PING_TIMEOUT` — not referenced
  outside this file today; keep hardcoding the literal in the test, matching this file's own
  existing convention.

  `HealthContext.test.tsx`: for the 4 tests currently asserting on `screen.getByRole("alert")` /
  `pointer-events-none`/`opacity-0` classes, trim the overlay assertions but **keep the
  `status`-testid assertions**:
  - "hides overlay once the initial health check resolves healthy" → rename "resolves healthy once
    the initial health check succeeds"; drop overlay block, keep `"healthy"` testid assertion.
  - "shows overlay while initial health check is still in flight" → rename "stays checking while
    the initial health check is in flight"; assert `status` testid is `"checking"`.
  - "shows overlay when ping fails" → rename "flips to unhealthy when ping fails".
  - "recovers and hides overlay when ping succeeds after failure" → rename "recovers to healthy
    when ping succeeds after failure".
  - "schedules next ping in 14 minutes on success" → rename "schedules next ping in 14m30s on
    success"; change the `14 * 60 * 1000 - 10_000` advance to `14.5 * 60 * 1000 - 10_000`.
  - The other 5 tests are untouched.

- **Acceptance criteria:**
  - [x] `HealthProvider` no longer imports or renders `ConnectionOverlay`.
  - [x] `useHealthStatus()` return shape unchanged: `{ status }`.
  - [x] `PING_INTERVAL_HEALTHY === 870000` (14.5 min).
  - [x] All 10 tests in `HealthContext.test.tsx` pass; no `role="alert"`/overlay CSS class
        references remain in the file.
- **Verify:** `bun run test -- src/context/__tests__/HealthContext.test.tsx`; `bun run build`;
  `bun run lint`.
- **Dependencies:** Task 0 (ordering only).
- **Files:** `src/context/HealthContext.tsx`, `src/context/__tests__/HealthContext.test.tsx`.
- **Scope:** S.

**Note:** this task alone temporarily removes all boot-overlay UI from the running app (nothing
renders `ConnectionOverlay` until Task 4). Expected, in-progress state.

### Checkpoint 1
- [x] `bun run lint`, `bun run test`, `bun run build` all clean.
- [x] `grep -rn "ConnectionOverlay" src` — only the component's own file + its own test remain;
      `HealthContext.tsx` no longer appears.
- [x] Commit once the above passes.

---

### Task 2: `AuthContext` — defer `attemptMountSession()` until health is healthy

- **Description:**
  - Import `useHealthStatus`. Destructure as `const { status: healthStatus } = useHealthStatus();`
    — **not** `status` — to avoid shadowing the existing local `const status = axios.isAxiosError(error)
    ? error.response?.status : undefined;` inside `attemptMountSession`'s catch block.
  - Add `const startedRef = useRef(false);` alongside `mountedRef`.
  - Convert `attemptMountSession` into a `useCallback(async () => { ...unchanged body... },
    [fetchMe])`.
  - Split the mount `useEffect` into two:
    1. Unchanged lifecycle effect (`[]` deps): `mountedRef`/`onSessionExpired` setup+cleanup only,
       no longer calls `attemptMountSession()` directly.
    2. New gating effect:
       ```tsx
       useEffect(() => {
         if (healthStatus !== "healthy" || startedRef.current) return;
         startedRef.current = true;
         void attemptMountSession();
       }, [healthStatus, attemptMountSession]);
       ```
  - `state.loading`'s initial value (`true`) and all other behavior (login/logout, definitive-401
    vs. transient-failure retry ladder) are unchanged.

  - `test-utils.tsx`: add one new named export (no change to `renderWithProviders` itself):
    ```ts
    import { vi } from "vitest";

    // Stubs global fetch so any HealthProvider mounted in the tree resolves /health as ok almost
    // immediately, letting AuthContext's health-gated bootstrap effect actually fire.
    // Callers must add `afterEach(() => vi.unstubAllGlobals())`.
    export function stubHealthyPing() {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    }
    ```

  - `AuthContext.test.tsx`:
    - Import `HealthProvider` and `stubHealthyPing`; add `stubHealthyPing();` to `beforeEach`,
      `vi.unstubAllGlobals();` to `afterEach`.
    - Wrap every `<AuthProvider>...</AuthProvider>` render tree with `<HealthProvider>`.
    - **New test**: `describe("AuthProvider — health-status flap safety", ...)`, own
      `beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))` /
      `afterEach(() => vi.useRealTimers())` scoped locally:
      1. Render with `HealthProvider` + `AuthProvider`, `fetch`/`/auth/refresh`/`/auth/me` mocked
         to succeed; wait for hydration.
      2. Drive `fetch` to fail, advance fake timers past `PING_INTERVAL_UNHEALTHY` (10s) so status
         flips `"unhealthy"`, then drive `fetch` back to ok and advance again to flip back
         `"healthy"`.
      3. Assert `/auth/refresh` was only ever called once, `user`/`role` unchanged after the flap.

- **Acceptance criteria:**
  - [x] `attemptMountSession()` never fires while `healthStatus !== "healthy"`.
  - [x] Fires exactly once per mount once `healthStatus` becomes `"healthy"`.
  - [x] A later health flap does not re-fire it or change `user`/`role`.
  - [x] All existing `AuthContext.test.tsx` *assertions* unchanged. One test's synchronization
        changed: the `login()` test's `waitFor` was checking a `"loading"` testid `LoginTrigger`
        never rendered (a pre-existing no-op wait) — harmless before because mount-time
        `attemptMountSession()` ran synchronously at mount and settled its 401 well before the
        test's click; now that it's gated behind the async health ping, that stale wait let the
        test click "login" before mount-session settled, so its late-arriving 401 clobbered the
        just-set login state. Fixed by giving `LoginTrigger` a real `loading` branch (matching
        `AuthDisplay`'s existing pattern) so the wait is a genuine signal. No assertion values
        changed.
- **Verify:** `bun run test -- src/context/__tests__/AuthContext.test.tsx`; `bun run build`.
- **Dependencies:** Task 1.
- **Files:** `src/context/AuthContext.tsx`, `src/test-utils.tsx`,
  `src/context/__tests__/AuthContext.test.tsx`.
- **Scope:** M.

### Checkpoint 2
- [x] `bun run test -- src/context/__tests__/AuthContext.test.tsx src/context/__tests__/HealthContext.test.tsx` clean.
- [x] `bun run lint`, `bun run build` clean.
- [x] **Expected, not a regression:** whole-suite `bun run test` still shows 3 failing files here
      (`RouteGuards.test.tsx`, `AdminLayout.test.tsx`, `LoginPage.test.tsx`) — that's Task 3.
- [x] Commit once the above passes.

---

### Task 3: Apply the `HealthProvider` + `stubHealthyPing()` pattern to the 3 other real-`AuthProvider` test files

- **Description:** Identical shape in `RouteGuards.test.tsx`, `AdminLayout.test.tsx`
  (`src/pages/admin/layout/__tests__/`), `LoginPage.test.tsx` (`src/pages/auth/__tests__/`):
  - Import `HealthProvider`, `stubHealthyPing`; add to `beforeEach`/`afterEach`.
  - Wrap the `<AuthProvider>` in each file's local composition helper (`RouteGuards.test.tsx`'s
    `wrap()`; `AdminLayout.test.tsx`'s `renderSidebar()` + inline `TopBar` render; `LoginPage.test.tsx`'s
    `renderLogin()`) with `<HealthProvider>`.
  - No existing assertion should need to change — they already use `waitFor(...)`. Confirm
    `LoginPage.test.tsx`'s `screen.getByRole("alert")` still resolves to exactly one element
    (Task 1 already removed `HealthContext`'s own `role="alert"`; `BootOverlay` isn't in this
    test's tree yet).

- **Acceptance criteria:**
  - [x] All 3 files' full test suites pass.
  - [x] No test changed its actual assertions, only its render-tree setup.
- **Verify:** `bun run test -- src/components/__tests__/RouteGuards.test.tsx src/pages/admin/layout/__tests__/AdminLayout.test.tsx src/pages/auth/__tests__/LoginPage.test.tsx`.
- **Dependencies:** Task 2.
- **Files:** `src/components/__tests__/RouteGuards.test.tsx`,
  `src/pages/admin/layout/__tests__/AdminLayout.test.tsx`, `src/pages/auth/__tests__/LoginPage.test.tsx`.
- **Scope:** S.

### Checkpoint 3
- [x] `bun run test` (full suite) clean.
- [x] `bun run lint`, `bun run build` clean.
- [x] Commit once the above passes.

---

### Task 4: `BootOverlay` component + `main.tsx` wiring

- **Description:**
  - New `src/components/BootOverlay.tsx`:
    ```tsx
    import { ConnectionOverlay } from "@/components/ConnectionOverlay";
    import { useAuth } from "@/context/AuthContext";
    import { useHealthStatus } from "@/context/HealthContext";

    export function BootOverlay() {
      const { status } = useHealthStatus();
      const { loading } = useAuth();
      return <ConnectionOverlay visible={status !== "healthy" || loading} />;
    }
    ```
  - New `src/components/__tests__/BootOverlay.test.tsx`, real `HealthProvider` + `AuthProvider`
    with independently controllable pending promises for both the `/health` fetch and the
    `/auth/refresh` axios call, asserting the truth table:
    1. Both still resolving → overlay visible.
    2. Health healthy, auth still loading → overlay stays visible (proves the fix).
    3. Health healthy AND auth resolved → overlay hides.
    4. Health unhealthy, auth `loading === false` → overlay stays visible (sanity check).
  - `main.tsx`: render `BootOverlay` as a sibling of `<AppRouter />`, inside `<AuthProvider>`,
    itself inside `<HealthProvider>`:
    ```tsx
    <HealthProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <BootOverlay />
        </AuthProvider>
      </BrowserRouter>
    </HealthProvider>
    ```

- **Acceptance criteria:**
  - [x] `ConnectionOverlay` renders exactly once in the whole app, from `BootOverlay`.
  - [x] `BootOverlay.test.tsx` covers the 4-case truth table above.
- **Verify:** `bun run test -- src/components/__tests__/BootOverlay.test.tsx`; `bun run test` (full
  suite); `bun run build`; `bun run lint`.
- **Dependencies:** Task 1; sequenced last.
- **Files:** `src/components/BootOverlay.tsx` (new), `src/components/__tests__/BootOverlay.test.tsx`
  (new), `src/main.tsx`.
- **Scope:** S/M.

### Final Checkpoint
- [x] Full `bun run lint` + `bun run test` + `bun run build` clean across the whole diff.
- [x] `grep -rn "ConnectionOverlay" src` shows exactly 2 non-test hits: its own definition and the
      single render site inside `BootOverlay.tsx`.
- [~] **Live/manual walkthrough**: `bun run dev`, hard-refresh, confirm a single continuous
      connecting overlay through to Login/Admin with no intermediate blank white flash. Optionally
      throttle the backend to make a regression visually obvious. Separately verify the
      anti-logout invariant for real: stay logged in past a simulated 14.5-minute health ping cycle
      and confirm the session survives a transient ping failure without logging out.
  - Deferred to the user — no browser tool available in this environment to perform it.
  - Commit as soon as Task 4's automated checks pass — don't hold the commit open waiting on this
    manual walkthrough. (Done: `e52ec7b`.)
- [x] **Update docs:**
  - `docs/documents/app-shell.md` — `ConnectionOverlay` now renders from `BootOverlay` (inside
    `AuthProvider`), not `HealthProvider` directly; the new reason `HealthProvider` still wraps
    `BrowserRouter`/`AuthProvider` is so `AuthContext` can call `useHealthStatus()`. Document the
    `14.5 * 60 * 1000` keep-alive interval and the Render 15-minute idle-suspend rationale.
  - `docs/documents/auth.md` — its `HealthContext` section and intro "API-health gating" line go
    stale; update to describe the new gated sequencing and the flap-safety `startedRef` invariant.
  - Committed `f1f9f36`.
- [x] **Update spec**: reflect final shipped state in `specs/cms-admin-boot-overlay-sequencing.md`
      (before deletion, below).
- [x] **Review**: five-axis code review (correctness, readability, architecture, security,
      performance) via the `agent-skills:code-reviewer` subagent over `git diff f0835fd..HEAD` —
      **APPROVE**, no correctness issues. Both specifically-asked questions confirmed sound: the
      `startedRef` guard holds under React 19 StrictMode's double-invoke (the gating effect can't
      fire during the synchronous replay since the real `/health` fetch can't resolve within that
      window), and the `{ status: healthStatus }` rename has no other shadowing collision. Two
      minor, non-blocking notes: the (now-deleted) spec said "React 18" instead of 19 (doc-only
      typo), and `BootOverlay`'s full-screen reblock on a transient steady-state ping hiccup is
      pre-existing, tested, intentional behavior, not a regression.
- [x] **Clean up**: delete `specs/cms-admin-boot-overlay-sequencing.md` after Review completes.
      Committed `c21bb8e`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `healthStatus` naming collision with the pre-existing local `status` (HTTP status code) inside `AuthContext`'s catch block | Medium — silent shadowing bug if missed | Task 2 explicitly destructures as `{ status: healthStatus }` |
| React 19 `StrictMode` double-invokes effects in dev | Low — the gated effect is a synchronous ref-check-then-set, self-correcting under double-invoke | No fix needed |
| `stubHealthyPing()`'s unscoped `vi.stubGlobal("fetch", ...)` could mask an unexpected real `fetch()` call later | Low today | Revisit to match on URL if a future test needs a distinct `fetch` mock |
| New flap-safety test mixes fake timers into a file whose other tests use real timers | Low — scoped per-`describe`, same pattern `HealthContext.test.tsx` already uses | Scope fake timers to the new `describe` block only |
| Whole-suite `bun run test` intentionally fails between Checkpoint 2 and 3 | Low, expected | Called out at Checkpoint 2 |

## Open Questions

None blocking.

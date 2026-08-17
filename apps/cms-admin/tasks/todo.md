# Todo: Fix cms-admin boot sequence (overlay flash / blank-page gap)

Full detail/acceptance-criteria/verification per task lives in `tasks/plan.md`. Check off here as
each task completes.

## Phase 0: Spec relocation
- [x] 0. Move `SPEC.md` → `specs/cms-admin-boot-overlay-sequencing.md`; trim root `SPEC.md` to a
      pointer
- [x] **Checkpoint** — file move clean

## Phase 1: HealthContext becomes pure state
- [x] 1. `HealthContext.tsx` — stop rendering `ConnectionOverlay`; `PING_INTERVAL_HEALTHY` 14m →
      14m30s; trim/rename the 5 affected `HealthContext.test.tsx` cases
- [x] **Checkpoint** — lint/test/build clean; commit

## Phase 2: AuthContext health-gated bootstrap
- [x] 2. `AuthContext.tsx` — defer `attemptMountSession()` on `useHealthStatus()`, `startedRef`
      guard; `stubHealthyPing()` in `test-utils.tsx`; `AuthContext.test.tsx` wrap + new
      flap-safety test
- [x] **Checkpoint** — `AuthContext`/`HealthContext` tests + lint/build clean; whole-suite failure
      in the 3 ripple files is expected here, not a regression; commit

## Phase 3: Ripple fix — other real-AuthProvider test files
- [x] 3. `RouteGuards.test.tsx`, `AdminLayout.test.tsx`, `LoginPage.test.tsx` — same
      `HealthProvider` + `stubHealthyPing()` wrap
- [x] **Checkpoint** — full suite lint/test/build clean; commit

## Phase 4: BootOverlay + wiring
- [x] 4. New `components/BootOverlay.tsx` + `BootOverlay.test.tsx`; wire into `main.tsx`
- [~] **Final Checkpoint** — full lint/test/build clean (done, committed `e52ec7b`); live
      walkthrough (no blank flash, no spurious logout across a simulated 14.5min ping) deferred to
      the user — no browser tool available in this environment to perform it

## Final
- [x] Update docs (`app-shell.md`, `auth.md`)
- [x] Update spec to reflect shipped state
- [x] Five-axis review (correctness, readability, architecture, security, performance) — APPROVE,
      no correctness issues
- [x] Delete `specs/cms-admin-boot-overlay-sequencing.md`

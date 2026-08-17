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
- [ ] **Checkpoint** — lint/test/build clean; commit

## Phase 2: AuthContext health-gated bootstrap
- [ ] 2. `AuthContext.tsx` — defer `attemptMountSession()` on `useHealthStatus()`, `startedRef`
      guard; `stubHealthyPing()` in `test-utils.tsx`; `AuthContext.test.tsx` wrap + new
      flap-safety test
- [ ] **Checkpoint** — `AuthContext`/`HealthContext` tests + lint/build clean; whole-suite failure
      in the 3 ripple files is expected here, not a regression; commit

## Phase 3: Ripple fix — other real-AuthProvider test files
- [ ] 3. `RouteGuards.test.tsx`, `AdminLayout.test.tsx`, `LoginPage.test.tsx` — same
      `HealthProvider` + `stubHealthyPing()` wrap
- [ ] **Checkpoint** — full suite lint/test/build clean; commit

## Phase 4: BootOverlay + wiring
- [ ] 4. New `components/BootOverlay.tsx` + `BootOverlay.test.tsx`; wire into `main.tsx`
- [ ] **Final Checkpoint** — full lint/test/build clean; live walkthrough (no blank flash, no
      spurious logout across a simulated 14.5min ping); commit

## Final
- [ ] Update docs (`app-shell.md`, `auth.md`)
- [ ] Update spec to reflect shipped state
- [ ] Five-axis review (correctness, readability, architecture, security, performance)
- [ ] Delete `specs/cms-admin-boot-overlay-sequencing.md`

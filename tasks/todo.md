# Todo: Root-level task runner

Plan: `tasks/plan.md` · Spec: `SPEC.md` (§ "Spec: Root-level task runner")

## Phase 1: Add the root task runner

- [ ] Task 1: Create root `package.json` with the full script set
  - Acceptance: `"private": true` + `"scripts"` only (no deps/devDeps/workspaces); all 16 scripts
    from `SPEC.md`'s Commands section present with exact command bodies; `*:all` scripts chain
    `cms-api → cms-admin → frontend` with `&&`.
  - Verify: run `lint:*`/`test:*` per app from root and diff against running the app's own script
    directly; `build:all` succeeds/fails identically to sequential per-app builds; `git status`
    shows no root `node_modules`/lockfile and no diff inside `apps/*`; `git diff --
    .github/workflows/ci.yml` empty.
  - Files: `package.json` (new, root)

## Checkpoint: Root task runner complete
- [ ] Task 1 verification steps all pass
- [ ] `README.md` "Getting started" updated to mention the new root commands
- [ ] Human review before shipping

## Open Questions (defaults in effect unless corrected)
- No `deploy:*` root scripts — deploy stays CI-only.
- Future 4th app needs script lines hand-added to root `package.json` (no glob discovery).

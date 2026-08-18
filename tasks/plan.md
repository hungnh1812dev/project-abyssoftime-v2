# Implementation Plan: Root-level task runner

Spec: `SPEC.md` (§ "Spec: Root-level task runner")

## Overview

Add one new file — a root `package.json` containing only a `"scripts"` block — so every app's
install/build/dev/test/lint can be triggered from the repository root as `bun run <action>:<app>`
or `bun run <action>:all`. No app's own `package.json`, lockfile, or CI config changes. No root
`"workspaces"` field, no root dependencies, no root lockfile.

## Dependency Graph

There is exactly one component and it depends on nothing new:

```
apps/cms-api/package.json    (scripts: build, start:dev, test, lint)   ─┐
apps/cms-admin/package.json  (scripts: build, dev, test, lint)         ─┼─→ root package.json (new)
apps/frontend/package.json   (scripts: build, dev, test, lint)         ─┘
```

The root file only reads/reflects script names that already exist in each app's `package.json`
(confirmed during spec: `cms-api` uses `start:dev`/`build`/`test`/`lint`; `cms-admin` uses
`dev`/`build`/`test`/`lint`; `frontend` uses `dev`/`build`/`test`/`lint`). No app-side change is a
prerequisite — this is additive and one-directional (root → apps), never the reverse.

## Architecture Decisions

- **Plain scripts, no workspace protocol** — chosen over Turborepo/Nx/bun-workspaces specifically to
  avoid hoisting `node_modules` or unifying lockfile resolution, which would violate the
  "independent install per app" rule this whole exercise exists to preserve. (Confirmed with user
  during spec phase.)
- **Straight passthrough, no re-implementation** — every root script is `cd apps/<app> && bun run
  <existing script>` (or `bun install --frozen-lockfile`). The root file never duplicates or
  diverges from an app's own script logic, so there's exactly one source of truth per action.
- **No `deploy:*` scripts** — deploy is CI-only today (GitHub Actions → Render/Vercel webhooks using
  secrets that don't exist locally). Adding a local `deploy:*` script would have nothing real to
  call. Left out of scope; flagged as an open question in the spec.
- **No app auto-discovery/glob** — three apps, hand-written script blocks. A glob-based generator
  would be over-engineering for three fixed entries.

## Task List

### Phase 1: Add the root task runner

- [ ] Task 1: Create root `package.json` with the full script set

**Description:** Create `/package.json` at the repo root with `"private": true` and the 16
`install:*`/`dev:*`/`build:*`/`test:*`/`lint:*` scripts specified in `SPEC.md`, covering all three
apps plus `install:all`/`build:all`/`test:all`/`lint:all` aggregates (no `dev:all` — running three
dev servers sequentially in one blocking script isn't useful; `dev:*` stays per-app only).

**Acceptance criteria:**
- [ ] Root `package.json` contains `"private": true` and only a `"scripts"` key — no
      `"dependencies"`, `"devDependencies"`, or `"workspaces"` field.
- [ ] All 16 scripts from `SPEC.md`'s Commands section are present with exact matching command
      bodies (`cd apps/<app> && bun run <script>` / `bun install --frozen-lockfile`).
- [ ] `install:all`, `build:all`, `test:all`, `lint:all` chain their three per-app scripts with
      `&&`, in the fixed order `cms-api`, `cms-admin`, `frontend`.

**Verification:**
- [ ] From repo root: `bun run lint:cms-api`, `bun run lint:cms-admin`, `bun run lint:frontend` each
      produce output identical to running `bun run lint` inside that app's own directory.
- [ ] From repo root: `bun run test:cms-api`, `bun run test:cms-admin`, `bun run test:frontend` each
      pass/fail identically to running `bun run test` inside that app's own directory.
- [ ] From repo root: `bun run build:all` succeeds (or fails at the same app/step) identically to
      building each app individually in sequence.
- [ ] `git status` after all of the above: no new root `node_modules/`, no new root lockfile, no
      diff inside any `apps/*` directory.
- [ ] `git diff -- .github/workflows/ci.yml` is empty.

**Dependencies:** None.

**Files likely touched:**
- `package.json` (new, root)

**Estimated scope:** XS — 1 file.

### Checkpoint: Root task runner complete
- [ ] Task 1's verification steps all pass
- [ ] `README.md`'s "Getting started" section updated to mention the new root commands (per spec's
      Keeping-the-Spec-Alive convention — docs follow the change, done as part of this same task
      since it's a one-line addition, not a separate task)
- [ ] Review with human before considering this shipped

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A root `package.json` existing at all could tempt a future contributor to add a `"workspaces"` field or shared deps, silently breaking per-app independence | Med | Boundary is explicit in `SPEC.md` ("Never: add a root lockfile, root `node_modules`, or a `workspaces` field"); root file stays minimal (scripts only) so there's nothing to build on top of by accident |
| `cd X && Y` script bodies are shell-syntax and assume a POSIX shell (bash/zsh/sh) | Low | Already true of every app's own scripts and of CI (`ubuntu-latest`); no Windows-only workflow exists in this repo today |
| Someone runs `bun install` at repo root (not `bun run install:all`) expecting it to install everything | Low | With no `"workspaces"` field and no root deps, `bun install` at root is a no-op / creates an empty lockfile at worst — not destructive. Worth a one-line root README note but not a blocker |

## Open Questions

Carried over from `SPEC.md`, unresolved — proceeding with the stated defaults unless corrected:

1. No `deploy:*` root scripts (default: deploy stays CI-only, as today).
2. A future 4th app needs its script lines hand-added to root `package.json` (default: acceptable,
   no glob tooling).

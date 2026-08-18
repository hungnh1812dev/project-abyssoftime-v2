# Spec

No module details live here for app-specific work — each app owns its own spec
(`apps/cms-api/SPEC.md`, `apps/cms-admin/SPEC.md`, `apps/frontend/SPEC.md`). Active feature spec:
`apps/cms-admin/specs/cms-admin-boot-overlay-sequencing.md` (cms-admin boot-overlay sequencing fix,
in progress; transient, deleted after its Review step).

This file *does* own root-level, cross-app infra work that isn't scoped to a single app — see below.

---

## Spec: Root-level task runner

### Objective

Add a root `package.json` that lets any app's install/build/dev/test/lint be triggered from the
repository root (`bun run <action>:<app>` or `bun run <action>:all`), while every app continues to
install, build, run, test, and lint **fully independently** — its own `package.json`, its own
`bun.lock`, its own `node_modules`, no hoisting, no shared dependency resolution. This is pure
command aggregation, not a workspace/dependency graph.

Today the repo already satisfies "each app installs/builds/runs/tests/lints independently"
(confirmed: no root `package.json`, no workspace tooling, separate `package.json`/`bun.lock` per
app, CI path-filters and deploys each app separately). The gap is ergonomics: there is currently no
way to trigger a given app's command from the repo root without `cd`-ing into it first.

**User:** whoever works in this repo locally (currently the repo owner) and wants to run e.g.
`bun run test:cms-api` from the repo root instead of `cd apps/cms-api && bun run test`.

### Tech Stack

Just a root `package.json` with a `"scripts"` block. No `"dependencies"`, no `"devDependencies"`, no
`"workspaces"` field. Bun is already the package manager/script runner every app uses, so root
scripts also run via `bun run`.

### Commands

Root `package.json` scripts (one block per app, plus `*:all` aggregates that run in a fixed order —
`cms-api`, `cms-admin`, `frontend` — and fail fast on the first failing app):

```json
{
  "private": true,
  "scripts": {
    "install:cms-api": "cd apps/cms-api && bun install --frozen-lockfile",
    "install:cms-admin": "cd apps/cms-admin && bun install --frozen-lockfile",
    "install:frontend": "cd apps/frontend && bun install --frozen-lockfile",
    "install:all": "bun run install:cms-api && bun run install:cms-admin && bun run install:frontend",

    "dev:cms-api": "cd apps/cms-api && bun run start:dev",
    "dev:cms-admin": "cd apps/cms-admin && bun run dev",
    "dev:frontend": "cd apps/frontend && bun run dev",

    "build:cms-api": "cd apps/cms-api && bun run build",
    "build:cms-admin": "cd apps/cms-admin && bun run build",
    "build:frontend": "cd apps/frontend && bun run build",
    "build:all": "bun run build:cms-api && bun run build:cms-admin && bun run build:frontend",

    "test:cms-api": "cd apps/cms-api && bun run test",
    "test:cms-admin": "cd apps/cms-admin && bun run test",
    "test:frontend": "cd apps/frontend && bun run test",
    "test:all": "bun run test:cms-api && bun run test:cms-admin && bun run test:frontend",

    "lint:cms-api": "cd apps/cms-api && bun run lint",
    "lint:cms-admin": "cd apps/cms-admin && bun run lint",
    "lint:frontend": "cd apps/frontend && bun run lint",
    "lint:all": "bun run lint:cms-api && bun run lint:cms-admin && bun run lint:frontend"
  }
}
```

No `deploy:*` scripts — see Open Questions.

### Project Structure

Only one new file: root `package.json`. Nothing inside `apps/cms-api`, `apps/cms-admin`, or
`apps/frontend` changes — their own `package.json`, `bun.lock`, and scripts stay exactly as-is.

```
package.json              → NEW. Root task runner: scripts only, no deps, no "workspaces" field.
apps/cms-api/              → unchanged
apps/cms-admin/            → unchanged
apps/frontend/             → unchanged
.github/workflows/ci.yml  → unchanged
```

### Code Style

Naming: `<action>:<app-name>` for a single app, `<action>:all` to run that action across all three
apps in the fixed order above. Every per-app script body is a straight passthrough —
`cd apps/<app> && bun run <that app's own script>` (or `bun install --frozen-lockfile` for install)
— never a re-implementation of an app's own script logic. `*:all` scripts chain the per-app scripts
with `&&` so they fail fast on the first failing app.

### Testing Strategy

No automated suite — this is a scripts-only aggregator with no logic to unit test. Verification is
manual, run once after the root `package.json` lands:

1. `bun run install:all` from repo root succeeds and creates **no** root `node_modules/` or root
   lockfile.
2. `bun run lint:all`, `bun run test:all`, `bun run build:all` each succeed/fail identically to
   running the underlying command directly inside that app's own directory.
3. `git status` afterward shows no untracked root `node_modules`/lockfile and no changes inside any
   `apps/*` directory.
4. `.github/workflows/ci.yml` diff is empty — CI keeps testing/deploying each app independently
   exactly as before.

### Boundaries

- **Always:** keep the root `package.json` limited to `"private": true` + `"scripts"` — never add a
  `"dependencies"`, `"devDependencies"`, or `"workspaces"` field. Every root script is a straight
  passthrough to that app's own existing script.
- **Ask first:** adding any root script category beyond install/build/dev/test/lint (e.g.
  `deploy:*`) — see Open Questions.
- **Never:** add a root lockfile, a root `node_modules`, or a `"workspaces"` field; modify any app's
  own `package.json` scripts to accommodate the root runner; modify `.github/workflows/ci.yml` as
  part of this change.

### Success Criteria

- From repo root, `bun run <action>:<app>` for `action ∈ {install, build, dev, test, lint}` and
  `app ∈ {cms-api, cms-admin, frontend}` behaves identically to running that app's own script from
  inside its directory.
- `<action>:all` runs all three apps' script for that action, in order, stopping on first failure.
- No root `node_modules`, root lockfile, or root `"workspaces"` field ever gets created.
- Each app's own independent install/build/test/lint/deploy continues to work completely unchanged.
- CI (`.github/workflows/ci.yml`) is untouched — still path-filters and deploys each app
  independently exactly as documented in root `README.md`.

### Open Questions

1. **No `deploy:*` root scripts are proposed.** Deploy today is CI-only — GitHub Actions triggers
   Render/Vercel webhooks using secrets (`CMS_API_RENDER_DEPLOY_HOOK`, `VERCEL_TOKEN`, etc.) that
   don't exist locally. A local root `deploy:*` command has nothing meaningful to call without them.
   Default: leave deploy exactly as-is (CI-triggered on push to `master`, per `README.md`). Confirm,
   or describe what a local deploy command should actually do.
2. A future 4th app under `apps/*` needs its own five script lines added by hand to the root
   `package.json` — there's no glob/auto-discovery. Acceptable given no workspace tooling is in
   play; confirm.

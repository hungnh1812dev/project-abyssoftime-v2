# AbyssOfTime — Repo Rules & Workflow

Entry point for any agent/human working in this repo.

## Repo feature workflow

1. Read this file (`CLAUDE.md`) — repo-wide dispatch.
2. Read `SPEC.md` — root-level, cross-app specs only. Each app owns its own spec
   (`apps/cms-api/SPEC.md`, `apps/cms-admin/SPEC.md`, `apps/frontend/SPEC.md`).
3. Read the repo rules — `docs/rules/*` and `docs/workflow.md`.
4. Follow the workflow for the app(s) you're working in — see `apps/<app-name>/docs/ENTRYPOINT.md`
   (or `apps/<app-name>/CLAUDE.md`) for that app's own rules/docs.

## Where things live

- **Rule that applies to every app** → `docs/rules/*.md` (this directory).
- **Rule that applies to one app only** → `apps/<app-name>/docs/rules/*.md`.
- **The workflow process itself** → `docs/workflow.md`.
- **Spec / plan / todo for repo-level or multi-app work** → root `SPEC.md` / `tasks/plan.md` /
  `tasks/todo.md`.
- **Spec / plan / todo for single-app work** → `apps/<app-name>/SPEC.md` /
  `apps/<app-name>/tasks/plan.md` / `apps/<app-name>/tasks/todo.md`.
- Documentation updates belong to the **Update docs/rules** step of `docs/workflow.md` — update
  the app(s) you actually touched, not just the root.

## Apps

- `apps/cms-api` — headless CMS backend. See `apps/cms-api/docs/ENTRYPOINT.md`.
- `apps/cms-admin` — admin panel. See `apps/cms-admin/docs/ENTRYPOINT.md`.
- `apps/frontend` — public site. See `apps/frontend/docs/ENTRYPOINT.md`.

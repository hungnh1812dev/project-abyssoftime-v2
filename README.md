# AbyssOfTime

Monorepo for the AbyssOfTime platform: a headless CMS backend, its admin panel, and the public
site that consumes it. Each app is independently built/deployed — there is no shared root
package.json or workspace tooling; run commands from inside each app's directory.

## Apps

| App | Path | Stack | Description |
| --- | --- | --- | --- |
| [`cms-api`](apps/cms-api/README.md) | `apps/cms-api` | NestJS, Prisma, GraphQL + REST | Headless CMS backend: schema-as-code content types, draft/publish documents, auth, media, roles/permissions, access tokens. |
| [`cms-admin`](apps/cms-admin/README.md) | `apps/cms-admin` | React, Vite, TanStack Query | Admin panel for managing content, media, users, roles, and access tokens against `cms-api`. |
| [`frontend`](apps/frontend/README.md) | `apps/frontend` | Next.js (App Router) | Public-facing site: CV, EN vocabulary trainer, Go/React learning modules, vaccine tracker, and client-side-encrypted data managers. |

Each app has its own `README.md`/`SPEC.md`/`docs/` with full setup, architecture, and conventions
— start there for anything app-specific. Repo-wide rules and the feature workflow live in
`docs/rules/*` / `docs/workflow.md`; `CLAUDE.md` is the entrypoint for any agent working in this
repo.

## Getting started

All apps use [Bun](https://bun.sh) as the package manager and script runner. From each app's
directory:

```bash
bun install --frozen-lockfile
bun run dev     # or start/start:dev, see the app's own README
```

`cms-api` and `cms-admin` also ship a `.env.example` — copy it to `.env`/`.env.local` and fill in
the required values before running.

## CI/CD

`.github/workflows/ci.yml` path-filters on `apps/**` so only the apps touched by a push are
linted, tested, and built. On `master`, each app is deployed independently:

- `cms-api` and `cms-admin` → Render (via deploy webhook)
- `frontend` → Vercel

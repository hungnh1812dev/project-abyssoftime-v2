# AbyssOfTime — Frontend

Next.js (App Router) public-facing site: CV, EN vocabulary trainer, Go/React learning modules,
vaccine tracker, and two client-side-encrypted data managers.

- **Full context** (tech stack, project structure, testing, boundaries, status):
  [`docs/frontend/overview.md`](../../docs/frontend/overview.md)
- **Conventions/rules** (routing, styling, forms, data fetching, testing, auth, encryption):
  [`rules/frontend/README.md`](../../rules/frontend/README.md)
- **Per-page module docs**: the other files in [`docs/frontend/`](../../docs/frontend/)

## Commands

Run from this directory (`apps/frontend/`) — scripts are self-contained here, not wired through a
root `bun --filter` alias.

```bash
bun install --frozen-lockfile   # matches what CI/Vercel run

bun run dev        # Turbopack dev server -> http://localhost:4000
bun run build      # production build
bun start          # production server -> http://localhost:5005
bun run lint       # eslint ./src
bunx tsc --noEmit  # type check
bun run analyze    # ANALYZE=true next build — bundle analyzer

bunx playwright test   # E2E suite
```

Copy `.env.example` to `.env.local` and fill in `AUTH_SECRET`/`CMS_API_URL` for local auth (the app
fails loudly at boot if `AUTH_SECRET` is unset) — see `SPEC.md`'s Session Design section for the
full Auth.js v5 flow.

## Deploy

Deploys to Vercel via `.github/workflows/ci.yml`'s `deploy-frontend` job on push to `main`
(path-filtered on `apps/frontend/**`), not through the Vercel Git integration directly.

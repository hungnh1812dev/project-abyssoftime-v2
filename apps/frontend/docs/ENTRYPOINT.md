# Entrypoint

Index of rule/doc files for this project (`apps/frontend`, the public Next.js site). Any agent
working on this repo only needs to start here.

- repo root `CLAUDE.md` — repo-wide dispatch entrypoint; read first if you haven't.
- repo root `docs/workflow.md` — feature workflow (spec > build > update spec/docs > review > cleanup), module rules, commit, formatting, and naming conventions. Shared with the sibling apps.
- repo root `docs/rules/bun.md` — Bun runtime/tooling conventions, shared with the sibling `apps/cms-api`/`apps/cms-admin` apps. Only the package-manager/script-runner commands (`bun install`, `bun run <script>`, `bunx <package>`, `bun test`) apply to this app; its `Bun.serve()`/HTML-import Frontend sections describe Bun-native patterns this Next.js app doesn't use.
- `/SPEC.md` — objective, tech stack, commands, project structure; pointer-only per the Root docs rule in `docs/workflow.md`.
- `/AGENTS.md` — Next.js framework rules, auto-written/re-added by `next dev`. Do not hand-edit; removing it from a diff only re-creates the uncommitted change.
- `/tasks/plan.md` / `/tasks/todo.md` — current build plan/task breakdown, present when work is in flight.
- `/docs/documents/frontend-flux-deployment.md` — deployment to the vm-prod k3s VPS at the bare `<domain>` via GHCR + Flux + the `deployment` branch (the shared cluster setup is in `apps/cms-api/k8s/README.md`): the standalone Docker image (Bun build, non-root Node runner, `NEXT_OUTPUT` opt-in so Vercel is unchanged, `.env*` excluded), build-time `GRAPHQL_URL`, the `k8s/flux/` templates (runtime Secret via `envFrom`, `AUTH_TRUST_HOST`, the `${APP_DOMAIN:=APP_DOMAIN-is-not-set}` fail-closed host), the ConfigMap/Secret templates, the cluster file `abyssdev-frontend-prod.yaml`, the CI jobs (`frontend-ghcr-publish`/`-ghcr-cleanup`/`-bump-tag`), the owner setup (DNS cutover, repo variables, public GHCR package, Secret values, cms-api `CORS_ORIGINS`), and `staging` → Vercel.
- `/docs/documents/frontend-flux-deployment-techstack.md` — decision tables: standalone on Node vs. full image vs. Bun runtime, opt-in standalone, the builder base, the placeholder `AUTH_SECRET`, the empty-domain guard, the probes, one Secret for runtime config.

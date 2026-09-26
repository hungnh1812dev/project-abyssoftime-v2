# Entrypoint

Index of rule/doc files for this project (`apps/cms-admin`, the CMS admin frontend). Any agent working on this repo only needs to start here.

- `/SPEC.md` — objective, tech stack, commands, project structure, code style, testing strategy, boundaries. Pointer-only per the Root docs rule below — module details live in `/docs/documents/*`.
- repo root `docs/workflow.md` — feature workflow (spec > build > update spec/docs > review > cleanup), module rules (max 500 lines, independent modules), commit, formatting, and naming conventions. Shared with the sibling apps.
- repo root `docs/rules/bun.md` — Bun runtime/tooling conventions, shared with the sibling `apps/cms-api` backend. Only the package-manager/script-runner commands (`bun install`, `bun run <script>`, `bunx <package>`) apply to this app; its Frontend/Testing API sections (`Bun.serve`, `bun:sqlite`, `bun test`) describe Bun-native patterns this Vite + Vitest app doesn't use — see `/SPEC.md`'s Tech Stack section.
- `/docs/documents/app-shell.md` — bootstrap (`main.tsx`), the shared axios client (`lib/api.ts`, in-memory access token + silent-refresh interceptor), query client defaults, the route table (`router.tsx`), and shared `types/cms.ts`; notes the dead `App.tsx`/`AdminRoute.tsx`.
- `/docs/documents/auth.md` — `AuthContext` (mount-time silent refresh, permission fetch), `HealthContext`/`ConnectionOverlay` (API cold-start gating), `ProtectedRoute`, and the login/register/invite-accept pages.
- `/docs/documents/navigation-shell.md` — collapsible `Sidebar` (permission-gated settings links, live content-type list), `AdminLayout`/`TopBar`/`StickyActionBar`, and `useBreadcrumbs`.
- `/docs/documents/form-system.md` — `FormProvider`/`FormField` (the fetch→edit→mutate→toast lifecycle wrapper) and the typed field inputs (text/number/boolean/media/richtext/json/repeatable-component) schema forms compose from.
- `/docs/documents/content-type.md` — the content-type registry (list-view/wrapper overrides), `ContentTypePanel`/`ContentTypeBuilder`/`renderSchemaField` (schema-driven single/collection-type edit forms, locale switching, publish/unpublish, first-save-then-navigate for new collection entries).
- `/docs/documents/documents.md` — collection/single-type document CRUD hooks and `CollectionListPage` (URL-as-source-of-truth list state, debounced search, bulk delete, column derivation); depends on `content-type.md`.
- `/docs/documents/media.md` — `MediaLibrary` (picker modal, used by `form-system.md`'s `MediaInput`) and `MediaLibraryPage` (standalone browse/manage), plus `useMedia` upload/list/delete hooks.
- `/docs/documents/access-control.md` — Users/Roles/Permissions/Access-Tokens settings pages and their hooks; the client-side `roleLevel` hierarchy (`lib/roles.ts`) vs. the separate API-managed `Role.level` field; access-token scopes as a separate authorization vocabulary from permission slugs.
- `/docs/documents/locales-and-invites.md` — locale catalog CRUD (`InternationalizePage`, `LocaleSelector`) and the invite create/list/revoke/accept flow (embedded in `access-control.md`'s Users page, not its own settings page).
- `/docs/documents/cms-admin-flux-deployment.md` — deployment to the vm-prod k3s VPS at `admin.<domain>` via GHCR + Flux + the `deployment` branch (the shared cluster setup is in `apps/cms-api/k8s/README.md`): the `VITE_API_URL` build arg (bare cms-api origin, from the `CMS_ADMIN_API_URL` repo variable), nginx `/healthz` and no proxies, the `k8s/flux/` templates (Deployment, Service, Traefik Ingress + https redirect in the base), the ConfigMap template, the cluster file `abyssdev-cms-admin-prod.yaml`, the CI jobs (`cms-admin-ghcr-publish`/`-ghcr-cleanup`/`-bump-tag`), the owner setup (DNS, repo variables, public GHCR package, ConfigMap, cms-api `CORS_ORIGINS`), and `staging` → Render.
- `/docs/documents/cms-admin-flux-deployment-techstack.md` — decision tables: build arg vs. runtime `config.js` vs. nginx proxy, removing the dead proxies, the `/healthz` probe, Ingress in the base vs. a Component, the fixed container port.

## Root docs

- `SPEC.md` and `CLAUDE.md` only contain guidance pointing to module files — not the module details themselves (see repo root `docs/workflow.md`'s Root docs rule).
- Once a feature's details are fully captured in `/docs/documents/*`, remove that feature's section from `SPEC.md` rather than letting it accumulate already-documented content.

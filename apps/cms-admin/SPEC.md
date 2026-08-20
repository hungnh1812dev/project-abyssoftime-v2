# Spec: AbyssOfTime CMS — Admin Frontend -

See `/docs/ENTRYPOINT.md` for the full doc index. This file only orients — module details live in `docs/documents/*` and must be removed from here once fully captured there (per repo root `docs/workflow.md`'s Root docs rule).

## Objective

The admin web UI for the AbyssOfTime headless CMS: authenticate (hybrid cookie/Bearer session — refresh token in an httpOnly cookie, access token in memory sent as `Authorization: Bearer`; self-register + OTP verification, no invites), browse/manage content types (single & collection), edit documents through schema-driven forms, manage media, and administer users/roles/permissions/access-tokens against a fully dynamic, DB-backed catalog. Locale administration has no UI in this app — the backend has no locale/i18n module, so that source is kept but unreachable (see `docs/documents/locales-and-invites.md`). Consumes the `cms-api` backend (sibling app, `apps/cms-api`) over `VITE_API_URL`, every route under `/api/v1/*` except `GET /health`; see that app's `docs/cms-admin-integration.md` for the API contract this frontend is built against.

## Tech Stack

React 19 + TypeScript, Vite (build/dev server — **not** Bun's own `Bun.serve`/HTML-import bundler), Tailwind CSS v4, shadcn/ui (Base UI primitives), TanStack Query, react-hook-form, react-router-dom v7, axios, CKEditor 5 (rich text), CodeMirror (JSON editing), sonner (toasts). Package manager/script runner is Bun; test runner is Vitest (`bun run test` → `vitest run`, not `bun test`). See repo root `docs/rules/bun.md` for which of that file's conventions actually apply here (package-manager/script-runner commands only — its Frontend/Testing API sections describe Bun-native patterns this app doesn't use).

## Commands

```
Dev:     bun run dev
Build:   bun run build       # tsc -b && vite build
Test:    bun run test        # vitest run
Watch:   bun run test:watch  # vitest
Lint:    bun run lint        # always this — never `bunx eslint .` directly (see repo root docs/workflow.md)
Format:  bun run format      # prettier --write "src/**/*.{js,jsx,ts,tsx}"
Preview: bun run preview
```

## Project Structure

```
src/
  App.tsx, App.css, assets/    → unused Vite/React template boilerplate (dead code, not imported)
  main.tsx                     → provider bootstrap (see docs/documents/app-shell.md)
  router.tsx                   → route table
  context/                     → AuthContext, HealthContext
  components/
    sidebar/, ui/               → nav shell, shadcn primitives
    form/                       → FormProvider/FormField + typed inputs
    content-type/, collection/, media/, locale/
  hooks/                        → one file per API resource (useAuth, useUsers, useRoles, ...)
  lib/                          → api client, query client, cn(), shared constants
  content-type-registry/       → per-slug list-view/wrapper overrides
  pages/
    auth/                       → login/register/verify-otp/forgot-password/reset-password (no invite flow — removed)
    admin/layout/                → AdminLayout, TopBar, StickyActionBar
    admin/panels/                → content-type & collection-type screens
    admin/settings/              → users/roles/permissions/access-tokens/media (+ orphaned, unreachable internationalize)
  types/cms.ts                 → shared API response/schema types (camelCase DTO shapes)
docs/
  ENTRYPOINT.md                → doc index, start here
  rules/                        → workflow.md, bun.md
  documents/                    → one file per module (see below)
```

## Code Style

- Function components, named exports (`export function Foo()`), no default exports for components.
- Data fetching/mutation always goes through a `hooks/use*.ts` file wrapping TanStack Query — components never call `api` directly except one-off inline queries inside a page (e.g. `LoginPage`'s `auth-setup` check).
- Tailwind utility classes composed via `cn()` (`lib/utils.ts`), not `classnames`/manual string concat.
- Errors from mutations surface via `sonner` toasts reading the API's Nest `HttpException` body (`{ statusCode, message, error }`, `message` a string or string array) through the shared `lib/errors.ts` `apiErrorMessage(error, fallback)` helper — see any `hooks/use*.ts` file for the pattern.

```tsx
export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.delete(`/roles/${documentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all }),
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Failed to delete role"));
    },
  });
}
```

## Testing Strategy

Vitest + Testing Library (`@testing-library/react`, `jsdom` environment), `axios-mock-adapter` for API mocking. Spec files live next to their source in `__tests__/` directories (e.g. `components/form/inputs/__tests__/`). Run via `bun run test`; coverage via `@vitest/coverage-v8` (invoked through Vitest's own coverage flag, not a separate script yet). Per repo root `docs/workflow.md`, `coverageThreshold` entries are added per-path only once a file has a dedicated spec suite, and are not required for Prisma/controller-equivalent files (n/a on this frontend — no backend layer here).

## Boundaries

- **Always:** run `bun run lint` (never `bunx eslint .` directly) and `bun run test` before considering a change done; format changed `.ts`/`.tsx` files with `bun run format` before committing; keep module files ≤500 lines (split when they grow past that); keep new features independent of unrelated modules' internals (prefer additive files over editing shared internals).
- **Ask first:** adding a new dependency; introducing a new cross-module coupling; changing the route table's auth gating (`minLevel`/permission checks in `router.tsx` or `Sidebar`); any schema/contract assumption about the `cms-api` backend that isn't already documented in its `docs/cms-admin-integration.md`.
- **Never:** commit without explicit user confirmation of the exact staged files + message (see repo root `docs/workflow.md`); include `Co-Authored-By` in commit messages; read/store a session token client-side — both tokens are httpOnly cookies this app never touches directly (`lib/api.ts`); bypass the repo root `docs/workflow.md` spec→build→update-docs→review→cleanup sequence for a new feature/page/module.

## Success Criteria

This spec + `docs/documents/*` accurately describe the app as it exists today (originally validated by a full read-through of `src/` on 2026-07-28; re-validated on 2026-07-29 after the full `abyssoftime-cms-api` contract rewrite — cookie-session auth, dynamic roles/permissions, rebuilt access tokens, hidden locales, and the camelCase content-type/document/media rewrite — landed across six phases). Going forward: a feature is "documented" when its `docs/documents/*.md` file(s) are updated to match the shipped code, per repo root `docs/workflow.md`'s Update docs step — not when this SPEC.md is edited (this file stays pointer-only).

## Open Questions

- repo root `docs/rules/bun.md` is shared with the sibling `cms-api` backend and describes Bun-native APIs (`Bun.serve`, `bun:sqlite`, `Bun.redis`, HTML-import frontend bundling) that don't apply to this Vite-based app. Left as-is per user decision (2026-07-28) rather than forked/edited for cms-admin — flagged here in case that changes.
- Several small duplications/gaps were found during the original audit and are noted in their respective `docs/documents/*.md` files (`Known gaps` sections) rather than fixed outright, since fixing them wasn't in scope for a documentation pass: dead code (`App.tsx` — `AdminRoute.tsx` was also dead code at the time but has since been deleted as part of the auth rewrite), `useBreadcrumbs`' incomplete `SETTINGS_LABELS` map, and the `MediaLibrary`/`MediaLibraryPage` upload-UI duplication. The stale spec-file reference has since moved: `AuthContext.tsx`'s comments no longer cite it, but `Sidebar.tsx` now has a comment citing `specs/access-token-auth-mismatch.md` §13.6, a file that does not exist in this repo (only `specs/cms-api-integration.md` does) — worth reconciling the next time that file is touched.

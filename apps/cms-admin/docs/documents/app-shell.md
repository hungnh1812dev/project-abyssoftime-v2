# App Shell

Bootstrap, HTTP client, routing table, and shared types that every other module depends on. React 19 + TypeScript + Vite (not Bun's own `Bun.serve`/HTML-import bundler — see repo root `docs/rules/bun.md`'s Frontend section, which doesn't apply to this app; Bun is used only as the package manager/script runner). Bundling is Vite, tests run on Vitest (`bun run test` → `vitest run`), not `bun test`.

## Bootstrap (`src/main.tsx`)

Provider nesting, outside-in: `QueryClientProvider` → `HealthProvider` → `BrowserRouter` → `AuthProvider` → `{ AppRouter, BootOverlay }`, with `Toaster` (sonner) and `ReactQueryDevtools` as siblings inside `QueryClientProvider`. `HealthProvider` wraps `BrowserRouter`/`AuthProvider` so `AuthContext` can call `useHealthStatus()` and gate its mount-time session bootstrap on API readiness (see [auth.md](./auth.md)) — `HealthContext` itself is pure state and renders nothing. `BootOverlay`, rendered as a sibling of `AppRouter` inside `AuthProvider`, is the single place `ConnectionOverlay` renders in the whole app: `visible={status !== "healthy" || loading}`, so it covers the entire window from first paint through both health confirmation and session hydration with no intermediate blank frame.

`src/App.tsx` is the unmodified Vite/React template starter (counter button, Vite/React logos) — **dead code**, not imported anywhere in `main.tsx` or `router.tsx`. Same for `src/App.css` and the `assets/react.svg`/`assets/vite.svg`/`assets/hero.png` it pulls in.

## HTTP client (`src/lib/api.ts`)

Single `axios` instance (`api`), `withCredentials: true`, `baseURL` = `${VITE_API_URL}/api/v1` (every backend route lives under `/api/v1/*` except unprefixed `GET /health`, which `HealthContext` fetches directly, not through this instance). Auth model is a **hybrid**: `refresh_token` is still an httpOnly cookie the browser sends automatically, but `access_token` is returned in the `login`/`refresh` JSON response body and held **in memory only** (module-level variable, not React state, not `localStorage`/`sessionStorage`) — see [auth.md](./auth.md) for the last-migrated-2026-08-08 note.

- `setAccessToken(token: string | null)` sets a module-level `_accessToken` variable; a request interceptor attaches `Authorization: Bearer <token>` whenever one is held, and omits the header entirely when not (e.g. before the first mount-time refresh resolves).
- A response interceptor catches `401`s: on the first `401` for a given request (`!original._retried`), it calls `POST /auth/refresh` with no body (deduped via a module-level `_refreshPromise` so concurrent `401`s trigger one refresh, not N), captures the rotated `accessToken` from the response via `setAccessToken`, retries the original request once (now carrying the new token), and on refresh failure invokes the `onSessionExpired` callback (registered by `AuthContext`, see [auth.md](./auth.md)) before rejecting.

This module has no React dependency — `AuthContext` is the only consumer of `onSessionExpired`, everything else just imports `api`. `src/lib/errors.ts`'s `apiErrorMessage(error, fallback)` is the shared helper for reading a Nest `HttpException` body's `message` (string or, for `ValidationPipe` failures, a string array joined with `", "`) — used by every mutation's `onError` toast across `useUsers`/`useRoles`/`usePermissions`/`useAccessTokens`/`useCollectionDocuments`/`useSingleTypeDocuments`/`useMedia` instead of each hook duplicating its own `AxiosError` parsing.

## Query client (`src/lib/queryClient.ts`)

One shared `QueryClient`: `staleTime: 30_000`, `retry: 1`. All `useQuery` hooks across the app inherit these defaults unless overridden locally (e.g. `useSingleTypeDocument`'s custom `retry` that stops on a `404`, see [documents.md](./documents.md)).

## Router (`src/router.tsx`)

`react-router-dom` v7, `<Routes>`/`<Route>` (not the data-router API). Public routes: `/login`, `/register`, `/verify-otp`, `/forgot-password`, `/reset-password`, `/403`. There is no `/invite/:token` route — invites were removed entirely (see [auth.md](./auth.md), [locales-and-invites.md](./locales-and-invites.md)). Everything else nests under `/admin`, gated by `ProtectedRoute` (see [auth.md](./auth.md)) wrapping `AdminLayout` (see [navigation-shell.md](./navigation-shell.md)). Unmatched paths (`*`) redirect to `/admin`.

Every panel route below `/admin` except the `index` route (`AdminPage`) is `React.lazy`-loaded with a shared `PanelFallback` (`Loading…`) `Suspense` boundary — content-type, collection-type detail, and every settings page. `settings/media` has no `minLevel`/permission gate at the route level (page-level empty state instead); `settings/users` requires `minLevel={ROLE_LEVEL.ADMIN}` (`50`); `settings/access-tokens`, `settings/roles`, `settings/permissions` require `minLevel={ROLE_LEVEL.SUPER_ADMIN}` (`100`) — `ROLE_LEVEL` is a named-constant object declared in `router.tsx` rather than bare numeric literals at each route. These are floor thresholds this app's own routes happen to gate on, not an exhaustive role list — the role/permission catalog itself is fully dynamic (see [access-control.md](./access-control.md)). These route-level `minLevel` checks are a coarser, second layer on top of the Sidebar's per-permission `hasPermission()` gating (see [navigation-shell.md](./navigation-shell.md)) — a link can be hidden by permission while the route itself is still only gated by role level.

There is no `settings/internationalize` route — locale UI is hidden (route and nav entry removed, source kept orphaned, see [locales-and-invites.md](./locales-and-invites.md)). `src/components/AdminRoute.tsx` (the old role-string guard, `role !== "admin"`) has been **deleted** — it was already dead code before this pass, and `ProtectedRoute`'s `minLevel` prop fully replaces what it did.

## Shared types (`src/types/cms.ts`)

- `FieldDefinition` — one schema field: `name`, `type` (a fixed union: `"text" | "richtext" | "number" | "boolean" | "media" | "json" | "component"`, no longer a bare `string`), `width` (`"100%" | "50%" | "1/3"`, form-grid column span), `header` (marks a field as the preferred label for collapsed/repeatable-entry summaries), `component`/`repeatable`/`fields` (nested `FieldDefinition[]` for component arrays). There is no `ext` field anymore — media fields have no per-field extension allowlist; the API accepts PNG/JPEG only, enforced server-side on upload (see [media.md](./media.md)).
- `ContentTypeSummary` — `{ slug, name, kind: "single" | "collection", draftToPublish }`; `ContentType` extends it with `documentId`, `fields`, `listFields` (admin-configured list-view column override, see [documents.md](./documents.md)), `createdAt`/`updatedAt`. All fields are camelCase now (previously `Slug`/`Name`/`Kind`/`Fields`/`ID`).
- `Document` — the single-document fetch shape: `{ data: { documentId, status, createdAt, updatedAt, publishedAt?, updatedBy: DocumentUpdatedBy | null, ...schemaFields } }`. `ListedDocumentItem` is a **different, sibling shape** for `GET /documents/collection-type/:slug` list rows — confirmed against the live API to put system columns as siblings of `data`, not nested inside it, with `data` holding only the content type's `listFields`-selected columns. `DocumentUpdatedBy` is `{ documentId, name }`. `EntryStatus = "draft" | "modified" | "published"`.
- `SYSTEM_FIELDS` / `stripSystemFields` — the field-name allowlist (`documentId`, `status`, `createdAt`, `updatedAt`, `publishedAt`, `updatedBy` — no more `locale`/`createdBy`/`updatedByName`) stripped from a document's `data` before it's fed into a `react-hook-form` instance, so the form only ever sees user-editable schema fields.
- `Locale` — kept as-is even though locale UI is hidden, so the orphaned `InternationalizePage`/`LocaleSelector`/`useLocales*` files still typecheck (see [locales-and-invites.md](./locales-and-invites.md)).
- `MediaAsset` — new shape: `{ documentId, fileName, mimeType, size, width, height, url, thumbnailUrl, publicId, hash, uploadedBy: string | null, createdAt, updatedAt }`. No more `ID`/`fileExt` (see [media.md](./media.md)).

## Misc

- `src/lib/utils.ts` — `cn()` (`clsx` + `tailwind-merge`), used everywhere Tailwind classes are conditionally composed.
- `src/lib/pageSize.ts` — `PAGE_SIZE_OPTIONS = [10, 25, 50, 100]`, shared between the collection list page and its `PageSizeSelector` (see [documents.md](./documents.md)).
- `src/content-type-registry/index.ts` — see [content-type.md](./content-type.md).

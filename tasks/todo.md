# Todo: `/cv-3` — CV page with role-nested projects

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS** — 13 done / 15 tasks

Checkbox updates ship in the same commit as that phase's code.

## Phase 0 — Data model

- [x] **T1** Add `apps/cms-api/content-types/cv-page-new.json` — copy of `cv-page.json` with the top-level projects removed, `role.projects` promoted to a repeatable component, and `period` added to `experience`
- [x] **T2** Verify the sync engine creates all eight tables and GraphQL exposes `projects` on `CvPageNewRole`, with a nested round-trip through the API — completed 2026-08-29 against the user's live dev stack. `psql \dt components_cv_page_new*` confirms all 8 tables (`documents_cv_page_new` + `skill`/`experience`/`experience_role`/`experience_role_project`/`education`/`language`/`reference`). GraphQL introspection confirms `cvPageNew`/`cvPageNews` on the root query and `CvPageNewRole.projects: [CvPageNewProject!]!`. Created a test document (`8ee6eb87-5f73-46af-81f0-092129a12be3`, super-admin auth) with one role holding one project; `cvPageNew(documentId, status: "draft")` returned the full company → role → project chain intact, including the role's `techStack` JSON field. A temporary read-only access token was created for the query and deleted immediately after.
- [x] **T3** Verify cms-admin renders the nested form and preserves the nesting on save *(manual, sibling repo)* — completed 2026-08-29 in the running cms-admin (localhost:5173) via browser automation, logged in as super admin. `CV Page New` appears in the content-type list; the "Add entry" control nests correctly three levels deep (experience → roles → projects), and every field in `cv-page-new.json` rendered and validated, including catching that `techStack` is a `json`-typed field requiring valid JSON array syntax, not a comma-separated string. Saved the document, reloaded the page, and confirmed the nested role/project data was still present and correctly attached.

> **CHECKPOINT A** — go / no-go: **GO**. T2 and T3 both verified 2026-08-29; depth-3 nesting works end-to-end in both the API and cms-admin, confirming the code trace in plan.md's Corrections section.
> **Commit 1** — `feat(cms-api): add cv-page-new content type with role-nested projects`

## Phase 1 — Data layer and first render

- [x] **T4** Add `cv-new.types.ts`, `cv-new.queries.ts`, `cv-new.service.ts`, using `name` (renamed from `company` per T1) on both sides of the list query
- [x] **T5** Add `src/mocks/cv-page-new.ts`, `cv-new-main.ts`, `cv-new-list.ts` and register `"cv-new-main"` / `"cv-new-list"` in `mock-all.ts` — at least one role holding no projects, one holding two
- [x] **T6** Add the `/cv-3` route, the frame, the header, and the About Me section — build/lint/tests pass; full browser screenshot blocked by the site-wide health gate (cms-api `/health` returns 403 against the user's local instance), confirmed via server logs to fail identically on the pre-existing `/cv-2` (no CV content in the DB yet — expected until T14), not a regression

> **CHECKPOINT B** — first render at `/en/cv-3`.
> **Commit 2** — `feat(frontend): scaffold /cv-3 page with cv-page-new data layer`

## Phase 2 — Experience section

- [x] **T7** Build the company strip and role blocks from `new.html`, on theme tokens rather than hex values — verified in-browser (light + dark) via a throwaway local stub GraphQL/health server, since the real cms-api has no `cv-page-new` content yet (T14); no app code touched to force this, stub was deleted after
- [x] **T8** Nest the project cards under their roles, rendering nothing at all for a role with no projects — verified in-browser (light + dark) with the same throwaway stub as T7; confirmed via DOM inspection that the empty-projects role emits exactly its 4 base children (period, position, responsibilities, tech chips), no empty wrapper

> **CHECKPOINT C** — the core feature.
> **Commit 3** — `feat(frontend): render role-nested project cards on /cv-3`

## Phase 3 — Remaining sections and frame

- [x] **T9** Fork the skills, education, languages, and references sections; lock the final section order — verified in-browser (light + dark) with the same throwaway stub; section id order confirmed via DOM query: `about-me, experience, skills, education, languages, references`. Added an empty-array `return null` guard to Skills/Education/Languages to match References (cv-elegant's versions don't guard those, but T9's acceptance criteria calls for it)
- [x] **T10** Add the anchor nav and the action bar with the company dropdown — added `CvNewCompanyDropdown.tsx` (renders `null` when the list is empty, navigates to `/{locale}/cv-3/{documentId}`), reused `PrintButton`, and wired both into `CvNewPageContent` alongside a six-section anchor nav; verified in-browser (light + dark) with a throwaway local stub GraphQL/health server since the real cms-api has no `cv-page-new` content yet (T14) and local port 5000 is bound by macOS ControlCenter, not cms-api — every anchor scrolled to its section, the dropdown listed the mock company and 404'd on `/cv-3/{documentId}` as expected since T11 isn't built yet; stub deleted after, no app code touched to force it
- [x] **T11** Add the `/cv-3/[documentId]` per-company route with a 404 on an unknown id — mirrors `/cv/[documentId]`; also `notFound()`s on a resolved-but-null result (`getCvNewById` returns `null` rather than throwing on a missing record, unlike `/cv`'s by-id fetch), and passes `cvList={[]}` to `CvNewPageContent` so the dropdown guard from T10 hides it. Verified in-browser with the same throwaway stub pattern as T10: a valid id rendered the full CV with no dropdown, an unknown id returned a real 404 (curl-confirmed status codes 200 and 404); stub deleted after

## Phase 4 — Print and tests

- [x] **T12** Write the print stylesheet: light-on-white in both themes, header background kept, no duplicated URLs — added `CvNewPage.module.css` (adapted from `/cv`'s: `@page` margin, forced light-mode variable block, `font-size`/`line-height`, zeroed content padding since page margin already provides it); anchor nav/action bar already used Tailwind `print:hidden` from T10 and project/role cards already had `print:break-inside-avoid` from T7/T8, so no changes needed there; header's `print-color-adjust: exact` already existed from T7. Found and fixed a real bug during verification: section headings use a fixed `dark:text-white/80` (not a CSS variable), so they stayed white-on-white when printing from the dark app theme — added an explicit `.content :global(h3)` override forcing the light color back. No `attr(href)` duplication rule added, since `CvNewHeader` already prints links as visible URL text. Verified in-browser (both app themes) by extracting the actual `@media print` rules from the compiled stylesheet and applying them live, then screenshotting — confirmed light-on-white body, dark header retained, no nav/action bar, no duplicate URLs, headings legible in both cases
- [x] **T13** Add `e2e/cv-3-layout.test.ts` asserting section order, no Projects section, and the empty-projects case — scopes the order check to the CV's own `header:has(h1)` (the site-wide nav bar is also a `<header>`) followed by `section[id]` in document order; empty-projects role located via its unique position text ("Frontend Developer") since no test-id convention exists in this repo. Full Checkpoint D gate run: `bun run lint`, `bun run build`, `bun test src` (78 pass), `bunx playwright test e2e/cv-3-layout.test.ts` (1 pass, 7 screenshots in `e2e/screenshots/`), cms-api `bun run lint` + `bun run test` (1121 pass) — all green. Verified against a throwaway stub dev server on the real port 4000 (with the user's permission, since Next 16 refuses a second dev instance per project directory regardless of port — a "different port" alone doesn't work around it), torn down after

> **CHECKPOINT D** — feature complete against mocks. Full gate: lint, build, unit, e2e, both apps, clean `git status`.
> **Commit 4** — `feat(frontend): complete /cv-3 sections, print styles and layout test`

## Phase 5 — Live content and closeout

- [ ] **T14** Enter the real content in cms-admin and verify `/cv-3` against the live API *(manual)* — still open. While attempting this, found and fixed a real bug it surfaced: `graphqlApi.fetch`'s dev mock-fallback never actually engaged for a legitimate empty result (only for hard GraphQL errors), and even then assumed a `{ data: {...} }` envelope shape that most CV mocks don't have (they're bare pre-selected values) — see `apps/frontend/src/api/graphqlApi.ts` and its new test. `/cv-2` and `/cv-3` both crashed identically (`Cannot read properties of null (reading 'position')`) against the running live cms-api/cms-admin/frontend because no `cv-page-new`/`cv-page` entry has `isMain: true` yet; both now render via mock fallback with the fix. Also closed a sibling gap: `/cv-3/[documentId]` (T11) had no per-id mock (unlike `/cv/[documentId]`'s `cv-demo-abc123.ts`), so it 404'd in dev instead of demoing — added `cv-new-demo-new-001.ts`, registered as `cv-new-demo-new-001` in `mock-all.ts`, matching the `documentId` already referenced by `cv-new-list.ts`; guarded by a new test in `mock-all.test.ts` asserting every cv-new list entry has a matching per-id mock. Live-content entry + verification against real data is still owed.
- [ ] **T15** Closeout: SPEC to SHIPPED, correct its risk table, resolve the slug question, propose removing `new.html`, grep for stale references

> **Commit 5** — `docs: mark /cv-3 spec shipped`

---

## Open before T1

- **Slug name.** `cv-page-new` gives the list query `cvPageNews`. `cv-page-v2` gives `cvPageV2s`. Free to change now, a delete-and-recreate once content exists.

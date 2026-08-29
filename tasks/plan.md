# Plan: `/cv-3` — CV page with role-nested projects

Spec: [`SPEC.md`](../SPEC.md) (DRAFT, 2026-08-28)
Status: **NOT STARTED**
Task list: [`tasks/todo.md`](todo.md)

---

## Corrections found during planning

The spec's risk table listed depth-3 component nesting as the one risk that could sink the whole
approach, unverified in both the API and the admin UI. Reading the code narrows that considerably.

| Layer | File | Handles depth 3? |
| --- | --- | --- |
| Table naming | `apps/cms-api/src/modules/content-type/application/schema/table-naming.ts` | Yes. Path segments join with `_`; the result is `components_cv_page_new__experience_role_project`, 47 characters. A truncate-plus-hash fallback covers anything over 63, so length cannot fail. |
| DDL sync | `.../application/sync/schema-differ.ts` | Yes. `collectComponentPaths` recurses with no depth limit. |
| Write | `.../document/application/support/component-io.service.ts` | Yes. `saveComponentTree` recurses, linking children by `parent_component_id`. |
| Read | same file, `hydrateRows` | Yes. Recurses on every nested component field. |
| GraphQL schema | `.../graphql/application/schema-builder.service.ts` | Yes. `buildComponentTypesFor`'s inner `visit` recurses. |

So the API side is structurally depth-agnostic, and T2 is a confirmation rather than a gamble. The
genuinely unknown piece is **cms-admin's form renderer**, which lives in the sibling repository
`abyssoftime-cms-admin` and is outside this project directory, so it cannot be inspected from here.
T3 is a manual check in the running admin and it is the real go/no-go.

One naming detail worth recording: GraphQL component type names derive from the component **name**
only, not its path, so the nested component named `project` becomes `CvPageNewProject`. That is
collision-free here only because the spec removes the top-level `projects` field. If a top-level
projects list is ever added back to this type, it must use a different component name.

---

## Dependency graph

```
T1 content-type JSON
      │
      ▼
T2 sync + GraphQL verification (API)
      │
      ▼
T3 cms-admin nested form check  ─────►  CHECKPOINT A  (go / no-go)
                                              │
                                              ▼
                                        T4 types + queries + service
                                              │
                                              ▼
                                        T5 mocks + registration
                                              │
                                              ▼
                                        T6 route + frame + header + summary
                                              │
                                        CHECKPOINT B  (first render)
                                              │
                                              ▼
                                        T7 shared section + experience roles
                                              │
                                              ▼
                                        T8 nested project cards + empty case
                                              │
                                        CHECKPOINT C  (the core feature)
                                              │
                                              ▼
                                        T9 skills, education, languages, references
                                              │
                                              ▼
                                        T10 anchor nav + action bar + dropdown
                                              │
                                              ▼
                                        T11 per-company [documentId] route
                                              │
                                              ▼
                                        T12 print CSS
                                              │
                                              ▼
                                        T13 e2e layout test
                                              │
                                        CHECKPOINT D  (feature complete on mocks)
                                              │
                                              ▼
                                        T14 real content entry + live verification
                                              │
                                              ▼
                                        T15 closeout
```

Everything is serial. T4 and T5 could technically start during T2 since they depend only on the
shape decided in T1, but a failure at T2 or T3 changes that shape, so nothing frontend begins before
Checkpoint A.

Each task below is a vertical slice: it ends with something observable in a browser, a database, or
a test run, not a layer that only makes sense once the next layer lands.

---

## Phase 0 — The data model

### T1 — Add the `cv-page-new` content type

**Size**: S
**Files**: `apps/cms-api/content-types/cv-page-new.json` (new)

Copy `content-types/cv-page.json`, then apply exactly four changes:

1. Delete the top-level `projects` component field.
2. Change `role.projects` from `{ "type": "text" }` to a repeatable component named `project`,
   carrying the seven fields the old top-level `project` component had: `name`, `teamSize`, `role`,
   `liveLink`, `responsitoryLink`, `techStack`, `responsibilities`.
3. Add `{ "name": "period", "type": "text", "width": "50%" }` to the `experience` component.
4. Rename the top-level `company` field to `name` — it labels the CV entry itself, not an employer;
   `experience.company` (the per-job employer) is unaffected.

`listFields`: `["position", "isMain", "name"]`.

**Acceptance criteria**
- The JSON differs from `cv-page.json` only in those four ways.
- `slug` is `cv-page-new`, `kind` is `collection`, `draftToPublish` is `true`.

**Verification**
```
cd apps/cms-api && bun run start:dev
```
Boot completes without a validation abort. A malformed file fails boot loudly, so a clean start is
the check.

---

### T2 — Verify the schema and GraphQL at depth 3

**Size**: S
**Files**: none. Verification only.

**Acceptance criteria**
- Eight tables exist: `documents_cv_page_new` plus component tables for `skill`, `experience`,
  `experience_role`, `experience_role_project`, `education`, `language`, `reference`.
- The GraphQL schema exposes `cvPageNews` and `cvPageNew`, and `CvPageNewRole` has a
  `projects: [CvPageNewProject]` field.
- A document written through the API round-trips with its nested projects intact.

**Verification**
```
psql "$DATABASE_URL" -c "\dt components_cv_page_new*"
```
Then against `POST http://localhost:3000/graphql` with `Authorization: Bearer <api token>`:
introspect `CvPageNewRole`, create one entry with a role holding two projects and a second role
holding none, publish it, and read it back through `cvPageNews`. Both roles must come back with the
right project counts, one of them an empty array.

---

### T3 — Verify the cms-admin nested form

**Size**: S
**Files**: none. Manual check by the user.

This is the one thing that cannot be verified from this repository.

**Acceptance criteria**
- `cv-page-new` appears in cms-admin's content-type list.
- Its form lets a project be added inside a role, with the role itself inside a company.
- Saving and reloading preserves the nesting.

**Verification**: manual, in the running admin.

---

> ### CHECKPOINT A — go / no-go
>
> If T3 fails, stop. Do not start frontend work. The fallback options, in order of preference:
> flatten to two levels by making `roles` non-repeatable is not viable; more likely we keep depth 3
> and enter content through GraphQL directly, or revisit the name-matching approach the spec
> rejected. Either way it is a decision for you, not a workaround I should pick.
>
> **Verified 2026-08-29**: T2 and T3 were originally waived on 2026-08-28 since neither had
> infrastructure available in that session. Both were completed against the user's live dev stack
> (cms-api on :8080, cms-admin on :5173, Postgres via Docker): 8 tables confirmed via `psql`, GraphQL
> schema and a round-trip query confirmed via a temporary access token, and the cms-admin nested form
> confirmed via browser automation logged in as super admin (save + reload preserved the nesting). The
> depth-3 code trace in "Corrections found during planning" above is now a confirmed fact, not an
> assumption.
>
> **Commit 1** — `feat(cms-api): add cv-page-new content type with role-nested projects`

---

## Phase 1 — Frontend data layer and first render

### T4 — Types, queries, service

**Size**: M
**Files**: `apps/frontend/src/views/cv-new/cv-new.types.ts`, `cv-new.queries.ts`, `cv-new.service.ts` (all new)

Mirror `cv-elegant.types.ts` with `projects` moved onto `role`, removed from the document root, and
`period` added to the experience entry. Queries mirror `cv-elegant.queries.ts` against `cvPageNews`
and `cvPageNew`, selecting the nested `projects` inside `roles`. Service mirrors
`cv-elegant.service.ts` with keys `cv-new.main`, `cv-new.list`, `cv-new.by-id`, `selectKey`
`cvPageNews.items`, and `next: { revalidate: 300, tags: ["cv"] }`.

**Acceptance criteria**
- `role.projects` is typed as an array and marked optional, so a role with none type-checks.
- The list query selects the document-root `name` field (renamed from `company` per T1, change 4),
  and the list item type calls the field `name` — not `companyName`. This is the cv-elegant defect
  the spec says not to inherit (`GET_CV_ELEGANT_LIST` selects `company`, `CvElegantListItemType`
  calls it `companyName`, so the dropdown label is blank).
- `experience.company` (the per-job employer) keeps its own name unchanged throughout.
- Nothing imports from `@/views/cv-elegant`.

**Verification**: `bun run build` from `apps/frontend` type-checks the new files.

---

### T5 — Mocks

**Size**: M
**Files**: `apps/frontend/src/mocks/cv-page-new.ts`, `cv-new-main.ts`, `cv-new-list.ts` (new);
`apps/frontend/src/mocks/mock-all.ts` (modified)

Content adapted from `src/mocks/cv-elegant-main.ts`, restructured so each role owns its projects.

**Acceptance criteria**
- At least one role has `projects: []`. The empty case must be exercised on every local run.
- At least one role has two or more projects.
- `"cv-new-main"` and `"cv-new-list"` are registered in `MockView`.
- `mock-all.ts` gains only import lines and two map entries.

**Verification**: `bun run build`, plus the data appearing in T6.

---

### T6 — Route, frame, header, summary

**Size**: M
**Files**: `apps/frontend/src/app/[locale]/(main)/cv-3/page.tsx`,
`src/views/cv-new/CvNewPage.tsx`, `CvNewPageContent.tsx`,
`shared/CvNewSection.tsx`, `header/CvNewHeader.tsx`, `header/CvNewHeader.module.css`,
`summary/CvNewSummary.tsx` (all new)

The frame per the spec: outer `relative mx-auto max-w-[800px] bg-background text-foreground/90`, the
full-bleed header immediately inside it, then an inner `px-5 py-6 sm:px-8 sm:py-8` wrapper holding
the sections. Header and summary are straight forks of their cv-elegant counterparts.

**Acceptance criteria**
- `/en/cv-3` renders the header bar and the About Me section from mock data.
- Contact and section titles come from the shared `cv-contact` and `common-text` services.
- The header is full-bleed. No horizontal padding on the outer container.
- `/cv` and `/cv-2` are unchanged.

**Verification**
```
cd apps/frontend && bun run dev
```
Open `http://localhost:4000/en/cv-3`. Then `git status` shows no modification under `src/views/cv`
or `src/views/cv-elegant`.

---

> ### CHECKPOINT B — first render
>
> The route, the service, the mock registry, and the frame are proven end to end before any of the
> real layout work starts.
>
> **Commit 2** — `feat(frontend): scaffold /cv-3 page with cv-page-new data layer`

---

## Phase 2 — The experience section

### T7 — Company strip and role blocks

**Size**: M
**Files**: `apps/frontend/src/views/cv-new/experience/CvNewExperience.tsx` (new);
`CvNewPageContent.tsx` (modified)

Rebuild from `new.html`, projects deliberately deferred to T8. Per company, a header strip with
name, location, and `period` on a muted background with a left accent border. Per role: title line
with position and period, `responsibilities` through `HTMLParser`, then tech chips.

**Acceptance criteria**
- `new.html`'s navy and blue map onto theme tokens. No hard-coded hex values.
- The section reads correctly in light and dark theme.
- Companies without a `period` render without an empty separator.

**Verification**: visual check at `/en/cv-3`, both themes.

---

### T8 — Nested project cards

**Size**: M
**Files**: `apps/frontend/src/views/cv-new/experience/CvNewExperience.tsx` (modified)

Each project in `role.projects` renders as a card matching `new.html`'s `.project-card`: name, role
and `Team of N` when `teamSize > 1`, `responsibilities` bullets, a tech line, and live and repository
links when present. Muted background, left accent border.

**Acceptance criteria**
- Every card sits under the role it belongs to.
- A role with an empty `projects` array renders its title, responsibilities, and tech stack and then
  stops. No heading, no empty container, no extra vertical gap.
- No standalone Projects section exists anywhere on the page.
- Cards avoid breaking across pages in print (`print:break-inside-avoid`).

**Verification**: visual check that the mock's empty-projects role from T5 renders with no gap.
Inspect it in devtools to confirm no empty wrapper element is emitted.

---

> ### CHECKPOINT C — the core feature
>
> This is the reason the content type changed. Everything after this is finishing work.
>
> **Commit 3** — `feat(frontend): render role-nested project cards on /cv-3`

---

## Phase 3 — Remaining sections and frame completion

### T9 — Skills, education, languages, references

**Size**: M
**Files**: `apps/frontend/src/views/cv-new/skills/CvNewSkills.tsx`,
`education/CvNewEducation.tsx`, `languages/CvNewLanguages.tsx`,
`references/CvNewReferences.tsx` (all new); `CvNewPageContent.tsx` (modified)

Straight forks of the cv-elegant components. No layout changes.

**Acceptance criteria**
- Final order: Header, About Me, Work Experience & Key Projects, Technical Skills, Education,
  Languages, References.
- Section ids are `about-me`, `experience`, `skills`, `education`, `languages`, `references`.
- References and any empty optional array render `null`, not an empty section.

**Verification**: visual check of order and ids at `/en/cv-3`.

---

### T10 — Anchor nav and action bar

**Size**: S
**Files**: `apps/frontend/src/views/cv-new/footer/CvNewCompanyDropdown.tsx` (new);
`CvNewPageContent.tsx` (modified)

`/cv`'s anchor nav strip, hidden below `sm` and in print, linking to the six section ids. Action bar
with the dropdown and the existing `PrintButton` reused from `@/views/cv/footer/PrintButton`.

**Acceptance criteria**
- Every anchor scrolls to a section that exists.
- The dropdown shows correct company labels and navigates to `/{locale}/cv-3/{documentId}`.
- The dropdown renders nothing when the list is empty.

**Verification**: click each anchor and one dropdown entry at `/en/cv-3`.

---

### T11 — Per-company route

**Size**: S
**Files**: `apps/frontend/src/app/[locale]/(main)/cv-3/[documentId]/page.tsx` (new)

Mirrors `/cv/[documentId]`: fetch by id alongside contact and common text, `notFound()` on failure.

**Acceptance criteria**
- A valid id renders that company's CV without the dropdown.
- An unknown id yields a 404.

**Verification**: visit a mock id and a junk id.

---

## Phase 4 — Print and tests

### T12 — Print stylesheet

**Size**: M
**Files**: `apps/frontend/src/views/cv-new/CvNewPage.module.css` (new or completed)

Start from `/cv`'s `CvPage.module.css`: `@page { margin: 8mm 14mm }`, `.printHide`, the forced
light-mode variable block, `font-size: 12.5px`, `line-height: 1.3`. Add `print-color-adjust: exact`
on the header. Drop `/cv`'s rule appending `attr(href)` under header links, since the cv-elegant
header already prints URLs as visible text.

**Acceptance criteria**
- Print preview is light-on-white in both light and dark theme.
- The dark header bar keeps its background.
- Anchor nav and action bar are absent from print.
- No duplicated URLs under the header links.
- Project cards do not split across a page break.

**Verification**: print `/en/cv-3` to PDF in both themes and read the output.

---

### T13 — End-to-end layout test

**Size**: M
**Files**: `apps/frontend/e2e/cv-3-layout.test.ts` (new)

Modeled on `e2e/cv-spacing.test.ts`: navigate, screenshot full page, capture each section.

**Acceptance criteria**
- Asserts the seven sections appear in the specified order.
- Asserts no element with a Projects section id exists.
- Asserts the empty-projects role emits no project card.
- Screenshots land in `e2e/screenshots/`.

**Verification**
```
cd apps/frontend && bunx playwright test e2e/cv-3-layout.test.ts
```

---

> ### CHECKPOINT D — feature complete against mocks
>
> Full gate before touching live content:
> ```
> cd apps/frontend && bun run lint && bun run build && bun test src
> bunx playwright test e2e/cv-3-layout.test.ts
> cd ../cms-api && bun run lint && bun run test
> git status   # nothing outside the spec's file lists
> ```
>
> **Commit 4** — `feat(frontend): complete /cv-3 sections, print styles and layout test`

---

## Phase 5 — Live content and closeout

### T14 — Enter real content and verify against the live API

**Size**: M, mostly manual
**Files**: none

Create the main `cv-page-new` entry in cms-admin from the existing `/cv-2` content, restructured so
each project sits under its role, and publish it.

**Acceptance criteria**
- `/en/cv-3` renders live data with mocks disabled.
- At least one role with no projects exists in the real content and renders cleanly.
- The company dropdown lists real entries.

**Verification**: load `/en/cv-3` against the live API and print it to PDF.

---

### T15 — Closeout

**Size**: S
**Files**: `SPEC.md` (modified), `tasks/todo.md` (modified), `new.html` (removal proposed)

Per the workflow's full step list, finishing the task list is not the same as being done.

**Acceptance criteria**
- `SPEC.md` status moves to SHIPPED with the date, and its risk table is corrected to match what the
  planning pass found.
- The open question about the `cv-page-new` slug is resolved in the spec, not left dangling.
- `new.html` is proposed for deletion as a spent scratch file. I will ask before removing it.
- A grep for `cv-3`, `cv-page-new`, and `CvPageNew` across the repository turns up no stale or
  contradictory documentation.

**Verification**: `grep -rn "cv-3\|cv-page-new" --exclude-dir=node_modules .`

---

> **Commit 5** — `docs: mark /cv-3 spec shipped`

---

## Commit protocol

Five commits, one per checkpoint, as listed above. Per your standing preferences:

- Commits batch at phase boundaries, never per file.
- Each phase's `tasks/todo.md` checkbox updates go in that same phase's commit, never separately.
- I show you the staged file list and the message and wait for your go-ahead before every commit.
- No `Co-Authored-By` trailer.

## Estimates

| Phase | Tasks | Size |
| --- | --- | --- |
| 0 — data model | T1–T3 | S, plus one manual admin check |
| 1 — data layer and first render | T4–T6 | M |
| 2 — experience section | T7–T8 | M, the real work |
| 3 — remaining sections and frame | T9–T11 | M |
| 4 — print and tests | T12–T13 | M |
| 5 — content and closeout | T14–T15 | M, mostly manual |

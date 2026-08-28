# Spec: `/cv-3` — CV page with role-nested projects

Status: **DRAFT** — awaiting approval
Date: 2026-08-28
Target apps: `apps/cms-api` (new content type), `apps/frontend` (new route + view)
Reference design: `new.html` (repo root, untracked scratch file)

This spec sits at the monorepo root because it crosses both apps. `apps/frontend/SPEC.md`
(SHIPPED auth spec) and `apps/cms-api/SPEC.md` (idle) are left untouched.

---

## Objective

Add a third CV presentation at `/cv-3`, backed by a **new content type whose projects live inside
each role** instead of in a flat top-level list. The reference file `new.html` groups every project
card under the role that produced it; the current content model cannot express that relationship,
so the model changes first and the page follows.

### User stories

- **As the CV owner**, I open `/cv-3` and see each job role followed by the project cards belonging
  to that role, so a reader can tell which work came from which position.
- **As the CV owner**, I add a role with no projects and the page renders that role cleanly, with no
  empty Projects heading and no stray spacing.
- **As the CV owner**, I print `/cv-3` to PDF and get the same clean light-on-white output `/cv`
  produces today.
- **As a content editor**, I enter the nested structure in cms-admin without touching code.

### Non-goals

- Changing `/cv`, `/cv-2`, `src/views/cv`, `src/views/cv-elegant`, or `content-types/cv-page.json`
  in any way. They keep working exactly as they do today.
- Migrating existing `cv-page` entries into the new content type. Content is re-entered manually.
- `apps/frontend-v2`.
- Adding `/cv-3` to the CMS-driven header navigation.

---

## Decisions

Answers given during spec intake, with the trade-off each one settles.

| Question | Chosen | Alternative rejected | Why |
| --- | --- | --- | --- |
| Route | New route `/cv-3` | Replace `/cv-2` | `/cv-2` and `src/views/cv-elegant` stay untouched, so nothing already working can regress. |
| Data source | New content type `cv-page-new` in cms-api | Reuse `cv-page`; match `role.projects` text against project names | Name-string matching breaks silently when a name is edited on one side only. A real nested component cannot drift. |
| Top-level projects | Nested only | Nested plus a top-level list | Matches `new.html` exactly. Personal side projects have no home in this model; accepted. |
| Section layouts | Fork `src/views/cv-elegant` components | Fork `src/views/cv` components | The new content type is a copy of `cv-page`, which is the shape cv-elegant already reads. Forking `/cv` would need a per-section adapter layer for grouped skills and data-carried section names. |
| Frame | From `src/views/cv` | From cv-elegant | Explicit request: outer wrapper, print rules, and CV container come from `/cv`. |
| References | Rendered | Omitted | `cv-page` already carries `references` and `/cv-2` renders them, so the data exists. My earlier "omit" question was asked on the wrong premise and is superseded. |
| Theme | Tailwind theme tokens, dark mode kept | `new.html`'s fixed light palette | Consistent with both existing CV pages and required for the print CSS token override to work. |
| Content bootstrap | Frontend mock + manual entry in cms-admin | Seed script copying `cv-page` rows | A one-time manual entry is cheaper than a migration script that runs once and is then dead code. |

---

## Assumptions

1. `new.html` governs **section order and the experience/projects rendering only**. Header, summary,
   skills, education, languages, and references keep the cv-elegant layout, per the request.
2. `/cv-3` mirrors `/cv`'s route shape: an index page plus a `[documentId]` child route, with the
   company dropdown in the action bar.
3. `/cv-3` is not in the CMS nav. `resolveRule` returns no rule for it, and `isRoleAllowed("")` is
   true, so the page is public — the same footing `/cv-2` has today. Prefix matching does not make
   the `/cv` rule apply, because `matches("/cv", "/cv-3")` requires the next character to be `/`.
4. Contact details and section titles keep coming from the existing `cv-contact` and `common-text`
   content types, shared with both existing CV pages. No new keys are required beyond what
   `src/mocks/cv-common-text.ts` already lists.
5. Component nesting three levels deep (`experiences → roles → projects`) is supported by the sync
   engine — `collectComponentPaths` in `apps/cms-api/src/modules/content-type/application/sync/schema-differ.ts`
   recurses without a depth limit, and the resulting table name is 49 characters, under Postgres's
   63-character identifier cap. This is **unverified at runtime and in the cms-admin form UI**; see
   Risks.

---

## Scope A — `apps/cms-api`: the `cv-page-new` content type

One new file, `content-types/cv-page-new.json`. No code, no Prisma migration. `ContentTypeSyncService`
creates the tables on the next boot.

It is a copy of `content-types/cv-page.json` with four changes:

1. The top-level `projects` component is **removed**.
2. `role.projects` changes from a `text` field to a **repeatable `project` component**, carrying the
   same fields the old top-level `project` component had.
3. `experience` gains a `period` text field, so the company header can show a date range the way
   `new.html` does. Without it there is no company-level period anywhere in the data.
4. The top-level `company` field is renamed to `name` — it labels the CV entry itself (e.g. "Senior
   Backend Engineer CV"), not an employer; `experience.company` (the per-job employer) is unaffected.

Everything else — `position`, `isMain`, `summary`, `skills`, `educations`, `languages`,
`references`, and every field inside them — is byte-identical to `cv-page.json`.

Resulting structure:

```
cv-page-new (collection, draftToPublish: true)
├─ position       text
├─ isMain         boolean
├─ name           text
├─ summary        richtext
├─ skills[]       { level, skill }
├─ experiences[]  { company, location, period
│                   └─ roles[]     { position, period, teamSize, techStack, responsibilities
│                                     └─ projects[]  { name, teamSize, role, liveLink,
│                                                      responsitoryLink, techStack,
│                                                      responsibilities } } }
├─ educations[]   { degree, institution, period, location, description }
├─ languages[]    { language, level }
└─ references[]   { name, phone, role }
```

`listFields`: `["position", "isMain", "name"]`.

### Generated GraphQL names

Derived by `apps/cms-api/src/modules/graphql/domain/naming.ts` from the slug:

| Purpose | Name |
| --- | --- |
| Object type | `CvPageNew` |
| Single query | `cvPageNew(documentId: ID!)` |
| List query | `cvPageNews(where: …)` |

`cvPageNews` is an awkward plural. The slug is a deliberate follow of the name you gave; say the word
and `cv-page-v2` (`cvPageV2` / `cvPageV2s`) replaces it before any content is entered. After content
exists, a slug change is a delete-and-recreate.

---

## Scope B — `apps/frontend`: the `/cv-3` page

### Files added

```
src/app/[locale]/(main)/cv-3/page.tsx              index, main CV
src/app/[locale]/(main)/cv-3/[documentId]/page.tsx per-company CV
src/views/cv-new/CvNewPage.tsx                     server component, fetches + composes
src/views/cv-new/CvNewPageContent.tsx              the frame: container, nav, sections, action bar
src/views/cv-new/CvNewPage.module.css              print rules
src/views/cv-new/cv-new.types.ts
src/views/cv-new/cv-new.queries.ts
src/views/cv-new/cv-new.service.ts
src/views/cv-new/header/CvNewHeader.tsx
src/views/cv-new/header/CvNewHeader.module.css
src/views/cv-new/shared/CvNewSection.tsx
src/views/cv-new/summary/CvNewSummary.tsx
src/views/cv-new/experience/CvNewExperience.tsx    ← the only section rebuilt from new.html
src/views/cv-new/skills/CvNewSkills.tsx
src/views/cv-new/education/CvNewEducation.tsx
src/views/cv-new/languages/CvNewLanguages.tsx
src/views/cv-new/references/CvNewReferences.tsx
src/views/cv-new/footer/CvNewCompanyDropdown.tsx
src/mocks/cv-page-new.ts
src/mocks/cv-new-main.ts
src/mocks/cv-new-list.ts
```

### Files modified

```
src/mocks/mock-all.ts    register "cv-new-main", "cv-new-list"
```

Nothing else in the repo is touched.

### Section order and layout source

| # | Section | id | Layout comes from |
| --- | --- | --- | --- |
| 1 | Header | — | cv-elegant header, unchanged |
| 2 | About Me | `about-me` | cv-elegant summary, unchanged |
| 3 | Work Experience & Key Projects | `experience` | **rebuilt from `new.html`** |
| 4 | Technical Skills | `skills` | cv-elegant skills, unchanged |
| 5 | Education | `education` | cv-elegant education, unchanged |
| 6 | Languages | `languages` | cv-elegant languages, unchanged |
| 7 | References | `references` | cv-elegant references, unchanged |

There is no standalone Projects section. Skills moving below Experience and References moving to the
bottom is the whole of the reordering versus `/cv-2`.

### The frame

Taken from `src/views/cv/CvPageContent.tsx` and `src/views/cv/CvPage.module.css`, with one structural
adjustment: the cv-elegant header is a full-bleed dark bar, so horizontal padding sits on an **inner
content wrapper** rather than on the outer container.

- Outer: `relative mx-auto max-w-[800px] bg-background text-foreground/90`
- Header: full-bleed, immediately inside the outer container
- Inner: `px-5 py-6 sm:px-8 sm:py-8`, holding sections 2 through 7
- Anchor nav: `/cv`'s nav strip, hidden below `sm` and hidden in print, linking to the six section ids
- Action bar: `CvNewCompanyDropdown` plus the existing `PrintButton`, reused from `src/views/cv/footer/PrintButton.tsx`

### Print CSS

`CvNewPage.module.css` starts from `/cv`'s rules — `@page { margin: 8mm 14mm }`, `.printHide`, the
forced light-mode CSS-variable block, `font-size: 12.5px`, `line-height: 1.3` — with two edits:

- **Add** `print-color-adjust: exact` on the header, so the dark header bar survives printing. Taken
  from `CvElegantHeader.module.css`.
- **Drop** `/cv`'s rule that appends `attr(href)` under header links. The cv-elegant header already
  prints full URLs as visible text, so keeping it would double them.

### Experience section, rebuilt from `new.html`

Per company: a header strip carrying company name, location, and the new `period` field, on a muted
background with a left accent border.

Per role, inside its company:

1. Role title line — position and period.
2. `responsibilities` richtext, rendered through `HTMLParser` as a bullet list.
3. `techStack` chips, when present.
4. **Project cards**, one per entry in `role.projects`:
   - name, plus role and `Team of N` when `teamSize > 1`
   - `responsibilities` richtext bullets
   - a tech line
   - live and repository links, when present
   - muted card background with a left accent border, matching `new.html`'s `.project-card`

`new.html`'s fixed navy and blue map onto the existing theme tokens (`muted`, `border`, `foreground/NN`)
so both themes and the print override keep working.

**A role with no projects renders steps 1 through 3 and stops.** No heading, no empty container, no
extra margin. This is an explicit acceptance criterion, not a side effect.

### Data layer

`cv-new.types.ts` mirrors `cv-elegant.types.ts` with `projects` moved onto `role` and removed from the
document root, plus `period` on the experience entry.

`cv-new.service.ts` copies the cv-elegant service exactly — `graphqlApi.fetch`, `registerService`,
`unifyFetch`, `selectKey: "cvPageNews.items"`, `next: { revalidate: 300, tags: ["cv"] }` — with keys
`cv-new.main`, `cv-new.list`, `cv-new.by-id`.

One known defect is **not** inherited: `CvElegantCompanyDropdown` reads `item.companyName` while
`GET_CV_ELEGANT_LIST` selects `company`, so its labels are blank. `CvNewCompanyDropdown` uses
`company` on both sides. The existing cv-elegant bug is out of scope and stays as it is.

---

## Commands

Frontend, from `apps/frontend`:

```
bun run dev      # next dev --turbopack, port 4000
bun run lint     # never `bunx eslint .` — it pegs the CPU for minutes
bun test src     # unit tests
bun run build    # production build, the type-check gate
```

cms-api, from `apps/cms-api`:

```
bun run start:dev   # boot syncs content-types/*.json into Postgres; a bad JSON aborts boot loudly
bun run lint
bun run test
```

End-to-end, from `apps/frontend`:

```
bunx playwright test e2e/cv-3-layout.test.ts
```

---

## Project structure and code style

- **Views own their data.** Every view directory carries its own `*.types.ts`, `*.queries.ts`, and
  `*.service.ts`. `cv-new` follows this and does not import from `cv-elegant`.
- **Cross-view reuse is limited to** `@/views/cv/contact.types`, `@/views/cv/common-text.types`,
  `@/views/cv/contact.service`, `@/views/cv/common-text.service`, and
  `@/views/cv/footer/PrintButton` — the same set cv-elegant already reuses.
- **Server components by default.** Only the dropdown carries `"use client"`.
- Tailwind utilities inline; CSS Modules only for `@media print`.
- Section titles come from `commonText.text[...]` with an English literal fallback, as cv-elegant does.
- Richtext always goes through `HTMLParser`, never `dangerouslySetInnerHTML`.
- Optional arrays are guarded before `.map`. `references` and `projects` return `null` when empty.
- Import ordering follows the existing eslint config; `bun run lint` is the arbiter.

---

## Testing strategy

There are no component tests anywhere in `apps/frontend` — the nine existing unit tests all cover
`src/lib` logic, and page-level verification is done with Playwright. This spec follows that,
rather than introducing a component-test setup for one page.

| Level | What | How |
| --- | --- | --- |
| Type | The new view compiles against the new types | `bun run build` |
| Lint | Style and import order | `bun run lint` |
| Backend | Content type syncs, tables are created at depth 3 | `bun run start:dev`, then inspect `components_cv_page_new__experience__role__project` |
| Backend | GraphQL exposes the nested shape | Query `cvPageNews` and confirm `experiences.roles.projects` resolves |
| E2E | Layout, section order, empty-projects role | `e2e/cv-3-layout.test.ts`, modeled on `e2e/cv-spacing.test.ts` — full-page screenshot plus per-section captures |
| Manual | Print output | Print `/cv-3` to PDF in light and dark theme, confirm both produce light-on-white |
| Manual | Content entry | Create one `cv-page-new` entry in cms-admin, including a role with zero projects |

The mock file must include **at least one role with an empty `projects` array**, so the empty case is
exercised on every local run rather than only when someone remembers to test it.

---

## Boundaries

**Always**

- Add the content type as JSON only. No Prisma migration, no new NestJS module.
- Keep `/cv` and `/cv-2` byte-identical. Any diff outside the file lists above is a defect.
- Register every new mock in `src/mocks/mock-all.ts`.
- Run `bun run lint` and `bun run build` before calling a task done.

**Ask first**

- Any edit to `content-types/cv-page.json`, `src/views/cv`, or `src/views/cv-elegant`.
- Renaming the `cv-page-new` slug once content has been entered against it.
- Adding `/cv-3` to the CMS header navigation.
- Deleting any file.

**Never**

- Read, create, or edit any `.env*` file except reading `.env.example`.
- Delete or rewrite `apps/frontend/SPEC.md`.
- Commit `new.html`. It is a scratch reference; it stays untracked or gets removed once `/cv-3` ships.
- Introduce a name-string link between a role and its projects. The nesting is the whole point.

---

## Acceptance criteria

1. `content-types/cv-page-new.json` exists; `bun run start:dev` boots without error and creates the
   document table plus four component tables, including the depth-3 project table.
2. cms-admin renders a form for `cv-page-new` allowing projects to be added inside a role, and an
   entry saved there is readable back through GraphQL.
3. `/en/cv-3` renders seven sections in the order Header, About Me, Work Experience & Key Projects,
   Technical Skills, Education, Languages, References.
4. Each project card appears under the role it belongs to. No standalone Projects section exists.
5. A role whose `projects` array is empty renders its title, responsibilities, and tech stack, with no
   projects markup and no extra vertical gap.
6. `/en/cv-3/<documentId>` renders a per-company CV; an unknown id yields a 404.
7. The company dropdown lists other entries with visible, correct company labels and navigates to
   `/{locale}/cv-3/{documentId}`.
8. Printing `/cv-3` produces light-on-white output with the header bar's background intact, no anchor
   nav, and no action bar — in both light and dark theme.
9. `/cv` and `/cv-2` render exactly as before; `git diff` touches no file outside the lists above.
10. `bun run lint` and `bun run build` both pass clean.

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Three-level component nesting has never been exercised. `docs/adding-a-content-type.md` states components nest arbitrarily deep, but notes the real seeds only go two levels. | Blocks the whole approach | Verify first, before any frontend work. Boot cms-api with the new JSON and inspect the tables. If the sync engine or cms-admin's form renderer cannot handle depth 3, stop and re-decide. |
| cms-admin's form UI may not render a repeatable component inside a repeatable component. cms-admin lives in a sibling repository outside this project, so I cannot inspect it. | Content cannot be entered by hand | Manual check in the running admin, immediately after the sync verification above. |
| The new content type starts empty, so `/cv-3` shows nothing against a live API until content is entered. | Cosmetic, local only | Mock data carries local dev; content entry is a tracked manual step. |
| `cvPageNews` as a list query name. | Readability only | Renameable at zero cost before content exists. |

---

## Open question

The slug `cv-page-new` follows the name you used. If you would rather have `cv-page-v2` and the query
name `cvPageV2s`, say so before implementation starts — after content is entered, changing it means
deleting and recreating the type.

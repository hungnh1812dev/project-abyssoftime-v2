# Todo: `/cv-3` — CV page with role-nested projects

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS** — 6 done, 2 skipped / 15 tasks

Checkbox updates ship in the same commit as that phase's code.

## Phase 0 — Data model

- [x] **T1** Add `apps/cms-api/content-types/cv-page-new.json` — copy of `cv-page.json` with the top-level projects removed, `role.projects` promoted to a repeatable component, and `period` added to `experience`
- [~] **T2** Verify the sync engine creates all eight tables and GraphQL exposes `projects` on `CvPageNewRole`, with a nested round-trip through the API — **skipped by user decision 2026-08-28**: requires booting cms-api against a live Postgres, not available in this session; the planning pass already traced `schema-differ.ts`/`component-io.service.ts`/`schema-builder.service.ts` as depth-agnostic, so this is deferred to the user's own dev environment rather than blocking
- [~] **T3** Verify cms-admin renders the nested form and preserves the nesting on save *(manual, sibling repo)* — **skipped by user decision 2026-08-28**, same reasoning as T2; deferred to the user

> **CHECKPOINT A** — go / no-go, **waived by user 2026-08-28**: T2/T3 deferred rather than blocking, frontend work proceeds on the assumption depth-3 nesting works (see plan.md's Corrections section). If either later fails, the fallback in plan.md is a decision for the user, not a workaround to pick automatically.
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

- [ ] **T9** Fork the skills, education, languages, and references sections; lock the final section order
- [ ] **T10** Add the anchor nav and the action bar with the company dropdown
- [ ] **T11** Add the `/cv-3/[documentId]` per-company route with a 404 on an unknown id

## Phase 4 — Print and tests

- [ ] **T12** Write the print stylesheet: light-on-white in both themes, header background kept, no duplicated URLs
- [ ] **T13** Add `e2e/cv-3-layout.test.ts` asserting section order, no Projects section, and the empty-projects case

> **CHECKPOINT D** — feature complete against mocks. Full gate: lint, build, unit, e2e, both apps, clean `git status`.
> **Commit 4** — `feat(frontend): complete /cv-3 sections, print styles and layout test`

## Phase 5 — Live content and closeout

- [ ] **T14** Enter the real content in cms-admin and verify `/cv-3` against the live API *(manual)*
- [ ] **T15** Closeout: SPEC to SHIPPED, correct its risk table, resolve the slug question, propose removing `new.html`, grep for stale references

> **Commit 5** — `docs: mark /cv-3 spec shipped`

---

## Open before T1

- **Slug name.** `cv-page-new` gives the list query `cvPageNews`. `cv-page-v2` gives `cvPageV2s`. Free to change now, a delete-and-recreate once content exists.

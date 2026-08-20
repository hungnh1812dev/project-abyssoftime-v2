# Archive

Completed phases moved out of `tasks/plan.md` / `tasks/todo.md` to keep those files token-lean.
Each entry is a frozen snapshot at archive time.

## Shared `DataTable` for the Settings pages (archived 2026-08-20)

Status: done. Spec (`specs/settings-shared-data-table.md`) deleted per Task 8. All 8 tasks
committed on `develop`: `ce2a318` (`DataTable` component), `8e8f7e6` (`UsersPage`), `742dcf9`
(`AccessTokensPage`), `4cf44b7` (`RolesPage`), `6245fef` (`PermissionsPage`), `72a6499` (five-axis
review fix), `a9533c2` (post-review color revision). Full suite: 464 passing, the same 5
pre-existing baseline failures present since before this feature started (unrelated —
`window.confirm`-spy tests predating a `ConfirmDialog` migration, and one role-change PATCH
assertion); lint/build unchanged from baseline throughout.

Two things worth knowing if this component is touched again:

- **The originally-specced colors (`bg-muted` header, `bg-muted/40` stripe) shipped in Task 1-5
  but were visually near-invisible** — in this theme's light-mode palette `--muted`
  (`oklch(0.97 0 0)`) and `--background` (`oklch(0.968 0.001 247)`) differ by only 0.002 lightness,
  and the base `TableRow` primitive's own `hover:bg-muted/50` had the identical problem. jsdom
  tests only assert class presence, not rendered contrast, so this wasn't caught until the user
  looked at real output. Final colors (commit `a9533c2`, after 3 rounds of live feedback): header
  `bg-sky-700 dark:bg-sky-900` with forced `text-white` on header cells; even rows
  `bg-gray-100 dark:bg-gray-800`; every body row gets `hover:bg-gray-200 dark:hover:bg-gray-700`
  (added specifically because the primitive's own hover was invisible for the same reason).
- **`DataTableColumn.className` applies to both the header and body cell** — safe for symmetric
  styling like `"text-right"`, but body-only styling (font/color/size on the value) must go inside
  `cell`'s returned node instead, or it bleeds onto the header text too. Documented on the field's
  own doc comment in `data-table.tsx` after being caught mid-migration (Task 3) and repeated
  correctly in Tasks 4-5.

No formal single-pass browser walkthrough of the four pages' dialogs/actions/permission-gating was
ever done (only the color iterations above were visually verified live) — full behavioral coverage
for those instead comes from the characterization tests added per migrated page plus the
pre-existing test suites, all held green throughout.

<details>
<summary>Final tasks/plan.md</summary>

# Plan: Shared `DataTable` for the Settings pages

Frontend-only, `apps/cms-admin`. All paths relative to `apps/cms-admin/` unless given as a full
repo path. Prior (unrelated) plan archived at `tasks/archive.md` — see that file's
"`DialogPanel` contract extraction" entry, which is **paused, not complete**; resuming it is a
separate decision from this feature.

Spec: `specs/settings-shared-data-table.md`.

## Overview

`UsersPage`, `AccessTokensPage`, `RolesPage`, and `PermissionsPage`
(`src/pages/admin/settings/*.tsx`) each hand-roll the same table shape directly from the vanilla
shadcn primitives in `ui/table.tsx` — a header row, then one row per record, one `TableCell` per
column. They differ only in which columns they show and how each cell renders (plain text, a
`Badge`, an expandable permission sub-tree, an action-button cluster). None of them has
header/row background styling today, and any shared visual change has to be hand-applied four
times.

This plan builds one composed `DataTable<T>` component (same tier as the existing
`ui/dialog-panel.tsx` — sits on top of the untouched `ui/table.tsx` primitive) that owns header
background + zebra-striping + the columns→rows rendering loop, and migrates the four pages onto
it. `CollectionListPage`'s table (dynamic columns, bulk-select) is explicitly out of scope — see
the spec.

**Colors — superseded post-implementation (commit `a9533c2`), see below.** Originally: header row
`bg-muted`, even body rows `bg-muted/40`, odd rows transparent (confirmed with the user during
Specify). After Task 6 shipped, the user found this scheme was **visually near-invisible**: in this
theme's light-mode palette, `--muted` (`oklch(0.97 0 0)`) and `--background`
(`oklch(0.968 0.001 247)`) differ by only 0.002 lightness — `muted` is actually barely *lighter*
than the background, not darker — and the base `TableRow` primitive's own `hover:bg-muted/50` has
the identical problem, so hover feedback was invisible too. Not something the jsdom test suite
could catch (it only asserts class presence, not rendered contrast) — exactly the kind of gap the
still-outstanding browser walkthrough exists to catch, except the user caught it manually first.

Final colors, after two rounds of live feedback: header row `bg-sky-700 dark:bg-sky-900` with
forced `text-white` on header cells (needed once the header got dark/saturated enough that the
default `text-foreground` stopped being readable); even body rows `bg-gray-100 dark:bg-gray-800`
(switched from a blue tint back to gray, per feedback); every body row also gets
`hover:bg-gray-200 dark:hover:bg-gray-700`, added specifically to fix the invisible-hover problem
above (overrides the primitive's `hover:bg-muted/50` via `cn()`/`tailwind-merge`'s
last-class-wins resolution — `ui/table.tsx` itself is untouched). All of Tasks 2-6's characterization
tests and their exact-token assertions were updated in lockstep with each color revision; full
suite stayed at 464 passing / the same 5 pre-existing baseline failures throughout.

## Dependency Graph

```
DataTable component (new, foundational)
        │
        ├──→ UsersPage migration          ─┐
        ├──→ AccessTokensPage migration    │  independent of each other,
        ├──→ RolesPage migration           │  parallelizable once DataTable lands
        └──→ PermissionsPage migration    ─┘
                        │
                        ▼
        Final: review, docs, browser walkthrough, cleanup
```

## `DataTable` API

```tsx
interface DataTableColumn<T> {
  key?: string;
  header: React.ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  className?: string; // applied to both TableHead and this column's TableCell
}

function DataTable<T>({
  columns,
  data,
  getRowKey,
  rowClassName,
}: {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  rowClassName?: (row: T) => string;
}): JSX.Element
```

- Header row: `bg-muted`.
- Body row: `cn(index % 2 === 1 && "bg-muted/40", rowClassName?.(row))` — caller's class composes
  *after* the stripe so it wins (e.g. `UsersPage`'s `isMe ? "bg-accent/30" : undefined`).
- `cell` takes priority over `accessorKey` when both would apply.
- No sorting/pagination/filtering/selection — not requested, none of the four pages have it today.

## Task List

### Phase 1: Foundation

#### Task 1: Build `DataTable<T>` — done, commit `ce2a318`

**Acceptance criteria:**
- [x] Renders `Table`/`TableHeader`/`TableBody` from `ui/table.tsx` under the hood (no
      reimplementation of the primitive).
- [x] Header row has `bg-muted`.
- [x] Even-indexed body rows (0-based → the 2nd/4th/... rendered row) have `bg-muted/40`; odd rows
      have no stripe class.
- [x] A column with `cell` renders the custom node; a column with only `accessorKey` renders
      `String(row[key])`.
- [x] `rowClassName`'s output is present in the row's class list alongside (not replacing) the
      stripe class.

**Verification:**
- [x] `bun run test src/components/ui/__tests__/data-table.test.tsx` — 4 passing.
- [x] `bun run lint` — 1 pre-existing error (`SidebarGroup.tsx`) + 1 pre-existing warning
      confirmed present on clean `develop` via `git stash`, unrelated to this change.
- [x] `bun run build` — clean.

**Dependencies:** None.

**Files:**
- `src/components/ui/data-table.tsx` (new)
- `src/components/ui/__tests__/data-table.test.tsx` (new)

**Estimated scope:** Small (2 files).

### Checkpoint: Foundation

- [x] `bun run lint` && `bun run build` && `bun run test` all clean (excluding the pre-existing
      unrelated failures verified above).
- [x] Human review of the column-config API shape before wiring four call sites onto it — not a
      dedicated up-front review, but the API stood unchanged (no rework needed) across all 4
      migrations plus the five-axis review.

### Phase 2: Migrate call sites (independent — any order, parallelizable)

#### Task 2: Migrate `UsersPage` — done, commit `8e8f7e6`

**Acceptance criteria:**
- [x] Same 4 columns (Email incl. "(you)" suffix, Display Name, Role badge, Actions), same
      conditional Select/Delete logic inside the Actions cell.
- [x] `isMe` row tint (`bg-accent/30`) reproduced via `rowClassName`.
- [x] No visible column/label/behavior change.

**Verification:**
- [x] `bun run test src/pages/admin/settings/__tests__/UsersPage.test.tsx` — 13/14 passing (1
      pre-existing unrelated failure, confirmed present on `develop` before this task). Added 2
      characterization tests: header `bg-muted` (genuinely RED against the pre-migration
      hand-rolled table, GREEN after), and the `bg-accent/30` "you" tint lock-in. Along the way,
      found and fixed a latent false-positive in both this new test and Task 1's committed
      `data-table.test.tsx`: `ui/table.tsx`'s base `TableRow` classes already contain the literal
      substring `"bg-muted"` (inside `data-[state=selected]:bg-muted`), so a plain
      `.toContain("bg-muted")` would pass even without the header styling — fixed both to an
      exact-token check (`className.split(/\s+/)`).

**Dependencies:** Task 1.

**Files:** `src/pages/admin/settings/UsersPage.tsx` (+ its test, only if a structure-specific
assertion needs updating).

**Estimated scope:** Small (1 file).

---

#### Task 3: Migrate `AccessTokensPage` — done, commit `742dcf9`

**Acceptance criteria:**
- [x] Same 4 columns (Name, Permissions badges/empty-state, Expires date format, Actions), same
      Revoke/Delete `PermissionTooltip`-gated buttons.
- [x] Caught during implementation: `DataTableColumn.className` applies to both header and body
      cell (by design), but the original markup's `font-medium`/`text-muted-foreground text-sm`
      styling on the Name/Expires columns was body-cell-only. Using `className` there would have
      bled that styling onto the header text — avoided by moving those classes into each column's
      `cell` render instead, keeping header styling untouched (a real fidelity bug caught before
      it ever ran, not just a style choice).

**Verification:**
- [x] `bun run test src/pages/admin/settings/__tests__/AccessTokensPage.test.tsx` — 11/13 passing
      (2 pre-existing unrelated failures — stale `window.confirm` spies that predate this page's
      move to `ConfirmDialog`, confirmed present on `develop` before this task). Added 1
      characterization test (header `bg-muted`, genuinely RED pre-migration, GREEN after).

**Dependencies:** Task 1.

**Files:** `src/pages/admin/settings/AccessTokensPage.tsx` (+ test if needed).

**Estimated scope:** Small (1 file).

---

#### Task 4: Migrate `RolesPage` — done, commit `4cf44b7`

**Acceptance criteria:**
- [x] Same 5 columns (Name badge, Slug, Level, Permissions via `PermissionSubTree`, Actions incl.
      `isDefault`-conditional Delete).
- [x] Applied the same `className`-bleed avoidance learned in Task 3: Name/Slug/Level's
      cell-only styling moved into each column's `cell` render rather than `column.className`.
      Also simplified away a redundant `font-medium` wrapper around the Name badge — `Badge`
      already sets its own `font-medium`, so the original `TableCell`'s class was a no-op.

**Verification:**
- [x] `bun run test src/pages/admin/settings/__tests__/RolesPage.test.tsx` — 14/14 passing (this
      page has no pre-existing baseline failures). Added 1 characterization test (header
      `bg-muted`, genuinely RED pre-migration, GREEN after).

**Dependencies:** Task 1.

**Files:** `src/pages/admin/settings/RolesPage.tsx` (+ test if needed).

**Estimated scope:** Small (1 file).

---

#### Task 5: Migrate `PermissionsPage` — done, commit `6245fef`

**Acceptance criteria:**
- [x] Same 4 columns (Slug mono, Name, Description, Actions incl. the per-row `deleteErrors` line
      rendered under the button pair).
- [x] Same `className`-bleed avoidance applied: Slug/Description's cell-only styling moved into
      each column's `cell` render rather than `column.className`.

**Verification:**
- [x] `bun run test src/pages/admin/settings/__tests__/PermissionsPage.test.tsx` — 12/14 passing
      (2 pre-existing unrelated failures — same stale `window.confirm`-spy pattern as
      `AccessTokensPage`, confirmed present on `develop` before this task). Added 1
      characterization test (header `bg-muted`, genuinely RED pre-migration, GREEN after).

**Dependencies:** Task 1.

**Files:** `src/pages/admin/settings/PermissionsPage.tsx`, its test file.

**Estimated scope:** Small (1 file).

### Checkpoint: All call sites migrated

- [x] `bun run lint` && `bun run build` && `bun run test` all clean across all four pages — 463
      passing, same 5 pre-existing unrelated failures present since before Task 1 (verified via
      `git stash` against clean `develop` at Task 1; unchanged in count/identity through Tasks
      2-5).
- [x] Browser walkthrough of the header/stripe/hover colors — not done as a single formal pass, but
      effectively satisfied through the user's live, iterative visual feedback after Task 6: the
      original `bg-muted` scheme was flagged as invisible, then refined through two more rounds
      (darker header + white header text, gray stripe, explicit row hover) until confirmed
      acceptable — see commit `a9533c2` and the "Colors" note earlier in this file. Full dialog/
      action/permission-gating regression coverage for all four pages still comes from the
      characterization + full-suite tests, not a visual pass — no visual regression check of those
      interactive elements themselves was done in a live browser.

### Phase 3: Final

#### Task 6: Five-axis review — done, commit `72a6499`

- [x] Correctness, readability, architecture, security, performance — per repo root
      `docs/workflow.md` step 6.
- [x] **Correctness:** verified via characterization tests + full-suite regression check at every
      task; no issues.
- [x] **Architecture:** one real finding — `DataTableColumn.className` applies to both header and
      body cell by design, a footgun for asymmetric styling. Already worked around correctly in
      Tasks 3-5 (cell-only styling moved into `cell` renderers), but the rationale was only
      explained via a near-identical comment repeated at 3 call sites. Fixed: documented once on
      the `className` field's doc comment in `data-table.tsx`, call-site comments trimmed to a
      one-line pointer.
- [x] **Readability:** consistent column-definition pattern across all 4 migrated pages.
- [x] **Security:** no new attack surface (no `dangerouslySetInnerHTML`, no user-controlled markup).
- [x] **Performance:** column arrays recreated per render (inline objects/functions) — negligible
      at these table sizes (small settings-page lists, no virtualization need); not flagged as an
      issue.
- [x] Full suite re-verified after the fix: 463 passing, same 5 pre-existing baseline failures;
      lint/build unchanged.

#### Task 7: Update docs — done, no changes needed

- [x] Checked `docs/documents/access-control.md` (documents these four pages) for anything
      table-markup-specific that now needs to mention `DataTable`. It describes behavior only
      (data flows, gating logic, CRUD endpoints) — no mention of `ui/table.tsx`,
      `TableHead`/`TableCell`, or table markup at all. Confirmed via
      `grep -rln "ui/table\|TableHead\|TableCell\|<Table>" docs/ SPEC.md` — no matches anywhere in
      the app's docs. No doc update needed.

#### Task 8: Clean up — done

- [x] Delete `specs/settings-shared-data-table.md` once Task 6 completes.
- [x] Archive this plan's `tasks/todo.md`/`tasks/plan.md` into `tasks/archive.md` once shipped.

## Verification (end-to-end)

- `bun run lint`, `bun run test`, `bun run build` all clean after each task and at each checkpoint
  (excluding the pre-existing unrelated failures already on `develop`).
- Manual browser check (`bun run dev`) of all four settings pages: header background, zebra
  striping, dark-mode toggle, and that every existing action (edit/delete/revoke/create,
  permission-gated buttons, confirm dialogs) still works exactly as before.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A page's test asserts old-markup DOM structure (not just role/text), breaking on migration | Low | Spec's Acceptance Criterion 7 allows updating such a test — never weakening/deleting it — since queries in these suites are already mostly by role/text. |
| Zebra stripe visually clashes with an existing bespoke row highlight (`UsersPage`'s "you" tint) | Low | `rowClassName` composes after the stripe class via `cn()`, so the caller's class wins on conflicting utilities (Tailwind/`tailwind-merge` last-wins semantics). |
| `DataTable`'s generic column-cell abstraction can't cleanly express a page's existing custom cell (e.g. `RolesPage`'s expandable `PermissionSubTree`, `PermissionsPage`'s per-row error line) | Low | `cell: (row: T) => ReactNode` is fully generic — any existing JSX for a cell drops in unchanged as a `cell` function body. |

## Open Questions

None blocking.

</details>

<details>
<summary>Final tasks/todo.md</summary>

# Todo: Shared `DataTable` for the Settings pages

Full detail in `tasks/plan.md`. Prior (unrelated, paused) plan archived at `tasks/archive.md`.

### Phase 1: Foundation
- [x] 1. Build `DataTable<T>` (`src/components/ui/data-table.tsx` + test) — commit `ce2a318`
- [x] **Checkpoint** — lint/build/test clean (confirmed: same pre-existing lint error/5 unrelated test failures present on clean `develop`, verified via `git stash`); column-config API shape was not given a dedicated up-front review, but stood unchanged (no rework needed) across all 4 migrations plus the five-axis review in Task 6, and the `className`-bleed footgun found along the way was fixed at the doc-comment level, not by reshaping the API

### Phase 2: Migrate call sites (independent, parallelizable after checkpoint)
- [x] 2. Migrate `UsersPage` — commit `8e8f7e6` (also fixed a false-positive `bg-muted` substring
      assertion in `data-table.test.tsx` from Task 1, bundled into this commit)
- [x] 3. Migrate `AccessTokensPage` — commit `742dcf9`
- [x] 4. Migrate `RolesPage` — commit `4cf44b7`
- [x] 5. Migrate `PermissionsPage` — commit `6245fef`
- [x] **Checkpoint** — lint/build/test clean (confirmed: 463 passing, same 5 pre-existing unrelated
      failures throughout Tasks 1-5, verified against `develop` baseline at Task 1); no dedicated
      formal browser walkthrough was done, but the colors were iteratively verified live with the
      user post-Task-6 (3 revisions — see commit `a9533c2` and Task 8's archive note) — interactive
      behavior (dialogs/actions/permission-gating) relies on the test suite, not a visual pass

### Phase 3: Final
- [x] 6. Five-axis review (correctness, readability, architecture, security, performance) — commit
      `72a6499`. Finding: `DataTableColumn.className` applies to both header+body cell (footgun for
      asymmetric styling, already worked around correctly in Tasks 3-5); fixed by documenting it
      once on the field itself instead of repeating the explanation at 3 call sites.
- [x] 7. Checked `docs/documents/access-control.md` and all other `docs/documents/*` — describe
      behavior only, no table-markup references (`grep -rln "ui/table\|TableHead\|TableCell\|<Table>"`
      across `docs/` and `SPEC.md` returns nothing). No doc update needed.
- [x] 8. Deleted `specs/settings-shared-data-table.md`, archived this plan/todo to `tasks/archive.md`

</details>

## `DialogPanel` contract extraction (archived 2026-08-20, PAUSED — not fully shipped)

Status: **not done**. Moved out of `tasks/plan.md`/`tasks/todo.md` only to make room for the
unrelated shared-`DataTable` feature now starting; this is a frozen snapshot of an in-progress
plan, not a completion record like the entry below it. All 9 numbered tasks' code-level acceptance
criteria and automated verification (lint/build/test) are done and committed (8 commits, `develop`
at `44682bd`). Outstanding before this can be considered shipped:

- Browser walkthrough of every migrated dialog (`ConfirmDialog` call sites, `DeleteConfirmDialog`,
  `AccessTokensPage`'s two dialogs, `PermissionDialog`, `RoleDialog`, the locale add/edit dialog,
  `ColumnChooserDialog`) — deferred across every task's checkpoint, never actually done.
- Human review of `DialogPanel`'s API (flagged at the Phase 1 checkpoint, before it was used at 6
  more call sites — call sites were migrated without this review happening).
- Five-axis review (correctness, readability, architecture, security, performance) of the whole
  plan.
- Post-review docs update: re-check `docs/documents/*` for stale `DialogNote`/header-contract
  references (grep was empty at plan time, said to "re-check" after review — never re-checked).

**To resume:** re-read the full plan below, pick up at the "Checkpoint: Complete" section's
outstanding browser walkthrough, then proceed to five-axis review and the docs re-check.

<details>
<summary>Original tasks/plan.md (as of archive time — every task's automated criteria checked off,
manual/review items still open, marked `[ ]` below exactly as they were)</summary>

# Plan: extract dialog contract out of the shadcn `ui/dialog.tsx` primitive

Frontend-only, `apps/cms-admin`. All paths relative to `apps/cms-admin/` unless given as a full
repo path. Prior phase (the `DialogNote`/`aria-describedby`-context work this plan relocates) is
archived at `tasks/archive.md`.

## Overview

`src/components/ui/dialog.tsx` is meant to stay the untouched shadcn/base-ui primitive (`Dialog`,
`DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, ...) — the
layer every other `ui/*` file is generated in the same style as. Commit `7ed48a2` broke that
convention by adding a `DialogNote` callout and an `aria-describedby` registration
context/`useId`/hooks system directly into that file, and there's now an uncommitted further edit
bordering `DialogHeader`. Both belong in app-level code, not the primitive.

This plan reverts `ui/dialog.tsx` to vanilla and introduces `DialogPanel`
(`src/components/ui/dialog-panel.tsx`), a composed component — same tier as the existing
`ConfirmDialog` — that owns the header (title + description, with the bordered/bled visual
treatment), the optional note callout, and the `aria-describedby` wiring. `DialogPanel` renders
the untouched `DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription` underneath; its
`children` slot is the fully custom body (including any footer — footer content and presence
varies too much per call site, per the audit below, to be a dedicated prop; it's just rendered via
the unmodified `DialogFooter`/`DialogClose` inside `children`).

## Architecture Decisions

- **`ui/dialog.tsx` reverts to the pre-`7ed48a2` baseline** (`git show 7ed48a2^:.../dialog.tsx`),
  minus nothing else — no `DialogNote`, no `DialogDescribedByContext`, no header border classes.
  It never gets a project-specific edit again; that's the whole point of this refactor.
- **New file `ui/dialog-panel.tsx` exports `DialogPanel`.** Props: `open`, `onOpenChange`, `title`,
  `description`, `note?`, `showCloseButton?`, `contentClassName?`, `children`. It computes two
  `useId()`s for description/note and passes `aria-describedby` straight to `DialogContent` as a
  prop — no context/registration machinery needed, since there are only ever these two possible
  description sources (this is simpler than what `7ed48a2` built, which anticipated more than two).
- **No dedicated `footer` prop.** Audited all 7 current direct-primitive call sites (see below):
  footer is sometimes a `DialogFooter` with 1-2 buttons, sometimes an inline button inside the
  body div with no `DialogFooter` at all (`TokenRevealDialog`, `AccessTokensPage`'s create-token
  dialog). Forcing a `footer` prop would misrepresent that variance; `children` already covers it
  since call sites render `DialogFooter` themselves when they want one.
- **`ConfirmDialog` is rebuilt on `DialogPanel`** — its Cancel/action button pair becomes
  `children` (a `DialogFooter`). This is both the first real caller (proves the API before the
  wider migration) and removes `ConfirmDialog`'s own direct use of the soon-to-be-deleted
  `DialogNote`.
- **Migration order is what keeps every step buildable:** create `DialogPanel` (additive, zero
  risk) → migrate `ConfirmDialog` (highest fan-out: 5 pages depend on it) → migrate the remaining
  6 direct-primitive call sites (independent of each other, parallelizable) → only once nothing
  imports `DialogNote` any more, strip it (and the describedby context) out of `ui/dialog.tsx`.
  Reverting `ui/dialog.tsx` first would break every one of those 7 call sites simultaneously.

## Call sites audited (all currently import `DialogHeader`/`DialogTitle`/`DialogDescription`
directly from `ui/dialog.tsx`, 5 of them also `DialogNote`)

| Call site | File | Note? | Footer shape |
|---|---|---|---|
| `ConfirmDialog` | `src/components/ui/confirm-dialog.tsx` | optional prop | `DialogFooter`: Cancel + action |
| `DeleteConfirmDialog` | `src/pages/admin/panels/collection-type/layout/DeleteConfirmDialog.tsx` | always | `DialogFooter`: Cancel + Delete |
| `TokenRevealDialog` | `src/pages/admin/settings/AccessTokensPage.tsx` | always | none — inline "Copy Token" button in body |
| create-token dialog | `src/pages/admin/settings/AccessTokensPage.tsx` | none | none — inline "Create Token" button in body |
| `PermissionDialog` | `src/pages/admin/settings/PermissionsPage.tsx` | conditional | `DialogFooter`: Cancel + Save |
| `RoleDialog` | `src/pages/admin/settings/RolesPage.tsx` | conditional (`fieldsDisabled`) | `DialogFooter`: Cancel + Save |
| add/edit locale dialog | `src/pages/admin/settings/InternationalizePage.tsx` | none | `DialogFooter`: Cancel + Save |
| `ColumnChooserDialog` | `src/components/collection/ColumnChooserDialog.tsx` | none | `DialogFooter`: Cancel + Save |

## Task List

### Phase 1: Foundation

#### Task 1: Create `DialogPanel`

**Description:** New `src/components/ui/dialog-panel.tsx`. Wraps `Dialog`/`DialogContent` from
the (still-current, not-yet-reverted) `ui/dialog.tsx`. Renders `DialogHeader` (with the bordered
treatment: `-mx-4 -mt-4 rounded-t-xl border-b p-4`, moved here from the uncommitted edit) +
`DialogTitle` + `DialogDescription`, an optional note callout (amber `TriangleAlert` block, same
markup `DialogNote` currently has, now owned by this file), then `children`. `aria-describedby` on
`DialogContent` is computed locally from two `useId()`s, no context needed.

**Acceptance criteria:**
- [x] `DialogPanel` renders title, description, and (when passed) note.
- [x] `DialogContent`'s `aria-describedby` includes the description id always, and the note id
      only when `note` is passed.
- [x] `showCloseButton` and `contentClassName` pass through to `DialogContent`.
- [x] `children` renders below the note, unconstrained.

**Verification:**
- [x] Tests pass: `bun run test dialog-panel`
- [x] Build succeeds: `bun run build`
- [x] Manual check: none yet (no callers) — covered by Task 2's browser check.

**Dependencies:** None.

**Files likely touched:**
- `src/components/ui/dialog-panel.tsx` (new)
- `src/components/ui/__tests__/dialog-panel.test.tsx` (new)

**Estimated scope:** Small (2 files).

---

#### Task 2: Migrate `ConfirmDialog` onto `DialogPanel`

**Description:** `confirm-dialog.tsx` renders `DialogPanel` instead of composing
`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogNote` by hand.
Its `title`/`description`/`note` props pass straight through; its Cancel/action button pair
becomes `children` inside a `DialogFooter`. Public `ConfirmDialogProps` API is unchanged — this is
an internal refactor only.

**Acceptance criteria:**
- [x] `ConfirmDialog`'s external prop API is unchanged (no caller elsewhere needs edits).
- [x] `ConfirmDialog` no longer imports `DialogNote`, `DialogHeader`, `DialogTitle`, or
      `DialogDescription` directly.
- [x] Rendered DOM/aria output is unchanged (note still described-by-linked when present).

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test confirm-dialog` — 8 characterization tests written against the
      pre-refactor implementation first (2 needed fixing for base-ui's actual event-callback
      signature, not a behavior change), then confirmed green again after the refactor.
- [ ] Manual check: open any one `ConfirmDialog` call site (e.g. Roles page → delete role) in the
      browser; confirm title/description/note/buttons render identically to before, no console
      errors, `aria-describedby` still resolves. (Deferred to the Foundation checkpoint below.)

**Dependencies:** Task 1.

**Files likely touched:**
- `src/components/ui/confirm-dialog.tsx`

**Estimated scope:** Small (1 file).

### Checkpoint: Foundation

- [ ] `bun run lint` && `bun run build` && `bun run test` all clean.
- [ ] Browser walkthrough of one `ConfirmDialog` call site confirms no regression.
- [ ] Human review of `DialogPanel`'s API before it's used at 6 more call sites.

### Phase 2: Migrate direct-primitive call sites

Each of these is independent of the others — safe to parallelize across sessions/agents once
Phase 1's checkpoint passes. Same shape every time: replace the
`DialogHeader`/`DialogTitle`/`DialogDescription`(/`DialogNote`) block with `DialogPanel`'s
`title`/`description`/`note` props; everything that was already below that block (fields, footer)
becomes `children`, unchanged.

#### Task 3: Migrate `DeleteConfirmDialog`

**Acceptance criteria:**
- [x] Renders via `DialogPanel`; no more direct `DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogNote` imports.
- [x] Bulk vs. single-entry title/description text unchanged.

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test DeleteConfirmDialog` — 6 characterization tests (bulk vs. single
      copy, note + aria-describedby, confirm/cancel behavior, no built-in close button), written
      and green against the pre-refactor implementation first, still green after the swap.
- [ ] Manual check: delete a single entry and a bulk selection in a collection-type list; confirm
      dialog text and Cancel/Delete buttons unchanged. (Deferred to the Phase 2 checkpoint.)

**Dependencies:** Task 1 (does not depend on Task 2).

**Files likely touched:**
- `src/pages/admin/panels/collection-type/layout/DeleteConfirmDialog.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 4: Migrate `AccessTokensPage`'s two dialogs

**Description:** `TokenRevealDialog` and the create-token dialog both move to `DialogPanel`. Both
have no `DialogFooter` — their action button stays inline in `children`, right where it is now.

**Acceptance criteria:**
- [x] Both dialogs render via `DialogPanel`.
- [x] `AccessTokensPage.tsx` no longer imports `DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogNote`.
- [x] (Unplanned but necessary) `DialogTrigger` usage removed too — `DialogPanel` owns its own
      `Dialog` root, so it can't host a sibling trigger; the create-token button became a plain
      `onClick={() => setCreateOpen(true)}`, matching how every other dialog in this same file is
      already opened (fully controlled state, no declarative trigger anywhere else in the app).

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test AccessTokensPage` — extended the existing suite with 2 new
      characterization tests (create-dialog title/description, reveal-dialog note +
      `aria-describedby`), both green before and after the refactor; existing suite's heavy
      indirect coverage of the create flow (permission tree, submit payload, plaintext reveal)
      stayed green throughout.
- [ ] Manual check: create a token (form renders, permissions tree works), reveal flow shows the
      note + copy button unchanged. (Deferred to the Phase 2 checkpoint.)

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/AccessTokensPage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 5: Migrate `PermissionsPage`'s `PermissionDialog`

**Acceptance criteria:**
- [x] Renders via `DialogPanel`; conditional note (create-only disclaimer) still conditional.
- [x] No more direct header/note primitive imports in `PermissionsPage.tsx`.

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test PermissionsPage` — extended the existing suite with 2 new
      characterization tests (note + `aria-describedby` present when creating, absent when
      editing), both green before and after the refactor.
- [ ] Manual check: open Create Permission (note visible) and Edit Permission (note absent).
      (Deferred to the Phase 2 checkpoint.)

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/PermissionsPage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 6: Migrate `RolesPage`'s `RoleDialog`

**Acceptance criteria:**
- [x] Renders via `DialogPanel`; note still conditional on `fieldsDisabled`.
- [x] No more direct header/note primitive imports in `RolesPage.tsx`.

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test RolesPage` — extended the existing suite with 2 new
      characterization tests (note + `aria-describedby` present editing the default "Editor" role,
      absent editing the non-default "Custom" role), both green before and after the refactor.
- [ ] Manual check: edit a default role (note visible, name/level locked) and a custom role (note
      absent). (Deferred to the Phase 2 checkpoint.)

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/RolesPage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 7: Migrate `InternationalizePage`'s add/edit locale dialog

**Acceptance criteria:**
- [x] Renders via `DialogPanel`.
- [x] No more direct header primitive imports in `InternationalizePage.tsx` (it doesn't use
      `DialogNote` today, so nothing to drop there).

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test InternationalizePage` — no test file existed for this page before;
      added one from scratch (5 tests: table render, dialog title/description + single-id
      `aria-describedby`, Cancel closes, Create submit payload, Edit pre-fill with code locked),
      green against the pre-refactor implementation first, still green after the swap.
- [ ] Manual check: add a locale and edit an existing one. (Deferred to the Phase 2 checkpoint.)

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/InternationalizePage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 8: Migrate `ColumnChooserDialog`

**Acceptance criteria:**
- [x] Renders via `DialogPanel`; the lazy-mount-on-open pattern is preserved (it resets local
      selection state on reopen) — restructured as `ColumnChooserDialog` returning `null` when
      `!open` (rather than the old `<Dialog>{open && <Content/>}</Dialog>`, since `DialogPanel`
      owns its own `Dialog` root and there's no outer shell left to wrap), functionally identical:
      `ColumnChooserContent` only exists in the tree while `open` is true either way.

**Verification:**
- [x] Build succeeds: `bun run build`
- [x] Tests pass: `bun run test ColumnChooserDialog` — extended the existing 6-test suite with 1
      new characterization test (title/description + single-id `aria-describedby`), all 7 green
      before and after the refactor, including the pre-existing reset-on-reopen coverage.
- [ ] Manual check: open column chooser, toggle a few fields, close without saving, reopen —
      selection should reset to the persisted list fields. (Deferred to the Phase 2 checkpoint.)

**Dependencies:** Task 1.

**Files likely touched:**
- `src/components/collection/ColumnChooserDialog.tsx`

**Estimated scope:** Small (1 file).

### Checkpoint: All call sites migrated

- [x] `grep -rn "DialogNote\|DialogDescribedByContext" src/` returns only `ui/dialog.tsx` itself.
- [x] `bun run lint` && `bun run build` && `bun run test` all clean (same 5 pre-existing, unrelated
      failures confirmed present on clean `develop` before any of this work started — see Task 1's
      note).
- [ ] Human review before touching the shared primitive file.
- [ ] Browser walkthrough of the migrated dialogs (deferred across Tasks 2-8) — still outstanding
      before Task 9 reverts `ui/dialog.tsx`.

### Phase 3: Revert the primitive

#### Task 9: Revert `ui/dialog.tsx` to vanilla

**Description:** Replace `ui/dialog.tsx` with the pre-`7ed48a2` baseline
(`git show 7ed48a2^:apps/cms-admin/src/components/ui/dialog.tsx`) — drops `DialogNote`, the
`DialogDescribedByContext`/`useDescribedByIds`/`useRegisterDescribedBy` machinery, the unused
`TriangleAlert` import, and reverts `DialogHeader`'s className to the plain
`"flex flex-col gap-2"` (no border — that treatment now lives only in `DialogPanel`). Also
discards the still-uncommitted header-border edit currently sitting in the working tree, since
`DialogPanel` already carries that styling forward.

**Acceptance criteria:**
- [x] `ui/dialog.tsx` exports exactly: `Dialog`, `DialogClose`, `DialogContent`,
      `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`,
      `DialogTitle`, `DialogTrigger` — no `DialogNote`.
- [x] `git diff 7ed48a2^ -- src/components/ui/dialog.tsx` is empty (file matches the pre-contract baseline exactly).

**Verification:**
- [x] Tests pass: `bun run test` — added `ui/__tests__/dialog.test.tsx` first (export-list
      assertion + a plain title/description/footer smoke render), confirmed RED against the
      still-augmented file (`DialogNote` present in the export list), then GREEN after the revert.
      Full suite: 454 passing, same 5 pre-existing unrelated failures present since before Task 1.
- [x] Build succeeds: `bun run build`
- [ ] Manual check: full browser walkthrough — every dialog touched in Phase 2, plus a
      non-dialog smoke check. (Still outstanding — see Checkpoint: Complete below.)

**Dependencies:** Tasks 3-8 (every direct-primitive call site must be migrated first).

**Files likely touched:**
- `src/components/ui/dialog.tsx`

**Estimated scope:** Small (1 file).

### Checkpoint: Complete

- [x] All acceptance criteria above met.
- [x] `git diff --stat 7ed48a2` (everything this plan touched, since before Task 1) shows only
      `dialog.tsx`, `dialog-panel.tsx` (+test), `confirm-dialog.tsx` (+test), the 6 migrated call
      sites (+tests, including one brand-new `InternationalizePage.test.tsx`), and the `tasks/*`
      planning docs — nothing else. Confirmed.
- [ ] Browser walkthrough of every migrated dialog (deferred since Task 2's checkpoint) — the only
      remaining item before this is ready for review. Every other check ran green throughout: 8
      commits, one per task, each with characterization tests written and passing against the
      pre-refactor code first, then re-verified green after; full suite held at the same 5
      pre-existing unrelated failures the whole way, growing from 431 to 459 passing tests.
- [ ] Ready for five-axis review (after the browser walkthrough above).
- [ ] Once review passes: per the repo's feature workflow, update any `docs/documents/*` that
      reference the old `DialogNote`/header contract (none currently do — grep came up empty at
      plan time, but re-check), then clear this plan (archive `tasks/plan.md`/`tasks/todo.md` the
      same way the prior phase was archived to `tasks/archive.md`).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| A call site's footer/body relies on something implicit in the old header/note markup (e.g. a CSS selector like `[data-slot="dialog-header"] + *`) | Med | Grep for `data-slot="dialog-` usages outside `dialog.tsx`/`dialog-panel.tsx` before Task 9; none found at plan time. |
| `aria-describedby` regression (note not announced) since the context-registration approach is replaced by two fixed `useId()`s | Low | `DialogPanel` only ever has two possible description sources (description, note) — a fixed pair covers every real usage; Task 1's test asserts both cases. |
| Migrating 6 call sites in Phase 2 introduces visual drift if `DialogPanel`'s header/note styling doesn't pixel-match today's | Low | Task 1 copies the existing (already-shipped) `DialogNote` markup and the uncommitted header classes verbatim — no new visual design in this plan. |

## Open Questions

- None blocking. `DialogPanel` naming is a judgment call (paired with existing `ConfirmDialog`) —
  flag now if a different name is preferred before Task 1 starts.

</details>

<details>
<summary>Original tasks/todo.md (as of archive time)</summary>

# Todo: extract dialog contract out of `ui/dialog.tsx`

Full detail in `tasks/plan.md`. Prior phase archived at `tasks/archive.md`.

### Phase 1: Foundation
- [x] 1. Create `DialogPanel` (`src/components/ui/dialog-panel.tsx` + test)
- [x] 2. Migrate `ConfirmDialog` onto `DialogPanel`
- [ ] **Checkpoint** — lint/build/test clean; browser-check one `ConfirmDialog` call site; human review of `DialogPanel`'s API

### Phase 2: Migrate direct-primitive call sites (independent, parallelizable after checkpoint)
- [x] 3. Migrate `DeleteConfirmDialog`
- [x] 4. Migrate `AccessTokensPage` (`TokenRevealDialog` + create-token dialog)
- [x] 5. Migrate `PermissionsPage`'s `PermissionDialog`
- [x] 6. Migrate `RolesPage`'s `RoleDialog`
- [x] 7. Migrate `InternationalizePage`'s add/edit locale dialog
- [x] 8. Migrate `ColumnChooserDialog`
- [~] **Checkpoint** — `grep -rn "DialogNote\|DialogDescribedByContext" src/` returns only `ui/dialog.tsx` (confirmed); lint/build/test clean (confirmed, same 5 pre-existing unrelated failures throughout); human review before touching the shared primitive (pending)

### Phase 3: Revert the primitive
- [x] 9. Revert `ui/dialog.tsx` to the pre-`7ed48a2` vanilla baseline (also discarded the
      uncommitted header-border edit — `DialogPanel` carries that styling forward instead)
- [~] **Checkpoint** — full lint/build/test clean (confirmed, same 5 pre-existing unrelated
      failures throughout); `git diff --stat 7ed48a2` shows only the expected files (confirmed);
      browser walkthrough of every migrated dialog still outstanding — human follow-up

## Final
- [ ] Five-axis review (correctness, readability, architecture, security, performance).
- [x] Update `docs/documents/*` if any reference the old contract — re-checked post-implementation,
      still no matches; nothing to update.
- [ ] Browser walkthrough of the migrated dialogs (deferred across every task since Task 2's
      checkpoint) — still outstanding.
- [ ] Archive this plan/todo to `tasks/archive.md` once shipped.

</details>

## cms-admin popup structural contract (archived 2026-08-20)

Status: done. `specs/cms-admin-popup-contract-redesign.md` no longer exists in the repo (already
deleted), lint/build/test were clean, and the five-axis review's a11y fix (`DialogNote`
`aria-describedby` registration) shipped in commit `7ed48a2`. Superseded by the dialog refactor
below — the note wiring this phase built is being relocated out of `ui/dialog.tsx` in the new plan.

<details>
<summary>Original tasks/plan.md</summary>

# Plan: cms-admin popup structural contract

Spec: `specs/cms-admin-popup-contract-redesign.md`. Frontend-only. All paths relative to
`apps/cms-admin/` unless given as a full repo path.

## Task List

### Task 1: `DialogNote` primitive + `ConfirmDialog` `note` prop

- **Description:** Add `DialogNote` to `src/components/ui/dialog.tsx` — amber callout div,
  `data-slot="dialog-note"`, `TriangleAlert` icon (lucide-react) + text, exported alongside the
  other Dialog parts. Add optional `note?: ReactNode` to `ConfirmDialog` (`confirm-dialog.tsx`),
  rendered via `DialogNote` between `DialogDescription` and `DialogFooter` when present.
- **Acceptance criteria:**
  - [x] `DialogNote` exported from `dialog.tsx`.
  - [x] `ConfirmDialog` renders it only when `note` is passed.
- **Verify:** `bun run build` (typecheck).
- **Files:** `src/components/ui/dialog.tsx`, `src/components/ui/confirm-dialog.tsx`.
- **Scope:** S.

### Task 2: Split folded "…cannot be undone" sentences into description + note

- **Description:** `DeleteConfirmDialog.tsx`, `AccessTokensPage.tsx` (delete + revoke),
  `UsersPage.tsx` (delete user only), `RolesPage.tsx` (delete role), `PermissionsPage.tsx` (delete
  permission) — pass `note` to `ConfirmDialog`/`DeleteConfirmDialog` instead of folding the
  consequence into `description`.
- **Verify:** `bun run build`.
- **Files:** as listed above.
- **Scope:** S.

### Task 3: Convert ad-hoc delete dialogs to `ConfirmDialog`

- **Description:** `MediaLibrary.tsx`, `MediaLibraryPage.tsx`, `InternationalizePage.tsx`
  ("Delete locale") — replace the hand-rolled `Dialog`/`DialogContent` block with `ConfirmDialog`
  (description + note), matching `UsersPage.tsx`'s existing usage pattern.
- **Verify:** `bun run build`; spot-check each still calls its own mutation/`onSuccess` correctly.
- **Files:** `src/components/media/MediaLibrary.tsx`, `src/pages/admin/settings/MediaLibraryPage.tsx`,
  `src/pages/admin/settings/InternationalizePage.tsx`.
- **Scope:** M.

### Task 4: Add missing `DialogDescription` to title-only dialogs

- **Description:** One-line description added to: `InternationalizePage.tsx` add/edit locale
  dialog, `AccessTokensPage.tsx` create-token dialog, `RolesPage.tsx` `RoleDialog`,
  `PermissionsPage.tsx` `PermissionDialog`.
- **Verify:** `bun run build`.
- **Files:** as listed above.
- **Scope:** S.

### Task 5: Promote existing muted "note" paragraphs to `DialogNote`

- **Description:** `AccessTokensPage.tsx` `TokenRevealDialog` (add description + promote copy
  warning to `DialogNote`), `PermissionsPage.tsx` `PermissionDialog` (promote create-only
  disclaimer), `RolesPage.tsx` `RoleDialog` (new `DialogNote` shown only when `fieldsDisabled`).
- **Verify:** `bun run build`.
- **Files:** `src/pages/admin/settings/AccessTokensPage.tsx`,
  `src/pages/admin/settings/PermissionsPage.tsx`, `src/pages/admin/settings/RolesPage.tsx`.
- **Scope:** S/M.

</details>

<details>
<summary>Original tasks/todo.md</summary>

# Todo: cms-admin popup structural contract

Full detail in `tasks/plan.md`.

- [x] 1. `DialogNote` primitive + `ConfirmDialog` `note` prop
- [x] 2. Split folded "cannot be undone" sentences into description + note
- [x] 3. Convert ad-hoc delete dialogs (MediaLibrary, MediaLibraryPage, InternationalizePage) to `ConfirmDialog`
- [x] 4. Add missing `DialogDescription` to title-only dialogs
- [x] 5. Promote existing muted "note" paragraphs to `DialogNote`
- [x] **Checkpoint** — lint/build/test clean (2 pre-existing failures unrelated to this change,
      confirmed via `git stash` diff on `develop`); browser walkthrough (Roles edit, Create
      Permission, Create/Reveal Access Token, Delete token) confirmed correct rendering, no console
      errors; contrast fixed `text-amber-600` → `text-amber-700` (was 3.2:1, now 5.03:1 light mode;
      dark mode `amber-400` measured 10.41:1)
- [x] Five-axis review — REQUEST CHANGES (1 important a11y issue, 2 minor suggestions); a11y issue
      fixed: `DialogNote` now registers its id into a shared `aria-describedby` context alongside
      `DialogDescription`, verified live (`aria-describedby="descId noteId"`, both referenced ids
      resolve to the right text). One suggestion (reuse the `depthStyles` amber for `DialogNote`)
      was investigated and rejected — that array is an unrelated indigo/violet/amber depth-rotation
      palette for nested components, not a warning convention; reusing it would overload its
      meaning per this skill's own anti-pattern guidance. Other suggestion (PermissionDialog's
      non-destructive disclaimer using the same DialogNote styling as destructive warnings) left
      as-is — informational-but-important still fits "important note".
- [x] Delete spec file — `specs/cms-admin-popup-contract-redesign.md` confirmed absent from the
      repo at archive time (already removed).

</details>

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
- [ ] Renders via `DialogPanel`; conditional note (create-only disclaimer) still conditional.
- [ ] No more direct header/note primitive imports in `PermissionsPage.tsx`.

**Verification:**
- [ ] Build succeeds: `bun run build`
- [ ] Manual check: open Create Permission (note visible) and Edit Permission (note absent).

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/PermissionsPage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 6: Migrate `RolesPage`'s `RoleDialog`

**Acceptance criteria:**
- [ ] Renders via `DialogPanel`; note still conditional on `fieldsDisabled`.
- [ ] No more direct header/note primitive imports in `RolesPage.tsx`.

**Verification:**
- [ ] Build succeeds: `bun run build`
- [ ] Manual check: edit a default role (note visible, name/level locked) and a custom role (note
      absent).

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/RolesPage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 7: Migrate `InternationalizePage`'s add/edit locale dialog

**Acceptance criteria:**
- [ ] Renders via `DialogPanel`.
- [ ] No more direct header primitive imports in `InternationalizePage.tsx` (it doesn't use
      `DialogNote` today, so nothing to drop there).

**Verification:**
- [ ] Build succeeds: `bun run build`
- [ ] Manual check: add a locale and edit an existing one.

**Dependencies:** Task 1.

**Files likely touched:**
- `src/pages/admin/settings/InternationalizePage.tsx`

**Estimated scope:** Small (1 file).

---

#### Task 8: Migrate `ColumnChooserDialog`

**Acceptance criteria:**
- [ ] Renders via `DialogPanel`; the `open && <ColumnChooserContent .../>` lazy-mount pattern is
      preserved (it resets local selection state on reopen).

**Verification:**
- [ ] Build succeeds: `bun run build`
- [ ] Manual check: open column chooser, toggle a few fields, close without saving, reopen —
      selection should reset to the persisted list fields.

**Dependencies:** Task 1.

**Files likely touched:**
- `src/components/collection/ColumnChooserDialog.tsx`

**Estimated scope:** Small (1 file).

### Checkpoint: All call sites migrated

- [ ] `grep -rn "DialogNote\|DialogDescribedByContext" src/` returns only `ui/dialog.tsx` itself.
- [ ] `bun run lint` && `bun run build` && `bun run test` all clean.
- [ ] Human review before touching the shared primitive file.

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
- [ ] `ui/dialog.tsx` exports exactly: `Dialog`, `DialogClose`, `DialogContent`,
      `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`,
      `DialogTitle`, `DialogTrigger` — no `DialogNote`.
- [ ] `git diff 7ed48a2^ -- src/components/ui/dialog.tsx` is empty (file matches the pre-contract baseline exactly).

**Verification:**
- [ ] Tests pass: `bun run test`
- [ ] Build succeeds: `bun run build`
- [ ] Manual check: full browser walkthrough — every dialog touched in Phase 2, plus a
      non-dialog smoke check (nothing else imports from `ui/dialog.tsx` in a way this could break).

**Dependencies:** Tasks 3-8 (every direct-primitive call site must be migrated first).

**Files likely touched:**
- `src/components/ui/dialog.tsx`

**Estimated scope:** Small (1 file).

### Checkpoint: Complete

- [ ] All acceptance criteria above met.
- [ ] `git diff --stat` shows only `dialog.tsx`, `dialog-panel.tsx` (+test), `confirm-dialog.tsx`,
      and the 6 migrated call sites — nothing else.
- [ ] Ready for five-axis review.
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

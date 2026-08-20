# Archive

Completed phases moved out of `tasks/plan.md` / `tasks/todo.md` to keep those files token-lean.
Each entry is a frozen snapshot at archive time.

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

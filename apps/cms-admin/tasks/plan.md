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

### Checkpoint

- [x] `bun run lint`, `bun run build`, `bun run test` all clean.
- [ ] Browser walkthrough (chrome-devtools MCP): open Roles → Delete (note renders), Access Tokens
      → Create → reveal token (note renders), confirm no console errors, screenshot at desktop
      width.
- [ ] Commit once the above passes (ask user for confirmation first, per commit rules).

## Final

- [ ] Five-axis review (correctness, readability, architecture, security, performance).
- [ ] Delete `specs/cms-admin-popup-contract-redesign.md` after Review completes.

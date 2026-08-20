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
- [ ] Delete spec file

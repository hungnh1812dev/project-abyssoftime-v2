# Todo: extract dialog contract out of `ui/dialog.tsx`

Full detail in `tasks/plan.md`. Prior phase archived at `tasks/archive.md`.

### Phase 1: Foundation
- [x] 1. Create `DialogPanel` (`src/components/ui/dialog-panel.tsx` + test)
- [x] 2. Migrate `ConfirmDialog` onto `DialogPanel`
- [ ] **Checkpoint** — lint/build/test clean; browser-check one `ConfirmDialog` call site; human review of `DialogPanel`'s API

### Phase 2: Migrate direct-primitive call sites (independent, parallelizable after checkpoint above)
- [x] 3. Migrate `DeleteConfirmDialog`
- [x] 4. Migrate `AccessTokensPage` (`TokenRevealDialog` + create-token dialog)
- [x] 5. Migrate `PermissionsPage`'s `PermissionDialog`
- [x] 6. Migrate `RolesPage`'s `RoleDialog`
- [x] 7. Migrate `InternationalizePage`'s add/edit locale dialog
- [x] 8. Migrate `ColumnChooserDialog`
- [~] **Checkpoint** — `grep -rn "DialogNote\|DialogDescribedByContext" src/` returns only `ui/dialog.tsx` (confirmed); lint/build/test clean (confirmed, same 5 pre-existing unrelated failures throughout); human review before touching the shared primitive (pending)

### Phase 3: Revert the primitive
- [ ] 9. Revert `ui/dialog.tsx` to the pre-`7ed48a2` vanilla baseline (also discards the current uncommitted header-border edit — `DialogPanel` carries that styling forward instead)
- [ ] **Checkpoint** — full lint/build/test + browser walkthrough of every migrated dialog; `git diff --stat` shows only the expected files

## Final
- [ ] Five-axis review (correctness, readability, architecture, security, performance).
- [ ] Update `docs/documents/*` if any reference the old contract (grep came up empty at plan time — re-check).
- [ ] Archive this plan/todo to `tasks/archive.md` once shipped.

# Decision rationale: action-button permission gating

Backing doc for the `action-button-permission-gating` spec (`/specs/action-button-permission-gating.md`). Two implementation choices compared here per repo root `docs/workflow.md`'s Decision rationale rule.

## Decision 1: how to gate a mutating button (disable + explain, not hide)

| Option | Fit for this repo | Complexity | Maintenance cost | Existing precedent |
|---|---|---|---|---|
| A. Inline `disabled={!hasPermission(...)}` + tooltip on every button site | Works, but ~14 call sites across 6 files repeat the same three-line pattern | Low per-site, but no shared behavior | High — any future change to gating logic (e.g. new fallback rule) means editing every site | None |
| B. Hook `usePermissionGate(required)` returning `{ allowed, reason }`, applied inline (`disabled={!allowed}` / `title={reason}`) at each site | Removes the permission-lookup duplication, keeps JSX ownership local to each page | Low | Medium — logic centralized, JSX still repeated | Matches `Sidebar.tsx`'s existing local `can()` pattern, just promoted to a shared hook |
| **C. Hook (B) + a thin `<PermissionTooltip reason>` wrapper used only where a tooltip is needed** (Recommended) | Same centralization as B, plus the disabled/tooltip *rendering* pattern isn't hand-rolled at each of ~14 sites | Low — one new ~20-line component | Low — one place to fix tooltip UX/copy later | Follows this repo's own convention of wrapping cross-cutting UI concerns in small `components/ui`-adjacent primitives (see `ProtectedRoute.tsx` for the route-level equivalent of this exact pattern) |

**Chosen: C.** `usePermissionGate()` lives next to `hasPermission()` in `src/lib/permissions.ts` (or a new `src/hooks/usePermissionGate.ts` if the module-independence rule pushes it there); `<PermissionTooltip>` wraps a disabled trigger with the reason text. Reason string is a fixed template (`Requires the "{slug}" permission`) — no i18n/localization work in scope.

## Decision 2: tooltip rendering

| Option | Fit | Complexity | Maintenance cost | Existing precedent |
|---|---|---|---|---|
| A. Native HTML `title` attribute on the (possibly-disabled) button | Zero new code | Lowest | Lowest | None in this codebase |
| **B. New `src/components/ui/tooltip.tsx` wrapping `@base-ui/react/tooltip`** (Recommended) | Matches how every other interactive affordance in `components/ui/*` (dialog, dropdown-menu, select, checkbox, switch) already wraps a Base UI primitive rather than relying on native browser chrome | Low — `@base-ui/react` is already a dependency, Tooltip is one of its primitives | Low, same pattern as siblings | Strong — `dialog.tsx`/`dropdown-menu.tsx` are the direct template to copy (`data-slot` attrs, `cn()` composition, Portal/Positioner/Popup structure) |

**Chosen: B.** Native `title` was rejected specifically because it's the only interactive primitive in this codebase that wouldn't follow the established Base-UI-wrapper pattern, and would look/behave inconsistently (unstyled OS tooltip, no touch support) next to every other popover-style UI in the app.

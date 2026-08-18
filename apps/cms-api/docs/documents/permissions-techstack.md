# Permissions Module — Tech/Pattern/Design Decisions

Comparison table for the one real choice made when rolling out real auth to `src/modules/permissions/**`, per repo root `docs/workflow.md`'s "Decision rationale" rule. See [permissions.md](./permissions.md) for the module's full implementation writeup, and [roles-techstack.md](./roles-techstack.md) for the fuller authorization-mechanism comparison this module inherits.

## Authorization mechanism

This module never had its own caller-authorization logic (unlike `roles`, it had **no** auth check at all before this cycle — see `permissions.md`'s "Known quirks"), so there was no existing mechanism to weigh against alternatives here. It adopts the same `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions(...)` pattern chosen for `roles` (see [roles-techstack.md](./roles-techstack.md) for that comparison) purely for consistency — introducing a second authorization pattern for one module, when the sibling modules already settled on one, would be inconsistency with no offsetting benefit.

| Criteria                     | A different/bespoke guard for this module | Reuse the `roles` module's guard pattern (chosen) |
| ------------------------------ | -------------------------------------------- | ---------------------------------------------------- |
| Consistency across `roles`/`permissions`/`users` | Breaks it — three modules, two patterns | One pattern everywhere |
| New code                        | A second guard/decorator implementation to maintain | Zero — same `common/guards/*` already built for `roles` |
| **Verdict**                    | Rejected — no reason for a different mechanism here | **Chosen** |

## Permission-slug format

| Criteria            | Free-form string                          | `resource:action` regex (chosen, pre-existing)  |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Established before this cycle | N/A                                        | Yes — `create-permission.dto.ts`'s `@Matches(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/)` predates this cycle |
| Changed by this cycle    | N/A                                            | No — this cycle only *consumes* the existing slug catalog (`user:manager`, `role:read`, etc.) for `@RequirePermissions(...)`, it doesn't redesign the format |
| **Verdict**             | N/A — not revisited                          | **Kept as-is** — not an in-scope decision for the auth rollout, noted here only so the "no format decision was reopened" is explicit |

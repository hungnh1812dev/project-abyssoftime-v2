# Roles Module — Tech/Pattern/Design Decisions

Comparison table for the authorization-mechanism choice made when rolling out real auth to `src/modules/roles/**`, per repo root `docs/workflow.md`'s "Decision rationale" rule. See [roles.md](./roles.md) for the module's full implementation writeup.

## Authorization mechanism (replacing the old numeric-`level` caller check)

| Criteria                        | Numeric `level` comparison (previous)                | RBAC library (e.g. CASL, `nest-casl`)        | Permission-slug guard + decorator (chosen)      |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| New dependency                     | None                                                       | Yes — a new authorization library to learn/maintain | None — `PermissionsGuard`/`@RequirePermissions` are ~30 lines total |
| Caller identity source              | `req.user?.roleSlug` from a **placeholder type with no real guard populating it** — every write always failed with `403` in practice | Would need the same real `req.user` JWT payload underneath anyway | Real `req.user` from `JwtAuthGuard` (JWT-verified, no DB call) |
| Expressiveness                      | One dimension (`level` — a single number ranks *all* roles on one axis) | Very expressive (conditions, field-level rules, subjects) — more than this app needs | Exactly matches what's needed: a fixed slug catalog (`role:read`, `role:manager`, etc.) per resource |
| Consistency with `permissions`/`users` | N/A — those modules had **no** auth check at all before this cycle | Would require rewriting `permissions:*` catalog into the library's own model | Directly reuses the existing `permissions` module's slug catalog (`user:manager`, `role:read`, etc.) — no parallel model needed |
| Fit for future growth               | Would need a redesign the moment two roles need different write scopes at the same level | Room to grow, but that room isn't needed yet | Room to grow by adding new slugs to the existing catalog — no framework migration needed |
| **Verdict**                        | Rejected — was already broken (fails closed, but unusably so) | Rejected — solves problems this app doesn't have yet | **Chosen** |

## Why `level` stays on the entity/schema at all

| Option                                            | Reasoning |
| --------------------------------------------------- | ----------- |
| Remove `level` entirely now that it's unused for authorization | Rejected — explicitly out of scope for this cycle (confirmed in `SPEC.md`'s assumptions); `level` is still validated `0–100` on create/update via the DTOs, and removing the column/field would be an unrequested, unrelated cleanup mid-auth-rollout |
| Keep `level`, stop reading it for authorization (chosen) | Matches the approved scope exactly: the field is inert for auth going forward but still meaningful for whatever future purpose (documentation, potential future re-use) prompted keeping it |

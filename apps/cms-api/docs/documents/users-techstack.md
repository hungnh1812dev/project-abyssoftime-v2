# Users Module — Tech/Pattern/Design Decisions

Comparison tables for the choices made when rolling out real auth to `src/modules/users/**`, per repo root `docs/workflow.md`'s "Decision rationale" rule. See [users.md](./users.md) for the module's full implementation writeup, and [roles-techstack.md](./roles-techstack.md) for the base authorization-mechanism comparison this module also inherits.

## Why `users` gets an *extra* check beyond the permission-slug guard

| Criteria                              | Permission-slug guard only (same as `roles`/`permissions`) | Permission-slug guard + level-hierarchy check (chosen) |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Models "who can act on whom"              | No — `user:manager` is all-or-nothing; any two holders of it are equals | Yes — a lower-`level` `user:manager` holder still can't touch a user whose role outranks the caller's |
| Matches the approved spec                 | Contradicts it — SPEC.md explicitly requires this scoped-to-`users` extra check | Matches it exactly (confirmed scope: `roles`/`permissions` stay purely slug-guarded, `users` alone gets the hierarchy layer) |
| Consistency cost                          | None                                                              | `roles`/`permissions` intentionally **don't** get this — an asymmetry, but a deliberate one: role/permission *records* aren't ranked by who holds them, but *user accounts* are, via their assigned role's `level` |
| **Verdict**                              | Rejected — spec explicitly calls for the stricter behavior here    | **Chosen** |

## Caller-identity source for the hierarchy check

| Criteria                  | Re-fetch caller's own role from the DB (like the old `roles` module's `callerRoleSlug` pattern) | Read `caller.level`/`caller.roleSlug` straight from the JWT payload (chosen) |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| DB calls per request           | One extra (`roles.findBySlug(callerRoleSlug)`)                                                        | Zero for the *caller's* side — `level`/`roleSlug` are already signed into the access token at login/refresh |
| Consistency with `JwtAuthGuard`'s design | Redundant — the whole point of embedding `roleSlug`/`level`/`permissions` in the token was to avoid exactly this kind of lookup | Matches it — reuses the payload the guard already verified |
| Freshness                     | Always current                                                                                        | Up to ~15 min stale (access-token TTL) if the caller's *own* role changed since login — same accepted tradeoff as the rest of the stateless-JWT design |
| **Verdict**                   | Rejected — reintroduces a DB call the JWT design was built to avoid                                    | **Chosen** |

Note: the check still does one DB call — to resolve the **target** user's (and, if changing, the new) role's `level` via `IRoleRepository.findById`, since that's not something the caller's own token can carry.

## Super-admin-promotion mechanism

| Criteria                              | Generic level check only (`caller.level > newRole.level`) | Level check, with a role-slug carve-out for `super_admin` (chosen) |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Works at the top of the hierarchy          | **No** — `super_admin` sits at `level: 100`, also `CreateRoleDto`'s validated ceiling (`@Max(100)`); "caller.level strictly greater than 100" can never be satisfied by anyone, making promotion to `super_admin` permanently impossible | Yes — the slug check (`caller.roleSlug === "super_admin"`) is the mechanism that actually permits reaching the top tier |
| Matches the literal spec wording           | Spec says both checks apply "in addition to, not instead of" each other — taken 100% literally, this is the broken option above | Confirmed with the project owner: the slug check *replaces* the level check for this one case, since the literal reading is unsatisfiable |
| Complexity                                 | Simpler (one rule, no special case)                                | One `if`/`else` branch — small, isolated, documented inline and in `users.md` |
| **Verdict**                                | Rejected — a spec bug discovered during implementation; flagged and resolved via `AskUserQuestion` rather than silently guessed | **Chosen** |

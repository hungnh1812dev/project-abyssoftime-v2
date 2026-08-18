# `GET /api/v1/auth/me` — Decision Rationale

Two judgment calls made while spec'ing this endpoint (see `SPEC.md` while the spec is active; this file is
the durable record once the spec is cleaned up per repo root `docs/workflow.md`).

## 1. Permissions source: fresh DB read vs. JWT-embedded values

| | Fresh from DB (chosen) | Embedded JWT values |
| --- | --- | --- |
| Accuracy | Always reflects the current role row | Up to 15 min stale (access-token TTL) after an admin edits a role's permissions |
| Consistency with enforcement (`PermissionsGuard`) | Can diverge from what's actually enforced right now, for up to 15 min after a live permission change | Perfectly consistent — same source the guard reads |
| Can it alone satisfy the requested shape? | Yes | No — `role.documentId`/`role.name` aren't in `AccessTokenPayload` at all, so a DB lookup of the role is mandatory regardless |
| Extra DB cost vs. the alternative | None — the role lookup happens either way | None saved |

**Decision:** fresh DB. Since the role lookup is unavoidable to populate `role.documentId`/`role.name`, the
only real choice was whether to then override that row's `permissions`/`level`/`slug` with the possibly-stale
JWT values. Chose not to — this endpoint's job is "report current state for UI gating," not "mirror
enforcement exactly." Enforcement (`PermissionsGuard`) is unchanged and untouched by this decision.

## 2. Deleted-user-mid-session: 401 vs. 404

| | 401 Unauthorized (chosen) | 404 Not Found |
| --- | --- | --- |
| Semantic fit | Slight stretch (the token itself is still valid) | Technically precise ("this user resource doesn't exist") |
| FE integration cost | Zero — FE already treats 401 on this route as "redirect to `/login`" | New special case: "404 here means your account is gone, log out" — not documented anywhere else in the API |
| Consistency with rest of API | Matches every other guarded route's "can't resolve who you are" → 401 pattern | Would be the first auth-identity failure to use 404 |
| Info leak | None beyond "invalid session" | Slightly more detail than necessary (distinguishes "no session" from "session valid, account gone") |

**Decision:** 401. `JwtStrategy.validate()` is a pure pass-through today (no DB check) — this endpoint is the
first to look up the caller's own user row by `sub`, making "token still valid, account deleted" a new edge
case. Mapping it to 401 keeps the FE's existing error contract unchanged.

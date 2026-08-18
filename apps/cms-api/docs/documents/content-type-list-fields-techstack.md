# Content-Type `listFields` — Tech/Pattern/Design Decisions

Comparison tables for the Configure-Columns backend cycle (`PATCH content-types/:slug/list-fields` + `updatedBy`), per repo root `docs/workflow.md`'s "Decision rationale" rule. See [content-type.md](./content-type.md#admin-mutable-listfields) for the module's full implementation writeup, and [document.md](./document.md#resolved-updatedby) for the `updatedBy` resolution path.

## Persistence for admin-set `listFields`

`ContentTypeSyncService.syncOne()` recomputes and overwrites `ContentType.listFields` from the JSON schema on **every app boot**, unconditionally — any approach that writes admin input into that same column gets silently reverted on the next deploy.

| Criteria | Mutate `content-types/*.json` on PATCH | Flag column, sync skips `listFields` once admin-set | Separate `listFieldsOverride` column (chosen) |
| --- | --- | --- | --- |
| Survives a redeploy | Only if the mutated file is also the one redeployed — a container/CI redeploy from source control would silently discard the admin's PATCH, since the running container's on-disk edit was never committed | Yes | Yes |
| New state introduced | None on the DB, but couples the API process to writable access on its own deploy artifact — unusual and fragile in a containerized/read-only-filesystem deployment | One boolean flag per content type, plus a conditional branch inside the sync engine's existing update path | One nullable JSON column, read only at `toEntity()` — zero new branches inside the sync engine |
| Coupling to `ContentTypeSyncService` | High — every PATCH would need to reload/re-diff schema, since the JSON file is also schema's source of truth for `fields`/`kind`/`draftToPublish` | Medium — `syncOne` must check the flag before deciding whether to overwrite `listFields`, a new conditional in an already-intricate diff/sync path | None — `ContentTypeSyncService` never reads or writes the override column; proven by construction (`content-type-sync.service.spec.ts` passes with zero edits to `content-type-sync.service.ts`) |
| Matches the "schema is JSON-owned, admin state is DB-owned" boundary | No — blurs schema-as-code (git-tracked, deploy-time) with admin-mutable runtime state (DB, request-time) into the same artifact | Partially — still routes admin state through the sync-owned column, just gated | Yes — a clean split: `listFields` stays 100% sync-owned, `listFieldsOverride` is 100% admin-owned, merged only at read time |
| Multi-instance / concurrent-deploy safety | Poor — concurrent API instances writing to their own local filesystem copy of the JSON file would diverge from each other and from source control | Fine — DB-backed, same guarantees as any other column | Fine — DB-backed, same guarantees as any other column |
| **Verdict** | Rejected | Rejected — solves the same problem with more coupling for no benefit over the chosen option | **Chosen** |

## `updatedBy` response shape

| Option | Reasoning |
| --- | --- |
| Flat string (just the resolved name) | Rejected — the `User` row has to be fetched regardless of what's read off it (same lookup cost either way), and a bare name string gives the FE nothing to link to a user detail view or to disambiguate two users sharing a display name |
| Nested `{ documentId, name }` (chosen) | Matches the `GET /auth/me` precedent (`docs/documents/auth-me-techstack.md`) of resolving once server-side and embedding the full object rather than a flattened projection; costs nothing extra at the lookup layer, and gives the FE a stable id to key off of |

## Where `LISTABLE_FIELD_TYPES` lives

The FE's request asked to reuse "whatever allowlist logic already backs `orderBy` validation" — `SORTABLE_FIELD_TYPES` (`text`/`number`/`boolean`), which lived in `document/infrastructure/persistence/sql/where-builder.ts`.

| Option | Reasoning |
| --- | --- |
| Leave the allowlist in `document`, have `content-type` import it | Rejected — `content-type` must not import from `document` (the module arrow is strictly one-way, `document → content-type`, documented in both modules' headers); reusing it in place would invert that boundary |
| Duplicate the allowlist inside `content-type` | Rejected — two independently-maintained copies of the same three-value set is exactly the kind of drift risk a single-source-of-truth relocation avoids, for zero benefit over just moving it |
| Relocate into `content-type/domain/entities/field-definition.ts` as `LISTABLE_FIELD_TYPES`, have `where-builder.ts` import from there (chosen) | Correct dependency direction (the type-kind allowlist is inherently a `content-type` concern — it's about `FieldType`, which `content-type` already owns), single source of truth, and a pure refactor: `where-builder.spec.ts`'s existing tests pass unmodified |

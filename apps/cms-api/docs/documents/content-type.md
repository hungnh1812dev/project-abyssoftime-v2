# Content Type Module

`src/modules/content-type/**` — schema-as-code engine for the CMS's dynamic content model. Content types are defined as JSON files under `content-types/*.json` at the repo root (`CONTENT_TYPES_DIR`, default `content-types`) and reconciled against Postgres on every boot by `ContentTypeSyncService` (`OnApplicationBootstrap`). This module owns the `ContentType` entity, its repository, the schema loader/validator, the diff-based sync engine, and the REST routes. Schema itself (`fields`/`kind`/`draftToPublish`) is **read-only by design** — edited only by changing a JSON file and rebooting; the sync engine reconciles it. `listFields` is the one admin-mutable exception (see [Admin-mutable `listFields`](#admin-mutable-listfields) below) — a `PATCH` route lets a `content_type:manager` caller override the list view's columns without touching the JSON file or the sync-owned column. Depended on by [`document`](document.md) (`GetContentTypeService` + `CONTENT_TYPE_REPOSITORY` are exported for it) — the module arrow is strictly one-way, `document → content-type`, never the reverse.

## Deviations from the source docs

Two Go-derived design docs (content-type + component) describe the original Go/GORM/MongoDB source. Where they conflicted with this repo's own conventions or with the SPEC decisions made during the Spec phase, this repo's version won:

1. **No MongoDB, no gRPC** — this repo is Postgres-only and REST-only (Postgres-only is now enforced in the source itself — `DB_DRIVER` and the `mysql`/`sqlite` schema stubs were removed entirely, see [dockerfile-techstack.md](./dockerfile-techstack.md) for the removal rationale). The Go docs' MongoDB nested-BSON path, the `gRPC ContentTypeService`, and `proto/cms/v1/content_type*` are all dropped entirely.
2. **No `locale`** — removed everywhere. The Go docs' injected system fields include `locale`; this repo's system-field set (`RESERVED_SYSTEM_FIELD_NAMES` in `schema-validator.ts`) is `id, document_id, version, created_at, updated_at, published_at, created_by, updated_by, published_by`, plus (added during the [GraphQL Contract Parity Pass](graphql.md#graphql-contract-parity-pass)'s five-axis review, to stop a content field from colliding with a fixed GraphQL SDL field/combinator name) the camelCase forms `documentId, createdAt, updatedAt, publishedAt, and, or, not` — no locale column, no locale query param anywhere in the API.
3. **True incremental ALTER, never DROP+CREATE** — the Go doc's `EnsureCollection(slug, fields)` is explicitly a "drops existing table and recreates" strategy. This repo's sync engine never drops a live table to change its shape: `schema-differ.ts` diffs live `information_schema` columns against desired fields and emits `ADD COLUMN`/`DROP COLUMN`/`ALTER COLUMN ... TYPE` clauses (see [Sync engine](#sync-engine) below) so that unrelated columns' data survives a schema edit. `DROP TABLE` is only ever issued when a content type's JSON file is deleted entirely, not on a field-level change.
4. **Permission slug naming** — the Go doc's `content_types:read` (plural resource) is `content_type:read` here (singular), matching this repo's existing convention (`role:read`, `user:read`, `media:read`, ...).
5. **Primary key** — same inversion as every other module in this repo (see `media.md`'s equivalent note): `documentId String @id @default(uuid())` is the real key; `id Int @default(autoincrement())` is a plain, unmapped legacy column.
6. **Column type mapping is richer than the Go doc's** — `field-type-mapping.ts`: `number → DOUBLE PRECISION` (Go doc: `REAL`), `json → JSONB` (Go doc: `TEXT`, i.e. no native JSON support), `media → UUID REFERENCES media_assets(document_id) ON DELETE SET NULL` (Go doc: a bare `VARCHAR`, no real FK constraint).
7. **No `FindByID`/documentId-keyed lookup route** — the Go doc's `ContentTypeRepository.FindByID` and its REST/gRPC surface are unused; the only read routes are by `slug` (`GET /api/v1/content-types`, `GET /api/v1/content-types/:slug`), matching Confirmed Decision territory that content types are addressed by slug everywhere in this feature, never by their internal `documentId`.
8. **Postgres identifier-length safety is new** — neither Go doc addresses the 63-byte Postgres identifier limit (GORM/MongoDB names were never long enough to matter). This repo's `table-naming.ts` hash-truncates an overlong component table name, and `indexName()` (added post-hoc, see [Known quirks](#known-quirks--deviations-preserved-intentionally) below) does the same for derived index names — a real Postgres constraint the Go source never had to solve.

## Entity

`domain/entities/content-type.entity.ts` — `ContentTypeEntity`:

| Field            | Type                 |
| ---------------- | -------------------- |
| `documentId`      | `string`             |
| `slug`            | `string`             |
| `name`            | `string`             |
| `kind`            | `"single" \| "collection"` |
| `draftToPublish`  | `boolean`            |
| `fields`          | `FieldDefinition[]`  |
| `listFields`      | `string[]`           |
| `createdAt`       | `Date`               |
| `updatedAt`       | `Date`               |

Maps 1:1 to the `ContentType` Prisma model (`prisma/postgresql/schema.prisma`, `@@map("content_types")`, migration `20260727072526_add_content_types`); `fields`/`listFields` are stored as `Json` columns. `ContentTypeSummary` (`{ slug, name, kind, draftToPublish }`) is the projection returned by the list route.

The entity's `listFields` is not a 1:1 column read — see [Admin-mutable `listFields`](#admin-mutable-listfields) immediately below for the separate `listFieldsOverride` column merged into it at read time.

`domain/entities/field-definition.ts` — the recursive shape every content type's `fields` array is built from:

```ts
type ContentKind = "single" | "collection";
type FieldType = "text" | "richtext" | "number" | "boolean" | "media" | "json" | "component";

interface FieldDefinition {
  name: string;
  type: FieldType;
  width?: string;
  header?: boolean;
  component?: string;    // present iff type === "component"
  repeatable?: boolean;  // present iff type === "component"
  fields?: FieldDefinition[]; // present iff type === "component"
}
```

`isComponentField(field)` is the single predicate every recursive walk (validator, differ, sync, component I/O in `document`) uses to branch on `type === "component"`. Components nest arbitrarily deep — the two real seeds (`cv-page`, `en-it-vocab`) both exercise 2 levels of nesting (`experiences → roles`, `phonetics → syllableParts`).

## Repository

`domain/repositories/content-type.repository.ts` — interface `IContentTypeRepository`, DI token `CONTENT_TYPE_REPOSITORY` (exported to `document`):

- `create(data: UpsertContentTypeData): Promise<ContentTypeEntity>`
- `update(slug, data: UpsertContentTypeData): Promise<ContentTypeEntity>` — full replace of `name`/`kind`/`draftToPublish`/`fields`/`listFields`. **`ContentTypeSyncService` is the only caller** — this is the sync-owned write path, never routed through admin input.
- `updateListFields(slug, listFields: string[]): Promise<ContentTypeEntity>` — narrow method, writes only the `listFieldsOverride` column, never touches `fields`/`kind`/`draftToPublish`/the sync-owned `listFields` column. The admin-facing write path; see [Admin-mutable `listFields`](#admin-mutable-listfields) below.
- `delete(slug): Promise<void>`
- `findBySlug(slug): Promise<ContentTypeEntity | null>`
- `findAll(): Promise<ContentTypeEntity[]>`
- `findAllSummaries(): Promise<ContentTypeSummary[]>` — a narrower `select` (name/slug/kind/draftToPublish only), used by the list route.

`ContentTypeNotFoundError` is a plain `Error` subclass, thrown by `infrastructure/persistence/prisma-content-type.repository.ts` (`PrismaContentTypeRepository`) on a caught Prisma `P2025` from `update`/`delete`, translated to `NotFoundException` at the service boundary — the same `RoleNotFoundError` pattern `media.md` documents.

`domain/repositories/schema-table.repository.ts` — interface `ISchemaTableRepository`, DI token `SCHEMA_TABLE_REPOSITORY` (not exported — internal to this module and the sync engine only):

- `ensureDocumentTable(slug, fields, kind)` / `alterDocumentTable(slug, plan)` / `dropDocumentTable(slug)` / `listDocumentColumns(slug)` — `kind` (added post-review, see [Known quirks](#known-quirks--deviations-preserved-intentionally)) makes `ensureDocumentTable` add a `UNIQUE (version)` table constraint for a `single`-kind content type, enforcing "at most one row per version" at the DB level.
- `ensureComponentTable(slug, componentPath, fields)` / `alterComponentTable(slug, componentPath, plan)` / `dropComponentTable(slug, componentPath)` / `listComponentColumns(slug, componentPath)`

`componentPath: string[]` is the nesting chain of component names from the document root (e.g. `["experience", "role"]`) — this is what lets an arbitrarily-nested component field resolve to one flat Postgres table name.

## Schema-as-code: loading and validating JSON definitions

`application/schema/schema-loader.service.ts` — `SchemaLoaderService.load()` reads `CONTENT_TYPES_DIR` (relative to `process.cwd()`) via `loadFromDir(dir)`:

1. `readdir(dir)`, filtered to `*.json`, sorted for deterministic processing order.
2. Each file is `JSON.parse`d, then `listFields` is defaulted to the **first 3 field names** from `fields` if the JSON didn't specify one (`DEFAULT_LIST_FIELDS_COUNT = 3`).
3. `validateContentTypeDefinition(definition)` runs (see below) — a throw here aborts the whole boot; there is no partial/best-effort load.
4. `ContentTypesDirectoryNotFoundError` if the directory itself is missing.

`application/schema/schema-validator.ts` — `validateContentTypeDefinition`:

- `assertSafeSlug(definition.slug)` (see [SQL identifier safety](#sql-identifier-safety) below).
- Recursively over every field (including nested component fields): `assertSafeFieldName(field.name)`; reject if the name collides with `RESERVED_SYSTEM_FIELD_NAMES`; for a component field, require a non-empty `component` name and recurse into `field.fields`.
- Every `listFields` entry must reference an actual field name on the content type, or `SchemaValidationError`.

## SQL identifier safety

`application/schema/sql-identifier.ts` is the injection choke-point every dynamic-DDL/DML path in this module (and `document`'s raw-SQL repositories) routes through before a string ever reaches `$executeRawUnsafe`/`$queryRawUnsafe`:

- `assertSafeSlug` — `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 1–53 chars.
- `assertSafeFieldName` — `^[a-zA-Z][a-zA-Z0-9]*$` (camelCase, no hyphen/underscore), 1–53 chars. Also used for component names.
- `quoteIdent` — the actual SQL-emitting function: validates against `^[a-zA-Z_][a-zA-Z0-9_]*$`, 1–63 bytes (Postgres's real identifier limit), then wraps in double quotes, doubling any embedded `"` — belt-and-suspenders, since the two `assert*` functions above should already have rejected anything that could reach here unsafely.

The 53-char limit on slugs/field names (not 63) leaves headroom for the `documents_`/`components_<slug>__` prefixes `table-naming.ts` adds on top before the 63-byte Postgres ceiling applies to the *final* identifier.

## Field-type → column-type mapping

`application/schema/field-type-mapping.ts` — `columnTypeFor(field)`, `null` for a component field:

| `FieldType` | Postgres column type |
| --- | --- |
| `text` | `TEXT` |
| `richtext` | `TEXT` |
| `number` | `DOUBLE PRECISION` |
| `boolean` | `BOOLEAN` |
| `media` | `UUID REFERENCES media_assets(document_id) ON DELETE SET NULL` |
| `json` | `JSONB` |

## Table naming

`application/schema/table-naming.ts`:

- `documentTableName(slug)` → `documents_<slug_with_hyphens_underscored>` (e.g. `cv-page` → `documents_cv_page`).
- `componentTableName(slug, path)` → `components_<slug>__<path.join("_")>` (e.g. `cv-page` + `["experience", "role"]` → `components_cv_page__experience_role`). If the full name would exceed the 63-byte Postgres identifier limit, it's deterministically hash-truncated: an 8-hex-char SHA-256-derived suffix replaces the tail of the joined path segment, so the same overlong path always produces the same truncated name across repeated syncs (idempotency depends on this).
- `indexName(tableName, suffix)` — same hash-truncation pattern, added to fix a real bug (see [Known quirks](#known-quirks--deviations-preserved-intentionally)): a table name can be safely under 63 bytes on its own but still overflow once an index-name suffix (e.g. `_document_version_idx`) is appended.

## Sync engine

`application/sync/schema-differ.ts` — pure functions, no I/O:

- `diffColumns(liveColumns, desiredFields)` → `{ addColumns, dropColumns, retypeColumns }`. A desired field absent from live columns → add. A live column absent from desired fields (and not a reserved system/internal column) → drop. A live column whose Postgres data type doesn't match the desired mapping → **retype via `ALTER COLUMN ... TYPE` with a `USING` cast** if the target type is `text` (any type safely casts to text); otherwise **drop the old column and add a new one of the new type** (SPEC Open Question #2 — an incompatible retype loses that one field's data, logged as a warning; every other column is untouched). `component`-typed fields are never turned into columns.
- `diffComponentTables(previousFields, desiredFields)` / `collectComponentPaths(fields)` → the analogous add/drop plan one level up, for whole component *tables* rather than columns, by diffing the full set of nested component paths (depth-first, prefixed) between the previous and desired field trees.

`application/sync/content-type-sync.service.ts` — `ContentTypeSyncService implements OnApplicationBootstrap`:

1. `onApplicationBootstrap()` → `schemaLoader.load()` then `sync(definitions)`. `sync()` is also called directly (bypassing the filesystem) by the e2e suite to exercise "reboot-equivalent" re-syncs against hand-built definitions — see [`document.md`](document.md)'s e2e notes.
2. `sync(definitions)`: fetch every existing `ContentType` row, diff its slug set against the desired definitions' slugs.
   - For each desired definition: `syncOne(definition, previous)` — `ensureDocumentTable` (new) or `listDocumentColumns` + `alterDocumentTable(diffColumns(...))` (existing); then `syncComponentTables` (ensure/alter every desired component path, drop any path no longer desired — new paths use `ensureComponentTable` even for an *existing* content type if the path itself is new); then `create`/`update` the `ContentType` row itself (unconditional `update` even when nothing textually changed — a cheap no-op, not gated on an actual diff).
   - For each existing `ContentType` whose slug is no longer desired: `syncDeletion` — drop every component table (deepest path first, `sort((a, b) => b.length - a.length)`, so a child table never outlives its parent) and the document table, then delete the `ContentType` row.
3. **Never a `DROP TABLE` for a field-level change** — only `syncDeletion` (whole content type removed) issues drops; see [Deviations](#deviations-from-the-source-docs) item 3.
4. **Last step of `sync()`:** `await this.documentPermissions.syncForContentTypes(definitions)` — see [Document permission catalog sync](#document-permission-catalog-sync) below. Called with the full desired-definitions list (not per-`syncOne`), after both the create/update loop and the deletion loop, so it runs exactly once per `sync()` call regardless of how many content types changed.

## Document permission catalog sync

`application/services/document-permission-sync.service.ts` — `DocumentPermissionSyncService.syncForContentTypes(definitions)`, called as the last step of `ContentTypeSyncService.sync()` (same `OnApplicationBootstrap` hook, sequential call — not a second independent bootstrap provider, avoiding any cross-module bootstrap-ordering race). For every content-type definition × 6 document actions (`read`/`create`/`update`/`delete`/`publish`/`unpublish`), idempotently ensures a `Permission` row exists with slug `document:<action>:<content-type-slug>` (e.g. `document:read:cv-page`) — same `findBySlug`-guard, skip-if-present pattern as `seed-default-data.service.ts`. Calls `IPermissionRepository.create()` directly, bypassing `CreatePermissionDto`'s 2-segment `resource:action` slug regex, since these are system-managed rows, not admin-authored input (see [permissions.md](permissions.md#system-managed-scoped-permission-rows)). **Never deletes** rows for a content type removed from `content-types/*.json` — matches `ContentTypeSyncService`'s own non-destructive philosophy; an orphaned scoped slug is left in the catalog, permanently inert once nothing can match it.

`ContentTypeModule` imports `PermissionModule` for this (a new edge in the module graph — `content-type` did not previously depend on `permissions`) and registers `DocumentPermissionSyncService` as a provider.

These rows exist purely so an API access token's `permissions: string[]` can hold a scoped slug — the actual grant check (`isDocumentActionGranted`, `src/common/authorization/document-permission.util.ts`) and its enforcement on REST/GraphQL document routes live in `document.md` and `graphql.md`.

## Admin-mutable `listFields`

The one write route this module has: `PATCH content-types/:slug/list-fields`, gated on `content_type:manager` (`super_admin` only — see [Permissions catalog additions](#permissions-catalog-additions) below).

**Why a separate column, not the sync-owned `listFields`.** `ContentTypeSyncService.syncOne()` recomputes `listFields` from the JSON schema and writes it back to the DB unconditionally on **every app boot** (see [Sync engine](#sync-engine) above) — a PATCH that wrote the existing `listFields` column would be silently reverted on the very next deploy. Resolution: `listFieldsOverride Json? @map("list_fields_override")` on the `ContentType` Prisma model (migration `20260728134343_add_content_type_list_fields_override`), a column `ContentTypeSyncService` never reads or writes. `PrismaContentTypeRepository.toEntity()` is the single merge point — `listFields = record.listFieldsOverride ?? record.listFields` — so every existing consumer (`GetContentTypeService`, `SchemaResolverService` → `ListDocumentsService`, `ContentTypeSyncService`'s own diffing) sees the effective value with zero changes to their own code. Proven by construction: `content-type-sync.service.spec.ts` passes with zero edits to `content-type-sync.service.ts` itself.

**Validation** (`application/services/update-list-fields.service.ts`, `UpdateListFieldsService`): `404` (`ContentTypeNotFoundError` → `NotFoundException`) on an unknown slug; every entry in the request's `listFields` array must either be a `LISTABLE_SYSTEM_COLUMNS` name or match a `fields` entry whose `type` is in `LISTABLE_FIELD_TYPES`, else `400`. Both constants live in `domain/entities/field-definition.ts`:

- `LISTABLE_FIELD_TYPES: ReadonlySet<FieldType>` = `{"text", "number", "boolean"}` — relocated here from `document/infrastructure/persistence/sql/where-builder.ts`'s `SORTABLE_FIELD_TYPES` (same values), since `content-type` must not import from `document` (the module arrow is strictly one-way, `document → content-type` — see the module header above). `where-builder.ts`'s `sortableColumnsFor` now imports `LISTABLE_FIELD_TYPES` from here instead of defining its own copy — a pure refactor, `where-builder.spec.ts`'s existing tests pass unmodified.
- `LISTABLE_SYSTEM_COLUMNS: readonly string[]` = `["documentId", "status", "createdAt", "updatedAt", "publishedAt", "updatedBy"]` — response-DTO-facing names (camelCase), distinct from `where-builder.ts`'s SQL-column-facing `SYSTEM_SORTABLE_COLUMNS` (snake_case, untouched by this feature). Consumed by `document`'s `ListDocumentsService` to source these names from resolved row values instead of `row.fields` — see `document.md`'s [Resolved `updatedBy`](document.md#resolved-updatedby) section.

`UpdateListFieldsDto { listFields: string[] }` — `@IsArray() @ArrayNotEmpty() @IsString({ each: true })`; the empty-array case is rejected by the DTO's global `ValidationPipe` before the service ever runs, so `listFields: []` never reaches `UpdateListFieldsService`.

## Services

`application/services/list-content-type.service.ts` — `ListContentTypeService.execute()`: thin passthrough to `findAllSummaries()`.

`application/services/get-content-type.service.ts` — `GetContentTypeService.execute(slug)`: `findBySlug(slug)`, `404 NotFoundException` (wrapping `ContentTypeNotFoundError`'s message) if not found. This is the service `document`'s `SchemaResolverService` calls on every document request to resolve the live schema — no caching, always a fresh DB read (see `document.md`).

## Endpoints

`presentation/content-type.controller.ts`, `@Controller("/api/v1/content-types")`, per-route `@UseGuards(JwtAuthGuard, PermissionsGuard)`:

| Method | Path | Permission | Service | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/content-types` | `content_type:read` | `ListContentTypeService` | Returns `ContentTypeSummary[]`. |
| `GET` | `/api/v1/content-types/:slug` | `content_type:read` | `GetContentTypeService` | Full `ContentTypeEntity`; `400 BadRequestException` for an unsafe slug (caught `UnsafeSqlIdentifierError`, translated at the controller — same pattern `document`'s `validate-params.ts` reuses), `404` if no content type has that slug. |
| `PATCH` | `/api/v1/content-types/:slug/list-fields` | `content_type:manager` | `UpdateListFieldsService` | `200 ContentTypeResponseDto`, `listFields` reflects the new override. `400` (empty array, unknown field name, or a field kind not in `LISTABLE_FIELD_TYPES`), `404` (unknown slug). See [Admin-mutable `listFields`](#admin-mutable-listfields) above. |

## Module wiring

`content-type.module.ts` — `imports: [PermissionModule]` (for `DocumentPermissionSyncService`'s catalog writes, see [Document permission catalog sync](#document-permission-catalog-sync) above); registers `ContentTypeController`; providers `SchemaLoaderService`, `ContentTypeSyncService`, `DocumentPermissionSyncService`, `ListContentTypeService`, `GetContentTypeService`, `UpdateListFieldsService`, and binds `CONTENT_TYPE_REPOSITORY → PrismaContentTypeRepository` / `SCHEMA_TABLE_REPOSITORY → PrismaSchemaTableRepository`. `exports: [GetContentTypeService, CONTENT_TYPE_REPOSITORY]` — exactly what `document.module.ts` imports and injects, nothing more (`SchemaLoaderService`/`ContentTypeSyncService`/`SCHEMA_TABLE_REPOSITORY` stay module-private in normal DI resolution, though NestJS's non-strict `app.get()` can still reach them directly — used by the e2e suite, see `document.md`). Registered in `src/app.module.ts` before `DocumentModule`.

## Permissions catalog additions

`src/bootstrap/seed-default-data.service.ts` — one new slug, `content_type:read`, added to `DEFAULT_PERMISSIONS` and granted to both `super_admin` and `admin` in `DEFAULT_ROLES` (the remaining 6 new slugs this feature cycle adds are `document:*`, documented in `document.md`). Same additive, `findBySlug`-guarded seeding pattern as every prior module — **an existing dev/prod DB's `super_admin`/`admin` role predating this change will not retroactively gain the slug** without a manual `PUT /api/v1/roles/:id` or a fresh DB (see `document.md`'s e2e notes for how the test suite handles this gap).

**A later cycle** (Configure-Columns backend, `PATCH .../list-fields`) added `content_type:manager` ("Edit a content type's list-view columns"), granted to `super_admin` only — matching every other `*:manager` permission (`user`, `role`, `permission`, `api_token`, `media`), all `super_admin`-only today; `admin` only ever holds `*:read` variants. Same seeding caveat applies: a pre-existing `super_admin` role predating this addition needs a manual grant.

**A later cycle still** added the boot-time-synced, content-type-scoped `document:<action>:<content-type-slug>` rows described in [Document permission catalog sync](#document-permission-catalog-sync) above — those are not seeded into `DEFAULT_ROLES`/`DEFAULT_PERMISSIONS` at all (they're catalog-only, consumed exclusively by API access tokens, never granted to a role by default).

## Tests

Unit tests (Jest, mocked repositories/adapters via `Test.createTestingModule` + `useValue`, or plain `new` construction) live next to each source file:

- `field-definition.spec.ts` — `isComponentField` true/false; `LISTABLE_FIELD_TYPES` contains exactly `text`/`number`/`boolean`; `LISTABLE_SYSTEM_COLUMNS` contains exactly the 6 response-DTO-facing names.
- `sql-identifier.spec.ts` — slug/field-name/identifier acceptance and rejection at every boundary (length, case, hyphen position, unicode, embedded quote, injection attempt).
- `table-naming.spec.ts` — `documentTableName`/`componentTableName` derivation for both real seeds' shapes; deterministic hash-truncation for an overlong path, stable across repeated calls; `indexName`'s simple-concatenation vs. hash-truncated paths (the latter using the real `en-it-vocab` `phonetic.syllablePart` case that originally surfaced the bug).
- `field-type-mapping.spec.ts` — every `FieldType` → column-type mapping, `null` for `component`.
- `schema-validator.spec.ts` — both real seeds' 3-level shapes validate cleanly; every rejection path (unsafe slug/field/component name, reserved-name collision, unknown `listFields` reference); a definition with no `listFields` is accepted (default applied elsewhere, by the loader/sync, not the validator).
- `schema-loader.service.spec.ts` — valid JSON loads with `listFields` defaulted to the first 3 field names, or kept as explicitly specified; malformed JSON, structural-validation failure, and a missing directory all throw; non-JSON files in the directory are ignored; `load()` resolves the directory from `CONTENT_TYPES_DIR` relative to `process.cwd()`.
- `schema-differ.spec.ts` — column add/drop/retype-with-safe-cast/drop-and-add-on-incompatible-retype, system columns never touched, component fields produce no column ops, an identical schema produces an empty plan; component-table add/drop-path planning, 3-level path collection for both real seeds' shapes, an empty plan when the component shape is unchanged.
- `content-type-sync.service.spec.ts` — new file creates the document table + every component table + the `ContentType` row; changed file alters against live columns + updates the row; deleted file deletes the row and drops every table; a malformed definition throws loudly instead of silently syncing; `onApplicationBootstrap()` loads via `SchemaLoaderService` and calls `sync()`; the definition's `kind` is passed through to `ensureDocumentTable` for both `single` and `collection`; `sync()` calls `DocumentPermissionSyncService.syncForContentTypes(definitions)` (mocked) exactly once, with the full desired-definitions list, as the last step.
- `document-permission-sync.service.spec.ts` — a new content type produces exactly 6 `create()` calls (one per document action), with the expected `document:<action>:<content-type-slug>` slugs; a content type whose 6 permission rows already exist (`findBySlug` returns non-null) produces zero `create()` calls; multiple content types are synced independently.
- `prisma-content-type.repository.spec.ts` — every CRUD method's field pass-through and mapping; `P2025` → `ContentTypeNotFoundError` translation on `update`/`delete`/`updateListFields`; unrelated errors rethrow; `findAllSummaries()` selects only the 4 projected fields; `toEntity()`'s override merge — `listFieldsOverride` present wins over `listFields`, `null` falls back to it; `updateListFields()` writes only the `listFieldsOverride` column.
- `prisma-schema-table.repository.spec.ts` — every DDL statement is asserted to have every identifier quoted and no unquoted interpolation (`CREATE TABLE IF NOT EXISTS`, indexes, `ALTER TABLE` add/drop/retype clauses, `DROP TABLE IF EXISTS`, for both document and component tables); an unsafe slug is rejected before touching the database; `information_schema.columns` introspection uses a bound parameter, never string interpolation; a `single`-kind content type's table gets the extra `UNIQUE (version)` constraint, a `collection`-kind one doesn't.
- `update-list-fields.service.spec.ts` — 404 on an unknown slug; a listable system column and an eligible-kind field both accepted; a name matching neither a system column nor an eligible field → 400; every ineligible kind (`richtext`/`media`/`json`/`component`) → 400, parameterized over all four.
- `get-content-type.service.spec.ts` / `list-content-type.service.spec.ts` — passthrough + 404 translation.
- `content-type.controller.spec.ts` — `list()`/`getBySlug()` delegate to the corresponding service; an invalid slug throws `BadRequestException` without touching the service; `updateListFields()` delegates to `UpdateListFieldsService`.
- `content-type.module.spec.ts` — registers the controller, every provider (incl. `UpdateListFieldsService` and both repository token bindings), and exports exactly `GetContentTypeService` + `CONTENT_TYPE_REPOSITORY`.
- `seed-default-data.service.spec.ts` (`src/bootstrap/`) — 19 permissions / 4 roles seeded from empty; `content_type:manager` created in `super_admin`'s grant list only, absent from `admin`/`editor`/`guest`.

`test/content-engine.e2e-spec.ts` (shared with `document`, real Postgres) covers this module's boot-sync materialization and the schema-edit re-sync path end-to-end — see `document.md`'s Tests section for the full e2e breakdown.

Per project rule, no `coverageThreshold` entries were added for the Prisma repositories (`prisma-content-type.repository.ts`, `prisma-schema-table.repository.ts`) or the controller (`content-type.controller.ts`).

## Known quirks / deviations (preserved intentionally)

- **`syncOne` always calls `update()` on an existing `ContentType`, even when nothing changed** — a cheap no-op UPDATE on every boot for every unchanged content type, not gated on an actual diff of `name`/`kind`/`draftToPublish`/`fields`/`listFields`. Harmless (Postgres `UPDATE` of identical values is fast and doesn't even bump `updatedAt` meaningfully differently), but worth knowing if `updatedAt` on the `content_types` row is ever load-bearing for something.
- **`listFields` defaulting is duplicated** — both `schema-loader.service.ts`'s `loadFromDir` and `content-type-sync.service.ts`'s `syncOne` independently default `listFields` to the first 3 field names when absent. This matters because `sync()` can be called directly with hand-built `ContentTypeDefinition`s that skip the loader entirely (as the e2e suite does for its throwaway content types) — the default still applies correctly either way, just from two separate call sites instead of one.
- **Incompatible retype loses that column's data** (SPEC Open Question #2, accepted as-is for v1) — see [Sync engine](#sync-engine) above. No abort-boot-and-demand-manual-migration alternative was implemented; a warning-log-and-proceed was judged sufficient for this repo's scope.
- **The `indexName()` fix was found by this feature's own e2e suite, not by design review** — `ensureComponentTable`'s two index-creation statements (and `ensureDocumentTable`'s one) originally built index names by naive string concatenation (`` `${tableName}_document_version_idx` ``). SPEC's Open Question #3 flagged the *table*-name hash-truncation fallback as "defined but untriggered by the two seeds" — true for table names, but the real `en-it-vocab` `phonetics → syllableParts` nesting produces a *table* name (45 bytes) safely under the 63-byte limit that still overflows once an index-name suffix is appended (67 bytes), throwing `UnsafeSqlIdentifierError` and preventing the app from ever booting against real Postgres with this seed. Fixed by extending the same hash-truncation approach to derived index names via a new `indexName()` helper — a pre-existing bug in already-committed code, not introduced by the e2e work that surfaced it.
- **The `appRoot`/env-loading bug this feature's e2e work also fixed lives in `src/config/config.module.ts`, not this module** — noted here only because it was found via the same e2e run; see `document.md`'s Tests section for the actual fix.
- **`ensureDocumentTable`'s `kind` parameter only affects table creation, never `alterDocumentTable`** — a `single`-kind content type's `UNIQUE (version)` constraint is added at `CREATE TABLE` time only; there is no retroactive path that adds it to an already-existing table if a content type's `kind` were ever edited after creation. Acceptable because this sync engine's diff logic doesn't reconcile `kind` changes at all (`diffColumns`/`diffComponentTables` only ever compare `fields`) — a pre-existing, separate limitation this fix didn't attempt to solve. See `document.md`'s "Post-review hardening" section for the full rationale (this was one of two findings from this feature's mandatory five-axis review).

## Verified state

`bun run build`, `bunx tsc --noEmit`, `bunx eslint .`, and `bun run test:cov` all pass (incl. the post-review hardening fixes — see [Known quirks](#known-quirks--deviations-preserved-intentionally) and `document.md`'s "Post-review hardening" section). `bun run test:e2e` is green (`test/content-engine.e2e-spec.ts`, 10/10) against a real reachable Postgres — boot sync confirmed to materialize `documents_cv_page`/`documents_en_it_vocab` and their component tables with zero hand-written per-content-type code, and a schema edit (add/remove a field) followed by a reboot-equivalent re-sync call confirmed to preserve the untouched column's data while dropping/adding the changed ones. See `document.md` for the full e2e breakdown (this module's sync engine is exercised as the foundation every document-level test depends on).

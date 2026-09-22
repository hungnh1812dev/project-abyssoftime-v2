# Media Module

`src/modules/media/**` — clean-architecture module for uploading, listing, and deleting image assets. Fully wired: registered in `AppModule`, all three routes are HTTP-reachable, Prisma-backed, and guarded by real JWT + permission-slug authorization. Depends on [`storage`](storage.md) (`MediaModule` imports `StorageModule`) for the actual file transfer — `media` itself never talks to AWS/Cloudinary directly. Assets are **immutable** — there is no update route; the only mutations are create (upload) and hard delete.

## Deviations from the source docs

The two Go-derived design docs pasted into this feature's spec cycle describe the original Go/GORM source faithfully, but this repo has its own established conventions for a few of the same concerns. Where they conflicted, this repo's convention won (all confirmed with the user during the Spec phase):

1. **Primary key** — the docs' `gormId Int @id @default(autoincrement()) @map("gorm_id")` + `documentId String @unique` is inverted here to match `Permission`/`Role`/`AccessToken`/`User`: `documentId String @id @default(uuid()) @map("document_id")` is the real key; `id Int @default(autoincrement())` is a plain, unmapped legacy column (no `@id`, no `@unique`, no `gorm_id` name).
2. **Guard/decorator naming** — this repo already has `PermissionsGuard` + `@RequirePermissions(...)` (plural), not the docs' `PermissionGuard`/`@RequirePermission` (singular). `MediaController` uses the existing plural names.
3. **Guard placement** — no controller in this codebase uses class-level `@UseGuards`/`@RequirePermissions`; every route repeats `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)` individually (matching `role.controller.ts`), instead of the docs' class-level-plus-override shape. Functionally identical either way.
4. **No `AuthModule` import** — `TokenModule` (which `JwtAuthGuard` depends on) is `@Global`, and no other module in this repo imports an `AuthModule` for its guards (matching `role.module.ts`). `MediaModule` doesn't import one either (see [Module wiring](#module-wiring) for what it does import).
5. **Field-set inference** — the exact column list (`fileName`, `mimeType`, `size`, `width`, `height`, `url`, `thumbnailUrl`, `publicId`, `hash`, `uploadedBy`) was a best-guess inference from the spec's scattered clues (`asset.publicId`, SHA-256 hashing, PNG/JPEG dimension checks) since the source docs' exact column list wasn't preserved in the repo verbatim. Confirmed with the user to proceed this way.
6. **Schema location** — only `prisma/postgresql/schema.prisma` carries the `MediaAsset` model; at the time, the `sqlite`/`mysql` schema files were still-present stubs (same deviation the `access-tokens`/`auth`/`permissions`/`roles` cycles made, for the same reason). Both stub files and `DB_DRIVER` were later removed entirely — this repo is now postgres-only in the source, not just by default — see [dockerfile-techstack.md](./dockerfile-techstack.md) for the removal rationale.

`MediaAssetNotFoundError`/P2025 translation is **not** a deviation — it's the exact same pattern already used verbatim by `RoleNotFoundError` (`role.repository.ts` / `prisma-role.repository.ts` / `delete-role.service.ts`), copied as-is.

## Entity

`domain/entities/media-asset.entity.ts` — `MediaAssetEntity`:

| Field          | Type             |
| -------------- | ---------------- |
| `documentId`   | `string`         |
| `fileName`     | `string`         |
| `mimeType`     | `string`         |
| `size`         | `number`         |
| `width`        | `number`         |
| `height`       | `number`         |
| `url`          | `string`         |
| `thumbnailUrl` | `string`         |
| `publicId`     | `string`         |
| `hash`         | `string`         |
| `uploadedBy`   | `string \| null` |
| `createdAt`    | `Date`           |
| `updatedAt`    | `Date`           |

Maps 1:1 to the `MediaAsset` Prisma model (`prisma/postgresql/schema.prisma`, `@@map("media_assets")`, migration `20260726074800_add_media_assets`). `uploadedBy` is a nullable FK to `User.documentId` (`onDelete` not set to cascade — an asset survives its uploader's deletion, `uploadedBy` is just orphaned as a dangling string, matching the source doc's design).

## Repository

`domain/repositories/media-asset.repository.ts` — interface `IMediaAssetRepository`, DI token `MEDIA_ASSET_REPOSITORY`:

- `create(data: CreateMediaAssetData): Promise<MediaAssetEntity>`
- `findById(documentId): Promise<MediaAssetEntity | null>`
- `findByDocumentIds(documentIds: string[]): Promise<MediaAssetEntity[]>` — one `prisma.mediaAsset.findMany({ where: { documentId: { in: documentIds } } })`; missing ids are simply absent from the result (no `null` padding — the caller, `GraphqlContextFactory`'s `DataLoader` batch function, maps results back to key order itself). Used by the GraphQL media field resolver's per-request `DataLoader` to batch what would otherwise be one lookup per resolved object — see [`graphql.md`](graphql.md#resolvers).
- `findAll(): Promise<MediaAssetEntity[]>` — ordered `createdAt: "desc"` (newest first).
- `delete(documentId): Promise<void>` — throws `MediaAssetNotFoundError` on a caught Prisma `P2025`.

`MediaAssetNotFoundError` is a plain `Error` subclass (`name = "MediaAssetNotFoundError"`), thrown by `infrastructure/persistence/prisma-media.repository.ts` (`PrismaMediaRepository`) and translated to `NotFoundException` in the service layer — copying `RoleNotFoundError`'s pattern exactly (see [Deviations](#deviations-from-the-source-docs) item 4 above).

## Image dimension sniffing

`application/util/image-dimensions.util.ts` — `getImageDimensions(buffer: Buffer): ImageDimensions`, a pure function with no I/O, no framework imports:

1. **PNG**: checks the 8-byte PNG signature (`0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a`), then reads width/height as big-endian `UInt32` at fixed offsets 16/20 within the mandatory `IHDR` chunk (always the first chunk in a valid PNG).
2. **JPEG**: checks the `0xff 0xd8` SOI marker, then walks the marker segments. Markers with no payload (`0xd8`/`0x01`, and the `0xd0`–`0xd7` RST range) are skipped by fixed offset; every other marker's segment length is read as big-endian `UInt16`. On hitting a SOF marker (`0xc0`–`0xc3`, `0xc5`–`0xc7`, `0xc9`–`0xcb`, `0xcd`–`0xcf` — baseline through progressive/arithmetic, excluding the DHT/DAC-adjacent `0xc4`/`0xc8`/`0xcc` values which aren't SOF markers), reads height/width as big-endian `UInt16` at offsets 5/7 into that segment and returns immediately; otherwise skips past the segment (`offset += 2 + segmentLength`) and continues.
3. Throws `UnsupportedImageFormatError` for anything else (wrong signature, malformed segment structure, or a JPEG with no SOF marker found before the buffer runs out).

Both branches are pure buffer-offset arithmetic — no third-party image library is used or needed for this repo's scope (dimension checks only, not full decoding).

## Services & business rules

All services inject `@Inject(MEDIA_ASSET_REPOSITORY)`; `Upload`/`Delete` additionally inject `@Inject(STORAGE_ADAPTER)` (cross-module, via `MediaModule` importing `StorageModule`).

**Upload** (`UploadMediaService.execute(input)`, `input: { buffer, fileName, mimeType, uploadedBy }`) — order is load-bearing, each step gates the next:

1. **Size check first**: `input.buffer.length > MEDIA_MAX_UPLOAD_BYTES` (typed config, `ConfigService<EnvironmentVariables, true>` + `{ infer: true }`, already defined in `env.validation.ts` — default 10 MB, no schema change needed for this feature) → `413 PayloadTooLargeException`. Storage is never touched. This is a second, defense-in-depth check — see [Multipart handling](#multipart-handling) below for the Multer-level limit that rejects an oversized upload before it's even fully buffered.
2. **Dimension/format check second**: `getImageDimensions(input.buffer)` — a thrown `UnsupportedImageFormatError` becomes `422 UnprocessableEntityException`; any other thrown error propagates uncaught. Storage is still never touched at this point. A JPEG whose SOF marker segment is truncated is bounds-checked and also throws `UnsupportedImageFormatError` (→ 422), not a raw `RangeError` (→ 500).
3. **Canonicalize third**: the caller-supplied `mimeType`/`fileName` are **not trusted** past this point. `getCanonicalMimeType(dimensions.format)` and `withCanonicalExtension(input.fileName, dimensions.format)` (both in `image-dimensions.util.ts`) derive a `mimeType`/extension from the format actually sniffed in step 2 — e.g. a PNG uploaded with a spoofed `mimeType: "text/html"` and `fileName: "x.html"` is stored as `image/png`/`x.png`. This closes a stored-content-type-spoofing gap: without it, a PNG/JPEG polyglot uploaded with an attacker-chosen `mimeType` would have been written to the storage provider (and served back) with that attacker-chosen `Content-Type`.
4. **Storage upload fourth**: `storage.upload({ buffer, fileName: <canonical fileName>, mimeType: <canonical mimeType> })` — only reached once all prior checks pass, and using the canonicalized values from step 3, not `input.fileName`/`input.mimeType` directly.
5. **Hash fifth**: SHA-256 of the raw buffer via `createHash("sha256").update(buffer).digest("hex")` (same pattern as `access-token-secret.util.ts`'s token hashing) — computed **after** the storage call, from the original buffer, not derived from anything storage returns.
6. **Persist last**: `mediaAssets.create({...})` with `fileName: input.fileName` (the original caller-supplied name is kept here, as harmless display metadata — only the _storage_ fileName/mimeType are canonicalized), `mimeType: <canonical mimeType>` (the detected type, not the caller-supplied one), `size` taken from `buffer.length` (not from any caller-supplied field — trusts the actual bytes), `width`/`height` from step 2, `url`/`thumbnailUrl`/`publicId` from step 4's `UploadResult`, `hash` from step 5, `uploadedBy` passed through as-is (`string | null`).

**List** (`ListMediaService.execute()`) — thin passthrough to `findAll()`. No pagination, no filtering — matches the source doc's scope.

**Delete** (`DeleteMediaService.execute(documentId)`), copying `DeleteRoleService`'s existence-check-then-translate shape exactly:

1. `404 NotFoundException` if `findById(documentId)` returns `null`.
2. `storage.delete(asset.publicId)` — **deliberately uncaught**. If storage delete fails (network error, provider outage, wrong credentials), the exception propagates straight out of `execute()` as an unhandled 500, and the DB row is **not** touched. This is the one place in the module where an error is intentionally left unwrapped, per the source doc: a storage failure must never silently drop a DB row while the underlying file still exists in the provider.
3. Only if step 2 succeeds: `mediaAssets.delete(documentId)`, with a second `MediaAssetNotFoundError → NotFoundException` translation guarding a delete-after-check race (asset deleted by another request between step 1's check and this call).

## Endpoints

`presentation/media.controller.ts`, `@Controller("/api/v1/media")`, per-route `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)`:

| Method   | Path                   | Service              | Required permission | Notes                                                                                                                                                                     |
| -------- | ---------------------- | -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/media`           | `ListMediaService`   | `media:read`        | Returns the full `MediaAssetEntity[]`, newest first.                                                                                                                      |
| `POST`   | `/api/v1/media/upload`    | `UploadMediaService` | `media:manager`     | `multipart/form-data`, field name `file`; `400 BadRequestException` if no file part is present; `uploadedBy: req.user.sub` (always non-null — `JwtAuthGuard` runs first). |
| `DELETE` | `/api/v1/media/:id` (204) | `DeleteMediaService` | `media:manager`     | Hard delete; storage object removed before the DB row (see [Delete](#services--business-rules) above); `404` if not found.                                                |

### Multipart handling

`@UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))` — the `storage: memoryStorage()` option is **explicit and required**: Multer's own default is disk storage, which would populate `file.path` instead of `file.buffer`, breaking every downstream step (`UploadMediaService` needs the raw buffer for size/dimension checks, storage upload, and hashing).

`media.module.ts` also registers `MulterModule.registerAsync({ useFactory: (configService) => ({ limits: { fileSize: configService.get("MEDIA_MAX_UPLOAD_BYTES", { infer: true }) } }), inject: [ConfigService] })`. Nest's `FileInterceptor(fieldName, localOptions)` shallow-merges its per-route `localOptions` over the module-level `MulterModuleOptions` (`multer({ ...options, ...localOptions })` — confirmed by reading `@nestjs/platform-express`'s `FileInterceptor` source), so the route's `{ storage: memoryStorage() }` and the module's `{ limits: { fileSize } }` both apply to the same underlying `multer()` instance without either overriding the other. This means Multer itself rejects an oversized upload — as a `413`, via `@nestjs/platform-express`'s `transformException` — before the request body is even fully buffered, rather than relying solely on the app-level check in step 1 of [Upload](#services--business-rules) above (which only runs after the whole file is already in memory as `file.buffer`).

#### No `@types/multer`

`multer` itself ships transitively via `@nestjs/platform-express` (already in `node_modules`) — no direct dependency was added. Instead of `@types/multer`'s `Express.Multer.File`, the controller hand-rolls a local `UploadedMulterFile` interface (`{ buffer: Buffer; originalname: string; mimetype: string; size: number }`) with just the fields it actually reads, matching the source doc's explicit design decision to avoid the type dependency.

## Environment variables

`MEDIA_MAX_UPLOAD_BYTES` already existed in `env.validation.ts` before this feature (default 10 MB) — no change needed.

`STORAGE_PROVIDER`, `AWS_REGION`, `AWS_S3_BUCKET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` belong to `storage`, not `media` — see [`storage.md`](storage.md#storage_provider-aws_-cloudinary_-are-deliberately-untyped) for why they're deliberately absent from `EnvironmentVariables`.

## Module wiring

`media.module.ts` imports `StorageModule` and a `MulterModule.registerAsync(...)` (see [Multipart handling](#multipart-handling) above) — no `AuthModule`, no `PermissionModule` — guards resolve permissions off the JWT payload, not a live DB lookup. It registers `MediaController` and all three services, and binds `MEDIA_ASSET_REPOSITORY → PrismaMediaRepository`. Imported into `src/app.module.ts` alongside `StorageModule`.

## Permissions catalog additions

`src/bootstrap/seed-default-data.service.ts` — two new slugs added to `DEFAULT_PERMISSIONS` (`media:manager`, `media:read`), granted to `super_admin` and `admin` respectively in `DEFAULT_ROLES` — same additive, `findBySlug`-guarded seeding pattern as every other resource pair (see `access-tokens.md`'s equivalent note: **existing dev/prod databases seeded before this change will not retroactively gain these permissions on an already-existing `super_admin`/`admin` role** without a manual `PUT /api/v1/roles/:id` or a fresh DB).

## Tests

Unit tests (Jest, mocked repositories/adapters via `Test.createTestingModule` + `useValue`, or plain `new` construction) live next to each source file:

- `image-dimensions.util.spec.ts` — PNG `IHDR` width/height/format; baseline JPEG SOF0 (skipping an APP0 segment); progressive JPEG SOF2; `UnsupportedImageFormatError` for a non-image buffer, for an empty buffer, and for a JPEG truncated right after its SOF marker's length field (regression test for a previously-uncaught `RangeError`, see [Known quirks](#known-quirks--deviations-preserved-intentionally) below).
- `upload-media.service.spec.ts` — `413` over the size limit (storage/repository never touched); `422` for a non-image buffer (storage/repository never touched); happy path (uploads to storage, hashes, persists mapped metadata); storage-before-persist ordering; `uploadedBy: null` passthrough when no uploader is known; a spoofed `mimeType`/extension (e.g. `text/html`/`.html` on real PNG bytes) is ignored — storage and the persisted entity both get the canonical `image/png`/`.png` derived from the sniffed format, not the caller's input.
- `list-media.service.spec.ts` — returns all assets from the repository, passthrough.
- `delete-media.service.spec.ts` — `404` when the target doesn't exist; a storage-delete failure propagates **uncaught** and does _not_ delete the DB row; `MediaAssetNotFoundError` from the repository translates to `NotFoundException`; unrelated repository errors rethrow unchanged; happy path deletes storage by `publicId` then the DB row by `documentId`.
- `prisma-media.repository.spec.ts` — `findAll` ordering + entity mapping; `findById` found/not-found; `findByDocumentIds` batches multiple ids via one `findMany`, omits unmatched ids, and returns `[]` for empty input without matching everything; `create` passes every field through (including `uploadedBy: null`); `delete` removes the record, translates a caught `P2025` into `MediaAssetNotFoundError`, and rethrows unrelated errors.
- `media.controller.spec.ts` — `list()`/`upload()`/`delete()` delegate to the corresponding service; `upload()` throws `BadRequestException` when no file is attached.
- `media.module.spec.ts` — imports `StorageModule` and a `MulterModule` registered with `MEDIA_MAX_UPLOAD_BYTES` as the `fileSize` limit; registers `MediaController`; registers the three services and binds the repository token to `PrismaMediaRepository`.

`test/media.e2e-spec.ts` (new shared e2e infra, see below) — real Postgres, `STORAGE_ADAPTER` overridden with `NoopStorageAdapter`:

- `401` unauthenticated `GET /api/v1/media`.
- Upload success with a `media:manager` token — response shape, `storage.uploads` recorded.
- `413` for an upload over `MEDIA_MAX_UPLOAD_BYTES`, with `storage.uploads` unchanged (never touched).
- `422` for a non-image upload, with `storage.uploads` unchanged (never touched).
- `403` upload attempt from a `media:read`-only token.
- List reachable by a `media:read`-only token.
- Delete removes both the storage object (`storage.deletes` contains the `publicId`) and the DB row.
- `403` delete attempt from a `media:read`-only token.
- `404` deleting an unknown `documentId`.
- Forced storage-delete failure (`NoopStorageAdapter.failNextDelete()`) surfaces as `500` and leaves the DB row intact — the e2e-level proof of the uncaught-storage-delete ordering documented above.

Per project rule, no `coverageThreshold` entries were added for the Prisma repository (`prisma-media.repository.ts`) or the controller (`media.controller.ts`).

### New shared e2e infrastructure

Two new `test/utils/*` files, not media-specific — the first reusable e2e helpers in this repo (existing `test/app.e2e-spec.ts` builds its `TestingModule` inline and never calls `configureApp`, so it has no `ValidationPipe`/`cookie-parser`; copying that pattern verbatim would have silently broken cookie-based `JwtAuthGuard` and multipart validation in the new suite):

- `test/utils/app-test.util.ts` — `bootTestApp(configureModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder)`: builds `Test.createTestingModule({ imports: [AppModule] })`, applies the optional override callback (used by `media.e2e-spec.ts` to `overrideProvider(STORAGE_ADAPTER).useValue(storage)`), compiles, then calls `configureApp(app)` (the real bootstrap config — `ValidationPipe`, cookie parsing, etc.) before `app.init()`.
- `test/utils/noop-storage.adapter.ts` — `NoopStorageAdapter implements StorageAdapter`: records every `upload`/`delete` call (`uploads: UploadFile[]`, `deletes: string[]`) instead of touching a real provider, returns a deterministic `noop://media/${fileName}` URL/`publicId`. `failNextDelete()` arms a one-shot rejection on the next `delete()` call, auto-resetting after firing — used to test the uncaught storage-delete-failure path above without a real provider outage.

`media.e2e-spec.ts` creates its own users directly via `PrismaService` + `JwtTokenService.signAccessToken(...)` against the seeded `super_admin`/`admin` roles (no HTTP register/verify-otp/login round-trip needed, since `JwtAuthGuard` only verifies the JWT — it never re-queries the DB for the user). A `randomUUID().slice(0, 8)` `runId` suffix on email/username avoids collisions with leftover rows from a prior incomplete run; `afterAll` cleans up every user/media row it created.

**Confirmed green (11/11)** against the user's own reachable Postgres. Note: the app only loads env from `.env.test.local`/`.env.local` (`src/config/config.module.ts`), never plain `.env` — `bun --env-file=.env.local run test:e2e` (or populating `.env.local` directly) is required for `bun run test:e2e` to see real config. Getting to green also required one one-off fix unrelated to this module's code: the target dev DB's `super_admin`/`admin` roles pre-dated this cycle's `media:manager`/`media:read` permissions, and `SeedDefaultDataService` doesn't retroactively add new permission slugs to a role that already exists (see [Permissions catalog additions](#permissions-catalog-additions) above) — granted via two real `PUT /api/v1/roles/:id` calls.

## Known quirks / deviations (preserved intentionally)

- No soft-delete — `delete` is a real hard `DELETE`, matching the "assets are immutable, deletion is permanent" design; no `deletedAt` column exists.
- `DeleteMediaService`'s check-then-act (`findById` then `storage.delete` then `mediaAssets.delete`) has no transaction wrapping across the storage call — a concurrent delete of the same asset between the initial check and the storage call could attempt to delete an already-gone storage object. Acceptable per the source doc's explicit ordering requirement (storage-before-DB, uncaught) — the alternative (wrapping in a DB transaction) can't span an external HTTP call to S3/Cloudinary anyway.
- `size` on `CreateMediaAssetData` is always derived from `buffer.length` server-side, never trusted from a client-supplied field — there is no client-supplied size field to begin with (Multer sets `file.size`, but `UploadMediaService` deliberately reads `input.buffer.length` instead).

## Post-review hardening

A five-axis code review (`agent-skills:code-reviewer`) flagged three Important findings on the initial implementation, all fixed:

1. **Memory-exhaustion DoS** — `FileInterceptor` had no `limits.fileSize`, so `MEDIA_MAX_UPLOAD_BYTES` was only enforced by `UploadMediaService` _after_ Multer had already buffered the entire upload into memory. Fixed by registering `MulterModule.registerAsync(...)` in `media.module.ts` with `limits: { fileSize: <MEDIA_MAX_UPLOAD_BYTES> }` — see [Multipart handling](#multipart-handling) above. The app-level check in `UploadMediaService` stays in place as a second layer, not replaced.
2. **Uncaught `RangeError` on a truncated JPEG** — `readJpegDimensions` read the SOF payload's height/width without bounds-checking first, so a JPEG cut off right after its SOF marker's length field crashed with a raw `RangeError` (→ unhandled 500) instead of `UnsupportedImageFormatError` (→ 422). Fixed with a bounds check before the payload read.
3. **Spoofed `mimeType`/extension reaching storage** — `UploadMediaService` previously passed the caller-supplied `mimeType`/`fileName` straight to `storage.upload(...)` and persisted them as-is, trusting client input past the point where the actual image format had already been sniffed. A PNG/JPEG polyglot uploaded with `mimeType: "text/html"` would have been stored with that attacker-chosen `Content-Type` — a potential stored-XSS vector if the storage provider/CDN serves objects with their stored content-type. Fixed: `getCanonicalMimeType`/`withCanonicalExtension` (`image-dimensions.util.ts`) derive the storage `mimeType`/extension from the format `getImageDimensions` actually detected; see step 3 of [Upload](#services--business-rules) above. The caller-supplied `fileName` is still kept verbatim in the persisted entity's `fileName` field as harmless display metadata — only the values sent to storage and the persisted `mimeType` are canonicalized.

Two Suggestion-level findings from the same review were **not** applied (left as accepted, documented tradeoffs, not defects): the S3 key's file extension is derived from `extname(fileName)` without an explicit whitelist (already unexploitable for path traversal — `extname` can't return a path separator — and now doubly moot since extension #3 above forces a canonical `.png`/`.jpg`); and `hash` has no supporting DB index (purely forward-looking, since nothing queries by `hash` today — see [Known quirks](#known-quirks--deviations-preserved-intentionally) above).

## Verified state

`bun run build`, `bunx tsc --noEmit`, `bunx eslint .`, and `bun run test:cov` all pass, including the post-review hardening fixes above (74 suites, 358 tests). `bun run test:e2e` for `media.e2e-spec.ts` is confirmed green (11/11) against the user's own reachable Postgres (see [Tests](#tests) above). A live walkthrough against `bun run start:dev` and a real Cloudinary account (`STORAGE_PROVIDER` unset, defaulting to `cloudinary`) confirmed upload → list → delete end-to-end: the uploaded file resolved to a real, independently-fetchable `res.cloudinary.com` URL, and deleting the asset removed both the DB row and the actual Cloudinary object (the URL 404s afterward). The S3 path is covered by `s3-storage.adapter.spec.ts`/`lazy-storage.adapter.spec.ts` but was not separately live-verified.

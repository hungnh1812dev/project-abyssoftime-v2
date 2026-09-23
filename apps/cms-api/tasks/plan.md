# Plan: cms-api Helmfile deployment + GHCR image pipeline

Spec: [`SPEC.md`](../SPEC.md) (approved, 2026-09-23)
Status: **IN PROGRESS** — re-planned onto the latest `helmfile-chart-template` (unpinned)
Task list: [`tasks/todo.md`](todo.md)

---

## Context

The spec replaces the current hand-written, uncommitted k8s manifests
(`apps/cms-api/k8s/deployment.yaml`, `service.yaml`) with a **helmfile-driven** deployment, backed by
the shared, externally published `helmfile-chart-template` Helm chart (also reusable by
`cms-admin`/`frontend` later). CI currently deploys cms-api only via a Render webhook; this adds a
second path that builds the existing multi-stage `Dockerfile`'s `runner` and `migrator` targets and
pushes both to GHCR, gated by a repo variable so the Render path is untouched by default. The user pulls the new image and runs
`helmfile apply` by hand — no cluster access from CI.

Confirmed naming (chart-derived): `appName=abyssoftime`, `serviceName=cms-api`,
`appNamespace=abyssoftime`, `appEnv=prod` → Deployment/Service `abyssoftime-cms-api-prod`, namespace
`abyssoftime-prod`, secret `abyssoftime-cms-api-secrets-prod`. GHCR image path
`ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, two tags per push (runner + `-migrate` suffix
for the migrator target). CI flag: `vars.CMS_API_DEPLOY_MODE` (`ghcr` opts in; unset/`render` keeps
today's behavior).

Reusable pieces already in place, confirmed by reading the code:

- `apps/cms-api/Dockerfile` already has both `runner` (default) and `migrator` targets — no Dockerfile
  changes needed, only two different `--target` builds in CI.
- `apps/cms-api/k8s/secret.example.yaml` already has the right *keys* (`PORT`, DB/storage/email vars)
  — only the `Namespace`/`Secret` **names** need renaming to the new convention.
- `.github/workflows/ci.yml`'s `change-detecter` → `cms-api-build` job chain is reused as the
  dependency for the new GHCR job, matching how `deploy-cms-api` already hooks in today.
- `src/main.ts:10` reads `process.env.PORT` only — there is no `APP_PORT` env var in the app. The
  chart's `appPort` value is a separate, non-secret template input (drives `containerPort` and the
  Service port); it must be kept in sync by hand with the Secret's `PORT` key.

**Chart source changed (2026-09-23, user follow-up):** the user published a standalone, shared chart,
`oci://ghcr.io/hungnh1812dev/helmfile-chart-template`. Version `0.2.0` adds `initContainers` (plain
container specs) and `secrets.enabled` (`envFrom` a pre-existing
`<appName>-<serviceName>-secrets-<appEnv>` Secret on the app and every init container). `0.3.0` adds
optional httpGet probes (`probes.enabled`, `probes.{liveness,readiness}`, default path `/healthz`)
and changes the default `image.pullPolicy` to `Always`. It replaces
the in-repo `charts/app-template/` and its `helm-chart-publish` CI job. Those phases were done and
committed (`c7cc99b`, `817bccc`) and are now archived as superseded in `tasks/archive.md`. They are
removed in Phase 0. Differences from `app-template` that change the plan:

- All names gain an `-<appEnv>` suffix, and the chart **fails** the render unless the release
  namespace equals `<appNamespace>-<appEnv>`.
- The Secret name is fixed by the chart (no override).
- The Service exposes `appPort` directly (`3000 → 3000`, was `80 → http`).
- Probe paths default to `/healthz`, so cms-api overrides them with `/health` and carries over the
  old manifest's timings.
- The chart's `image.pullPolicy` (default `Always` as of 0.3.0) covers only the main container. The
  `migrate` init container's `latest-migrate` tag isn't exactly `latest`, so Kubernetes would default
  it to `IfNotPresent`; cms-api sets `imagePullPolicy: Always` on it explicitly.

The chart is already published, so Phase 2 is no longer blocked on a first publish.

**Version policy (user decision, 2026-09-23):** consume the **latest** chart version. There is no
`version:` in `helmfile.yaml`, so chart changes the user publishes later (e.g. probes) reach cms-api
without edits here. Verified with helmfile v1.5.2: an unversioned OCI chart resolves to the newest
tag, but helmfile then caches it and skips refreshing it on later runs. The operator flow must be
`helmfile cache cleanup && helmfile apply`. A semver range (`">=0.2.0"`) caches the same way, so it
isn't used.

## Dependency graph

```
Phase 0 — Switch to the published chart
  T0a Align SPEC.md with the latest helmfile-chart-template (names, inputs, unpinned, probes)
  T0b Remove charts/app-template/ + helm-chart-publish CI job (ask before delete)
        │
        ▼
  CHECKPOINT 0 — spec matches chart; in-repo chart + publish job gone

Phase 2 — cms-api's helmfile release
  T4 apps/cms-api/helmfile.yaml + apps/cms-api/k8s/values.yaml (chart:
     oci://ghcr.io/hungnh1812dev/helmfile-chart-template, no version = latest; real cms-api values,
     secrets.enabled, migrate init container, /health probes)
        │
        ▼
  T5 apps/cms-api/k8s/secret.example.yaml — rename Namespace/Secret to abyssoftime-prod /
     abyssoftime-cms-api-secrets-prod
        │
        ▼
  T6 Remove old apps/cms-api/k8s/deployment.yaml + service.yaml (ask before delete)
        │
        ▼
  CHECKPOINT B — helmfile render supersedes the old manifests (incl. /health probes); old raw
                 manifests removed with explicit confirmation

Phase 3 — CI/CD for cms-api images (independent of Phase 2; after T0b since same ci.yml)
  T7 New cms-api-ghcr-publish job (build+push runner & migrator targets, gated on
     vars.CMS_API_DEPLOY_MODE == 'ghcr')
        │
        ▼
  T8 Gate existing deploy-cms-api (Render) job so it still runs by default (unset/'render')
        │
        ▼
  CHECKPOINT C — ci.yml diff reviewed line-by-line: cms-admin/frontend jobs untouched, existing
                 cms-api jobs unchanged except the one added `if` gate, new job correctly scoped,
                 YAML valid

Phase 4 — Docs & wrap-up (after Checkpoints B, C)
  T9 docs/documents/cms-api-k3s-deployment.md
  T10 docs/documents/cms-api-k3s-deployment-techstack.md
  T11 apps/cms-api/docs/ENTRYPOINT.md index entries
        │
        ▼
  CHECKPOINT D — Review & cleanup
  T12 Five-axis review
  T13 Reduce apps/cms-api/SPEC.md to a minimal pointer
  T14 Explicit commit confirmation
```

## Risks / open items carried from the spec

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `appPort` (chart value) vs. `PORT` (secret key) can drift — the chart can't enforce they match | Medium — a mismatch breaks Service routing silently | Documented explicitly in T4 (inline comment) and T9 (module doc); `3000` matches today's secret |
| Chart probe path defaults to `/healthz`, but cms-api serves `/health` | High if missed — liveness fails, and the pod restarts in a loop | T4 overrides both probe paths; the acceptance criteria check the rendered path |
| `latest-migrate` init image defaults to `IfNotPresent` (only an exact `latest` tag defaults to `Always`) | Medium — the migrator silently runs stale migrations | T4 sets `imagePullPolicy: Always` on the init container explicitly |
| The chart is unpinned, so a breaking chart release (renamed/required values) lands on the next cms-api deploy | Medium — `helmfile apply` could fail or render differently with no change in this repo | Always run `helmfile cache cleanup && helmfile diff` before `apply` (documented in T9). The chart's `values.schema.json` makes most breakages fail loudly at render time |
| helmfile caches an unversioned OCI chart and skips refreshing it | Medium — "latest" silently sticks to the first fetched version | `helmfile cache cleanup` before every deploy, in the `helmfile.yaml` comment and T9 |
| Image tag scheme (`latest` + short-SHA) wasn't explicitly specified by the user | Low — easy to change later | Called out in T4/T7; adjust before Checkpoint C if the user wants something else |
| Deleting the in-repo chart (T0b) and the old raw manifests (T6) is destructive | Low-Medium — the chart is recoverable from git history; the raw manifests are untracked | Ask explicit confirmation before each delete, per the global rule |

No `helm`/`helmfile apply` (or any cluster-mutating command) runs as part of this plan — every
verification step is `lint`/`template`/`diff`, read-only against the user's cluster.

## Open Questions

None.

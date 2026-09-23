# Plan: cms-api Helmfile deployment + GHCR image pipeline

Spec: [`SPEC.md`](../SPEC.md) (approved, 2026-09-23)
Status: **NOT STARTED**
Task list: [`tasks/todo.md`](todo.md)

---

## Context

The spec replaces the current hand-written, uncommitted k8s manifests
(`apps/cms-api/k8s/deployment.yaml`, `service.yaml`) with a **helmfile-driven** deployment, backed by
a reusable Helm chart at the repo root so other apps (`cms-admin`, `frontend`) can reuse it later. CI
currently deploys cms-api only via a Render webhook; this adds a second path that builds the existing
multi-stage `Dockerfile`'s `runner` and `migrator` targets and pushes both to GHCR, gated by a repo
variable so the Render path is untouched by default. The user pulls the new image and runs
`helmfile apply` by hand — no cluster access from CI.

Confirmed naming (from spec): `appName=abyssoftime`, `servicePostfix=cms-api` → service/release
`abyssoftime-cms-api`, namespace `abyssoftime-prod`, secret `abyssoftime-cms-api-secrets`. GHCR path
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
  chart's `appPort` value is a separate, non-secret template input (drives `containerPort`/probes/
  `Service.targetPort`); it must be kept in sync by hand with the Secret's `PORT` key. Surfaced as an
  open question in the spec with no objection — proceeding on that basis.

## Dependency graph

```
Phase 1 — charts/app-template (generic Helm chart)
  T1 Chart.yaml + values.yaml + _helpers.tpl (naming plumbing)
        │
        ▼
  T2 templates/deployment.yaml + templates/service.yaml (init container + main container + Service)
        │
        ▼
  CHECKPOINT A — helm lint clean; helm template with generic sample values renders expected
                 Deployment/Service names, envFrom, ports, init container

Phase 2 — cms-api's helmfile release
  T3 apps/cms-api/helmfile.yaml + apps/cms-api/k8s/values.yaml (real cms-api values)
        │
        ▼
  T4 apps/cms-api/k8s/secret.example.yaml — rename Namespace/Secret to abyssoftime-prod /
     abyssoftime-cms-api-secrets
        │
        ▼
  T5 Remove old apps/cms-api/k8s/deployment.yaml + service.yaml (ask before delete)
        │
        ▼
  CHECKPOINT B — chart output for cms-api values matches/supersedes the old manifests; secret
                 template renamed; old raw manifests removed with explicit confirmation

Phase 3 — CI/CD (independent of Phase 1/2, can run in parallel)
  T6 New cms-api-ghcr-publish job (build+push runner & migrator targets, gated on
     vars.CMS_API_DEPLOY_MODE == 'ghcr')
        │
        ▼
  T7 Gate existing deploy-cms-api (Render) job so it still runs by default (unset/'render')
        │
        ▼
  CHECKPOINT C — ci.yml diff reviewed line-by-line: cms-admin/frontend jobs untouched, existing
                 cms-api jobs unchanged except the one added `if` gate, new job correctly scoped,
                 YAML valid

Phase 4 — Docs & wrap-up (after Checkpoints A-C)
  T8 docs/documents/cms-api-k3s-deployment.md
  T9 docs/documents/cms-api-k3s-deployment-techstack.md
  T10 apps/cms-api/docs/ENTRYPOINT.md index entries
        │
        ▼
  CHECKPOINT D — Review & cleanup
  T11 Five-axis review
  T12 Reduce apps/cms-api/SPEC.md to a minimal pointer
  T13 Explicit commit confirmation
```

## Risks / open items carried from the spec

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `appPort` (chart value) vs. `PORT` (secret key) can drift — the chart can't enforce they match | Medium — a mismatched port breaks probes/Service routing silently | Documented explicitly in T3 (inline comment) and T8 (module doc); default `3000` matches today's secret |
| Image tag scheme (`latest` + short-SHA) wasn't explicitly specified by the user | Low — easy to change later | Called out in T3/T6; adjust before Checkpoint C if the user wants something else |
| Deleting the old raw manifests (T5) is destructive on untracked files | Low-Medium — could discard in-progress edits | Ask explicit confirmation before deleting, per global rule; cross-check chart output first |

No `helm`/`helmfile apply` (or any cluster-mutating command) runs as part of this plan — every
verification step is `lint`/`template`/`diff`, read-only against the user's cluster.

## Open Questions

None outstanding — the naming, migration-image, GHCR path, and CI-flag decisions were confirmed
during the Specify phase (see `SPEC.md`'s "Assumptions" section).

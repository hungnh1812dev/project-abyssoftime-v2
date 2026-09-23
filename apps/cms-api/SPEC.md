# Spec: `cms-api` — Helmfile-based k3s deployment + GHCR image pipeline

Date: 2026-09-23 (revised same day: switched from an in-repo chart to the shared published
`helmfile-chart-template`)
Target app: `apps/cms-api` only (`cms-admin`/`frontend` are not touched).

---

## Objective

Replace the current ad-hoc, hand-written k8s manifests (`apps/cms-api/k8s/deployment.yaml`,
`service.yaml`) with a **helmfile-driven deployment** so releasing a new cms-api build to the user's
k3s cluster is a single `helmfile apply` instead of manually editing/reapplying raw YAML. CI stops
depending on the Render webhook for cms-api and instead builds and pushes the production image (and
a Prisma-migration variant of it) to GHCR; the user runs helmfile by hand.

### User stories

- **As the operator**, I run `helmfile apply` in `apps/cms-api/` and get a Deployment (with a
  migration init container that runs `prisma migrate deploy` before the app container starts, and
  `/health` readiness/liveness probes) and a Service, without hand-editing any k8s YAML.
- **As the operator**, when I later add `cms-admin` or `frontend` to k3s, I reuse the same shared
  published chart with different values instead of writing a new chart.
- **As the operator**, I apply `apps/cms-api/k8s/secret.yaml` myself (from the committed
  `secret.example.yaml` template) before running helmfile — CI and the chart never see or generate
  real secret values.
- **As the operator**, after CI pushes new images to GHCR, I roll them out by hand. There is no
  automatic cluster deploy from CI.
- **As a maintainer**, the existing Render-webhook deploy for cms-api keeps working untouched unless
  I explicitly flip a repo variable to switch that app over to the new GHCR flow.

### Non-goals

- Migrating `cms-admin` or `frontend` onto k3s/helmfile.
- Maintaining the chart itself. `helmfile-chart-template` lives in its own repo; this repo only
  consumes it.
- Automatic cluster deploy from CI (no `kubectl`/`helmfile apply` runs in GitHub Actions).
- Ingress/TLS. The Service stays ClusterIP-only, because ingress-nginx is broken on the user's
  cluster.
- Multi-environment support (staging, etc.): a single `appEnv: prod`.
- Changing `main.ts`'s `process.env.PORT` runtime contract or any other application code.

---

## Decisions

1. **Chart**: the shared, externally published `oci://ghcr.io/hungnh1812dev/helmfile-chart-template`,
   **unpinned**. `helmfile.yaml` has no `version:`, so each deploy uses the latest published chart
   (0.3.0 at the time of writing), and chart improvements reach cms-api without edits here. This
   replaces the in-repo `charts/app-template/` chart and its CI publish job, which are removed.
   - **Cache caveat (verified, helmfile v1.5.2):** helmfile caches an unversioned OCI chart and skips
     refreshing it on later runs. Always run `helmfile cache cleanup` before `diff`/`apply`. A semver
     range (`">=x"`) caches the same way, so it is not used.
   - **Trade-off accepted:** deploys are less reproducible, and a breaking chart release lands on the
     next deploy. `helmfile diff` before every `apply` and the chart's `values.schema.json` catch
     most breakages before anything is applied.
2. **Naming**: the chart derives every name from four inputs: `appName: abyssoftime`,
   `serviceName: cms-api`, `appNamespace: abyssoftime`, `appEnv: prod`.
   - Deployment/Service: `abyssoftime-cms-api-prod`
   - Namespace: `abyssoftime-prod`. The chart **fails** the render unless the release namespace equals
     `<appNamespace>-<appEnv>`, so `helmfile.yaml` sets exactly that.
   - Secret: `abyssoftime-cms-api-secrets-prod`. It is fixed by the chart (no override) and loaded via
     `envFrom` into the app and every init container when `secrets.enabled: true`. The chart never
     creates it.
3. **Migration image**: CI builds and pushes **two** image tags from the existing multi-stage
   `Dockerfile`. The `runner` target is used by the main container, and the `migrator` target only
   by the init container. The `runner` image cannot run `prisma migrate deploy` itself (no
   `prisma/`, `scripts/`, or devDependencies), so a second tag is required. The init container is
   declared through the chart's `initContainers.containers` (plain container spec). It needs no
   `command`, because the `migrator` target's `CMD` already runs `prisma migrate deploy`.
4. **GHCR path**: `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, tagged
   `{latest,<short-sha>}` for the runner and `{latest-migrate,<short-sha>-migrate}` for the migrator.
   That is one package with two tag families, not a second GHCR package.
5. **Image pull policy**: the chart's `image.pullPolicy` defaults to `Always` (as of 0.3.0) but covers
   only the main container. The `migrate` init container sets `imagePullPolicy: Always` itself.
   Kubernetes defaults to `Always` only for a tag that is exactly `latest`, so `latest-migrate`
   would otherwise be `IfNotPresent` and never re-pull.
6. **Rolling out a new `latest` image**: `helmfile apply` alone does not restart pods when the
   rendered manifests are unchanged (same `latest` tag). After CI pushes new images, the operator
   runs `kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod`. The new pod
   re-pulls both images and re-runs the migration init container. Alternative: set `image.tag` and
   the init image to a `<short-sha>` tag in `k8s/values.yaml` and `helmfile apply`, which also gives
   a git-tracked record of what's deployed.
7. **Probes**: `probes.enabled: true`, overriding the chart's default `/healthz` path with `/health`
   (the endpoint cms-api serves outside the `api/v1` prefix, `src/bootstrap/configure-app.ts:95`).
   Timings are carried over from the old manifest: liveness `initialDelaySeconds: 15`,
   `periodSeconds: 20`; readiness `initialDelaySeconds: 5`, `periodSeconds: 10`.
8. **CI flag mechanism**: a GitHub Actions **repository variable**, `vars.CMS_API_DEPLOY_MODE`
   (`render` default / `ghcr`), decides whether `deploy-cms-api` still hits the Render webhook or a
   new `cms-api-ghcr-publish` job builds+pushes to GHCR instead. Unset behaves exactly as today
   (Render).
9. **`appPort` vs. the `PORT` secret key**: the app reads only `process.env.PORT` (`src/main.ts:10`).
   Helm can't read a live Secret's value at render time, so the chart's `appPort` (drives
   `containerPort` and the Service port) is a separate plain value, `3000`. It must be kept in sync by
   hand with `secret.example.yaml`'s `PORT: "3000"`. The chart cannot enforce that; a comment in
   `k8s/values.yaml` calls it out.
10. **Service port**: the chart exposes `appPort` directly (`3000 → 3000`); the old manifest used
    `80 → http`. Port-forward becomes `svc/abyssoftime-cms-api-prod 3000:3000`.

---

## Tech Stack

- **helmfile** (`apps/cms-api/helmfile.yaml`) consuming the OCI Helm chart
  `oci://ghcr.io/hungnh1812dev/helmfile-chart-template` — `helm`/`helmfile` already installed locally
  (`/opt/homebrew/bin/helm`, `/opt/homebrew/bin/helmfile`).
- No new runtime dependency in `apps/cms-api` itself — the existing 5-stage `Dockerfile`
  (`deps`/`build`/`prod-deps`/`migrator`/`runner`) is reused as-is, just built with two `--target`
  values in CI instead of one.
- CI: existing GitHub Actions workflow (`.github/workflows/ci.yml`), extended with
  `docker/login-action` + `docker/build-push-action` against `ghcr.io` for images.

## Commands

```
# Render locally without applying (verification) — pulls the latest chart from GHCR
cd apps/cms-api && helmfile cache cleanup && helmfile template

# Diff against the live cluster (requires kubeconfig context set)
cd apps/cms-api && helmfile cache cleanup && helmfile diff

# Apply (manual, by the user — never run by an agent or CI)
cd apps/cms-api && helmfile cache cleanup && helmfile apply

# Roll out newly pushed `latest` images (manifests unchanged → apply alone won't restart pods)
kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod

# Apply the hand-managed secret + namespace (manual, before first helmfile apply)
kubectl apply -f apps/cms-api/k8s/secret.yaml

# Build both image targets locally (mirrors what CI will do)
docker build --target runner   -t ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:local            apps/cms-api
docker build --target migrator -t ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:local-migrate    apps/cms-api
```

## Project Structure

```
apps/cms-api/
  helmfile.yaml                    → NEW: OCI repository entry (ghcr.io/hungnh1812dev) + one release
                                     using helmfile-chart-template, no version (latest), namespace
                                     "abyssoftime-prod"
  k8s/
    values.yaml                    → NEW: cms-api's own (non-secret) chart values
    secret.example.yaml            → UPDATED: Namespace/Secret renamed to abyssoftime-prod /
                                     abyssoftime-cms-api-secrets-prod
    secret.yaml                    → untouched by any agent (real secrets, gitignored)
    deployment.yaml, service.yaml  → REMOVED once the helmfile render replaces them (ask before
                                     deleting — untracked but pre-existing files)

charts/app-template/               → REMOVED (superseded by the published chart; ask before deleting)

.github/workflows/ci.yml           → UPDATED: helm-chart-publish job + its change-detecter filter
                                     removed; new cms-api-ghcr-publish job (builds+pushes 2 image
                                     tags); deploy-cms-api job gated by vars.CMS_API_DEPLOY_MODE
```

## Code Style

- Match the existing k8s YAML style already in this repo: a top comment block explaining what the
  file is, any manual pre-req steps, and the exact command to apply it (see current
  `service.yaml`/`secret.example.yaml` headers).
- cms-api-specific settings live only in `apps/cms-api/k8s/values.yaml`; `helmfile.yaml` holds only
  the repository/release wiring.
- GitHub Actions: follow the existing job style in `ci.yml` (named steps, `defaults.run.working-directory`,
  `needs`/`if` gating via `change-detecter` outputs) — the new GHCR job slots into the same
  `needs: [cms-api-build]` dependency chain the current `deploy-cms-api` job uses.

## Testing Strategy

Infra config has no unit-test framework; verification is command-based and manual:

- `helmfile cache cleanup && helmfile template` renders valid YAML with:
  - Deployment and Service `abyssoftime-cms-api-prod` in `abyssoftime-prod`.
  - Init container `migrate` on the `latest-migrate` image, listed before the main container.
  - Both containers `envFrom` `abyssoftime-cms-api-secrets-prod`, with `imagePullPolicy: Always`.
  - `/health` probes with the timings above.
  - Old manifest's resources.
  - Service port `3000`.
- `kubectl apply --dry-run=client -f apps/cms-api/k8s/secret.example.yaml` succeeds.
- GitHub Actions YAML is valid (`actionlint` if available, otherwise a syntax-only check) — the new
  job doesn't break `change-detecter`/existing job graph for cms-admin/frontend.
- **Manual, by the user, out of this workflow's automated scope**: an actual `helmfile apply` against
  their live k3s cluster, confirming the init container completes a migration and the main container
  reaches Ready.

## Boundaries

- **Always do**: keep cms-api specifics in `k8s/values.yaml`; keep the existing Render-webhook path
  in `ci.yml` working when `CMS_API_DEPLOY_MODE` is unset/`render`; never write real secret values
  anywhere in the repo; `helmfile cache cleanup` before rendering/diffing so the latest chart is used.
- **Ask first**: deleting `apps/cms-api/k8s/deployment.yaml`/`service.yaml` or `charts/app-template/`
  (per the user's global rule, confirm before any delete); any change to `docs/rules/k8s-secrets.md`'s
  protected-file list; pinning the chart version (the user chose latest); adding a second GHCR
  package instead of the two-tag-one-package convention.
- **Never do**: read, edit, create, or delete `apps/cms-api/k8s/secret.yaml`; commit real secret
  values, GHCR credentials, or kubeconfig into the repo; add a `kubectl`/`helmfile apply` step to CI
  (deploy stays manual); rename or remove the existing `deploy-cms-api`/Render-webhook job; fork or
  vendor the chart into this repo.

## Success Criteria

- `charts/app-template/` and the `helm-chart-publish` CI job are gone.
- `apps/cms-api/helmfile.yaml` + `apps/cms-api/k8s/values.yaml` render (from the latest published
  `helmfile-chart-template`) everything listed in Testing Strategy.
- `apps/cms-api/k8s/secret.example.yaml` reflects the renamed namespace/Secret name (still placeholder
  values only).
- `.github/workflows/ci.yml` still has an unmodified default path (Render webhook) for cms-api, plus a
  new path — gated by `vars.CMS_API_DEPLOY_MODE == 'ghcr'` — that builds and pushes both the runner
  and migrator image tags to `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`.
- The old raw `apps/cms-api/k8s/deployment.yaml`/`service.yaml` are removed (after explicit
  confirmation) once the helmfile render is verified equivalent.
- `docs/documents/` gains a doc for this feature (helmfile/chart + GHCR pipeline) per the repo
  workflow's "Update docs" step, and `apps/cms-api/docs/ENTRYPOINT.md` gains an index line pointing to
  it.

---

## Next steps

Execute `apps/cms-api/tasks/todo.md`: Phase 0 (this spec revision + removing the in-repo chart) →
helmfile release → CI → docs → review.

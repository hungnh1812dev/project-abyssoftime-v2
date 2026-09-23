# k3s Deployment (helmfile + GHCR)

How cms-api gets from a `master` push to a running pod on the user's k3s cluster. CI builds and
pushes images to GHCR, and the operator rolls them out by hand with helmfile. Nothing in CI touches
the cluster. See [cms-api-k3s-deployment-techstack.md](./cms-api-k3s-deployment-techstack.md) for why
each piece was chosen. For the image itself, see [dockerfile.md](./dockerfile.md).

## Files

| File | Role |
| --- | --- |
| `apps/cms-api/helmfile.yaml` | OCI repository entry (`ghcr.io/hungnh1812dev`) + one release, `abyssoftime-cms-api-prod` in `abyssoftime-prod`, using `helmfile-chart-template` with **no `version:`** |
| `apps/cms-api/k8s/values.yaml` | Every cms-api-specific chart value: names, port, images, resources, secrets, init container, probes |
| `apps/cms-api/k8s/secret.example.yaml` | Committed template for the Namespace + Secret (placeholders only) |
| `apps/cms-api/k8s/secret.yaml` | Real values, gitignored, applied by hand. Agents never touch it (see `docs/rules/k8s-secrets.md`) |
| `.github/workflows/ci.yml` → `cms-api-ghcr-publish` | Builds and pushes both images on every `master` push that changes cms-api |

## The chart: shared, external, unpinned

The chart is `oci://ghcr.io/hungnh1812dev/helmfile-chart-template`, a generic Deployment + Service
chart maintained in **its own repo**. This repo only consumes it; nothing in the chart is
cms-api-specific. `helmfile.yaml` sets no version, so every deploy uses the **latest** published
chart (0.3.0 at the time of writing).

- **Cache gotcha:** helmfile caches an unversioned OCI chart and then skips refreshing it ("Skipping
  refresh for chart at …"). Without clearing the cache, "latest" sticks to whatever was fetched
  first, so always run `helmfile cache cleanup` first. A semver range (`version: ">=x"`) caches the
  same way.
- **Breaking chart releases** reach cms-api on the next deploy with no change here. Run
  `helmfile diff` before every `apply`. The chart's `values.schema.json` also fails the render loudly
  on most incompatible values.

### Derived names

The chart builds every name from four values in `k8s/values.yaml`: `appName: abyssoftime`,
`serviceName: cms-api`, `appNamespace: abyssoftime`, `appEnv: prod`.

| Resource | Name |
| --- | --- |
| Deployment, Service, helmfile release | `abyssoftime-cms-api-prod` |
| Namespace | `abyssoftime-prod`. The chart **fails** the render unless the release namespace equals `<appNamespace>-<appEnv>` |
| Secret (pre-existing, never created by the chart) | `abyssoftime-cms-api-secrets-prod`. Fixed by the chart; no override |

## What the render contains

- **Migration init container** `migrate`: runs image `cms-api:latest-migrate`, the Dockerfile's
  `migrator` target. Its own `CMD` runs `prisma migrate deploy`, so no `command` is set. It runs to
  completion before the app container starts on every pod start.
- **App container** `cms-api`: runs image `cms-api:latest`, the `runner` target.
- **Secrets:** `secrets.enabled: true` adds `envFrom: abyssoftime-cms-api-secrets-prod` to both
  containers. The migrator needs the DB vars too.
- **Probes:** liveness and readiness `httpGet` on `/health`, port `http`. Liveness uses 15s initial
  delay and 20s period; readiness uses 5s and 10s. The chart defaults the path to `/healthz`, so the
  override is required. cms-api serves `/health` outside the `api/v1` prefix
  (`src/bootstrap/configure-app.ts`). Without the override, liveness fails and the pod restart-loops.
- **Resources:** requests `100m`/`128Mi`, limits `500m`/`512Mi`.
- **Service:** ClusterIP, port `3000 → 3000` (the chart exposes `appPort` directly). There is no
  Ingress yet.

### Image pull policy

The main container uses the chart's `image.pullPolicy`, which defaults to `Always` as of 0.3.0. That
setting **does not apply to init containers**. Kubernetes defaults to `Always` only when the tag is
exactly `latest`, so `latest-migrate` would default to `IfNotPresent` and keep running stale
migrations. `values.yaml` therefore sets `imagePullPolicy: Always` on the init container explicitly.

### `appPort` vs. `PORT`

The app listens on `process.env.PORT`, which comes from the Secret. The chart's `appPort`
(`containerPort`, probes, Service port) is a separate plain value, because Helm can't read a
Secret's value at render time. **Both must be `3000`**. Nothing enforces it, so change them together.

## Images (GHCR)

`ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, one package with two tag families per push:

| Dockerfile target | Tags |
| --- | --- |
| `runner` | `latest`, `<short-sha>` |
| `migrator` | `latest-migrate`, `<short-sha>-migrate` |

The `cms-api-ghcr-publish` job runs only on a `master` push, and only when cms-api changed (it depends on
`cms-api-build`). It uses
`GITHUB_TOKEN` with `packages: write`; no other credentials are involved.

The job builds **both** targets before pushing anything. It then pushes the SHA tags first, then
`latest-migrate`, and `latest` last. A failed or cancelled run therefore can't leave `latest` on a
newer app than `latest-migrate`, which matters because `concurrency: cancel-in-progress` can stop a
run between steps. A `rollout restart` against a mismatched pair would start the new app on the old
schema. Both images carry the `org.opencontainers.image.source` label, which links the GHCR package
to this repo.

`apps/cms-api/.dockerignore` excludes `k8s/` and `helmfile.yaml`, so a local `docker build` can't bake
the operator's real `k8s/secret.yaml` into an image through `COPY . .`.

The branch decides where cms-api goes. Both paths require cms-api to have changed.

| Push to | `cms-api-ghcr-publish` (k3s images) | `deploy-cms-api` (Render webhook) |
| --- | --- | --- |
| `staging` | skipped | runs |
| `master` | runs | skipped |
| `develop` | skipped | skipped (CI checks only) |

`deploy-cms-api` still uses the `Production` GitHub environment, where `CMS_API_RENDER_DEPLOY_HOOK`
lives. If that environment has a deployment-branch rule limited to `master`, the `staging` job will be
rejected. In that case, allow `staging` there, or move the hook to a `Staging` environment.

The images are private by default on GHCR. The k3s node needs pull access: either make the package
public, or add an `imagePullSecrets` registry credential. The chart has no value for
`imagePullSecrets` yet.

## Operator flow

First deploy:

```
# 1. Namespace + Secret (copy secret.example.yaml → secret.yaml, fill in the placeholders first)
kubectl apply -f apps/cms-api/k8s/secret.yaml

# 2. Release
cd apps/cms-api
helmfile cache cleanup && helmfile diff
helmfile cache cleanup && helmfile apply
```

After CI pushes new images, the `latest` tags are unchanged, so `helmfile apply` renders identical
manifests and **does not restart pods**. Roll out by restarting instead. The new pod re-pulls both
images and re-runs migrations:

```
kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod
kubectl -n abyssoftime-prod rollout status  deploy/abyssoftime-cms-api-prod
```

Alternatively, set `image.tag` and the init container image to the `<short-sha>` tags in
`k8s/values.yaml` and `helmfile apply`. That triggers a normal rollout and records what's deployed
in git.

Reach it (no Ingress): `kubectl -n abyssoftime-prod port-forward svc/abyssoftime-cms-api-prod 3000:3000`.

### Migrating from the old hand-written manifests

The old `cms-api` Deployment/Service and `cms-api-env` Secret lived in namespace `abyssoftime`. They
are not managed by helmfile. Remove them by hand once the new release is healthy.

## Verified state

- `helmfile cache cleanup && helmfile template` pulls chart 0.3.0 (no tag in the pull line). It
  renders everything above: names, namespace, init-container order, `envFrom` on both containers,
  `Always` on both images, `/health` probes with the listed timings, resources, and Service
  `3000`.
- `secret.example.yaml` parses as a Namespace + Secret (20 keys) whose names match the render.
- `ci.yml` parses. Compared with the Render-only workflow, the only changes are the new job and one
  `if` clause. The job itself only runs on a real `master` push with GHCR credentials.
- Not verified here (manual, by the operator): an actual `helmfile apply` against the live cluster.

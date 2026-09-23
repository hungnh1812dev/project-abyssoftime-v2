# k3s Deployment (helmfile + GHCR)

How cms-api gets from a `master` push to a running pod on the user's k3s cluster. CI builds and
pushes images to GHCR, and the operator rolls them out by hand with helmfile. Nothing in CI touches
the cluster. See [cms-api-k3s-deployment-techstack.md](./cms-api-k3s-deployment-techstack.md) for why
each piece was chosen. For the image itself, see [dockerfile.md](./dockerfile.md).

## Files

| File | Role |
| --- | --- |
| `apps/cms-api/k8s/helmfile.yaml.gotmpl` | OCI repository entry (`ghcr.io/hungnh1812dev`) + two releases: `<name>-secrets` (local `secrets-chart`, the Secret built from exported env vars) and `<name>` (`helmfile-chart-template`, **no `version:`**, `needs` the Secret release). Reads the identity values (name, namespace, env, port) from required `APP_*` env vars and derives the release names and namespace from them |
| `apps/cms-api/k8s/secrets-chart/` | Tiny local chart: one `Secret` whose `stringData` is the `env` map helmfile built from the environment |
| `apps/cms-api/k8s/values.yaml.gotmpl` | The rest of cms-api's chart values: images, resources, secrets, init container, probes. A `.gotmpl` so helmfile fills in the image tag from `APP_IMAGE_TAG` |
| `apps/cms-api/k8s/.env.example` | Committed template for your env file: the `APP_*` block with prod values plus every runtime key. Also the list of key names that go into the Secret |
| `apps/cms-api/k8s/.env.local` (any name) | Gitignored, exported into the shell before running helmfile. The single source for both the `APP_*` identity vars and every runtime config/secret key. Agents never touch it (see `docs/rules/k8s-secrets.md`) |
| `.github/workflows/ci.yml` → `cms-api-ghcr-publish` | Builds and pushes both images on every `master` push that changes cms-api |

## The chart: shared, external, unpinned

The chart is `oci://ghcr.io/hungnh1812dev/helmfile-chart-template`, a generic Deployment + Service
chart maintained in **its own repo**. This repo only consumes it; nothing in the chart is
cms-api-specific. `helmfile.yaml.gotmpl` sets no version, so every deploy uses the **latest** published
chart (0.3.0 at the time of writing).

- **Cache gotcha:** helmfile caches an unversioned OCI chart and then skips refreshing it ("Skipping
  refresh for chart at …"). Without clearing the cache, "latest" sticks to whatever was fetched
  first, so always run `helmfile cache cleanup` first. A semver range (`version: ">=x"`) caches the
  same way.
- **Breaking chart releases** reach cms-api on the next deploy with no change here. Run
  `helmfile diff` before every `apply`. The chart's `values.schema.json` also fails the render loudly
  on most incompatible values.

### Derived names

`helmfile.yaml.gotmpl` reads the chart's identity values from **required** env vars (`requiredEnv`).
You export them from a gitignored env file in `k8s/` (e.g. `.env.local`) before running the CLI. A
missing var fails the render with
`required env var APP_NAME is not set` instead of deploying under a wrong name.

| Env var | Chart value | cms-api prod value | Meaning |
| --- | --- | --- | --- |
| `APP_NAME` | `appName` | `abyssoftime` | Application / product name |
| `APP_SERVICE_NAME` | `serviceName` | `cms-api` | Service within the application |
| `APP_NAMESPACE` | `appNamespace` | `abyssoftime` | Base namespace |
| `APP_ENV` | `appEnv` | `prod` | Environment |
| `APP_PORT` | `appPort` | `3000` | Container and Service port |
| `APP_IMAGE_TAG` | `image.tag`, init image `<tag>-migrate` (in `values.yaml.gotmpl`) | `latest` | `latest`, or a short SHA to pin/roll back |

The release passes these values to the chart and derives the release name and namespace from them.
That way the names always match what the chart expects. The file needs the `.gotmpl` extension,
because helmfile v1 doesn't template a plain `.yaml`.

Resulting names with the cms-api prod values:

| Resource | Name |
| --- | --- |
| Deployment, Service, helmfile release | `abyssoftime-cms-api-prod` |
| Namespace | `abyssoftime-prod`. The chart **fails** the render unless the release namespace equals `<appNamespace>-<appEnv>` |
| Secret (created by the `-secrets` release, referenced by the app chart) | `abyssoftime-cms-api-secrets-prod`. The app chart fixes the name; no override |
| Secret release | `abyssoftime-cms-api-prod-secrets` |

## What the render contains

- **Migration init container** `migrate`: runs image `cms-api:<APP_IMAGE_TAG>-migrate` (`latest-migrate` by default), the Dockerfile's
  `migrator` target. Its own `CMD` runs `prisma migrate deploy`, so no `command` is set. It runs to
  completion before the app container starts on every pod start.
- **App container** `cms-api`: runs image `cms-api:<APP_IMAGE_TAG>`, the `runner` target.
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
migrations. `values.yaml.gotmpl` therefore sets `imagePullPolicy: Always` on the init container explicitly.

## The Secret, from environment variables

The helmfile never reads your env file. You export it into the shell (`set -a && . ./.env.local && set +a`),
and `helmfile.yaml.gotmpl` builds the Secret's `stringData` from the environment:

- **Key names** come from the committed `k8s/.env.example`: every `KEY=` line that isn't a comment.
  Other variables in your shell (`PATH`, `HOME`, …) never reach the Secret, and neither does a key
  that's missing from the template. **A new app env var must be added to `k8s/.env.example`**.
- **Values** come only from the environment (`env "KEY"`). Quoting and escaping are the shell's job,
  so any value the shell accepts works.
- `APP_*` keys are left out (they're helmfile's identity vars, not app config).
- Unset or **empty** keys are left out, so the app sees them as unset and falls back to its defaults
  (e.g. no `SMTP_HOST` means the console email sender).
- `PORT` is always set from `APP_PORT`, overriding any exported `PORT`. The app listens on
  `process.env.PORT` while the chart's `appPort` drives `containerPort`, probes and the Service port,
  so deriving one from the other keeps them from drifting apart.

The env file can have any name (`.env`, `.env.local`, `.env.staging`, …). `apps/cms-api/.gitignore`
ignores `.env` and `.env.local`; add a pattern for any other name you use. The keys the app accepts
are documented in `apps/cms-api/.env.example`. `helmfile diff` shows Secret changes masked
(helm-diff's default), not in plain text. The values are stored in-cluster in Helm's release Secret,
same as any Helm-managed Secret.

A Secret change alone doesn't restart pods (`envFrom` is only read at container start), so run a
`rollout restart` after changing values.

## Images (GHCR)

`ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, one package with two tag families per push:

| Dockerfile target | Tags |
| --- | --- |
| `runner` | `latest`, `<short-sha>` |
| `migrator` | `latest-migrate`, `<short-sha>-migrate` |

The runner build passes `APP_PORT` from the **`CMS_API_APP_PORT` repo variable** (Settings → Secrets and
variables → Actions → Variables). The Dockerfile requires it, so the job fails until it's set. Keep it
equal to `APP_PORT` in your k8s env file. It only sets the image's `EXPOSE` and default `PORT`; in k3s the
Secret's `PORT` decides the listen port.

The `cms-api-ghcr-publish` job runs only on a `master` push, and only when cms-api changed (it depends on
`cms-api-build`). It uses
`GITHUB_TOKEN` with `packages: write`; no other credentials are involved.

The job builds **both** targets before pushing anything. It then pushes the SHA tags first, then
`latest-migrate`, and `latest` last. A failed or cancelled run therefore can't leave `latest` on a
newer app than `latest-migrate`, which matters because `concurrency: cancel-in-progress` can stop a
run between steps. A `rollout restart` against a mismatched pair would start the new app on the old
schema. Both images carry the `org.opencontainers.image.source` label, which links the GHCR package
to this repo.

`apps/cms-api/.dockerignore` excludes `k8s/` (helmfile, values and secrets all live there), so a local `docker build` can't bake
the operator's real `k8s/.env*` files into an image through `COPY . .`.

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

Deploy (first time or any later change to env values or chart values). Copy `k8s/.env.example` to
`k8s/.env.local` (or any gitignored name) and fill it in first. helmfile creates the namespace, then the
Secret release, then the app release:

```
cd apps/cms-api/k8s
set -a && . ./.env.local && set +a    # exports APP_* + every runtime key for this terminal only
helmfile cache cleanup && helmfile diff
helmfile cache cleanup && helmfile apply
```

**One-time switch from the old hand-applied Secret** (the removed `secret.yaml`): Helm refuses to take over a Secret it didn't
create (`invalid ownership metadata`). Hand the existing one to the new release first. Pods keep
running with no downtime:

```
kubectl -n abyssoftime-prod label secret abyssoftime-cms-api-secrets-prod app.kubernetes.io/managed-by=Helm
kubectl -n abyssoftime-prod annotate secret abyssoftime-cms-api-secrets-prod \
  meta.helm.sh/release-name=abyssoftime-cms-api-prod-secrets meta.helm.sh/release-namespace=abyssoftime-prod
```

After CI pushes new images, the `latest` tags are unchanged, so `helmfile apply` renders identical
manifests and **does not restart pods**. Roll out by restarting instead. The new pod re-pulls both
images and re-runs migrations:

```
kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod
kubectl -n abyssoftime-prod rollout status  deploy/abyssoftime-cms-api-prod
```

Alternatively, set `APP_IMAGE_TAG` in your env file to a `<short-sha>` (e.g. `7074d17`) and
`helmfile apply`. Both the app and the migrate image switch to that commit (`7074d17`,
`7074d17-migrate`), and the changed tag triggers a normal rollout. Setting it back to an older SHA
is a rollback. The env file isn't committed, so the deployed tag is recorded only in the cluster.

Reach it (no Ingress): `kubectl -n abyssoftime-prod port-forward svc/abyssoftime-cms-api-prod 3000:3000`.

### Migrating from the old hand-written manifests

The old `cms-api` Deployment/Service and `cms-api-env` Secret lived in namespace `abyssoftime`. They
are not managed by helmfile. Remove them by hand once the new release is healthy.

## Verified state

- `helmfile cache cleanup && helmfile template` pulls chart 0.3.0 (no tag in the pull line). It
  renders everything above: names, namespace, init-container order, `envFrom` on both containers,
  `Always` on both images, `/health` probes with the listed timings, resources, and Service
  `3000`.
- With a fake env file, the `-secrets` release renders `abyssoftime-cms-api-secrets-prod` with
  comments, `APP_*` keys and empty values dropped, `export ` and quotes stripped, `=` inside a value
  kept, and `PORT` taken from `APP_PORT`. `helmfile list` shows both releases, and the full
  `helmfile template` renders the Secret release before the app, whose `envFrom` names the same Secret.
- `ci.yml` parses. Compared with the Render-only workflow, the only changes are the new job and one
  `if` clause. The job itself only runs on a real `master` push with GHCR credentials.
- Not verified here (manual, by the operator): an actual `helmfile apply` against the live cluster.

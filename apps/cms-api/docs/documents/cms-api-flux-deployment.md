# k3s Deployment (Flux GitOps + GHCR)

This doc covers how cms-api gets from a `master` push to a running pod on the owner's k3s cluster:

1. CI builds and pushes two images to GHCR.
2. Flux, running in the cluster and watching a **separate GitOps repo**, notices the new tag and
   commits it to that repo.
3. Flux then applies the plain manifests with that tag.

Nothing in CI touches the cluster. Project info (names, namespace, port, image repo) lives in a
ConfigMap, and runtime config and secrets live in a Secret. The owner creates both by hand, and
neither is in code. See [cms-api-flux-deployment-techstack.md](./cms-api-flux-deployment-techstack.md)
for why each piece was chosen, and [dockerfile.md](./dockerfile.md) for the images. For a
step-by-step setup from zero, follow the runbook [k8s/README.md](../../k8s/README.md).

## Files

| File | Role |
| --- | --- |
| `apps/cms-api/k8s/flux/kustomization.flux.yaml` | Flux entry point (`kustomize.toolkit.fluxcd.io/v1` Kustomization in `flux-system`). It substitutes `${APP_*}` from the ConfigMap and carries the `APP_IMAGE_TAG` setter marker. It is the only file with placeholders you fill in when copying |
| `apps/cms-api/k8s/flux/app/` | Deployment, Service, ImageRepository, ImagePolicy and ImageUpdateAutomation. Only `${APP_*}` placeholders, with no project values |
| `apps/cms-api/k8s/configmap.example.yaml` | ConfigMap manifest template: the six `APP_*` keys, `<placeholders>` only |
| `apps/cms-api/k8s/secret.example.yaml` | Secret manifest template: runtime config and secrets. Required keys active, optional keys commented out |
| `apps/cms-api/k8s/configmap.yaml`, `apps/cms-api/k8s/secret.yaml` | Your filled-in copies, applied with `kubectl apply --server-side -f`. Gitignored. Agents never touch them (see `docs/rules/k8s-secrets.md`) |
| `.github/workflows/ci.yml` → `cms-api-ghcr-publish` | Builds and pushes both images on every `master` push that changes cms-api |

This repo only holds **templates**. The GitOps repo holds the live copy, and Flux reads only
that.

## Naming contract

| Name | Formula | prod value |
| --- | --- | --- |
| full-namespace | `<app-namespace>-<app-env>` | `abyssoftime-prod` |
| full-app-name (Deployment, Service, Flux objects) | `<app-name>-<app-service-name>-<app-env>` | `abyssoftime-cms-api-prod` |
| Secret, in full-namespace | `<app-name>-<app-service-name>-<app-env>-secrets` | `abyssoftime-cms-api-prod-secrets` |
| ConfigMap, in `flux-system` | `<app-name>-<app-service-name>-<app-env>-config` | `abyssoftime-cms-api-prod-config` |
| App image | `<app-image-repo>:<tag>` | `…/cms-api:57-a1b2c3d` |
| Init (migration) image | `<app-image-repo>:<tag>-init` | `…/cms-api:57-a1b2c3d-init` |

### Variables substituted into `app/`

| Variable | Source | Used for |
| --- | --- | --- |
| `APP_NAME` | ConfigMap | Every name |
| `APP_SERVICE_NAME` | ConfigMap | Every name |
| `APP_NAMESPACE` | ConfigMap | The namespace, `${APP_NAMESPACE}-${APP_ENV}` |
| `APP_ENV` | ConfigMap | Every name and the namespace |
| `APP_PORT` | ConfigMap | `containerPort`, probes, Service port, and the app's `PORT` |
| `APP_IMAGE_REPO` | ConfigMap | Both images and the ImageRepository |
| `APP_IMAGE_TAG` | `postBuild.substitute` in the entry file, rewritten by image automation | Both images |

The ConfigMap sits in `flux-system` because `postBuild.substituteFrom` only reads objects in the
Kustomization's own namespace. It isn't `optional`, so if it's missing the reconcile fails rather
than applying `${APP_NAME}`-style names.

## What Flux applies

- **Init container `init`** runs `<repo>:<tag>-init`, which is the Dockerfile `migrator` target. Its
  `CMD` runs `prisma migrate deploy` to completion before the app starts, on every pod start.
- **App container `app`** runs `<repo>:<tag>` (the `runner` target) with
  `command: ["sh", "-c", "PORT=${APP_PORT} exec bun dist/src/main"]`.
  - The `command` sets `PORT` from the ConfigMap, overriding any `PORT` in the Secret, so the app
    and the Service can't disagree.
  - It **repeats the Dockerfile runner `CMD`**, so keep the two in sync.
  - It isn't done with `env: [{name: PORT, value: "${APP_PORT}"}]` because Flux substitutes after
    kustomize has dropped the quotes. The value would reach the API server as the int `3000`, and
    the Deployment would be rejected.
- **Secrets:** both containers load the Secret through `envFrom`. The migrator needs the DB
  variables too.
- **Probes:** liveness and readiness `httpGet` on `/health` at `${APP_PORT}`. Liveness uses a 15s
  initial delay and 20s period; readiness uses 5s and 10s. cms-api serves `/health` outside the
  `api/v1` prefix.
- **Resources:** requests `100m`/`128Mi`, limits `500m`/`512Mi`.
- **Service:** ClusterIP, `${APP_PORT} → ${APP_PORT}`. There's no Ingress.
- **Image automation** (all in `flux-system`, named full-app-name):
  - The **ImageRepository** scans `${APP_IMAGE_REPO}` every 5m.
  - The **ImagePolicy** keeps tags matching `^(?P<n>\d+)-[a-f0-9]{7}$` (so never `-init`), extracts
    `$n` and picks the highest number. The bare `$n` survives substitution because Flux only expands
    `${…}`.
  - The **ImageUpdateAutomation** commits the newest tag through the bootstrap `flux-system`
    GitRepository, on its branch. With no `update.path`, it scans the whole GitOps repo, and
    `policySelector` limits it to this app's policy.

The entry Kustomization sets `wait: true` and `timeout: 5m`. It reports Ready only after the
Deployment rolls out, so a failed migration or crash loop shows up in
`flux get kustomizations`.

## Images (GHCR)

The `cms-api-ghcr-publish` job runs on a `master` push, only when cms-api changed (it depends on
`cms-api-build`), and pushes to the repo set in the **`CMS_API_IMAGE_REPO` repo variable** (e.g.
`ghcr.io/<owner>/<repo>/cms-api`, lowercase). If the variable isn't set, the job fails straight
away.

| Dockerfile target | Tag |
| --- | --- |
| `migrator` | `<run_number>-<sha7>-init` |
| `runner` | `<run_number>-<sha7>` |

- The job builds both targets first, then pushes `-init` **before** the app tag. Flux only follows
  the app tag, so it never sees one whose migrations aren't in the registry yet.
- There are no `latest` tags. Every tag is immutable and names one commit. Re-pushing `latest`
  wouldn't save storage anyway: the old image stays in GHCR as an untagged version.
- **Cleanup (opt-in):** when the repo variable **`CMS_API_GHCR_CLEANUP`** is `true`, the job ends
  by running `actions/delete-package-versions@v5`. It keeps the newest **10 versions** (5 releases,
  app + `-init`) and deletes everything older, tagged or not. The package name and owner are
  derived from `CMS_API_IMAGE_REPO`.
  - Turn it on only **after** the helmfile migration. The first run also deletes the old
    `latest`/`latest-migrate` images that the Helm deploy pulls.
  - Tags can't be protected: for containers, the action matches `ignore-versions` against the
    digest, not the tag.
  - It needs the package to grant this repo the **Admin** role (package settings → Manage Actions
    access). Otherwise the step fails after the images are already pushed.
  - Public packages are free on GHCR, so cleanup only bounds how much piles up.
- **`run_number` caveat:** the counter belongs to the workflow file. If you rename `ci.yml`, it
  restarts at 1. Flux would then keep the old, higher tag and ignore every new one until the
  numbers pass it. If you rename the file, raise the numbers first, e.g. by prefixing the tag with
  an offset.
- Both images carry `org.opencontainers.image.source` from the workflow's repository, which links
  the GHCR package to this repo. The only credential used is `GITHUB_TOKEN` with `packages: write`.
- **Visibility:** the templates have no `imagePullSecrets` and no ImageRepository `secretRef`, so
  the GHCR package must be **public**. If you make it private, add a pull Secret to the Deployment
  and a `secretRef` to the ImageRepository.
- `apps/cms-api/.dockerignore` excludes `k8s/`, so `COPY . .` can't bake a filled-in
  `k8s/secret.yaml` into an image.

The branch decides where cms-api goes. Both paths require cms-api to have changed.

| Push to | `cms-api-ghcr-publish` (k3s images) | `deploy-cms-api` (Render webhook) |
| --- | --- | --- |
| `staging` | skipped | runs |
| `master` | runs | skipped |
| `develop` | skipped | skipped (CI checks only) |

`deploy-cms-api` still uses the `Production` GitHub environment, where `CMS_API_RENDER_DEPLOY_HOOK`
lives. If that environment's deployment-branch rule only allows `master`, the `staging` job is
rejected. Allow `staging` there, or move the hook to a `Staging` environment.

## How a deploy happens

1. A push to `master` runs CI, which pushes `58-b2c3d4e-init` and then `58-b2c3d4e`.
2. Within 5 minutes, the ImageRepository sees the tag and the ImagePolicy picks `58-b2c3d4e`.
3. The ImageUpdateAutomation rewrites `APP_IMAGE_TAG` in the entry file and pushes a
   `chore(<full-app-name>): update image tag` commit to the GitOps repo.
4. The Kustomization reconciles and the Deployment rolls out: the init container runs the
   migrations, then the app starts.

The GitOps repo history records exactly which tag was deployed, and when.

## Owner setup (one time)

Prerequisites, all outside this repo:

1. Flux is installed with the **image-reflector-controller** and
   **image-automation-controller**. For example:
   `flux bootstrap github … --components-extra=image-reflector-controller,image-automation-controller --read-write-key`.
2. The bootstrap `flux-system` GitRepository uses a deploy key with **write** access, which the
   ImageUpdateAutomation needs to push.
3. The `CMS_API_IMAGE_REPO` repo variable is set in this repo (Settings → Secrets and variables →
   Actions → Variables). `CMS_API_APP_PORT` is no longer used and can be deleted.
   `CMS_API_GHCR_CLEANUP=true` is optional and should only be set after the migration (see Images).
   It also needs this repo to have the Admin role on the package.
4. The GHCR package is public (see Images).

Then create the cluster inputs **before** pushing the manifests:

```bash
kubectl create namespace <app-namespace>-<app-env>

# Copy the templates to their gitignored names, fill in names and values, then apply
cp k8s/secret.example.yaml k8s/secret.yaml
cp k8s/configmap.example.yaml k8s/configmap.yaml
kubectl apply --server-side -f k8s/secret.yaml -f k8s/configmap.yaml
```

Use `--server-side`. A plain `kubectl apply` would also store every Secret value in plain text in
the `last-applied-configuration` annotation.

When filling in the templates:

- **Quote every value** (`"true"`, `"5432"`, `"3000"`). Secret and ConfigMap data must be strings.
- **In the Secret, uncomment only the optional keys you use**, such as the credentials for your
  storage and email provider. Don't leave an optional key as `""`: an empty value is not "unset",
  and some fail validation. For example, `RATE_LIMIT_FPS: ""` becomes `0`, fails `@Min(1)`, and
  the app won't boot.
- Don't add `PORT` to the Secret. The Deployment sets it from `APP_PORT`.
- The ConfigMap must stay in `flux-system`.

Finally, copy the templates into the GitOps repo:

- `k8s/flux/app/` goes to `<path-to-app-dir>`, e.g. `./apps/<full-app-name>`. It must be
  **outside** the bootstrap Kustomization's path (e.g. `./clusters/<name>`). Otherwise that
  Kustomization applies it a second time, without substitution.
- `k8s/flux/kustomization.flux.yaml` goes **inside** the bootstrap path, so Flux picks it up. Fill
  in:
  - `<full-app-name>` (3×)
  - `<path-to-app-dir>`
  - `<initial-tag>`, the newest `<run_number>-<sha7>` in GHCR. Automation keeps it current after
    that.

Commit and push. Then check with `flux get kustomizations`, `flux get images policy` and
`kubectl -n <full-namespace> get pods`.

### Migrating from the helmfile deploy

Until now, cms-api ran from two Helm releases in `abyssoftime-prod`: `abyssoftime-cms-api-prod` (the
shared chart) and `abyssoftime-cms-api-prod-secrets` (the Secret). Flux can't take them over. The
chart's Deployment selector labels differ, and selectors are immutable. So remove them and let
Flux recreate the objects. **Expect a short downtime** between the uninstall and Flux's first
apply.

1. Create the new Secret (`abyssoftime-cms-api-prod-secrets`, a new name) and the ConfigMap as
   above. The namespace already exists. Carry your values over from your old env file into
   `k8s/secret.yaml`, leaving out `PORT` and the `APP_*` keys.
2. Remove the Helm releases. This also deletes the old `abyssoftime-cms-api-secrets-prod` Secret:
   ```bash
   helm -n abyssoftime-prod uninstall abyssoftime-cms-api-prod abyssoftime-cms-api-prod-secrets
   ```
3. Push the filled-in templates to the GitOps repo, or run
   `flux reconcile kustomization <full-app-name> --with-source` if they're already there.

## Day-2 operations

- **Secret change:** envFrom is only read when a container starts. So edit `k8s/secret.yaml`,
  re-apply it, and restart:
  ```bash
  kubectl apply --server-side -f k8s/secret.yaml
  kubectl -n <full-namespace> rollout restart deploy/<full-app-name>
  ```
  A key you remove from the file is also removed from the Secret, because server-side apply
  tracks which keys it owns.
- **ConfigMap change** (e.g. port): edit `k8s/configmap.yaml`, run `kubectl apply --server-side -f
  k8s/configmap.yaml`, then `flux reconcile kustomization <full-app-name>`. Changed values change the manifests, so the
  pods roll out normally. Changing `APP_NAME`, `APP_SERVICE_NAME`, `APP_NAMESPACE` or `APP_ENV`
  renames everything. The entry file's literals, the Secret and the ConfigMap have to follow.
- **Rollback or pin a tag.** Reverting the tag commit alone doesn't hold: automation writes the
  newest tag back within 5 minutes. Suspend it first:
  ```bash
  flux suspend image update <full-app-name>
  # then, in the GitOps repo: revert the "update image tag" commit (or set APP_IMAGE_TAG to an older
  # <run_number>-<sha7>) and push
  flux reconcile kustomization <full-app-name> --with-source
  ```
  Once a fixed image is pushed, run `flux resume image update <full-app-name>`. With cleanup on,
  only the last 5 releases still exist in GHCR, so you can't pin anything older. The init container
  runs *forward* migrations only, so rolling back past a schema change needs a manual DB fix.
- **Reach it** (there's no Ingress):
  `kubectl -n <full-namespace> port-forward svc/<full-app-name> <port>:<port>`.

## Gotchas

- **Number-like substitutions become ints.** Flux renders with kustomize (quotes dropped), then
  runs envsubst and YAML→JSON. A `${VAR}` standing alone as a whole value becomes an int if it
  looks like one. That's right for `containerPort`, but wrong for string fields such as
  `env[].value`. Only put numeric variables in string fields inside a longer string.
- **Only `${VAR}` is substituted.** A bare `$n` (as in the ImagePolicy's `extract`) is left
  alone, and `$$` becomes a literal `$`. Any other `${…}` text in `app/` is treated as a variable.
  If it's not in the ConfigMap, it's replaced with an empty string.
- **The `command` must match the Dockerfile runner `CMD`.** If the entrypoint changes, update
  `k8s/flux/app/deployment.yaml` too.
- **Copy both sides.** After changing templates here, copy them into the GitOps repo. Flux never
  reads this repo.

## Verified state

- `kubectl kustomize k8s/flux/app` renders. Its placeholders are exactly the 7 variables above.
- The rendered output is run through envsubst with fake values, limited to those variables to
  match Flux, then parsed and asserted in Python. That covers names, namespaces, both images,
  `envFrom`, int ports, the `PORT` command, string-only env values, probes, resources, the Service
  selector, the image-automation fields, and `$n` surviving substitution.
- The ImagePolicy regex accepts `57-a1b2c3d` and rejects `-init`, `latest`, uppercase and short
  SHAs.
- The entry file has one setter marker, 3 `<full-app-name>` placeholders, and no project literals.
- The `ci.yml` publish job parses. Its tags, push order and repo variable are asserted, and every
  other job is unchanged.
- Not verified here (manual, by the owner): Flux reconciling in the live cluster, image automation
  pushing to the GitOps repo, and the migration steps.

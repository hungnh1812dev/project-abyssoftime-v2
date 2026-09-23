# Spec: cms-api CI/CD on Flux

Status: **DRAFT** — awaiting approval
Date: 2026-09-23
Target app: `apps/cms-api` (+ the cms-api jobs in `.github/workflows/ci.yml`)

---

## Objective

Replace the manual helmfile deploy of cms-api to k3s with **GitOps via Flux**:

- **CI** (GitHub Actions, this repo) builds and pushes images to GHCR, and nothing else.
- **CD** (Flux, a separate GitOps repo) picks up each new image automatically and applies plain
  k8s manifests.
- **No project values in code.** App identity lives in a ConfigMap and runtime secrets live in a
  Secret. The owner creates both by hand before the first deploy, and manifests only hold
  `${VAR}` placeholders.

### User stories

- **As the owner**, I merge to `master`. CI pushes `<tag>` + `<tag>-init`, Flux notices the new
  tag, commits it to the GitOps repo, and rolls the Deployment. I run no deploy command.
- **As the owner**, I create the namespace, Secret, and ConfigMap once with `kubectl`, and
  Flux does everything else.
- **As the owner**, I roll back by suspending image automation
  (`flux suspend image update <full-app-name>`), then reverting or pinning the tag commit in the
  GitOps repo. A revert alone gets overwritten by the newest tag within 5 minutes.
- **As a reader of this repo**, I find no app name, namespace, port, or image repo hardcoded in
  manifests or CI.

### Non-goals

- Installing or bootstrapping Flux itself, or creating the GitOps repo. The owner does this, and
  docs only list the prerequisites.
- Ingress, ServiceAccount, and Namespace manifests. Only a Deployment and a Service are in scope.
- Staging (Render) and cms-admin/frontend deploy jobs. These stay untouched.
- Environments other than `prod`. The design supports them, but only `prod` is specified.

---

## Naming contract

Project info keys come from the ConfigMap (see below). Derived names:

| Name | Formula | prod value (example, **not in code**) |
| --- | --- | --- |
| full-namespace | `<app-namespace>-<app-env>` | `abyssoftime-prod` |
| full-app-name | `<app-name>-<app-service-name>-<app-env>` | `abyssoftime-cms-api-prod` |
| Secret | `<app-name>-<app-service-name>-<app-env>-secrets` | `abyssoftime-cms-api-prod-secrets` |
| ConfigMap | `<app-name>-<app-service-name>-<app-env>-config` | `abyssoftime-cms-api-prod-config` |
| App image | `<app-image-repo>:<tag>` | `ghcr.io/…/cms-api:57-a1b2c3d` |
| Init image | `<app-image-repo>:<tag>-init` | `ghcr.io/…/cms-api:57-a1b2c3d-init` |

⚠ The Secret name **changes** from today's `abyssoftime-cms-api-secrets-prod` to
`abyssoftime-cms-api-prod-secrets`. The owner creates the new one, and the old Helm-owned one is
removed together with the old releases (see Migration).

### ConfigMap keys (`<full-app-name>-config`, namespace `flux-system`)

| Key | Meaning |
| --- | --- |
| `APP_NAME` | Application / product name |
| `APP_SERVICE_NAME` | Service within the application |
| `APP_NAMESPACE` | Base namespace |
| `APP_ENV` | Environment (`prod`) |
| `APP_PORT` | Container + Service port. Also injected as the app's `PORT` |
| `APP_IMAGE_REPO` | Image repository, without a tag |

It lives in `flux-system` because Flux `postBuild.substituteFrom` only reads ConfigMaps and
Secrets from the Kustomization's own namespace.

### Secret (`<full-app-name>-secrets`, namespace `<full-namespace>`)

The app's runtime env vars (JWT, DB, storage, email, …). Keys are listed in `k8s/.env.example`
with **no** `APP_*` keys, and are loaded into both containers through `envFrom`.

---

## Design

### CI (this repo, `.github/workflows/ci.yml`)

`cms-api-ghcr-publish` (master only) changes:

- Tag = `<github.run_number>-<sha7>` (sortable). Push `<tag>-init` **before** `<tag>` so Flux
  never sees an app tag whose init image is missing.
- Rename the migrator tag suffix from `-migrate` to `-init`. The Dockerfile `migrator` target
  name is unchanged.
- Stop pushing `latest` / `latest-migrate`.
- Read the image repo from `vars.CMS_API_IMAGE_REPO` instead of the hardcoded
  `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`. `APP_PORT` already comes from
  `vars.CMS_API_APP_PORT`.

### CD (templates in `apps/cms-api/k8s/flux/`, copied by the owner into the GitOps repo)

```
k8s/flux/
  kustomization.flux.yaml   # Flux Kustomization (entry point) — the only file with literals the owner fills in
  app/
    kustomization.yaml      # kustomize list of the files below
    deployment.yaml         # Deployment: init container + app container
    service.yaml            # ClusterIP Service on ${APP_PORT}
    image-repository.yaml   # ImageRepository ${APP_IMAGE_REPO}
    image-policy.yaml       # ImagePolicy: ^(?P<n>\d+)-[a-f0-9]{7}$, numerical by n (excludes -init)
    image-update.yaml       # ImageUpdateAutomation → commits the new tag to the GitOps repo
```

- **Entry Kustomization** (`flux-system`): `path: ./…/app`,
  `postBuild.substituteFrom: [{kind: ConfigMap, name: <full-app-name>-config}]`, and
  `postBuild.substitute.APP_IMAGE_TAG: "<tag>" # {"$imagepolicy": "flux-system:<full-app-name>:tag"}`.
  The image-automation setter rewrites that one line, so the app and init images always share a
  tag from one commit.
- The owner fills in this file's placeholders when copying it to the GitOps repo:
  `<full-app-name>` (3×), `<path-to-app-dir>` and `<initial-tag>`. `app/` must sit **outside**
  the bootstrap `flux-system` Kustomization's path. Otherwise the bootstrap one also applies it,
  unsubstituted. It also has `wait: true` and `timeout: 5m`, so a failed rollout or migration
  shows up on the Kustomization. Flux requires a literal ConfigMap name and a literal setter marker to start from,
  so the entry point needs them. Nothing under `app/` holds a literal.
- **Deployment** (`${APP_NAMESPACE}-${APP_ENV}` / `${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}`),
  carrying over what `values.yaml.gotmpl` has today:
  - init container `init`: `${APP_IMAGE_REPO}:${APP_IMAGE_TAG}-init`, runs `prisma migrate deploy`
  - app container: `${APP_IMAGE_REPO}:${APP_IMAGE_TAG}`, port `${APP_PORT}`, and
    `command: ["sh", "-c", "PORT=${APP_PORT} exec bun dist/src/main"]`. This overrides anything
    in the Secret, so the app and Service can't disagree. It is not done with
    `env: PORT="${APP_PORT}"` because Flux runs substitution after kustomize drops the quotes, so
    the value would reach the API server as an int and be rejected. The command must stay in sync
    with the Dockerfile runner's `CMD`.
  - both containers: `envFrom: secretRef ${…}-secrets`
  - probes: liveness `/health` (initialDelay 15s, period 20s) and readiness `/health` (5s / 10s)
  - resources: requests 100m / 128Mi, limits 500m / 512Mi
- **Service**: ClusterIP with the same name, port `${APP_PORT}` → targetPort `${APP_PORT}`.
- **Image automation** (`image.toolkit.fluxcd.io/v1`, `flux-system`, named `<full-app-name>`):
  - The ImageRepository scans `${APP_IMAGE_REPO}` every 5m.
  - The ImagePolicy uses `^(?P<n>\d+)-[a-f0-9]{7}$` with extract `$n`, sorted numerically
    ascending. The bare `$n` is safe because Flux's envsubst only expands `${…}`.
  - The ImageUpdateAutomation uses the bootstrap-default `flux-system` GitRepository and its
    branch. It has no `update.path` (it scans the repo root), and `policySelector` on
    `app.kubernetes.io/name: <full-app-name>` stops it from touching other apps' markers. This
    way the template makes no assumptions about how the GitOps repo is laid out.

### Owner prerequisites (docs only, no agent action)

1. Flux is installed with the image-reflector and image-automation controllers, and the GitOps
   repo is bootstrapped with a **write** deploy key (needed by ImageUpdateAutomation).
2. `kubectl create namespace <full-namespace>`
3. Create the Secret from a private env file, dropping empty values:
   `kubectl -n <full-namespace> create secret generic <full-app-name>-secrets --from-env-file=<(grep -E '^[A-Z0-9_]+=.+' k8s/.env.local)`
4. `kubectl -n flux-system create configmap <full-app-name>-config --from-env-file=<config env file>`
5. If the GHCR package is private: an image-pull Secret for the Deployment **and** a `secretRef`
   on the ImageRepository (see Open Questions).
6. Copy `k8s/flux/` into the GitOps repo, fill in `<full-app-name>`, and push.

After a Secret change, the owner runs `kubectl rollout restart` (Flux doesn't restart pods for
Secret changes).

### Removed

`k8s/helmfile.yaml.gotmpl`, `k8s/values.yaml.gotmpl`, `k8s/secrets-chart/`, and every
`helmfile`/`APP_INIT_IMAGE_*` reference in docs.

### Migration (owner, one-time)

Create the new Secret and ConfigMap, then
`helm -n abyssoftime-prod uninstall abyssoftime-cms-api-prod abyssoftime-cms-api-prod-secrets`,
then push the GitOps repo. Expect a short downtime between the uninstall and Flux's first apply.

---

## Tech Stack

Flux v2 (kustomize-controller, image-reflector-controller, image-automation-controller;
`image.toolkit.fluxcd.io/v1`, `kustomize.toolkit.fluxcd.io/v1`), plain k8s YAML, GitHub Actions
(`docker/build-push-action@v6`), and GHCR. No Helm or helmfile.

## Commands

```bash
# Render the app manifests (placeholders unresolved) — must succeed
kubectl kustomize apps/cms-api/k8s/flux/app

# Check that every ${VAR} is covered by the ConfigMap keys + APP_IMAGE_TAG (fake values, no real env file)
kubectl kustomize apps/cms-api/k8s/flux/app | grep -o '\${[A-Z_]*}' | sort -u

# Offline shape check with fake substitutions (same order as Flux: kustomize build, then envsubst),
# parsed with PyYAML and asserted in Python. Never `kubectl apply --dry-run` — it contacts the cluster.
kubectl kustomize apps/cms-api/k8s/flux/app | APP_NAME=a APP_SERVICE_NAME=s APP_NAMESPACE=n APP_ENV=prod \
  APP_PORT=3000 APP_IMAGE_REPO=r APP_IMAGE_TAG=1-abcdef0 envsubst | python3 -c 'import yaml,sys; print(list(yaml.safe_load_all(sys.stdin)))'

# App checks — unchanged, must still pass
cd apps/cms-api && bun run lint && bun run test && bun run build
```

(`flux`, `kubeconform`, and `actionlint` aren't installed locally. Adding them is an ask-first
step, see Boundaries.)

## Project Structure

```
apps/cms-api/
  k8s/
    .env.example           # Secret key template (APP_* removed)
    config.env.example     # NEW — ConfigMap key template (placeholders only)
    flux/                  # NEW — Flux templates (see Design)
  docs/documents/
    cms-api-flux-deployment.md            # replaces cms-api-k3s-deployment.md
    cms-api-flux-deployment-techstack.md  # replaces cms-api-k3s-deployment-techstack.md (comparison tables)
  docs/rules/k8s-secrets.md               # rewritten for manual Secret + ConfigMap
.github/workflows/ci.yml                  # cms-api-ghcr-publish job only
```

## Code Style

YAML with 2-space indent and a short header comment on each file saying what it is and where its
values come from, like the existing `values.yaml.gotmpl`. Placeholders use Flux envsubst syntax
only:

```yaml
# App container. Every value is substituted by Flux from the <full-app-name>-config ConfigMap
# (APP_*) and the image-automation tag (APP_IMAGE_TAG) — no literals.
containers:
  - name: app
    image: ${APP_IMAGE_REPO}:${APP_IMAGE_TAG}
    command: ["sh", "-c", "PORT=${APP_PORT} exec bun dist/src/main"]
    ports:
      - containerPort: ${APP_PORT}
    envFrom:
      - secretRef:
          name: ${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}-secrets
```

Note: Flux substitutes **after** kustomize has dropped quotes and then converts YAML to JSON. So
a placeholder that expands to something number-like becomes an int wherever it stands alone.
That's required for `containerPort`, but it breaks string fields such as `env[].value`. Only put
a numeric var in a string field when it's part of a longer string, as in the `command` above.

## Testing Strategy

No unit tests. This is infra config. Verification:

1. `kubectl kustomize` renders `k8s/flux/app`.
2. The placeholder set equals `{APP_NAME, APP_SERVICE_NAME, APP_NAMESPACE, APP_ENV, APP_PORT,
   APP_IMAGE_REPO, APP_IMAGE_TAG}`, with no strays.
3. After fake substitution (`kubectl kustomize | envsubst`, which is the same order Flux uses),
   a Python/PyYAML assert checks names, images, envFrom, int ports, the `PORT` command, probes,
   resources and the Service selector. Don't use `kubectl apply --dry-run=client`: it still
   contacts the kubeconfig's cluster.
4. `grep -rn` finds no `abyssoftime`, `hungnh1812dev`, `3000`, or `cms-api` literal under
   `k8s/flux/app/` or in the cms-api publish job.
5. The ImagePolicy regex accepts `57-a1b2c3d` and rejects `57-a1b2c3d-init` and `latest`
   (tested with a quick `grep -E`).
6. Manual, by the owner: the first master push after cutover rolls the Deployment, and
   `flux get images policy` shows the new tag.
7. `bun run lint && bun run test && bun run build` in `apps/cms-api` still pass.

## Boundaries

- **Always:** keep manifests free of project literals, push `-init` before the app tag, update
  docs, the rule file, and `ENTRYPOINT.md` in the same change, and write a techstack comparison
  table per `docs/workflow.md`.
- **Ask first:** installing CLI tools (`flux`, `kubeconform`, `actionlint`), changing any
  non-cms-api CI job, renaming the Dockerfile `migrator` target, any commit, and deleting files
  (helmfile, values, and secrets-chart need explicit confirmation).
- **Never:** read, edit, or create `k8s/.env*` other than `.env.example`, write outside this
  repo (including the GitOps repo), run `kubectl`/`helm`/`flux` against the real cluster, or put
  real values in `config.env.example`.

## Success Criteria

- [x] `k8s/helmfile.yaml.gotmpl`, `k8s/values.yaml.gotmpl`, and `k8s/secrets-chart/` are gone,
      and no doc mentions helmfile as the current deploy path.
- [x] `k8s/flux/` passes Testing steps 1–5.
- [x] CI publishes only `<run_number>-<sha7>` and `<run_number>-<sha7>-init`, with `-init`
      pushed first and the repo taken from `vars.CMS_API_IMAGE_REPO`.
- [x] `k8s/.env.example` has no `APP_*` keys, and `k8s/config.env.example` lists exactly the six
      ConfigMap keys.
- [x] Docs cover the naming contract, owner prerequisites, migration, rollback, and Secret-change
      restart. The techstack doc compares Flux vs helmfile, image automation vs a manual tag, and
      plain manifests vs the shared chart.
- [x] `apps/cms-api` lint, test, and build pass.

## Open Questions

1. **GHCR visibility.** Is the `cms-api` package public? If private, the templates need an
   `imagePullSecrets` placeholder and an ImageRepository `secretRef`, and the owner creates both
   Secrets.
2. **`run_number` resets** if the workflow file is renamed, which would make Flux stop picking up
   new tags. Is that acceptable, or should the tag be a Unix timestamp (`<epoch>-<sha7>`)?
3. **Uncommitted helmfile work** (the current `git status`: Dockerfile, ci.yml, k8s/*, docs).
   Should it be committed first as history, or folded into this change and superseded?
4. **Template location.** You picked `apps/cms-api/deploy/flux/`, but I placed the templates at
   `apps/cms-api/k8s/flux/` so they sit next to the existing `k8s/.env.example` and the
   `k8s-secrets` rule paths stay valid. Is that OK?

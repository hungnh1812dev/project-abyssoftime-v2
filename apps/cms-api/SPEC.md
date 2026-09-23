# Spec: `cms-api` — Helmfile-based k3s deployment + GHCR image pipeline

Date: 2026-09-23
Target app: `apps/cms-api` only (this spec introduces a reusable Helm chart at the repo root, but
scopes its first consumer to cms-api; `cms-admin`/`frontend` are not touched).

---

## Objective

Replace the current ad-hoc, hand-written k8s manifests (`apps/cms-api/k8s/deployment.yaml`,
`service.yaml`) with a **helmfile-driven deployment** so releasing a new cms-api build to the user's
k3s cluster is a single `helmfile apply` instead of manually editing/reapplying raw YAML. CI stops
depending on the Render webhook for cms-api and instead builds and pushes the production image (and
a Prisma-migration variant of it) to GHCR; the user pulls that image onto their VPS/k3s node and runs
helmfile by hand.

### User stories

- **As the operator**, I run one `helmfile apply` in `apps/cms-api/` and get a Deployment (with a
  migration init container that runs `prisma migrate deploy` before the app container starts) and a
  Service, without hand-editing any k8s YAML.
- **As the operator**, when I later add `cms-admin` or `frontend` to k3s, I reuse the same root Helm
  chart with different values instead of writing a new chart from scratch.
- **As the operator**, I apply `apps/cms-api/k8s/secret.yaml` myself (from the committed
  `secret.example.yaml` template) before running helmfile — CI and the chart never see or generate
  real secret values.
- **As the operator**, after CI pushes new images to GHCR, I manually `docker pull` them onto the
  VPS/k3s node and bump the tag in the chart's values before re-running helmfile — no automatic
  cluster deploy from CI.
- **As a maintainer**, the existing Render-webhook deploy for cms-api keeps working untouched unless
  I explicitly flip a repo variable to switch that app over to the new GHCR flow.

### Non-goals

- Migrating `cms-admin` or `frontend` onto k3s/helmfile (this spec only wires up cms-api; the chart
  is written generically so those apps can reuse it later, but their helmfile releases are out of
  scope here).
- Automatic cluster deploy from CI (no `kubectl`/`helmfile apply` runs in GitHub Actions). Pulling
  the image and running helmfile stay manual, per the user's explicit ask.
- Ingress/TLS (still ClusterIP-only per the existing `service.yaml` note — ingress-nginx is broken on
  the user's cluster; out of scope here).
- Multi-environment support (staging, etc.) — namespace is hardcoded to a single `-prod` suffix, per
  the user's spec.
- Changing `main.ts`'s `process.env.PORT` runtime contract or any other application code.

---

## Assumptions (confirmed with user before writing this spec)

1. **Naming values**: `appName = "abyssoftime"`, `servicePostfix = "cms-api"` → full service/release
   name `abyssoftime-cms-api`, full namespace `abyssoftime-prod`, secret name
   `abyssoftime-cms-api-secrets`. Matches the image tag (`abyssoftime-cms-api`) already used in the
   current (uncommitted) manifests.
2. **Migration image**: CI builds and pushes **two** image tags from the existing multi-stage
   `Dockerfile` — the `runner` target (already the default, used by the main container) and the
   `migrator` target (used only by the init container). The `runner` image cannot run
   `prisma migrate deploy` itself (no `prisma/`, `scripts/`, or devDependencies), so a second tag is
   required rather than reusing one image with a different command.
3. **GHCR path**: `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, tagged `<tag>` for the
   runner image and `<tag>-migrate` for the migrator image (same package, two tags — no second GHCR
   package).
4. **CI flag mechanism**: a GitHub Actions **repository variable**, `vars.CMS_API_DEPLOY_MODE`
   (`render` default / `ghcr`), decides whether `deploy-cms-api` still hits the Render webhook or a
   new `cms-api-ghcr-publish` job builds+pushes to GHCR instead. Unset behaves exactly as today
   (Render).

## Open question — resolve during spec review

- **"APP_PORT" vs the existing `PORT` secret key.** The app only ever reads `process.env.PORT`
  (`src/main.ts:10`); there is no `APP_PORT` env var in the code. Helm/Helmfile cannot read a live
  cluster Secret's *value* at template-render time (Secrets are opaque until the pod starts), so the
  numeric port used for `containerPort`/probes/`Service.targetPort` **must** come from a plain
  (non-secret) Helm value — proposed name `appPort` in `apps/cms-api/k8s/values.yaml`, defaulting to
  `3000` to match the current `secret.example.yaml`'s `PORT: "3000"`. The actual app secret keeps
  supplying `PORT` via `envFrom` as it does today. **This means `appPort` (chart value) and `PORT`
  (secret key) are two separate settings that must be kept in sync by whoever edits either — the
  chart cannot enforce that.** Flag if this split is unacceptable; the alternative (a `lookup()` call
  against the live Secret from inside the chart) is an anti-pattern and breaks `helmfile diff`/CI
  templating on a cluster that doesn't have the secret yet, so it is not proposed.

---

## Tech Stack

- **Helm** v3 chart (`charts/app-template/`, repo root) + **helmfile** (`apps/cms-api/helmfile.yaml`)
  — both already installed locally (`/opt/homebrew/bin/helm`, `/opt/homebrew/bin/helmfile`).
- No new runtime dependency in `apps/cms-api` itself — the existing 5-stage `Dockerfile`
  (`deps`/`build`/`prod-deps`/`migrator`/`runner`) is reused as-is, just built with two `--target`
  values in CI instead of one.
- CI: existing GitHub Actions workflow (`.github/workflows/ci.yml`), extended with
  `docker/login-action` + `docker/build-push-action` against `ghcr.io`.

## Commands

```
# Render the chart locally without applying (verification)
helm template abyssoftime-cms-api charts/app-template -f apps/cms-api/k8s/values.yaml

# Diff against the live cluster (requires kubeconfig context set)
cd apps/cms-api && helmfile diff

# Apply (manual, by the user — never run by an agent or CI)
cd apps/cms-api && helmfile apply

# Apply the hand-managed secret + namespace (manual, before first helmfile apply)
kubectl apply -f apps/cms-api/k8s/secret.yaml

# Build both image targets locally (mirrors what CI will do)
docker build --target runner   -t ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:local            apps/cms-api
docker build --target migrator -t ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:local-migrate    apps/cms-api
```

## Project Structure

```
charts/app-template/              → NEW: generic, reusable Helm chart (any app, any postfix/namespace)
  Chart.yaml
  values.yaml                     → chart defaults/schema (appName, servicePostfix, namespaceBase,
                                     image.{repository,tag}, migratorImage.{repository,tag}, appPort,
                                     secretName override, resources, probe path)
  templates/
    deployment.yaml                → main container + conditional initContainer (migrator)
    service.yaml
    _helpers.tpl                   → full name / namespace / secret-name templating helpers

apps/cms-api/
  helmfile.yaml                    → NEW: release pointing at ../../charts/app-template,
                                     namespace = "{{ .Values.namespaceBase }}-prod"
  k8s/
    values.yaml                    → NEW: cms-api's own (non-secret) Helm values
    secret.example.yaml            → UPDATED: renamed Secret/namespace to match new naming
    secret.yaml                    → untouched by any agent (real secrets, gitignored)
    deployment.yaml, service.yaml  → REMOVED once the chart replaces them (ask before deleting —
                                     untracked but pre-existing files)

.github/workflows/ci.yml           → UPDATED: new cms-api-ghcr-publish job (builds+pushes 2 tags),
                                     deploy-cms-api job gated by vars.CMS_API_DEPLOY_MODE
```

## Code Style

- Match the existing k8s YAML style already in this repo: a top comment block explaining what the
  file is, any manual pre-req steps, and the exact command to apply it (see current
  `service.yaml`/`secret.example.yaml` headers).
- Helm chart templates use `{{- ... }}` whitespace-trimming consistently and a single `_helpers.tpl`
  for name-construction logic (`abyssoftime-cms-api`, `abyssoftime-cms-api-secrets`, etc.) rather than
  repeating `printf`/`Chart.Name` interpolation inline in each template — one source of truth for the
  naming convention described in Objective.
- GitHub Actions: follow the existing job style in `ci.yml` (named steps, `defaults.run.working-directory`,
  `needs`/`if` gating via `change-detecter` outputs) — the new GHCR job slots into the same
  `needs: [cms-api-build]` dependency chain the current `deploy-cms-api` job uses.

## Testing Strategy

Infra config has no unit-test framework; verification is command-based and manual:

- `helm lint charts/app-template` — chart passes lint with no errors.
- `helm template ... -f apps/cms-api/k8s/values.yaml` renders valid YAML with the expected resource
  names (`abyssoftime-cms-api` Deployment/Service, `abyssoftime-cms-api-secrets` referenced via
  `envFrom`, init container using the `-migrate`-tagged image).
- `helmfile diff` (or `helmfile template`) runs clean against `apps/cms-api/helmfile.yaml`.
- GitHub Actions YAML is valid (`actionlint` if available, otherwise a syntax-only check) — the new
  job doesn't break `change-detecter`/existing job graph for cms-admin/frontend.
- **Manual, by the user, out of this workflow's automated scope**: an actual `helmfile apply` against
  their live k3s cluster, confirming the init container completes a migration and the main container
  reaches Ready.

## Boundaries

- **Always do**: keep `charts/app-template` generic (no cms-api-specific defaults hardcoded into the
  chart itself — cms-api-specific values belong in `apps/cms-api/k8s/values.yaml`); keep the existing
  Render-webhook path in `ci.yml` working when `CMS_API_DEPLOY_MODE` is unset/`render`; never write
  real secret values anywhere in the repo.
- **Ask first**: deleting `apps/cms-api/k8s/deployment.yaml`/`service.yaml` (untracked pre-existing
  files, superseded by the chart — per the user's global rule, confirm before any delete); any change
  to `docs/rules/k8s-secrets.md`'s protected-file list; adding a second GHCR package/path instead of
  the two-tag-one-package convention above if that turns out to be preferred later.
- **Never do**: read, edit, create, or delete `apps/cms-api/k8s/secret.yaml` (existing rule,
  unchanged); commit real secret values, GHCR credentials, or kubeconfig into the repo; add a
  `kubectl`/`helmfile apply` step to CI (deploy stays manual per the user's explicit ask); rename or
  remove the existing `deploy-cms-api`/Render-webhook job.

## Success Criteria

- `charts/app-template` exists, lints clean, and takes `appName`/`servicePostfix`/`namespaceBase` as
  values with no cms-api-specific hardcoding.
- `apps/cms-api/helmfile.yaml` + `apps/cms-api/k8s/values.yaml` render a Deployment named
  `abyssoftime-cms-api` in namespace `abyssoftime-prod`, with an init container running the
  `-migrate`-tagged image before the main `abyssoftime-cms-api` container starts, both pulling
  `envFrom` the `abyssoftime-cms-api-secrets` Secret.
- `apps/cms-api/k8s/secret.example.yaml` reflects the renamed namespace/Secret name (still placeholder
  values only).
- `.github/workflows/ci.yml` still has an unmodified default path (Render webhook) for cms-api, plus a
  new path — gated by `vars.CMS_API_DEPLOY_MODE == 'ghcr'` — that builds and pushes both the runner
  and migrator image tags to `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`.
- The old raw `apps/cms-api/k8s/deployment.yaml`/`service.yaml` are removed (after explicit
  confirmation) once the chart is verified to render equivalent resources.
- `docs/documents/` gains a doc for this feature (helmfile/chart + GHCR pipeline) per the repo
  workflow's "Update docs" step, and `apps/cms-api/docs/ENTRYPOINT.md` gains an index line pointing to
  it.

---

## Next steps

Per `docs/workflow.md`'s feature workflow, once this spec is approved: run **Build (plan)** to
produce `apps/cms-api/tasks/plan.md` + `tasks/todo.md` (task breakdown for chart → helmfile → secret
template update → CI job → docs), then **Build (execute)**.

# Todo: cms-api Helmfile deployment + GHCR image pipeline

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS** — 2 done / 13 tasks

Checkbox updates ship in the same commit as that phase's code.

## Phase 1 — Reusable Helm chart (`charts/app-template/`)

- [x] **T1 — Chart skeleton: naming plumbing.** `Chart.yaml` (apiVersion v2), `values.yaml` schema
  (all generic, no cms-api defaults): `appName`, `servicePostfix`, `namespaceBase`,
  `image.{repository,tag}`, `migratorImage.{repository,tag}`, `migration.enabled` (bool, default
  `true`), `appPort` (default `3000`), `secretName` (optional override; defaults to computed
  `<appName>-<servicePostfix>-secrets`), `resources`, `probePath` (default `/health`). `_helpers.tpl`:
  `app-template.fullname` (`<appName>-<servicePostfix>`), `app-template.namespace`
  (`<namespaceBase>-prod`), `app-template.secretName` (override or computed default).
  - Acceptance: chart metadata valid; helpers compute the three names correctly for arbitrary
    appName/servicePostfix input (verified via T2's render — a bare `_helpers.tpl` has nothing to
    render on its own).
  - Verify: folded into T2's verify.
  - Files: `charts/app-template/Chart.yaml`, `charts/app-template/values.yaml`,
    `charts/app-template/templates/_helpers.tpl`
  - Deps: none. Size: S

- [x] **T2 — Deployment + Service templates.** `deployment.yaml`: one container
  (`image.repository:image.tag`, `envFrom` the computed secret, `containerPort`/readiness+liveness
  `httpGet` on `probePath` using `appPort`); one `initContainers` entry when `migration.enabled`
  (image `migratorImage.repository:migratorImage.tag`, same `envFrom` — no command override needed,
  the `migrator` Dockerfile target's own `CMD` already runs `prisma migrate deploy`). `service.yaml`:
  ClusterIP, named port `http`, `port: 80` → `targetPort: http` (same convention as the current
  uncommitted `service.yaml`).
  - Acceptance: `helm template` output has exactly one Deployment + one Service, names matching the
    helper convention, init container listed before the main container, `envFrom` on both containers.
  - Verify: `helm lint charts/app-template` (no errors); `helm template rel charts/app-template
    --set appName=demo,servicePostfix=api,namespaceBase=demo,image.repository=example/app,image.tag=v1,migratorImage.repository=example/app,migratorImage.tag=v1-migrate`
    — inspect rendered YAML.
  - Files: `charts/app-template/templates/deployment.yaml`,
    `charts/app-template/templates/service.yaml`
  - Deps: T1. Size: M

> **CHECKPOINT A** — **PASSED** (2026-09-23). `helm lint charts/app-template` clean (no errors).
> `helm template` with cms-api-like sample values (`appName=demo,servicePostfix=api,namespaceBase=demo,...`)
> renders exactly one Deployment + one Service named `demo-api`, namespace `demo-prod`, init
> container (`demo-api-migrate`) listed before the main container, both with `envFrom:
> secretRef.name: demo-api-secrets`. `secretName` override verified independently (renders the
> literal override instead of the computed default). No cms-api specifics in the chart itself.
>
> Implementation note: the chart's own **default** `values.yaml` (used by bare `helm lint`/
> `helm template` with no overrides) needed non-empty placeholder values (`appName: "app"`,
> `servicePostfix: "service"`, `namespaceBase: "default"`, `*.repository: "changeme/app"`) rather
> than empty strings — an empty `appName`/`servicePostfix` renders `name: -`, which is invalid/
> ambiguous YAML to Helm's parser (`block sequence entries are not allowed in this context`).
> These are still generic, non-app-specific placeholders; every real consumer overrides all of them.
> **Commit 1** — once Checkpoint A passes.

## Phase 2 — cms-api's helmfile release

- [ ] **T3 — `apps/cms-api/helmfile.yaml` + `apps/cms-api/k8s/values.yaml`.** One release, chart
  `../../charts/app-template`, values file `k8s/values.yaml`, namespace `abyssoftime-prod` set
  literally on the release (helmfile releases take a literal namespace, not re-derived at this
  layer). Values: `appName: abyssoftime`, `servicePostfix: cms-api`, `namespaceBase: abyssoftime`,
  `image.repository: ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, `image.tag: latest`,
  `migratorImage.repository`: same, `migratorImage.tag: latest-migrate`, `appPort: 3000` (matches
  `secret.example.yaml`'s `PORT: "3000"` — call out the pairing in a comment).
  - Acceptance: `helmfile template` renders a Deployment named `abyssoftime-cms-api` in namespace
    `abyssoftime-prod` with an init container image ending `latest-migrate` and main container image
    `...cms-api:latest`, both `envFrom: abyssoftime-cms-api-secrets`.
  - Verify: `cd apps/cms-api && helmfile template` (no cluster needed).
  - Files: `apps/cms-api/helmfile.yaml`, `apps/cms-api/k8s/values.yaml`
  - Deps: Checkpoint A. Size: S

- [ ] **T4 — Rename `apps/cms-api/k8s/secret.example.yaml`.** `Namespace.metadata.name` and
  `Secret.metadata.namespace` → `abyssoftime-prod` (was `abyssoftime`); `Secret.metadata.name` →
  `abyssoftime-cms-api-secrets` (was `cms-api-env`). Update the header comment (apply-order note,
  `kubectl apply -f` example) to match. Keys unchanged. `secret.yaml` itself is never touched.
  - Acceptance: `abyssoftime-cms-api-secrets` matches exactly what T3's rendered Deployment
    references in `envFrom`.
  - Verify: `kubectl apply --dry-run=client -f apps/cms-api/k8s/secret.example.yaml` succeeds
    (client-side, no live cluster needed); diff review against T3's rendered secret name.
  - Files: `apps/cms-api/k8s/secret.example.yaml`
  - Deps: T3. Size: XS

- [ ] **T5 — Remove superseded raw manifests.** Ask the user explicitly before deleting (untracked,
  pre-existing files). Cross-check first that T2/T3's rendered output covers everything the old files
  did (resource requests/limits, probe timings); note the old `imagePullPolicy: Never` +
  `docker save | ssh ... ctr images import` flow is fully replaced by the GHCR pull flow (documented
  in T8).
  - Acceptance: files deleted only after explicit confirmation; `grep -r` for the deleted filenames
    comes back clean.
  - Verify: manual cross-check + confirmation.
  - Files (deleted): `apps/cms-api/k8s/deployment.yaml`, `apps/cms-api/k8s/service.yaml`
  - Deps: T3, T4. Size: XS

> **CHECKPOINT B** — go/no-go: chart + helmfile + renamed secret template together fully replace the
> old raw manifests; deletion confirmed with the user first.
> **Commit 2** — once Checkpoint B passes.

## Phase 3 — CI/CD (parallel to Phase 1/2)

- [ ] **T6 — New `cms-api-ghcr-publish` job.** `needs: [cms-api-build]`,
  `if: needs.change-detecter.outputs.cms-api == 'true' && vars.CMS_API_DEPLOY_MODE == 'ghcr' && github.ref == 'refs/heads/master' && github.event_name == 'push'`,
  `permissions: { contents: read, packages: write }`. Steps: checkout, `docker/login-action@v3`
  (`registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`),
  two `docker/build-push-action@v6` calls against `apps/cms-api` — `target: runner` tagged
  `ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:{latest,<short-sha>}` and `target: migrator`
  tagged `...:{latest-migrate,<short-sha>-migrate}`.
  - Acceptance: job only runs when the repo variable is set to `ghcr`; produces both image tags on a
    master push.
  - Verify: YAML parses (`python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`);
    read-through confirms `cms-admin`/`frontend` jobs and their `needs`/`if` graphs are byte-identical
    to before.
  - Files: `.github/workflows/ci.yml`
  - Deps: none (independent of Phase 1/2). Size: M

- [ ] **T7 — Gate the existing Render deploy job.** Add `&& vars.CMS_API_DEPLOY_MODE != 'ghcr'` to
  `deploy-cms-api`'s existing `if:` condition — every other line of that job untouched, so an unset
  variable reproduces today's behavior exactly.
  - Acceptance: with `CMS_API_DEPLOY_MODE` unset, `deploy-cms-api` still runs and
    `cms-api-ghcr-publish` does not; with it set to `ghcr`, the reverse.
  - Verify: same YAML-parse check as T6; trace both branches of the condition by hand.
  - Files: `.github/workflows/ci.yml`
  - Deps: T6 (same file/section, sequential). Size: XS

> **CHECKPOINT C** — go/no-go: full diff of `.github/workflows/ci.yml` reviewed — only the new job
> and one added `if` clause change; every other job (`cms-admin-*`, `frontend-*`, `deploy-cms-admin`,
> `deploy-frontend`, all `cms-api-*` build/test/lint jobs) untouched. YAML valid.
> **Commit 3** — once Checkpoint C passes.

## Phase 4 — Docs & wrap-up

- [ ] **T8 — `docs/documents/cms-api-k3s-deployment.md`.** Module doc (matches the
  `docs/documents/*.md` convention): chart location + what's generic vs. cms-api-specific, the
  init-container migration mechanism, the full manual operator flow (apply `secret.yaml` → `helmfile
  apply`), the GHCR image path + two-tag convention, the `CMS_API_DEPLOY_MODE` flag, and the
  `appPort`/`PORT` pairing caveat.
  - Files: `apps/cms-api/docs/documents/cms-api-k3s-deployment.md`
  - Deps: Checkpoint B, Checkpoint C. Size: S

- [ ] **T9 — `docs/documents/cms-api-k3s-deployment-techstack.md`.** Decision-rationale table per
  `docs/workflow.md`: Helm+helmfile vs. Kustomize vs. raw manifests; two-tag-one-GHCR-package vs.
  two-packages for the migrator image; repo-variable vs. `workflow_dispatch` input for the CI flag.
  - Files: `apps/cms-api/docs/documents/cms-api-k3s-deployment-techstack.md`
  - Deps: T8. Size: S

- [ ] **T10 — `apps/cms-api/docs/ENTRYPOINT.md`.** Add index entries for T8/T9, matching the existing
  bullet format.
  - Files: `apps/cms-api/docs/ENTRYPOINT.md`
  - Deps: T9. Size: XS

> **CHECKPOINT D** — Docs read-through for consistency.
> **Commit 4** — once Checkpoint D passes.

## Phase 5 — Review & cleanup

- [ ] **T11 — Five-axis review** (`agent-skills:code-reviewer`) — correctness (naming/templating
  logic), readability, architecture (chart genericity, no cms-api leakage), security (no secrets
  baked in, `GITHUB_TOKEN` scoped to `packages: write` only, no cluster credentials in CI),
  performance (n/a for YAML — note and skip).
  - Deps: Checkpoint D. Size: M

- [ ] **T12 — Reduce `apps/cms-api/SPEC.md` to a minimal pointer**, per this repo's established
  convention (see the Dockerfile feature's `tasks/archive.md` T14 for precedent) — once T8/T9 fully
  capture the implementation, strip the spec back to a short pointer at those docs.
  - Deps: T11. Size: XS

> **CHECKPOINT E** — Final review sign-off. Ask for explicit commit confirmation (exact staged files
> + full commit message) before committing, per `docs/workflow.md`'s commit rules.

- [ ] **T13 — Commit confirmation** — ask Yes/No on the exact staged file list and full commit
  message before running `git commit`.
  - Deps: Checkpoint E. Size: XS

# Todo: cms-api Helmfile deployment + GHCR image pipeline

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS** — 12 done / 13 tasks (in-repo chart phases archived as superseded — see
[`tasks/archive.md`](archive.md))

Checkbox updates ship in the same commit as that phase's code.

**Chart:** the shared, externally published `oci://ghcr.io/hungnh1812dev/helmfile-chart-template`,
**unpinned**: `helmfile.yaml` has no `version:`, so each deploy fetches the latest published version
(0.3.0 at the last re-plan). Its source lives in its own repo; this repo only consumes it. It
replaces the in-repo `charts/app-template/` chart built in the archived Phases 1/1.5.

**Cache caveat (verified with helmfile v1.5.2):** helmfile caches an unversioned OCI chart and skips
refreshing it on later runs ("Skipping refresh for chart at …/helmfile-chart-template"). The first
fetched version would stick. The operator flow is therefore `helmfile cache cleanup && helmfile
apply`. A semver range (`version: ">=0.2.0"`) was also tested; it caches under the range string and
has the same problem, so it adds nothing.

## Phase 0 — Switch to the published chart

- [x] **T0a — Align `apps/cms-api/SPEC.md` with `helmfile-chart-template` (latest, currently 0.3.0).** Rewrite the
  sections that describe `charts/app-template`: naming inputs are now `appName`/`serviceName`/
  `appNamespace`/`appEnv` (was `appName`/`servicePostfix`/`namespaceBase`); resource names change to
  Deployment/Service `abyssoftime-cms-api-prod`, namespace `abyssoftime-prod` (the chart **fails** the
  render unless the release namespace equals `<appNamespace>-<appEnv>`), Secret
  `abyssoftime-cms-api-secrets-prod` (fixed by the chart, no override). Service now exposes `appPort`
  directly (`3000 → 3000`, was `80 → http`). The migrator runs through `initContainers.containers`
  (plain container spec) and secrets through `secrets.enabled: true` (`envFrom` on the app and every
  init container). Probes come from `probes.enabled` + `probes.{liveness,readiness}` (httpGet on
  port `http`). The chart defaults the path to `/healthz`, so cms-api must override it with `/health`.
  Drop the chart-publish CI job, the `helm package`/`helm push` commands, and
  `charts/app-template/` from Project Structure/Testing/Boundaries/Success Criteria.
  - Acceptance: `grep -n "servicePostfix\|namespaceBase" apps/cms-api/SPEC.md` returns nothing, and
    `app-template` appears only as "removed". Every resource name in the spec matches the latest
    chart's render.
  - **Done (2026-09-23).** Spec rewritten around a numbered Decisions list. Added decision 6 (found
    while rewriting): with a fixed `latest` tag, `helmfile apply` renders identical manifests and
    doesn't restart pods. New images are rolled out with
    `kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod`, or by switching
    `values.yaml` to `<short-sha>` tags.
  - Verify: read-through against `helm template` output of the published chart.
  - Files: `apps/cms-api/SPEC.md`
  - Deps: none. Size: S

- [x] **T0b — Remove the in-repo chart and its publish job.** Ask the user explicitly before deleting.
  Delete `charts/app-template/` (and `charts/` if empty). In `.github/workflows/ci.yml` remove the
  `helm-chart` output, path filter and debug-summary line from `change-detecter`, and the whole
  `helm-chart-publish` job. Every other job stays byte-identical.
  - Acceptance: `app-template`/`helm-chart` appear only in the spec/task files as "removed"/history;
    `ci.yml` diff touches only those lines.
  - **Done (2026-09-23).** Deletion confirmed by the user. The `ci.yml` diff is 31 deleted lines, and
    `git diff 817bccc~1 -- .github/workflows/ci.yml` is empty: the workflow is byte-identical to its
    state before the chart-publish commit. YAML parses; `actionlint` is not installed.
  - Verify: `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`;
    `grep -rn "app-template\|helm-chart" --exclude-dir=node_modules . | grep -v tasks/archive.md` is
    empty; `git diff .github/workflows/ci.yml` read-through.
  - Files (deleted): `charts/app-template/**`; (edited): `.github/workflows/ci.yml`
  - Deps: none. Size: S

> **CHECKPOINT 0**: **PASSED** (2026-09-23). The spec matches the published chart, and the in-repo
> chart and publish job are gone, with deletion confirmed by the user.
> **Commit 1**: once Checkpoint 0 passes.

## Phase 2 — cms-api's helmfile release

- [x] **T4 — `apps/cms-api/helmfile.yaml` + `apps/cms-api/k8s/values.yaml`.** One release
  `abyssoftime-cms-api-prod`, namespace `abyssoftime-prod` (literal; it must equal
  `<appNamespace>-<appEnv>` or the chart fails), chart from an OCI repository entry
  (`repositories: [{name: hungnh1812dev, url: ghcr.io/hungnh1812dev, oci: true}]`,
  `chart: hungnh1812dev/helmfile-chart-template`), **no `version:`**, so the latest published chart is
  used. Add a comment above the release explaining that and the `helmfile cache cleanup`
  requirement. Values file `k8s/values.yaml`. Values:
  - `appName: abyssoftime`, `serviceName: cms-api`, `appNamespace: abyssoftime`, `appEnv: prod`
  - `appPort: 3000` (must match `secret.example.yaml`'s `PORT: "3000"`; add a comment about the pairing)
  - `image.repository: ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api`, `image.tag: latest`
    (no `pullPolicy`, since the chart defaults to `Always` as of 0.3.0)
  - `resources`: carry over the old manifest's `100m/128Mi` requests and `500m/512Mi` limits
  - `secrets.enabled: true`
  - `initContainers.enabled: true`, `containers: [{name: migrate, image: ghcr.io/hungnh1812dev/project-abyssoftime-v2/cms-api:latest-migrate, imagePullPolicy: Always}]`.
    No `command` is needed because the `migrator` target's `CMD` already runs `prisma migrate deploy`.
    Set `imagePullPolicy: Always` explicitly. The chart's `pullPolicy` only applies to the main
    container, and Kubernetes pulls every time by default only for a tag that is exactly `latest`.
    `latest-migrate` would default to `IfNotPresent` and never re-pull.
  - `probes.enabled: true`, with the old manifest's settings carried over: `liveness: {path: /health,
    initialDelaySeconds: 15, periodSeconds: 20}` and `readiness: {path: /health, initialDelaySeconds: 5,
    periodSeconds: 10}`. The path must be overridden because the chart defaults to `/healthz`, while
    cms-api serves `/health` outside the `api/v1` prefix (`src/bootstrap/configure-app.ts:95`).
    `timeoutSeconds: 1`/`failureThreshold: 3` come from the chart defaults.
  - Acceptance: `helmfile template` renders a Deployment and a Service named
    `abyssoftime-cms-api-prod` in `abyssoftime-prod`. The init container `migrate` uses the
    `latest-migrate` image and is listed before the main container (image `...cms-api:latest`). Both
    containers have `envFrom: abyssoftime-cms-api-secrets-prod`. Both images use
    `imagePullPolicy: Always`. The liveness and readiness probes hit `/health` with the old timings.
    Resources match the old manifest, and the Service port is `3000`.
  - Verify: `cd apps/cms-api && helmfile cache cleanup && helmfile template`. The "Pulling" line shows
    no tag, and the render matches the acceptance criteria. The same setup (unversioned, OCI repo
    entry) and these exact values rendered successfully against 0.3.0 during planning.
  - Files: `apps/cms-api/helmfile.yaml`, `apps/cms-api/k8s/values.yaml`
  - Deps: T0a. Size: S
  - **Done (2026-09-23).** `helmfile cache cleanup && helmfile template` pulled chart 0.3.0 with no
    tag, and every acceptance item checked out in the render.

- [x] **T5 — Rename `apps/cms-api/k8s/secret.example.yaml`.** `Namespace.metadata.name` and
  `Secret.metadata.namespace` → `abyssoftime-prod` (was `abyssoftime`); `Secret.metadata.name` →
  `abyssoftime-cms-api-secrets-prod` (was `cms-api-env`). This name is fixed by the chart's
  `chart.secretName` helper. Update the header comment (apply-order note, `kubectl apply -f` example)
  to match. Keys unchanged. `secret.yaml` itself is never touched.
  - Acceptance: `abyssoftime-cms-api-secrets-prod` matches exactly what T4's rendered Deployment
    references in `envFrom`.
  - Verify: `kubectl apply --dry-run=client -f apps/cms-api/k8s/secret.example.yaml` succeeds
    (client-side, no live cluster needed); diff review against T4's rendered secret name.
  - Files: `apps/cms-api/k8s/secret.example.yaml`
  - Deps: T4. Size: XS
  - **Done (2026-09-23).** The header now also notes the apply-before-helmfile order and that the
    Secret name is fixed by the chart. `kubectl apply --dry-run=client` can't run offline: it still
    fetches OpenAPI from the unreachable cluster. It was replaced by a YAML parse check (Namespace
    `abyssoftime-prod` plus Secret `abyssoftime-cms-api-secrets-prod` in `abyssoftime-prod`, 20 keys)
    and a name match against T4's rendered `envFrom`. `kubeconform` is not installed.

- [x] **T6 — Remove superseded raw manifests.** Ask the user explicitly before deleting (untracked,
  pre-existing files). First cross-check T4's render against the old files. Resources and the `/health`
  readiness/liveness probes (same timings) carry over. The Service port changes from `80` to `3000`, so the port-forward becomes
  `svc/abyssoftime-cms-api-prod 3000:3000`. The old `imagePullPolicy: Never` +
  `docker save | ssh ... ctr images import` flow is fully replaced by the GHCR pull flow (documented
  in T9).
  - Acceptance: files deleted only after explicit confirmation; `grep -r` for the deleted filenames
    comes back clean.
  - Verify: manual cross-check + confirmation.
  - Files (deleted): `apps/cms-api/k8s/deployment.yaml`, `apps/cms-api/k8s/service.yaml`
  - Deps: T4, T5. Size: XS
  - **Done (2026-09-23).** Cross-check passed: resources and probes are identical. Additions:
    migrate init container and GHCR images. Renames: names/namespace, with Service `80→http` becoming
    `3000→3000`. Deletion was confirmed by the user, and no references remain outside the task/spec
    history. Operator note: the old `cms-api` Deployment/Service and the `cms-api-env` Secret in the
    `abyssoftime` namespace still exist on the live cluster until removed by hand.

> **CHECKPOINT B**: **PASSED** (2026-09-23). The helmfile, pulling the latest
> `helmfile-chart-template` (0.3.0) from GHCR, and the renamed secret template fully replace the old
> raw manifests. The render matches the old manifest, including probes, and deletion was confirmed by
> the user.
> **Commit 2**: once Checkpoint B passes.

## Phase 3 — CI/CD for cms-api images (parallel to Phase 0/2)

- [x] **T7 — New `cms-api-ghcr-publish` job.** `needs: [cms-api-build]`,
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
  - Deps: T0b (same file; land the removal first). Size: M
  - **Done (2026-09-23), with one deviation:** the `if` drops the
    `needs.change-detecter.outputs.cms-api == 'true'` check. The `needs` context only holds *direct*
    dependencies, so it would evaluate to empty here. It is also redundant, because
    `needs: [cms-api-build]` already skips this job when cms-api didn't change, the same way
    `deploy-cms-api` works. The short SHA is computed in a step (`${GITHUB_SHA::7}`). There is no buildx
    setup: the default driver shares layers between the two builds in the same job. Unverified
    observation: the existing `cms-api-lint`/`-test`/`-build` jobs (and the cms-admin/frontend
    equivalents) use the same `needs.change-detecter` pattern without a direct dependency. That may
    make them always skip. Worth checking against a real run, but it is outside this feature's scope.

- [x] **T8 — Gate the existing Render deploy job.** Add `&& vars.CMS_API_DEPLOY_MODE != 'ghcr'` to
  `deploy-cms-api`'s existing `if:` condition — every other line of that job untouched, so an unset
  variable reproduces today's behavior exactly.
  - Acceptance: with `CMS_API_DEPLOY_MODE` unset, `deploy-cms-api` still runs and
    `cms-api-ghcr-publish` does not; with it set to `ghcr`, the reverse.
  - Verify: same YAML-parse check as T7; trace both branches of the condition by hand.
  - Files: `.github/workflows/ci.yml`
  - Deps: T7 (same file/section, sequential). Size: XS
  - **Done (2026-09-23).** Both branches traced by hand. Unset or `render` means Render deploy runs
    and the publish job is skipped; `ghcr` means the reverse.

> **CHECKPOINT C**: **PASSED** (2026-09-23). The `ci.yml` diff since Commit 2 is +47/-1: the new
> `cms-api-ghcr-publish` job plus the one changed `deploy-cms-api` `if` line. Every other job is
> untouched, and the YAML parses. `actionlint` is not installed. The image builds run only on a real
> master push, because there are no GHCR credentials here.
> **Commit 3**: once Checkpoint C passes.

## Phase 4 — Docs & wrap-up

- [x] **T9 — `docs/documents/cms-api-k3s-deployment.md`.** Module doc (matches the
  `docs/documents/*.md` convention). Cover:
  - The external chart (`oci://ghcr.io/hungnh1812dev/helmfile-chart-template`, unpinned so each
    deploy uses the latest version, source in its own repo). Cover the cache caveat
    (`helmfile cache cleanup` before every apply), and use `helmfile diff` to preview what a new
    chart version changes.
  - Which values are cms-api-specific, and the derived names
    (`abyssoftime-cms-api-prod`, `abyssoftime-prod`, `abyssoftime-cms-api-secrets-prod`).
  - The init-container migration mechanism.
  - The full manual operator flow: apply `secret.yaml`, then `helmfile apply`. Include rolling out
    new `latest` images with `kubectl rollout restart` (apply alone doesn't restart pods when the
    manifests are unchanged; see `SPEC.md` decision 6).
  - The GHCR image path, the two-tag convention.
  - The `CMS_API_DEPLOY_MODE` flag.
  - The `appPort`/`PORT` pairing caveat.
  - The `/health` probe override (the chart defaults to `/healthz`) and why the migrate init
    container sets `imagePullPolicy: Always` explicitly.
  - Files: `apps/cms-api/docs/documents/cms-api-k3s-deployment.md`
  - Deps: Checkpoint B, Checkpoint C. Size: S

- [x] **T10 — `docs/documents/cms-api-k3s-deployment-techstack.md`.** Decision-rationale table per
  `docs/workflow.md`. Compare:
  - Helm+helmfile vs. Kustomize vs. raw manifests.
  - Unpinned (latest) chart vs. a pinned version vs. a semver range. Latest was chosen by the user
    so chart updates reach cms-api without edits here. The trade-off is less reproducible deploys.
  - A shared external chart published from its own repo vs. an in-repo chart published from this
    repo's CI (tried, then superseded) vs. a local relative path.
  - Two tags in one GHCR package vs. two packages for the migrator image.
  - A repo variable vs. a `workflow_dispatch` input for the CI flag.
  - Files: `apps/cms-api/docs/documents/cms-api-k3s-deployment-techstack.md`
  - Deps: T9. Size: S

- [x] **T11 — `apps/cms-api/docs/ENTRYPOINT.md`.** Add index entries for T9/T10, matching the
  existing bullet format.
  - Files: `apps/cms-api/docs/ENTRYPOINT.md`
  - Deps: T10. Size: XS

> **CHECKPOINT D**: **PASSED** (2026-09-23). A read-through of both docs, `SPEC.md`,
> `helmfile.yaml` and `values.yaml` found no contradictions. T9 also documents two operator points
> that weren't planned: GHCR packages are private by default, so the node needs pull access (the chart
> has no `imagePullSecrets` value yet), and the old `abyssoftime`-namespace resources must be removed
> by hand.
> **Commit 4**: once Checkpoint D passes.

## Phase 5 — Review & cleanup

- [x] **T12 — Five-axis review** (`agent-skills:code-reviewer`). Axes:
  - Correctness: helmfile/values render the intended names, the namespace guard passes, and the
    init container gets the secret.
  - Readability.
  - Architecture: cms-api specifics live only in `k8s/values.yaml`, and the chart is consumed rather
    than forked.
  - Security: no secrets baked in, `GITHUB_TOKEN` scoped to `packages: write` only, no cluster
    credentials in CI.
  - Performance: n/a for YAML; note it and skip.
  - Deps: Checkpoint D. Size: M
  - **Done (2026-09-23).** Verdict: REQUEST CHANGES, with no Critical findings. Both Important
    findings were confirmed and fixed:
    - `latest` and `latest-migrate` could diverge if the run failed or was cancelled
      (`cancel-in-progress`) between the two pushes. Now both images are built first and pushed in
      order: SHA tags, then `latest-migrate`, then `latest`.
    - `.dockerignore` didn't exclude `k8s/`, so a local `COPY . .` would bake the real `secret.yaml`
      into the migrator image. `k8s` and `helmfile.yaml` are now excluded.
    - Also applied: the `org.opencontainers.image.source` label, and an `ENTRYPOINT.md` techstack
      list that was missing 2 of the 6 tables.
    - Not applied: `resources` on the init container, a non-root `USER` in the `migrator` stage, and
      buildx GHA cache. All three are optional follow-ups.
    - The pre-existing `needs.change-detecter` issue (see T7) was re-raised as possibly blocking the
      whole cms-api chain. It needs a real CI run to confirm and is left to the user.
    - The `ci.yml` change after the fix still parses.

- [x] **T13 — Reduce `apps/cms-api/SPEC.md` to a minimal pointer**, per this repo's established
  convention (see the Dockerfile feature's `tasks/archive.md` T14 for precedent) — once T9/T10 fully
  capture the implementation, strip the spec back to a short pointer at those docs.
  - Deps: T12. Size: XS
  - **Done (2026-09-23).** Every spec decision is captured in `cms-api-k3s-deployment.md` and
    `cms-api-k3s-deployment-techstack.md`. `SPEC.md` is now the standard "No active spec → see
    `docs/ENTRYPOINT.md`" pointer.

> **CHECKPOINT E** — Final review sign-off. Ask for explicit commit confirmation (exact staged files
> + full commit message) before committing, per `docs/workflow.md`'s commit rules.

- [ ] **T14 — Commit confirmation** — ask Yes/No on the exact staged file list and full commit
  message before running `git commit`.
  - Deps: Checkpoint E. Size: XS

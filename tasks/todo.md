# Todo: cms-api tag bump from CI (replace Flux image automation)

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS**. 2 of 6 tasks done.

Checkbox updates ship in the same commit as that phase's work. Verification is offline only: never
run `kubectl apply`/`flux`/`helm` against a cluster, and never read `k8s/secret.yaml` or
`k8s/configmap.yaml`.

## Phase 1: Flux cluster manifests

- [x] **T1: Clean up the vm-dev app Kustomization.** (XS)
  - Files: `clusters/abyssdev/vm-dev/abyssdev-apps-develop.yaml`
  - Acceptance:
    - The `# {"$imagepolicy": …}` marker is removed. `APP_IMAGE_TAG` stays a plain quoted string
      (`"dev"` until the first bump).
    - There's a header comment saying CI rewrites this value through a PR.
    - `interval: 3m`, `prune: true`, `wait: true` and `timeout: 5m` are unchanged.
  - Verify:
    - `kubectl kustomize clusters/abyssdev/vm-dev` renders.
    - The assert script finds no `$imagepolicy` anywhere under `clusters/`.
  - Deps: none

- [x] **T2: Wire up vm-prod: fix the bootstrap path and add the app Kustomization.** (S)
  - Files:
    - `clusters/abyssdev/vm-prod/flux-system/gotk-sync.yaml` (**ask first:** generated file)
    - `clusters/abyssdev/vm-prod/kustomization.yaml` (new)
    - `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml` (new)
  - Acceptance:
    - `gotk-sync.yaml` path is `./clusters/abyssdev/vm-prod`, and nothing else in it changes.
    - `kustomization.yaml` lists `flux-system/` and `abyssdev-apps-prod.yaml`.
    - `abyssdev-apps-prod.yaml` mirrors vm-dev: name `abyssdev-cms-api-sync-prod`, path
      `./apps/cms-api/k8s/flux`, ConfigMap `abyssdev-cms-api-prod-config`, the same intervals,
      prune, wait and timeout, and the same `APP_IMAGE_TAG` key layout.
  - Verify:
    - `kubectl kustomize clusters/abyssdev/vm-prod` renders.
    - The assert script checks that the two app files differ only in name, ConfigMap and tag value.
  - Deps: none (parallel with T1)

### Checkpoint 1
- [x] Both cluster dirs render, and the assert script passes.
- [x] Commit: the owner confirms the file list and message (Yes/No, no `Co-Authored-By`).

## Phase 2: CI bump

- [ ] **T3: Add the `cms-api-bump-tag` job and the publish `outputs.tag`.** (S)
  - Files: `.github/workflows/ci.yml`
  - **Ask first:** adding `peter-evans/create-pull-request@v7`.
  - Acceptance:
    - `cms-api-ghcr-publish` gains `outputs: tag: ${{ steps.tag.outputs.tag }}`. Nothing else in
      that job changes.
    - The new job has:
      - `needs: [cms-api-ghcr-publish]`, the same `master` + `push` guard, and permissions
        `contents: write` and `pull-requests: write` only.
      - A `yq -i` step on both cluster files, then a read-back check that each file equals `$TAG`,
        failing otherwise.
      - `create-pull-request` with branch `ci/cms-api-image-tag`, base `master`, title
        `chore(cms-api): deploy image <tag>`, `add-paths` limited to the two cluster files, and
        delete-branch on merge.
    - A comment explains the loop safety (`GITHUB_TOKEN` + the paths filter) and the required repo
      setting.
  - Verify:
    - `ci.yml` parses (PyYAML).
    - A dict diff against `HEAD` shows only the publish job's added `outputs` and the new job.
    - `yq` dry-run on copies of both files (Docker `mikefarah/yq` if available, otherwise a Python
      mirror) changes only the tag line.
  - Deps: T1, T2

### Checkpoint 2
- [ ] Workflow asserts pass.
- [ ] Commit (Yes/No).

## Phase 3: Remove image automation

- [ ] **T4: Delete the Flux image-automation manifests.** (S)
  - Files:
    - `apps/cms-api/k8s/flux/image-repository.yaml`, `image-policy.yaml` and `image-update.yaml`
      (**ask first:** delete)
    - `apps/cms-api/k8s/flux/kustomization.yaml`
    - `apps/cms-api/k8s/flux/deployment.yaml` (header comment only, if it mentions automation)
  - Acceptance:
    - `kustomization.yaml` lists only `deployment.yaml` and `service.yaml`, and its header comment
      says `APP_IMAGE_TAG` comes from the cluster app Kustomization, set by the CI bump PR.
  - Verify:
    - The `kubectl kustomize apps/cms-api/k8s/flux | envsubst '<7 vars>'` render parses.
    - It has no `image.toolkit.fluxcd.io` kinds, and the placeholder set is exactly the 7
      `APP_*` vars.
  - Deps: T3

### Checkpoint 3
- [ ] Render and asserts pass.
- [ ] Commit (Yes/No).

## Phase 4: Docs and rules

- [ ] **T5: Update the cms-api Flux deployment doc and the techstack comparison.** (S)
  - Files:
    - `apps/cms-api/docs/documents/cms-api-flux-deployment.md`
    - `apps/cms-api/docs/documents/cms-api-flux-deployment-techstack.md`
  - Acceptance:
    - The flow is: CI → GHCR → bump PR → merge → Flux polls (1m/3m) on `vm-dev` and `vm-prod`.
    - The files table matches the new layout.
    - The rollback section says to open a PR with an older tag; there's no `flux suspend image`.
    - The techstack doc has comparison tables for CI-writes versus Flux image automation, PR versus
      direct push, `create-pull-request` versus `gh`, and `yq` versus `sed`.
    - "Verified state" is rewritten to match.
  - Verify:
    - `grep -nE 'GitOps repo|ImagePolicy|ImageUpdateAutomation|kustomization.flux|flux/app' <files>`
      finds only intentional historical mentions.
  - Deps: T4

- [ ] **T6: Update the runbook, the k8s rule and the template comments.** (S)
  - Files:
    - `apps/cms-api/k8s/README.md`
    - `apps/cms-api/docs/rules/k8s-secrets.md`
    - `apps/cms-api/k8s/configmap.example.yaml` (header comment only)
  - Acceptance:
    - The runbook covers per-cluster setup (vm-dev local VM, vm-prod VPS): bootstrap
      `--path=clusters/abyssdev/<cluster>`, the ConfigMap and Secret names per env, the "Allow
      GitHub Actions to create and approve pull requests" setting, and the vm-prod path-fix
      `kubectl patch` command.
    - The rule's stale paths (`k8s/flux/app/`, `kustomization.flux.yaml`, GitOps repo) are updated.
      The rule's intent is unchanged.
  - Verify: the same stale-reference `grep` across `apps/cms-api/k8s` and `apps/cms-api/docs` is
    clean.
  - Deps: T5

### Checkpoint 4 (final)
- [ ] All the asserts from checkpoints 1–3 re-run clean.
- [ ] Five-axis review (`docs/workflow.md` step 6).
- [ ] Commit (Yes/No).
- [ ] Hand the owner:
  - The vm-prod `kubectl patch` or re-bootstrap command.
  - Creating the prod ConfigMap and Secret.
  - The repo Actions PR setting.
  - Watching the first real bump PR through to both clusters running the new tag.
- [ ] Clean up (`docs/workflow.md` step 7): reduce `SPEC.md` to a pointer, and reduce the stale
  `apps/cms-api/SPEC.md` after the owner confirms.

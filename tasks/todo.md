# Todo: cms-api tag bump from CI (replace Flux image automation)

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS**. 3 of 6 tasks done.

Checkbox updates ship in the same commit as that phase's work. Verification is offline only: never
run `kubectl apply`/`flux`/`helm` against a cluster, and never read `k8s/secret.yaml` or
`k8s/configmap.yaml`.

## Phase 1: Flux cluster manifests

- [x] **T1: Clean up the vm-dev app Kustomization.** (XS)
  - Files: `clusters/abyssdev/vm-dev/abyssdev-apps-develop.yaml`
  - Acceptance:
    - The `# {"$imagepolicy": …}` marker is removed. `APP_IMAGE_TAG` stays a plain quoted string
      (`"dev"` until the first bump).
    - There's a header comment saying CI rewrites this value (on the `deployment` branch).
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

- [x] **T3: Add the `cms-api-bump-tag` job (push to `deployment`), the publish `outputs.tag`, and point Flux at `deployment`.** (S)
  - Files:
    - `.github/workflows/ci.yml`
    - Both `clusters/abyssdev/*/flux-system/gotk-sync.yaml` (`ref.branch` → `deployment`, as the
      owner directed)
    - Both cluster app files (header comments only)
  - Decision changes during T3 (owner):
    - Push directly to `deployment`, not a PR and not `master`.
    - Flux reads only `deployment`.
    - Use `sed`, not `yq`; no extra tools or actions.
    - Existing `master` CI is unchanged.
  - Acceptance:
    - `cms-api-ghcr-publish` gains `outputs: tag: ${{ steps.tag.outputs.tag }}`. Nothing else in
      that job changes, and every other existing job is unchanged.
    - The new job has:
      - `needs: [cms-api-ghcr-publish]` and the same `master` + `push` guard.
      - Permissions `contents: write` only.
      - `concurrency: cms-api-bump-tag`, with `cancel-in-progress: false`.
      - Checkout with `ref: deployment`.
    - The bump step validates the tag format, then makes up to 3 attempts. Each one:
      1. Runs `fetch`, then `reset --hard origin/deployment`.
      2. Checks each file exists; skips it if its run number is already at least ours; otherwise
         `sed`s the tag line through a temp file, then `grep`s it back and fails on a mismatch.
      3. Exits 0 if nothing changed.
      4. Commits `chore(cms-api): deploy image <tag>` as `github-actions[bot]` and pushes
         `HEAD:deployment`.
    - Both `gotk-sync.yaml` files have `ref.branch: deployment`.
  - Verify:
    - The PyYAML asserts pass (`t1`–`t3`): the job diff against the baseline, the job fields, and
      the gotk-sync branch.
    - The bump dry-run passes: the extracted `run` block against a bare origin, with bash 3.2 and
      BSD sed, covering the bump, no-ops, race retry, loud failures, and `master` untouched.
  - Deps: T1, T2

### Checkpoint 2
- [x] Workflow asserts pass.
- [x] Commit (Yes/No).

## Phase 3: Remove image automation

- [ ] **T4: Delete the Flux image-automation manifests.** (S)
  - Files:
    - `apps/cms-api/k8s/flux/image-repository.yaml`, `image-policy.yaml` and `image-update.yaml`
      (**ask first:** delete)
    - `apps/cms-api/k8s/flux/kustomization.yaml`
    - `apps/cms-api/k8s/flux/deployment.yaml` (header comment only, if it mentions automation)
  - Acceptance:
    - `kustomization.yaml` lists only `deployment.yaml` and `service.yaml`, and its header comment
      says `APP_IMAGE_TAG` comes from the cluster app Kustomization, set by the CI bump commit on `deployment`.
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
    - The flow is: CI → GHCR → bot commit to `deployment` → Flux polls `deployment` (1m/3m) on
      `vm-dev` and `vm-prod`. Manifest changes reach Flux through an owner merge from `master` into
      `deployment`.
    - The files table matches the new layout.
    - The rollback section says to push a commit to `deployment` with an older tag, which holds
      until the next build; there's no `flux suspend image`.
    - The techstack doc has comparison tables for:
      - CI writes the tag versus Flux image automation.
      - The `deployment` branch versus `master` versus a PR.
      - `sed` versus `yq`.
      - Reset-and-reapply retry versus rebase.
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
      `--branch=deployment --path=clusters/abyssdev/<cluster>` (or the `kubectl patch` commands),
      the first `master` → `deployment` merge and its tag-line conflict, the ConfigMap and Secret names per env, the `deployment`
      branch prerequisite (Actions must be able to push), and the vm-prod path-fix
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
  - Merging `master` into `deployment` (and the conflict to resolve).
  - Pointing both clusters at `deployment`, plus the vm-prod path fix.
  - Creating the prod ConfigMap and Secret.
  - The `deployment` push prerequisite (Actions must be able to push).
  - Watching the first real bump commit on `deployment` through to both clusters running the new
    tag.
- [ ] Clean up (`docs/workflow.md` step 7): reduce `SPEC.md` to a pointer, and reduce the stale
  `apps/cms-api/SPEC.md` after the owner confirms.

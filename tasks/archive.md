# Archive: completed tasks

Finished plans/todos moved out of `tasks/plan.md` / `tasks/todo.md` to keep them lean.

---

## cms-api tag bump from CI (shipped, archived 2026-09-26)

### Plan

### Plan: cms-api tag bump from CI (replace Flux image automation)

Spec: [`SPEC.md`](../SPEC.md) (DRAFT, 2026-09-24)
Status: **IN PROGRESS**
Task list: [`tasks/todo.md`](todo.md)

---

#### Overview

After the GHCR push on `master`, the new `cms-api-bump-tag` job commits the tag to the **`deployment`**
branch, the only branch Flux reads. It sets `APP_IMAGE_TAG` in both cluster app Kustomizations:
`vm-dev` (local VM) and `vm-prod` (VPS). `master` and its existing CI jobs are untouched, apart from
the publish job exposing its tag. Each cluster's Flux polls `deployment` every 1m and reconciles, with
a 3m drift re-check. Other manifest changes reach `deployment` when the owner merges `master` into it.
Flux image automation is removed.

#### Dependency graph

```
T1 vm-dev app Kustomization cleaned ─┐
T2 vm-prod wired (path + files) ─────┼─▶ T3 CI bump job (edits both files) ─▶ T4 remove image automation
                                     │                                            │
                                     └────────────────────────────────────────────┴─▶ T5 docs ─▶ T6 rules/runbook
```

- T3 needs both cluster files to exist with the same `APP_IMAGE_TAG:` line, because `sed` rewrites
  that line in each.
- T4 comes after T3, so no revision is left with no tag writer at all. The current
  automation is already miswired (vm-dev's marker points at a `-prod` policy), so the ordering is
  about hygiene, not an outage risk.
- The docs come last, so they describe the final state.

#### Architecture decisions (from spec, restated for build)

- **CI is the only writer of the tag.** The tag comes from a new `outputs.tag` on
  `cms-api-ghcr-publish`, so it's computed once.
- **Direct push to `deployment`,** using plain `git` with no third-party action. This changed at the
  owner's request during T3: first from a PR to `master`, then to `deployment`. Flux's
  `gotk-sync.yaml` `ref.branch` becomes `deployment` on both clusters.
- **Races:** each of up to 3 attempts runs `fetch`, `reset --hard origin/deployment`, re-applies the
  edit and pushes. A file's tag is only replaced if its run number is lower than ours. The job-level
  `concurrency` (no cancel) runs bumps one at a time.
- **`sed` + `grep` read-back** rather than `yq` (owner: no extra tools). Writing through a temp file
  instead of `sed -i` makes GNU and BSD sed behave the same.
- **No CI loop:** the workflow only runs on `develop`/`staging`/`master` pushes, and a
  `GITHUB_TOKEN` push never triggers a workflow run.
- **Offline verification only.** A throwaway Python/PyYAML assert script lives in the session
  scratchpad, not the repo, like the previous Flux work. Nothing runs against a cluster.
- **The exact CI script is dry-run locally.** It's extracted from `ci.yml` and run against a
  throwaway bare origin with `deployment` and `master` branches, using macOS bash 3.2 and BSD sed.

#### Phases

##### Phase 1: Flux cluster manifests (T1, T2)
Both clusters get an app Kustomization with a plain `APP_IMAGE_TAG` value (no `$imagepolicy`
marker), the same intervals, and a correct bootstrap path.

**Checkpoint 1:**
- `kubectl kustomize` renders both cluster dirs.
- The assert script passes.
- Commit (ask Yes/No first).

##### Phase 2: CI bump (T3)
Add the job, and add a tag output to the publish job.

**Checkpoint 2:**
- `ci.yml` parses.
- Every job except `cms-api-ghcr-publish` (which only gains `outputs`) and the new job is
  unchanged.
- The bump dry-run passes. It covers:
  - Both files bumped with a +2/-2 diff, and the marker dropped.
  - An older tag and a re-run are no-ops.
  - A push race is retried.
  - A bad tag and a missing file fail loudly.
  - `master` is never written.
- Commit.

##### Phase 3: Remove image automation (T4)
Delete the three `image-*.yaml` files and remove them from `kustomization.yaml`. Deleting files needs
the owner's OK.

**Checkpoint 3:**
- The app render has no `image.toolkit.fluxcd.io` kinds, and `envsubst` covers exactly 7 vars.
- Commit.

##### Phase 4: Docs and rules (T5, T6)
The docs describe this same-repo, CI-bump flow. Stale references to a separate GitOps repo,
`k8s/flux/app/` and `kustomization.flux.yaml` are removed.

**Checkpoint 4 (final):**
- `grep` finds no stale references.
- Review (five-axis).
- Commit.
- Hand the owner the manual cluster steps.

#### Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| vm-prod's in-cluster `flux-system` Kustomization reads the broken path, so the path fix in Git never gets applied | High (vm-prod never syncs) | Owner runs `kubectl patch` or re-bootstraps. The exact command is in the spec and gets repeated in the final hand-off. |
| Protection on `deployment` blocks the Actions push | Med (the bump job fails, and nothing deploys) | The job fails loudly. The runbook documents the prerequisite. |
| `deployment` is missing a cluster file (for example vm-prod's, before the first `master` → `deployment` merge) | Med (the bump fails) | The job fails with "merge master into deployment first". The owner's first step is that merge. |
| The first `master` → `deployment` merge conflicts on vm-dev's tag line | Low | Documented in the spec's owner steps: keep `deployment`'s tag and drop the marker. |
| The in-cluster `GitRepository` still tracks `master` | High (bumps never deploy) | The owner patches or re-bootstraps with `--branch=deployment`. The exact commands are in the spec and in the hand-off. |
| The `sed` pattern misses (a renamed key or reformatted line) | Med | A `grep` read-back requires exactly one `APP_IMAGE_TAG: "<tag>"` line per file, or the job fails. The file headers say CI rewrites that line. |
| Pruning image-* objects after T4 merges | Low | `prune: true` removes them. The image controllers stay installed but idle, which is a spec non-goal. |
| vm-dev's current tag `"dev"` may not exist in GHCR | Low (vm-dev pods already in whatever state) | Open Q2. Until it's answered, T1 keeps `"dev"`, and the first CI bump on `deployment` replaces it. |
| Two bumps race, or an older run finishes last | Low | `concurrency` runs them one at a time, the run-number guard stops a rollback, and the reset-and-reapply retry avoids rebase conflicts. |

#### Open questions (carried from spec; plan proceeds on the stated defaults)

1. Is vm-dev's `APP_IMAGE_TAG: "dev"` a real tag? **Default: leave it; the first bump replaces
   it.**
2. Can the stale `apps/cms-api/SPEC.md` be reduced to a pointer? **Default: yes, in the clean-up
   step after review.** The owner confirms before anything is deleted.

### Todo

### Todo: cms-api tag bump from CI (replace Flux image automation)

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **IN PROGRESS**. 7 of 7 tasks done (T7 = per-arch fix).

Checkbox updates ship in the same commit as that phase's work. Verification is offline only: never
run `kubectl apply`/`flux`/`helm` against a cluster, and never read `k8s/secret.yaml` or
`k8s/configmap.yaml`.

#### Phase 1: Flux cluster manifests

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

##### Checkpoint 1
- [x] Both cluster dirs render, and the assert script passes.
- [x] Commit: the owner confirms the file list and message (Yes/No, no `Co-Authored-By`).

#### Phase 2: CI bump

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

##### Checkpoint 2
- [x] Workflow asserts pass.
- [x] Commit (Yes/No).

#### Phase 3: Remove image automation

- [x] **T4: Delete the Flux image-automation manifests.** (S)
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

##### Checkpoint 3
- [x] Render and asserts pass.
- [x] Commit (Yes/No).

#### Phase 4: Docs and rules

- [x] **T5: Update the cms-api Flux deployment doc and the techstack comparison.** (S)
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

- [x] **T6: Update the runbook, the k8s rule and the template comments.** (S)
  - Files:
    - `apps/cms-api/k8s/README.md`
    - `apps/cms-api/docs/rules/k8s-secrets.md`
    - `apps/cms-api/k8s/configmap.example.yaml` (header comment only)
    - Also `apps/cms-api/docs/ENTRYPOINT.md` and `apps/cms-api/docs/documents/dockerfile.md`
      (found by the stale-reference scan)
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

#### Phase 5: Fix, per-arch images (live deploy: `exec format error` on the arm64 VM)

- [x] **T7: Build separate amd64 and arm64 images (4 per release) and bump each cluster to its arch.** (S)
  - Branch: `fix/cms-api-multiarch-images` (from `master`, after PR #68)
  - Files:
    - `.github/workflows/ci.yml`
    - `apps/cms-api/docs/documents/cms-api-flux-deployment.md`
    - `apps/cms-api/docs/documents/cms-api-flux-deployment-techstack.md`
    - `apps/cms-api/k8s/README.md`
  - Acceptance:
    - `cms-api-ghcr-publish` is a matrix (`ubuntu-latest`/amd64, `ubuntu-24.04-arm`/arm64). It
      pushes `<tag>-<arch>-init` and then `<tag>-<arch>`, and keeps `outputs.tag`.
    - A new `cms-api-ghcr-cleanup` job, after publish with the opt-in, keeps 20 versions.
    - `cms-api-bump-tag` writes `<tag>-arm64` to vm-dev and `<tag>-amd64` to vm-prod. Its guard
      accepts the arch suffix.
    - Every other job is unchanged. Manifests and templates are unchanged.
  - Verify:
    - The PyYAML asserts pass against `master`'s `ci.yml`.
    - The bump dry-run passes: per-cluster arch, an old arch-less tag replaced, older tags no-op,
      push race, `master` untouched.
    - Owner: after the next `master` build, both clusters' init containers start.
  - Deps: T1–T6 (merged)

##### Checkpoint 4 (final)
- [x] All the asserts from checkpoints 1–3 re-run clean.
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

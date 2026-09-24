# Plan: cms-api tag bump from CI (replace Flux image automation)

Spec: [`SPEC.md`](../SPEC.md) (DRAFT, 2026-09-24)
Status: **IN PROGRESS**
Task list: [`tasks/todo.md`](todo.md)

---

## Overview

After the GHCR push on `master`, CI opens or updates one PR. The PR sets `APP_IMAGE_TAG` in both
cluster app Kustomizations: `vm-dev` (local VM) and `vm-prod` (VPS). When the owner merges it, each
cluster's Flux picks up the change: `GitRepository` polls every 1m, and the app `Kustomization`
reconciles and re-checks every 3m. Flux image automation (`ImageRepository`/`ImagePolicy`/
`ImageUpdateAutomation`) is removed.

## Dependency graph

```
T1 vm-dev app Kustomization cleaned ─┐
T2 vm-prod wired (path + files) ─────┼─▶ T3 CI bump job (edits both files) ─▶ T4 remove image automation
                                     │                                            │
                                     └────────────────────────────────────────────┴─▶ T5 docs ─▶ T6 rules/runbook
```

- T3 needs both cluster files to exist with the same key layout, because `yq` must hit a real key in
  each.
- T4 comes after T3, so no revision of `master` is left with no tag writer at all. The current
  automation is already miswired (vm-dev's marker points at a `-prod` policy), so the ordering is
  about hygiene, not an outage risk.
- The docs come last, so they describe the final state.

## Architecture decisions (from spec, restated for build)

- **CI is the only writer of the tag.** The tag comes from a new `outputs.tag` on
  `cms-api-ghcr-publish`, so it's computed once.
- **The PR lives on a fixed branch, `ci/cms-api-image-tag`,** managed by
  `peter-evans/create-pull-request@v7`. Each run force-pushes the branch, so there's always one
  open PR with the newest tag. This is a new action dependency; ask before adding it (T3).
- **`yq -i` on `ubuntu-latest`,** where it's preinstalled, rather than `sed`.
- **Loop safety:**
  - Pushes and PRs made with `GITHUB_TOKEN` don't trigger workflows.
  - The merge only touches `clusters/**`, which the `cms-api` paths filter ignores.
- **Offline verification only.** A throwaway Python/PyYAML assert script lives in the session
  scratchpad, not the repo, like the previous Flux work. Nothing runs against a cluster.
- **`yq` isn't installed locally.** To dry-run the exact CI command, use
  `docker run --rm -v "$PWD":/w -w /w mikefarah/yq` if Docker is available. Otherwise mirror the
  edit in Python and rely on CI's first real run. Installing `yq` through brew needs asking first.

## Phases

### Phase 1: Flux cluster manifests (T1, T2)
Both clusters get an app Kustomization with a plain `APP_IMAGE_TAG` value (no `$imagepolicy`
marker), the same intervals, and a correct bootstrap path.

**Checkpoint 1:**
- `kubectl kustomize` renders both cluster dirs.
- The assert script passes.
- Commit (ask Yes/No first).

### Phase 2: CI bump (T3)
Add the job, and add a tag output to the publish job.

**Checkpoint 2:**
- `ci.yml` parses.
- Every job except `cms-api-ghcr-publish` (which only gains `outputs`) and the new job is
  unchanged.
- A `yq` dry-run on both files changes only the tag line.
- Commit.

### Phase 3: Remove image automation (T4)
Delete the three `image-*.yaml` files and remove them from `kustomization.yaml`. Deleting files needs
the owner's OK.

**Checkpoint 3:**
- The app render has no `image.toolkit.fluxcd.io` kinds, and `envsubst` covers exactly 7 vars.
- Commit.

### Phase 4: Docs and rules (T5, T6)
The docs describe this same-repo, CI-bump flow. Stale references to a separate GitOps repo,
`k8s/flux/app/` and `kustomization.flux.yaml` are removed.

**Checkpoint 4 (final):**
- `grep` finds no stale references.
- Review (five-axis).
- Commit.
- Hand the owner the manual cluster steps.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| vm-prod's in-cluster `flux-system` Kustomization reads the broken path, so the path fix in Git never gets applied | High (vm-prod never syncs) | Owner runs `kubectl patch` or re-bootstraps. The exact command is in the spec and gets repeated in the final hand-off. |
| The repo setting "Allow GitHub Actions to create and approve pull requests" is off | Med (the bump job fails) | The job fails loudly. The setting is documented in the runbook. |
| `yq` path misses (a renamed key or file) and silently writes a new key | Med | After the edit, the CI step checks with `yq e '.spec.postBuild.substitute.APP_IMAGE_TAG'` that each file equals `$TAG`, and fails otherwise. |
| Pruning image-* objects after T4 merges | Low | `prune: true` removes them. The image controllers stay installed but idle, which is a spec non-goal. |
| vm-dev's current tag `"dev"` may not exist in GHCR | Low (vm-dev pods already in whatever state) | Open Q2. Until it's answered, T1 keeps `"dev"`, and the first CI bump PR replaces it. |
| A bump PR sits unmerged while `master` moves on | Low | `create-pull-request` rebases the branch on `master` each run. |

## Open questions (carried from spec; plan proceeds on the stated defaults)

1. Should one PR bump both clusters? **Default: yes.**
2. Is vm-dev's `APP_IMAGE_TAG: "dev"` a real tag? **Default: leave it; the first bump PR replaces
   it.**
3. Can the stale `apps/cms-api/SPEC.md` be reduced to a pointer? **Default: yes, in the clean-up
   step after review.** The owner confirms before anything is deleted.

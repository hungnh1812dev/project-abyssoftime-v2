# Plan: cms-api tag bump from CI (replace Flux image automation)

Spec: [`SPEC.md`](../SPEC.md) (DRAFT, 2026-09-24)
Status: **IN PROGRESS**
Task list: [`tasks/todo.md`](todo.md)

---

## Overview

After the GHCR push on `master`, the new `cms-api-bump-tag` job commits the tag to the **`deployment`**
branch, the only branch Flux reads. It sets `APP_IMAGE_TAG` in both cluster app Kustomizations:
`vm-dev` (local VM) and `vm-prod` (VPS). `master` and its existing CI jobs are untouched, apart from
the publish job exposing its tag. Each cluster's Flux polls `deployment` every 1m and reconciles, with
a 3m drift re-check. Other manifest changes reach `deployment` when the owner merges `master` into it.
Flux image automation is removed.

## Dependency graph

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

## Architecture decisions (from spec, restated for build)

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
- The bump dry-run passes. It covers:
  - Both files bumped with a +2/-2 diff, and the marker dropped.
  - An older tag and a re-run are no-ops.
  - A push race is retried.
  - A bad tag and a missing file fail loudly.
  - `master` is never written.
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
| Protection on `deployment` blocks the Actions push | Med (the bump job fails, and nothing deploys) | The job fails loudly. The runbook documents the prerequisite. |
| `deployment` is missing a cluster file (for example vm-prod's, before the first `master` → `deployment` merge) | Med (the bump fails) | The job fails with "merge master into deployment first". The owner's first step is that merge. |
| The first `master` → `deployment` merge conflicts on vm-dev's tag line | Low | Documented in the spec's owner steps: keep `deployment`'s tag and drop the marker. |
| The in-cluster `GitRepository` still tracks `master` | High (bumps never deploy) | The owner patches or re-bootstraps with `--branch=deployment`. The exact commands are in the spec and in the hand-off. |
| The `sed` pattern misses (a renamed key or reformatted line) | Med | A `grep` read-back requires exactly one `APP_IMAGE_TAG: "<tag>"` line per file, or the job fails. The file headers say CI rewrites that line. |
| Pruning image-* objects after T4 merges | Low | `prune: true` removes them. The image controllers stay installed but idle, which is a spec non-goal. |
| vm-dev's current tag `"dev"` may not exist in GHCR | Low (vm-dev pods already in whatever state) | Open Q2. Until it's answered, T1 keeps `"dev"`, and the first CI bump on `deployment` replaces it. |
| Two bumps race, or an older run finishes last | Low | `concurrency` runs them one at a time, the run-number guard stops a rollback, and the reset-and-reapply retry avoids rebase conflicts. |

## Open questions (carried from spec; plan proceeds on the stated defaults)

1. Is vm-dev's `APP_IMAGE_TAG: "dev"` a real tag? **Default: leave it; the first bump replaces
   it.**
2. Can the stale `apps/cms-api/SPEC.md` be reduced to a pointer? **Default: yes, in the clean-up
   step after review.** The owner confirms before anything is deleted.

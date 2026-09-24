# k3s Deployment (Flux) — Tech/Pattern/Design Decisions

This doc has comparison tables for the choices behind cms-api's Flux GitOps + GHCR deployment,
following repo root `docs/workflow.md`'s "Decision rationale" rule. See
[cms-api-flux-deployment.md](./cms-api-flux-deployment.md) for how it's implemented.

The previous helmfile deploy is described in git history:
`git show c1168e6:apps/cms-api/docs/documents/cms-api-k3s-deployment-techstack.md` (and
`…-deployment.md`). Its decisions (the shared chart, an unpinned version, `latest` +
`rollout restart`) are superseded by the ones below. The branch-based CI routing (`staging` →
Render, `master` → k3s images) is unchanged.

The first Flux version used Flux image automation and a separate GitOps repo. Both were replaced by a
CI job that commits the tag to this repo's `deployment` branch. The tables below record both the
current choice and why the earlier one was dropped.

## Delivery: Flux GitOps (chosen) vs. helmfile by hand (previous) vs. Argo CD vs. CI pushes to the cluster

| Criteria | Flux (chosen) | helmfile by hand (previous) | Argo CD | CI runs `kubectl apply` |
| --- | --- | --- | --- | --- |
| Who rolls out a new image | The cluster, on its own | The owner, from a terminal | The cluster, on its own | CI |
| Cluster credentials outside the cluster | None (the cluster pulls) | The owner's kubeconfig | None | A kubeconfig in GitHub secrets, and the API server must be reachable from GitHub |
| Automatic image updates | CI commits the tag to Git; Flux applies it (see below) | No | Separate Argo CD Image Updater, or the same CI commit | Only what CI deploys |
| Footprint on a small k3s node | A few lightweight controllers, no UI | None | Heavier (server, repo-server, Redis, UI) | None |
| Drift correction | Yes, it reconciles every interval | No | Yes | No |
| **Verdict** | **Chosen (user decision)**: pull-based, no cluster credentials outside the cluster, lightweight | Replaced: every release needed a manual step, and the deployed tag lived only in the cluster | Rejected: more to run for the same result on one small cluster | Rejected: exposes the cluster API to CI |

## Getting a new tag to the cluster: CI bump commit (chosen) vs. Flux image automation (previous) vs. manual tag bump vs. `latest` + restart

| Criteria | CI commits the tag (`cms-api-bump-tag`, chosen) | Flux image automation (previous) | Manual tag bump | `latest` + restart on push |
| --- | --- | --- | --- | --- |
| Steps per release | None | None | One commit or `kubectl patch` | None, but something must trigger the restart |
| Who knows the new tag | CI, which just pushed it; no discovery needed | The cluster scans GHCR every 5m and picks the tag through a regex policy | The owner | Nobody |
| Moving parts | One CI job (git + sed) | ImageRepository + ImagePolicy + ImageUpdateAutomation, 2 extra controllers, a **write** deploy key | None | A restart trigger |
| Delay after the push | Seconds for the commit, then about 1m for Flux | Up to 5m scan + commit + reconcile | Human | — |
| Record of what's deployed | A commit per tag on `deployment` | A commit per tag | Only in the cluster, or a commit | Nothing: `latest` hides it |
| Rollback | Push an older tag to `deployment`; it holds until the next build | Suspend automation first, or it rewrites the tag within 5m | Set the old tag back | Re-push an old image as `latest` |
| **Verdict** | **Chosen (user decision)**: the fewest moving parts, the tag comes straight from the job that pushed it, and Flux only needs read access | Replaced: more controllers and a write key, and the regex policy and 5m polling only work out what CI already knows | Rejected: deploys stay manual | Rejected: can't tell or pin what's running |

## Rendering: plain manifests (chosen) vs. HelmRelease + the shared `helmfile-chart-template` chart

| Criteria | Plain manifests + Flux substitution (chosen) | HelmRelease + shared OCI chart |
| --- | --- | --- |
| Resources needed | Deployment + Service, two short files | The same, through a general chart |
| Chart versioning and caching issues | None | Pin vs. unpinned trade-off again (see the git history) |
| Where values come from | `${APP_*}` from the ConfigMap via `postBuild.substituteFrom` | `valuesFrom` a ConfigMap. But `releaseName`/`targetNamespace` are literal fields, so identity still leaks into Git |
| Visibility of what's applied | The YAML is the manifest | Only after rendering the chart |
| **Verdict** | **Chosen (user decision)**: two resources don't justify a chart, and everything stays substitutable | Rejected: adds a moving dependency, and names still end up literal |

## Where CI writes the tag, and what Flux reads: this repo's `deployment` branch (chosen) vs. `master` vs. a PR vs. a separate GitOps repo (previous)

| Criteria | `deployment` branch (chosen) | Direct push to `master` | PR to `master` | Separate GitOps repo (previous) |
| --- | --- | --- | --- | --- |
| Bot commits in app history | None on `master` | One per release on `master` | One merge per release | None in this repo |
| CI loop risk | None: `ci.yml` doesn't run on `deployment` | Needs guards (`GITHUB_TOKEN`, `[skip ci]`, paths filter) | Merge commit reruns CI unless filtered | None |
| Fully automatic | Yes | Yes | No, needs a merge per release | Yes |
| Branch protection | `master` stays protected; only `deployment` must accept Actions pushes | `master` must allow Actions to push | Works with protection | Deploy key on the GitOps repo |
| Getting manifest changes live | Merge `master` into `deployment` (explicit) | Immediate | Immediate after merge | Copy templates into the other repo by hand |
| **Verdict** | **Chosen (user decision)**: `master` stays clean and CI stays unchanged, it can't loop, and merging `master` into `deployment` is an explicit "release manifests" step | Rejected: bot commits on `master`, and loop guards to maintain | Rejected: not automatic | Replaced: a second repo to keep in sync by hand |

## Project info: ConfigMap created by hand (chosen) vs. Secret created by hand vs. committed in Git

| Criteria | ConfigMap, by hand (chosen) | Secret, by hand | Committed (e.g. `kustomize` vars in Git) |
| --- | --- | --- | --- |
| Project values in code | None | None | Yes, which the user ruled out |
| Sensitivity of the values | Names, port, image repo: not secret | Treated as secret for no benefit | — |
| Readable with `kubectl get -o yaml` | Plain text | base64 | — |
| Supported by `substituteFrom` | Yes | Yes | — |
| **Verdict** | **Chosen (user decision)**: non-secret identity belongs in a ConfigMap | Rejected: hides harmless data | Rejected: the requirement is "no project info in code" |

The unavoidable exception is each cluster file's ConfigMap name. Flux needs one literal reference
to start from.

## Image tag format: `<run_number>-<sha7>` (chosen) vs. `<epoch>-<sha7>` vs. `<sha7>` only vs. semver

| Criteria | `<run_number>-<sha7>` (chosen) | `<epoch>-<sha7>` | `<sha7>` only | semver `vX.Y.Z` |
| --- | --- | --- | --- | --- |
| Orderable (the bump job never lowers the run number) | Yes, numeric prefix | Yes | No, SHAs are random | Yes |
| Names the commit | Yes | Yes | Yes | Only with a release process |
| Human-readable | Matches the Actions run number | A long number | Yes | Yes |
| Failure mode | Renaming `ci.yml` resets the counter, and the bump job skips new tags until the numbers pass the old ones | Clock skew between runners (negligible) | — | Someone has to bump versions |
| **Verdict** | **Chosen (user decision)**: readable and maps to the CI run. The reset caveat is documented | Documented fallback if the workflow is ever renamed | Rejected: can't be ordered | Rejected: no release process to drive it |

## GHCR storage: unique tags + opt-in cleanup (chosen) vs. `latest` only vs. no cleanup

The user is on a free GitHub account. According to GitHub's billing docs, GitHub Packages is free
for public packages, and container image storage is "currently free". Private packages on other
registries get 500MB on Free.

| Criteria | `<run_number>-<sha7>` + `delete-package-versions` keeping 10 (chosen) | `latest` / `latest-init` only | Unique tags, no cleanup |
| --- | --- | --- | --- |
| Storage over time | Bounded: 10 versions | **Unbounded**: each re-push leaves the old image as an untagged version | Unbounded |
| Tag bump / auto-deploy | Works | Breaks: the tag never changes, so there's nothing to deploy | Works |
| Rollback | The last 5 releases | None (only whatever is `latest`) | Any release |
| Risk | The first run deletes the pre-Flux `latest` images, hence the opt-in `CMS_API_GHCR_CLEANUP` variable. Needs the Admin role on the package | Manual `rollout restart` per release | None |
| **Verdict** | **Chosen (user decision, keep 5 releases)** | Rejected: doesn't reduce storage, and it breaks auto-deploy | Rejected: storage keeps growing |

## Setting `PORT`: shell wrapper in `command` (chosen) vs. `env` value vs. `PORT` in the Secret vs. fixed port

Flux substitutes after kustomize has dropped quotes, then converts YAML to JSON
(`fluxcd/pkg` `SubstituteVariables`). So `value: "${APP_PORT}"` reaches the API server as the int
`3000`, and an `env` value must be a string.

| Criteria | `command: sh -c "PORT=${APP_PORT} exec bun dist/src/main"` (chosen) | `env: PORT="${APP_PORT}"` | `PORT` in the manual Secret | Fixed `3000` in the manifests |
| --- | --- | --- | --- | --- |
| Works after Flux substitution | Yes (the number is inside a longer string) | No, the Deployment is rejected | Yes | Yes |
| Single source for the port | `APP_PORT` | `APP_PORT` | Two: `APP_PORT` + `PORT` | None (literal) |
| Cost | Repeats the Dockerfile `CMD`, so the two must stay in sync | — | Mismatch makes the probes/Service miss the app | Port is no longer configurable, and it's a literal in code |
| **Verdict** | **Chosen (user decision)** | Rejected: broken | Rejected: two places to keep equal | Rejected: contradicts "no project info in code" |

## Migrator image: one package with a `-init` suffix (chosen) vs. a separate package

The previous deploy used the `-migrate` suffix. The user renamed it `-init`, after the init
container that runs it. The Dockerfile target is still `migrator`.

| Criteria | One package, `<tag>-init` (chosen) | Separate `cms-api-init` package |
| --- | --- | --- |
| Packages to manage (visibility, pull access) | 1 | 2 |
| Pairing app and init images | Derived from one `APP_IMAGE_TAG` | Two tags to keep in step |
| **Verdict** | **Chosen**: one tag drives both images | Rejected: twice the admin for a cleaner tag list |

## Editing the tag in CI: `sed` + `grep` read-back (chosen) vs. `yq`

| Criteria | `sed` via a temp file, then `grep` read-back (chosen) | `yq -i` |
| --- | --- | --- |
| Extra tools | None (`sed`/`grep` are everywhere) | mikefarah `yq`: preinstalled on `ubuntu-latest`, but not on macOS by default |
| Same script locally and in CI | Yes: no `sed -i`, so GNU and BSD sed behave the same, and the real script is dry-run on macOS | Only with `yq` installed locally |
| Robustness | Matches the `APP_IMAGE_TAG:` line by key. The read-back requires exactly one `APP_IMAGE_TAG: "<tag>"` line, so a missed pattern fails loudly | Edits the YAML path structurally |
| Comments on the line | Replaced along with the line (drops the old `$imagepolicy` marker) | Kept |
| **Verdict** | **Chosen (user decision)**: no extra tool, and the read-back covers the robustness gap | Rejected: an extra dependency for a one-line edit |

## Concurrent pushes to `deployment`: reset-and-reapply retry (chosen) vs. `git pull --rebase` vs. no retry

| Criteria | Fetch + `reset --hard origin/deployment` + re-apply + push, 3 attempts (chosen) | `git pull --rebase` then push | Push once |
| --- | --- | --- | --- |
| Conflicts | Impossible: the edit is re-done on the fresh tip | Can conflict on the tag line itself | — |
| Out-of-order runs | Run-number guard: never replaces a tag with a lower run number | Would overwrite a newer tag | Would overwrite a newer tag |
| Serialisation | `concurrency: cms-api-bump-tag` (queued, never cancelled) | Same | Same |
| **Verdict** | **Chosen**: simple, conflict-free, and safe against an older run finishing last | Rejected: a conflict fails the deploy | Rejected: a race loses the deploy |

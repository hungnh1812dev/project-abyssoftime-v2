# k3s Deployment (Flux) — Tech/Pattern/Design Decisions

This doc has comparison tables for the choices behind cms-api's Flux GitOps + GHCR deployment,
following repo root `docs/workflow.md`'s "Decision rationale" rule. See
[cms-api-flux-deployment.md](./cms-api-flux-deployment.md) for how it's implemented.

The previous helmfile deploy is described in git history:
`git show c1168e6:apps/cms-api/docs/documents/cms-api-k3s-deployment-techstack.md` (and
`…-deployment.md`). Its decisions (the shared chart, an unpinned version, `latest` +
`rollout restart`) are superseded by the ones below. The branch-based CI routing (`staging` →
Render, `master` → k3s images) is unchanged.

## Delivery: Flux GitOps (chosen) vs. helmfile by hand (previous) vs. Argo CD vs. CI pushes to the cluster

| Criteria | Flux (chosen) | helmfile by hand (previous) | Argo CD | CI runs `kubectl apply` |
| --- | --- | --- | --- | --- |
| Who rolls out a new image | The cluster, on its own | The owner, from a terminal | The cluster, on its own | CI |
| Cluster credentials outside the cluster | None (the cluster pulls) | The owner's kubeconfig | None | A kubeconfig in GitHub secrets, and the API server must be reachable from GitHub |
| Automatic image updates | Built in (image-reflector + image-automation controllers) | No | Separate Argo CD Image Updater | Only what CI deploys |
| Footprint on a small k3s node | A few lightweight controllers, no UI | None | Heavier (server, repo-server, Redis, UI) | None |
| Drift correction | Yes, it reconciles every interval | No | Yes | No |
| **Verdict** | **Chosen (user decision)**: pull-based, no cluster credentials outside the cluster, image automation included | Replaced: every release needed a manual step, and the deployed tag lived only in the cluster | Rejected: more to run for the same result on one small cluster | Rejected: exposes the cluster API to CI |

## Getting a new tag to the cluster: image automation (chosen) vs. manual tag bump in the ConfigMap vs. `latest` + restart

| Criteria | Flux image automation (chosen) | Manual tag bump (`APP_IMAGE_TAG` in the ConfigMap) | `latest` + restart on push |
| --- | --- | --- | --- |
| Steps per release | None | One `kubectl patch` | None, but something must trigger the restart |
| Record of what's deployed | A commit per tag in the GitOps repo | Only in the cluster | Nothing: `latest` hides it |
| Rollback | Suspend automation, then revert or pin the tag | Patch the old tag back | Re-push an old image as `latest` |
| App and init images from one commit | Yes, one `APP_IMAGE_TAG` feeds both | Yes | Only if both `latest` tags move together |
| Tag lives in Git | Yes (it's release state, not project info) | No | No |
| **Verdict** | **Chosen (user decision)**: fully automatic and auditable | Rejected: deploys stay manual | Rejected: can't tell or pin what's running |

## Rendering: plain manifests (chosen) vs. HelmRelease + the shared `helmfile-chart-template` chart

| Criteria | Plain manifests + Flux substitution (chosen) | HelmRelease + shared OCI chart |
| --- | --- | --- |
| Resources needed | Deployment + Service, two short files | The same, through a general chart |
| Chart versioning and caching issues | None | Pin vs. unpinned trade-off again (see the git history) |
| Where values come from | `${APP_*}` from the ConfigMap via `postBuild.substituteFrom` | `valuesFrom` a ConfigMap. But `releaseName`/`targetNamespace` are literal fields, so identity still leaks into Git |
| Visibility of what's applied | The YAML is the manifest | Only after rendering the chart |
| **Verdict** | **Chosen (user decision)**: two resources don't justify a chart, and everything stays substitutable | Rejected: adds a moving dependency, and names still end up literal |

## Where the Flux manifests live: separate GitOps repo (chosen) vs. this repo as the Flux source

| Criteria | Separate GitOps repo (chosen) | This repo as a Flux `GitRepository` |
| --- | --- | --- |
| Image automation commits | Land in the GitOps repo | Land on this repo's `master`: bot commits mixed with app history, which also retriggers CI |
| Deploy key | Write key on the GitOps repo only | Write key on the app repo |
| Cluster config for other apps | One place | Split per app repo |
| Cost | Templates here must be copied there after changes | None |
| **Verdict** | **Chosen (user decision)**: keeps bot commits and cluster write access out of the app repo | Rejected: automation would push to `master` |

This repo keeps the templates in `k8s/flux/` because agents may only write inside this repo. The
GitOps repo is the source of truth.

## Project info: ConfigMap created by hand (chosen) vs. Secret created by hand vs. committed in Git

| Criteria | ConfigMap, by hand (chosen) | Secret, by hand | Committed (e.g. `kustomize` vars in Git) |
| --- | --- | --- | --- |
| Project values in code | None | None | Yes, which the user ruled out |
| Sensitivity of the values | Names, port, image repo: not secret | Treated as secret for no benefit | — |
| Readable with `kubectl get -o yaml` | Plain text | base64 | — |
| Supported by `substituteFrom` | Yes | Yes | — |
| **Verdict** | **Chosen (user decision)**: non-secret identity belongs in a ConfigMap | Rejected: hides harmless data | Rejected: the requirement is "no project info in code" |

The unavoidable exceptions are the entry file's ConfigMap name and setter marker. Flux needs one
literal reference to start from, so the owner fills in `<full-app-name>` there when copying.

## Image tag format: `<run_number>-<sha7>` (chosen) vs. `<epoch>-<sha7>` vs. `<sha7>` only vs. semver

| Criteria | `<run_number>-<sha7>` (chosen) | `<epoch>-<sha7>` | `<sha7>` only | semver `vX.Y.Z` |
| --- | --- | --- | --- | --- |
| Orderable by ImagePolicy | Yes, numerical on the extracted number | Yes | No, SHAs are random | Yes |
| Names the commit | Yes | Yes | Yes | Only with a release process |
| Human-readable | Matches the Actions run number | A long number | Yes | Yes |
| Failure mode | Renaming `ci.yml` resets the counter, and Flux ignores new tags until the numbers pass the old ones | Clock skew between runners (negligible) | — | Someone has to bump versions |
| **Verdict** | **Chosen (user decision)**: readable and maps to the CI run. The reset caveat is documented | Documented fallback if the workflow is ever renamed | Rejected: Flux can't order it | Rejected: no release process to drive it |

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
| Packages to manage (visibility, pull access, ImageRepository) | 1 | 2 |
| Pairing app and init images | Derived from one `APP_IMAGE_TAG` | Two tags to keep in step |
| Keeping `-init` tags away from the ImagePolicy | Regex anchors on `^\d+-[a-f0-9]{7}$` | Not needed |
| **Verdict** | **Chosen**: one tag drives both images | Rejected: twice the admin for a cleaner tag list |

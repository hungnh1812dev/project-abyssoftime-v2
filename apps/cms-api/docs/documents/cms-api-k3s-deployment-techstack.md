# k3s Deployment — Tech/Pattern/Design Decisions

Comparison tables for the choices behind cms-api's helmfile + GHCR deployment, per repo root
`docs/workflow.md`'s "Decision rationale" rule. See
[cms-api-k3s-deployment.md](./cms-api-k3s-deployment.md) for the implementation writeup.

## Deployment tooling: Helm + helmfile (chosen) vs. Kustomize vs. raw manifests

| Criteria | Helm + helmfile (chosen) | Kustomize | Raw manifests (previous state) |
| --- | --- | --- | --- |
| Reuse across apps | One chart, per-app values | Shared base + overlays; workable but patch-heavy | Copy-paste per app |
| Deploy command | `helmfile apply` (declarative, with `diff`) | `kubectl apply -k` | `kubectl apply -f` per file |
| Preview changes | `helmfile diff` | `kubectl diff -k` | `kubectl diff -f` |
| Tooling already installed | Yes (`helm`, `helmfile`) | Built into `kubectl` | Yes |
| **Verdict** | **Chosen**: the reusable chart already existed, and `diff` before `apply` matters with an unpinned chart | Rejected: no shared chart to build on, and overlays get verbose | Rejected: what this feature replaces |

## Chart source: shared external chart (chosen) vs. in-repo chart published from this repo vs. local path

This feature first built `charts/app-template/` in this repo, with a CI job publishing it to
`ghcr.io/hungnh1812dev/project-abyssoftime-v2/charts`. That was superseded the same day by the
user's standalone `helmfile-chart-template`, and the in-repo chart was removed.

| Criteria | Shared external chart (chosen) | In-repo chart + CI publish (tried, removed) | In-repo chart, local path `../../charts/…` |
| --- | --- | --- | --- |
| Where the chart evolves | Its own repo, reusable beyond this monorepo | This repo only | This repo only |
| Extra CI in this repo | None | A publish job + path filter | None |
| Consumable outside a monorepo checkout | Yes (`oci://`) | Yes (`oci://`) | No |
| Features cms-api needs | Init containers (0.2.0), `envFrom` secrets (0.2.0), probes (0.3.0) | All, built for cms-api | All |
| **Verdict** | **Chosen**: one chart for all the user's projects, and no chart maintenance here | Superseded | Rejected: ties every consumer to this checkout |

## Chart version: unpinned/latest (chosen) vs. pinned vs. semver range

| Criteria | Unpinned, no `version:` (chosen) | Pinned (`version: 0.3.0`) | Range (`version: ">=0.3.0"`) |
| --- | --- | --- | --- |
| Chart improvements reach cms-api | Automatically on next deploy | Only after a version bump here | Automatically |
| Reproducibility | Low: the same commit can render differently later | High | Low |
| helmfile cache behaviour (v1.5.2, verified) | Cached, not refreshed. Needs `helmfile cache cleanup` | Cached per version, which is correct | Cached under the range string. Same problem as unpinned |
| **Verdict** | **Chosen (user decision)**: the chart is under active development by the same owner. Mitigated by `cache cleanup` + `diff` before every `apply` | Rejected for now: every chart change would need a follow-up edit here | Rejected: no advantage over unpinned, and the same cache problem |

## Migrator image: two tags in one GHCR package (chosen) vs. two packages

| Criteria | One package, `-migrate` tag suffix (chosen) | Separate `cms-api-migrate` package |
| --- | --- | --- |
| Packages to manage (visibility, pull access) | 1 | 2 |
| Relationship between the two images | Obvious: same SHA, same package | Needs a naming convention to line up |
| Tag listing | Mixed runner/migrator tags | Clean per package |
| **Verdict** | **Chosen**: one set of permissions, and the SHA pairs them | Rejected: double the package admin for a cosmetic gain |

## Rolling out `latest`: `rollout restart` (chosen default) vs. SHA tags in `values.yaml`

| Criteria | Keep `latest`, `kubectl rollout restart` (chosen default) | Bump `<short-sha>` tags in `values.yaml` |
| --- | --- | --- |
| Steps per release | 1 command | Edit 2 values + `helmfile apply` (+ commit) |
| Record of what's deployed | Only in the cluster | In git |
| Works with `pullPolicy: Always` | Yes: the restart re-pulls | Yes, and a changed tag triggers the rollout anyway |
| **Verdict** | **Chosen default**: the lowest-effort manual flow the user asked for | Documented alternative for when traceability matters |

## CI routing: by branch (chosen) vs. repository variable vs. `workflow_dispatch` input

The first implementation used a repository variable, `CMS_API_DEPLOY_MODE` (`render` or `ghcr`), to
switch `master` between Render and GHCR. The user replaced it with a split by branch: `staging` deploys
to Render, and `master` pushes images for k3s.

| Criteria | Branch-based (chosen) | `vars.CMS_API_DEPLOY_MODE` (replaced) | `workflow_dispatch` input |
| --- | --- | --- | --- |
| Render and k3s side by side | Yes: one per branch | No: one or the other | Per run only |
| Covers automatic pushes | Yes | Yes | No |
| Hidden state outside the repo | None | A repo setting | None |
| **Verdict** | **Chosen**: `staging` keeps the existing Render setup, and `master` feeds k3s | Replaced: couldn't run both targets | Rejected: doesn't cover pushes |

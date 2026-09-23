# Implementation Plan: cms-api CI/CD on Flux

Spec: `apps/cms-api/SPEC.md`. Task list: `tasks/todo.md`. Prior work: `tasks/archive.md`.

## Overview

Replace the helmfile deploy with Flux GitOps. CI pushes sortable `<run_number>-<sha7>` and
`<run_number>-<sha7>-init` images. Plain k8s templates in `k8s/flux/` (which the owner copies to
the GitOps repo) are filled in by Flux from a hand-made ConfigMap and the image-automation tag.
The runtime Secret is hand-made too. helmfile, values and secrets-chart are removed.

## Dependency graph

```
naming contract (SPEC)
  ├── k8s/config.env.example ──┐
  ├── k8s/flux/app (Deployment, Service) ──┐
  │       └── image automation (ImageRepository/Policy/UpdateAutomation) ── needs tag format ──┐
  │               └── k8s/flux/kustomization.flux.yaml (substituteFrom + setter marker)        │
  ├── CI publish job (tag format, -init before app, vars.CMS_API_IMAGE_REPO) ◄─────────────────┘
  ├── k8s/.env.example (drop APP_*)
  └── remove helmfile / values / secrets-chart ── after templates exist (nothing still points at them)
          └── docs + rule + ENTRYPOINT (describe the final state)
```

The tag format (`^\d+-[a-f0-9]{7}$`, with `-init` excluded) is the contract between the CI
job and the ImagePolicy. It is fixed in the SPEC, so the two sides can be built independently.

## Architecture decisions (from the SPEC intake)

- Flux image automation instead of a manual tag bump. Git records what's deployed, and rollback
  is a revert.
- Plain manifests instead of the shared `helmfile-chart-template`. There's no chart to pin or
  cache-clean, and there are only two resources.
- A separate GitOps repo. This repo only ships templates, because agents can't write outside it.
- The ConfigMap lives in `flux-system`, which `postBuild.substituteFrom` requires. The Secret
  lives in `<full-namespace>`, which `envFrom` requires.
- A single `APP_IMAGE_TAG` substitution feeds both images, so app and init always come from
  one commit.
- `PORT` is set from `${APP_PORT}` through the app container's
  `command: ["sh","-c","PORT=${APP_PORT} exec bun dist/src/main"]`, replacing the helmfile `PORT`
  injection. An `env` value can't carry it, because Flux substitutes after kustomize drops the
  quotes, so the API server would get an int. The command must stay in sync with the Dockerfile
  `CMD`.

## Phases

1. **Flux templates.** This is new and carries the most risk (substitution typing, the setter
   marker), so it goes first. Tasks 1–3.
2. **CI + Secret template.** These are the producer side of the tag contract and the owner's
   inputs. Tasks 4–5.
3. **Remove helmfile.** Only after the replacement exists. Task 6.
4. **Docs, rules, wrap-up.** Tasks 7–9.

Checkpoints come after each phase. Commits are batched at checkpoints, and every commit needs
an explicit Yes/No first (per `docs/workflow.md`).

## Verification toolkit (all local, no cluster access)

- `kubectl kustomize k8s/flux/app` renders the templates.
- `… | envsubst` with fake `APP_*` values (same order as Flux), then PyYAML asserts. **Not**
  `kubectl apply --dry-run=client`, because it contacts the kubeconfig's real cluster.
- `python3 -c 'import yaml,sys; list(yaml.safe_load_all(sys.stdin))'` checks that YAML parses
  (used for the Flux CRD files and `ci.yml`).
- `grep -E` checks the ImagePolicy regex against sample tags, and a literal scan checks for
  `abyssoftime|hungnh1812dev|cms-api|3000`.

`flux`, `kubeconform` and `actionlint` aren't installed. Installing them is ask-first and isn't
required by this plan.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A number-like placeholder becomes an int after substitution (kustomize drops quotes, then Flux converts YAML to JSON) | High (apply fails) | Seen in Task 1: `containerPort` must be an int, so it's fine. `PORT` moved into `command`. The check asserts every env value is a string |
| `command` falls out of sync with the Dockerfile `CMD` | Med (app won't start) | Comments in both places, plus a note in the deployment doc and dockerfile doc (Tasks 7, 9) |
| Setter marker in the wrong place or wrong format, so the tag never updates | High (no auto deploy) | Follow the Flux docs exactly: the marker goes on the `APP_IMAGE_TAG` line with `:tag` suffix. The owner verifies with `flux get images policy` |
| Flux picks an app tag before its `-init` exists | Med (init pull fails, then retries) | CI pushes `-init` first (Task 4). The policy regex excludes `-init` |
| `run_number` resets if the workflow file is renamed | Med (Flux stops picking up newer tags) | Documented. Switching to `<epoch>-<sha7>` is an open question |
| Private GHCR package | High (ImageRepository scan and pod pulls fail) | Open question. If private, Task 2 and Task 1 add a pull-secret placeholder |
| Cutover downtime between `helm uninstall` and the first Flux apply | Low | Documented in the migration steps. The owner picks the window |
| Uncommitted helmfile work in the tree | Low | Resolve before Task 1 (Task 0) |

## Open questions (defaults used unless you say otherwise)

1. Is the GHCR package public? **Default: public**, so no pull-secret placeholders.
2. Tag counter: **default `run_number`**, as approved. The alternative is `<epoch>-<sha7>`.
3. Uncommitted helmfile changes: **default: commit them as-is first** (Task 0, needs your Yes).
4. Template location: **default `apps/cms-api/k8s/flux/`**.

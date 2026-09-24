# Spec: cms-api tag bump from CI (replace Flux image automation)

Status: **DRAFT**. Awaiting approval.
Date: 2026-09-24
Target areas: `.github/workflows/ci.yml` (cms-api jobs), `clusters/abyssdev/*`, `apps/cms-api/k8s/flux/`,
cms-api Flux docs/rules

This spec sits at the monorepo root because it spans CI, the Flux cluster manifests, and cms-api's
k8s templates. The `/cv-3` spec that was here is SHIPPED and has been replaced.

---

## Objective

GitHub Actions becomes the only thing that writes the cms-api image tag. Flux image automation, which
currently scans GHCR in the cluster and commits the tag itself, is removed. Flux on each cluster only
polls this repo and reconciles whenever a file changes, including the tag.

```
push master ─▶ CI build/test ─▶ GHCR push <run>-<sha7> (+ -init)
                                      │
                                      ▼
                  CI opens/updates PR "bump cms-api to <tag>"  (edits APP_IMAGE_TAG in both clusters)
                                      │  owner merges
                                      ▼
   vm-dev (local VM) ─┐     Flux GitRepository polls master every 1m
   vm-prod (VPS) ─────┴─▶   Flux Kustomization reconciles on new revision (+ every 3m drift check)
                                      ▼
                            Deployment rolls to <tag>
```

### User stories

- **As the owner**, after a `master` push that changes cms-api, a PR appears within about a minute of
  the GHCR push. It sets `APP_IMAGE_TAG` to the new tag in both `vm-dev` and `vm-prod`.
- **As the owner**, I merge that PR, and both clusters run the new image within about 5 minutes. I
  run no `kubectl` or `flux` command.
- **As the owner**, I edit any manifest under a cluster's path (for example resources or probes) and
  push to `master`. Flux applies it within about 5 minutes.
- **As the owner**, if two cms-api builds land before I merge, there is still only one open bump PR,
  and it carries the newest tag.
- **As the owner**, I roll back by opening a PR that sets `APP_IMAGE_TAG` to an older tag. Nothing
  overwrites it; there's no automation to suspend.

### Non-goals

- Deploying cms-admin or frontend through Flux. They stay on Render and Vercel.
- A separate `develop` image or build. Both clusters use the same GHCR images from `master`.
- Promotion gates such as dev first and then prod. One PR bumps both clusters (see Open Questions).
- Uninstalling the image-reflector and image-automation controllers from the clusters. Leaving them
  idle is harmless; removing them means re-bootstrapping, which is an owner action.
- Any change to Secret or ConfigMap contents.

---

## Decisions

| Question | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Who writes the tag | CI only | Keep Flux image automation too | Two writers to one line make conflicting commits. CI already knows the exact tag it pushed, so no GHCR scan or regex policy is needed, and Flux doesn't need a write deploy key. |
| How CI writes it | Opens or updates a PR | Direct push to `master` | Owner's choice: merging is the deploy approval. |
| Environments | One PR bumps `vm-dev` and `vm-prod` | Per-branch images (develop → vm-dev) | Both clusters pull the same GHCR repo. vm-dev (local VM) and vm-prod (VPS) differ only by host and ConfigMap. |
| PR tooling | `peter-evans/create-pull-request@v7` | `gh pr create` script | It handles "update the existing PR on a fixed branch" natively. A script would need its own branch, force-push and PR-exists logic. **New action dependency: ask first.** |
| YAML edit | `yq -i` (preinstalled on `ubuntu-latest`) | `sed` | It edits a structured key, not a text pattern, so a comment or reorder can't make it miss silently. |

The full comparison tables go in `apps/cms-api/docs/documents/cms-api-flux-deployment-techstack.md`
during the docs step, as `docs/workflow.md` requires.

---

## Target state

### CI (`.github/workflows/ci.yml`)

New job `cms-api-bump-tag`, with `needs: [cms-api-ghcr-publish]` and the same `master` + `push` guard:

1. Checkout `master`.
2. For each cluster file, set `.spec.postBuild.substitute.APP_IMAGE_TAG` to `<run_number>-<sha7>`.
   Take the tag from a new `cms-api-ghcr-publish` output (`outputs.tag`) instead of computing it a
   second time.
3. Create or update the PR on the fixed branch `ci/cms-api-image-tag`, based on `master`, titled
   `chore(cms-api): deploy image <tag>`. It force-pushes the branch, so an older unmerged bump is
   replaced rather than stacked.
4. Permissions: `contents: write`, `pull-requests: write`, and nothing else.

There's no CI loop:
- PRs and pushes made with `GITHUB_TOKEN` don't trigger workflows.
- The merge commit only touches `clusters/**`, which the `cms-api` paths filter ignores, so no
  rebuild or new bump happens.

Repo setting the owner must enable: **Settings → Actions → General → "Allow GitHub Actions to create
and approve pull requests"**.

### Flux, both clusters (`clusters/abyssdev/{vm-dev,vm-prod}/`)

| File | vm-dev (local VM) | vm-prod (VPS) |
| --- | --- | --- |
| `flux-system/gotk-sync.yaml` path | `./clusters/abyssdev/vm-dev` (already fixed) | **Fix:** `./clusters/local-vm/abyssdev/cms-api` → `./clusters/abyssdev/vm-prod` |
| `kustomization.yaml` | exists | **New:** `flux-system/` + the app file |
| App Flux Kustomization | `abyssdev-apps-develop.yaml` | **New:** `abyssdev-apps-prod.yaml` |
| Kustomization name | `abyssdev-cms-api-sync-develop` | `abyssdev-cms-api-sync-prod` |
| `substituteFrom` ConfigMap | `abyssdev-cms-api-develop-config` | `abyssdev-cms-api-prod-config` |
| `APP_IMAGE_TAG` | a real tag; drop the `$imagepolicy` marker | same |

Reconcile loop (the "loop check"), the same on both clusters:
- `GitRepository flux-system`: `interval: 1m`, branch `master`. It fetches new commits.
- App `Kustomization`: `interval: 3m`, `prune: true`, `wait: true`, `timeout: 5m`. A new source
  revision triggers an immediate reconcile. The interval re-applies to fix drift if someone edits
  the cluster by hand.

### cms-api templates (`apps/cms-api/k8s/flux/`)

- Delete `image-repository.yaml`, `image-policy.yaml` and `image-update.yaml`, and remove them from
  `kustomization.yaml`. Deleting files needs the owner's OK.
- `deployment.yaml` and `service.yaml` stay unchanged.

### Owner-run cluster steps (agent never runs these)

- **vm-prod** can't pick up its own path fix, because its flux-system Kustomization reads from the
  broken path. Re-run bootstrap with `--path=clusters/abyssdev/vm-prod`, or run
  `kubectl -n flux-system patch kustomization flux-system --type merge -p '{"spec":{"path":"./clusters/abyssdev/vm-prod"}}'`.
- Create `abyssdev-cms-api-prod-config` and the prod Secret on the VPS from the templates.
- After the image-* manifests are pruned, the old `ImageRepository`/`ImagePolicy`/`ImageUpdateAutomation`
  objects are removed by `prune: true` automatically. Nothing else is needed.
- Optional: make the Flux deploy key read-only.

---

## Commands

```bash
# Render templates offline (no cluster contact)
kubectl kustomize apps/cms-api/k8s/flux
kubectl kustomize clusters/abyssdev/vm-dev
kubectl kustomize clusters/abyssdev/vm-prod

# Substitution check with fake values, matching Flux's postBuild
kubectl kustomize apps/cms-api/k8s/flux \
  | APP_NAME=a APP_SERVICE_NAME=s APP_NAMESPACE=n APP_ENV=e APP_PORT=3000 \
    APP_IMAGE_REPO=ghcr.io/x/y APP_IMAGE_TAG=57-a1b2c3d \
    envsubst '${APP_NAME} ${APP_SERVICE_NAME} ${APP_NAMESPACE} ${APP_ENV} ${APP_PORT} ${APP_IMAGE_REPO} ${APP_IMAGE_TAG}'

# Tag edit dry-run, exactly as CI will run it
TAG=57-a1b2c3d yq -i '.spec.postBuild.substitute.APP_IMAGE_TAG = strenv(TAG)' clusters/abyssdev/vm-dev/abyssdev-apps-develop.yaml

# Workflow lint
actionlint .github/workflows/ci.yml   # if installed; else parse with python -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))'

# Owner-only, live checks after merge
flux get sources git
flux get kustomizations
kubectl -n <full-namespace> get deploy <full-app-name> -o jsonpath='{..image}'
```

## Project Structure

```
.github/workflows/ci.yml                    → cms-api-ghcr-publish (+ tag output), new cms-api-bump-tag
clusters/abyssdev/vm-dev/                   → local VM cluster: flux-system/ + abyssdev-apps-develop.yaml
clusters/abyssdev/vm-prod/                  → VPS cluster: flux-system/ + abyssdev-apps-prod.yaml (new)
apps/cms-api/k8s/flux/                      → shared app templates (Deployment, Service), ${APP_*} only
apps/cms-api/k8s/README.md                  → owner runbook (update)
apps/cms-api/docs/documents/cms-api-flux-deployment*.md → docs + techstack table (update)
apps/cms-api/docs/rules/k8s-secrets.md      → fix stale paths (k8s/flux/app/, kustomization.flux.yaml)
```

## Code Style

Match the existing manifests and CI: a header comment on each file saying what it does and why, and
`${APP_*}` placeholders only in `apps/cms-api/k8s/flux/**`. The CI step style:

```yaml
  cms-api-bump-tag:
    name: CMS API Deploy - Bump Flux tag
    runs-on: ubuntu-latest
    needs: [cms-api-ghcr-publish]
    if: github.ref == 'refs/heads/master' && github.event_name == 'push'
    permissions:
      contents: write
      pull-requests: write

    steps:
      - name: Checkout
        uses: actions/checkout@v5

      # Same tag the publish job pushed; both clusters pull the same GHCR images.
      - name: Set APP_IMAGE_TAG in cluster manifests
        env:
          TAG: ${{ needs.cms-api-ghcr-publish.outputs.tag }}
        run: |
          for f in clusters/abyssdev/vm-dev/abyssdev-apps-develop.yaml \
                   clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml; do
            yq -i '.spec.postBuild.substitute.APP_IMAGE_TAG = strenv(TAG)' "$f"
          done
```

## Testing Strategy

There is no unit-test framework for YAML or CI here. Verification is offline and scripted, the same
way as the previous Flux work:

- `kubectl kustomize` renders `apps/cms-api/k8s/flux` and both cluster dirs without error.
- The rendered app output contains no `ImageRepository`, `ImagePolicy` or `ImageUpdateAutomation`
  kinds.
- A Python/PyYAML assert script checks:
  - Both cluster app Kustomizations have the same `APP_IMAGE_TAG`, no `$imagepolicy` marker, the
    correct ConfigMap name and path, and the intervals above.
  - The vm-prod `gotk-sync.yaml` path is `./clusters/abyssdev/vm-prod`.
- `yq` bump dry-run: running it on a copy changes only the `APP_IMAGE_TAG` line (checked with
  `git diff --stat`).
- `ci.yml` parses. The new job has the right `needs`, guard and permissions, the publish job exposes
  `outputs.tag`, and every other job is byte-identical.
- **Manual (owner):** a real `master` push opens the PR. After the merge, both clusters report the
  new image.

## Boundaries

- **Always:** keep project values out of `apps/cms-api/k8s/flux/**` (placeholders only); verify
  offline; give the owner exact commands for any cluster action; update docs and rules for the
  areas touched.
- **Ask first:**
  - Adding `peter-evans/create-pull-request`.
  - Deleting the three image-* manifests.
  - Editing the generated `gotk-sync.yaml` (vm-prod path fix).
  - Committing (Yes/No with the file list and message; no `Co-Authored-By`).
- **Never:**
  - Run `kubectl`, `helm` or `flux` against a real cluster, including `--dry-run=client`.
  - Read or touch `apps/cms-api/k8s/secret.yaml`, `apps/cms-api/k8s/configmap.yaml` or any `.env*`.
  - Edit `gotk-components.yaml`.
  - Give CI any cluster credentials.

## Success Criteria

1. A `master` push that changes cms-api ends with one open PR from `ci/cms-api-image-tag`. The PR
   sets `APP_IMAGE_TAG` in both cluster files to the `<run>-<sha7>` that was just pushed to GHCR.
2. A second push before the merge updates that same PR to the newer tag, instead of opening a
   second one.
3. Merging the PR doesn't start a cms-api build or another bump PR.
4. No `image.toolkit.fluxcd.io` objects are rendered from this repo anymore.
5. `vm-prod` has a working bootstrap path and an app Kustomization that mirrors vm-dev, with a
   prod ConfigMap.
6. Both clusters use `GitRepository interval: 1m` and app `Kustomization interval: 3m`, `prune: true`.
7. The docs (`cms-api-flux-deployment.md`, `-techstack.md`, `k8s/README.md`, `k8s-secrets.md`)
   describe this same-repo, CI-bump flow, with no mention of a separate GitOps repo or of image
   automation.
8. Owner-verified: after the merge, both clusters run the new tag within about 5 minutes.

## Open Questions

1. **One PR for both clusters, or promote dev first?** The spec assumes one PR updates both files, so
   one merge deploys to the local VM and the VPS together. The alternative is two PRs, vm-dev then
   vm-prod.
2. **vm-dev's current `APP_IMAGE_TAG: "dev"`.** Is that a real GHCR tag you pushed by hand? If not,
   it gets replaced by the newest `<run>-<sha7>` during the build.
3. **Stale `apps/cms-api/SPEC.md`** (the old Flux DRAFT, already shipped via PRs #63/#64). Can it be
   reduced to a pointer as part of this work's clean-up step?

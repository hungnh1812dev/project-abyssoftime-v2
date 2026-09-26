# Spec: cms-api tag bump from CI to the `deployment` branch (replace Flux image automation)

Status: **IN PROGRESS** (see `tasks/todo.md`)
Date: 2026-09-24
Target areas: `.github/workflows/ci.yml` (cms-api jobs), `clusters/abyssdev/*`, `apps/cms-api/k8s/flux/`,
cms-api Flux docs/rules

This spec sits at the monorepo root because it spans CI, the Flux cluster manifests, and cms-api's
k8s templates. The `/cv-3` spec that was here is SHIPPED and has been replaced.

---

## Objective

GitHub Actions becomes the only thing that writes the cms-api image tag. It writes it only on the
**`deployment` branch**, which is the only branch Flux reads. Flux image automation, which currently
scans GHCR in the cluster and commits the tag itself, is removed. The existing `master` CI stays as
it is: it builds, tests and pushes to GHCR, and it gains exactly one extra job. Flux on each cluster
polls `deployment` and reconciles whenever anything there changes, whether that's the tag or any
other file.

```
push master ─▶ CI build/test (unchanged) ─▶ GHCR push <run>-<sha7> (+ <run>-<sha7>-init)
                                                  │
                                                  ▼
                      cms-api-bump-tag: commit "deploy image <tag>" to `deployment`
                      (sed on the APP_IMAGE_TAG line in both cluster files; master untouched)
                                                  │
   vm-dev (local VM) ─┐                           ▼
   vm-prod (VPS) ─────┴─▶  Flux GitRepository polls `deployment` every 1m
                           Flux Kustomization reconciles on new revision (+ every 3m drift check)
                                                  ▼
                           Deployment rolls to <tag> (app) + <tag>-init (migrations)

manifest changes: master ──(owner merges master into deployment)──▶ deployment ─▶ Flux
```

### User stories

- **As the owner**, after a `master` push that changes cms-api, a `github-actions[bot]` commit lands
  on `deployment` about a minute after the GHCR push. It sets `APP_IMAGE_TAG` to the new tag in both
  `vm-dev` and `vm-prod`. `master` gets no bot commit, and no extra CI run starts.
- **As the owner**, both clusters run the new app and init images within about 5 minutes of that
  commit. I run no `kubectl` or `flux` command.
- **As the owner**, I change a manifest (for example resources, probes or a cluster file) on `master`
  and then merge `master` into `deployment`. Flux applies it within about 5 minutes.
- **As the owner**, if two cms-api builds race, `deployment` ends up on the newest tag. An older run
  never overwrites a newer tag.
- **As the owner**, I roll back by pushing a commit to `deployment` that sets `APP_IMAGE_TAG` to an
  older tag. It holds until the next cms-api build; there's no automation to suspend.

### Non-goals

- Changing any existing `master` CI job, beyond exposing the tag the publish job already computes.
- Syncing `master` into `deployment` automatically. The owner merges by hand when manifests change.
- Deploying cms-admin or frontend through Flux. They stay on Render and Vercel.
- Promotion gates such as dev first and then prod, or a manual approval step. One commit bumps both
  clusters.
- Uninstalling the image-reflector and image-automation controllers. Leaving them idle is harmless.
- Any change to Secret or ConfigMap contents.

---

## Decisions

| Question | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Who writes the tag | CI only | Keep Flux image automation too | Two writers to one line make conflicting commits. CI already knows the exact tag it pushed. |
| Where CI writes it | Direct push to the `deployment` branch | Push to `master` / open a PR | Owner's choice (T3). `master` stays clean and unprotected-branch concerns go away. The workflow never runs on `deployment` pushes, so there's structurally no CI loop. |
| What Flux reads | `deployment` only (`gotk-sync.yaml` `ref.branch`) | `master` | A tag written to `deployment` must be what the clusters run. |
| Environments | One commit bumps `vm-dev` and `vm-prod` | Per-branch images | Both clusters pull the same GHCR repo; they differ only by host and ConfigMap. |
| Edit tool | `sed` + `grep` read-back (no `sed -i`) | `yq` | Owner's choice: no extra tool. Writing through a temp file behaves the same with GNU sed (runner) and BSD sed (macOS), so the exact CI script is dry-run locally. The read-back check makes a missed pattern fail loudly. |
| Push races | Reset to `origin/deployment`, re-apply, push; 3 attempts; never lower the run number | `git pull --rebase` | Re-applying on a fresh tip can't conflict. The run-number check stops an older run from rolling back a newer tag. |

The full comparison tables go in `apps/cms-api/docs/documents/cms-api-flux-deployment-techstack.md`
during the docs step, as `docs/workflow.md` requires.

---

## Target state

### CI (`.github/workflows/ci.yml`)

- **`cms-api-ghcr-publish`** gains `outputs: tag: ${{ steps.tag.outputs.tag }}`, and nothing else
  changes in it.
- **The new job `cms-api-bump-tag`** has `needs: [cms-api-ghcr-publish]` and the same `master` +
  `push` guard. So it runs only when cms-api changed and the images were pushed.
  1. Check out `deployment`.
  2. Validate that `TAG` matches `^[0-9]+-[0-9a-f]{7}$`.
  3. Up to 3 attempts:
     1. `git fetch origin deployment` and `git reset --hard origin/deployment`.
     2. For each cluster file:
        - Fail with "merge master into deployment first" if the file is missing.
        - Skip the file if its current tag's run number is at least ours.
        - Otherwise `sed` the whole `APP_IMAGE_TAG:` line to `APP_IMAGE_TAG: "<tag>"`, which also
          drops any old `$imagepolicy` marker. Then `grep` that it matches exactly once.
     3. If nothing changed, exit 0.
     4. Commit `chore(cms-api): deploy image <tag>` as `github-actions[bot]`, then
        `git push origin HEAD:deployment`.
  4. Permissions: `contents: write` only.
  5. `concurrency: cms-api-bump-tag`, with `cancel-in-progress: false`.
  6. No third-party actions and no extra tools.
- **No CI loop.** `on.push.branches` is `develop`/`staging`/`master`, so a push to `deployment` never
  triggers this workflow. Pushes made with `GITHUB_TOKEN` don't trigger workflows either.

### Flux, both clusters (`clusters/abyssdev/{vm-dev,vm-prod}/`)

| File | vm-dev (local VM) | vm-prod (VPS) |
| --- | --- | --- |
| `flux-system/gotk-sync.yaml` `ref.branch` | `master` → **`deployment`** | `master` → **`deployment`** |
| `flux-system/gotk-sync.yaml` path | `./clusters/abyssdev/vm-dev` | **Fix:** → `./clusters/abyssdev/vm-prod` |
| `kustomization.yaml` | exists | **New:** `flux-system/` + the app file |
| App Flux Kustomization | `abyssdev-apps-develop.yaml` | **New:** `abyssdev-apps-prod.yaml` |
| Kustomization name | `abyssdev-cms-api-sync-develop` | `abyssdev-cms-api-sync-prod` |
| `substituteFrom` ConfigMap | `abyssdev-cms-api-develop-config` | `abyssdev-cms-api-prod-config` |
| `APP_IMAGE_TAG` on `master` | placeholder `"dev"`, no marker | same |

Reconcile loop, the same on both clusters:
- `GitRepository flux-system`: `interval: 1m`, branch `deployment`.
- App `Kustomization`: `interval: 3m`, `prune: true`, `wait: true`, `timeout: 5m`.

### cms-api templates (`apps/cms-api/k8s/flux/`)

- Delete `image-repository.yaml`, `image-policy.yaml` and `image-update.yaml`, and remove them from
  `kustomization.yaml`. Deleting files needs the owner's OK.
- `deployment.yaml` and `service.yaml` stay unchanged. Both images already come from
  `${APP_IMAGE_TAG}`.

### Owner-run steps (agent never runs these)

1. **Merge this work into `master`, then merge `master` into `deployment`.** Expect one conflict on
   vm-dev's `APP_IMAGE_TAG` line (`deployment` has `"75-4bef740" # {"$imagepolicy"…}`). Resolve it to
   `APP_IMAGE_TAG: "75-4bef740"`, with no marker. Set vm-prod's tag to the same value.
2. **Point each cluster at `deployment`.** The in-cluster `GitRepository` still tracks `master`, and
   vm-prod also still reads the broken path. Re-bootstrap each cluster with
   `--branch=deployment --path=clusters/abyssdev/<cluster>`, or patch:
   ```bash
   kubectl -n flux-system patch gitrepository flux-system --type merge -p '{"spec":{"ref":{"branch":"deployment"}}}'
   # vm-prod only:
   kubectl -n flux-system patch kustomization flux-system --type merge -p '{"spec":{"path":"./clusters/abyssdev/vm-prod"}}'
   ```
3. Create `abyssdev-cms-api-prod-config` and the prod Secret on the VPS from the templates.
4. `deployment` must accept pushes from GitHub Actions. That means no protection rule, or one with an
   Actions bypass.
5. After T4 reaches `deployment`, `prune: true` removes the old `ImageRepository`/`ImagePolicy`/
   `ImageUpdateAutomation` objects.

---

## Fix: per-arch images (found after the first live deploy)

The first live deploy failed on the M1 VM with `init exec /usr/local/bin/docker-entrypoint.sh: exec
format error`. CI built **amd64-only** images on `ubuntu-latest`. The Intel VPS runs them, but the
arm64 VM (Apple Silicon) can't.

| Question | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| How to build arm64 | Native runners: matrix `ubuntu-latest` (amd64) + `ubuntu-24.04-arm` (arm64) | QEMU + buildx | The repo is public, so arm64 runners are free. Native builds are fast and avoid Bun-under-QEMU crash reports. |
| One multi-arch tag, or separate per-arch images | **Separate: 4 images per release** (owner's choice) | Multi-arch manifest lists via `imagetools create` | No merge job. Each cluster's file names exactly the arch it runs, visible in Git. |

Target state:
- **Tags:** `<run>-<sha7>-<arch>` (app) and `<run>-<sha7>-<arch>-init` (init), with `<arch>` in
  `amd64`/`arm64`. `deployment.yaml` is unchanged: `${APP_IMAGE_TAG}` and `${APP_IMAGE_TAG}-init`,
  where `APP_IMAGE_TAG` includes the arch.
- **`cms-api-ghcr-publish`** is a 2-way matrix. Each leg builds both targets natively and pushes
  `-<arch>-init` first, then `-<arch>`. It keeps `outputs.tag` (the arch-less `<run>-<sha7>`).
- **`cms-api-ghcr-cleanup`** (new) runs after publish, with the same opt-in, and keeps 20 versions
  (4 per release = 5 releases). It's a separate job so the matrix doesn't run the cleanup twice.
- **`cms-api-bump-tag`** writes `<tag>-arm64` to vm-dev and `<tag>-amd64` to vm-prod. Its run-number
  check accepts an optional `-amd64`/`-arm64` suffix, so an old arch-less tag like `79-d16e564` is
  replaced.

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

# Owner-only, live checks after the bot commit
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

Match the existing manifests and CI:
- A header comment on each file says what it does and why.
- `${APP_*}` placeholders only in `apps/cms-api/k8s/flux/**`.
- Bash in CI uses `set -euo pipefail` and `::error::` annotations on every failure path.
- Portable `sed`: write to `"$f.tmp"` and `mv`, never `sed -i`.

## Testing Strategy

There is no unit-test framework for YAML or CI here. Verification is offline and scripted, and the
scripts live in the session scratchpad:

- `kubectl kustomize` renders `apps/cms-api/k8s/flux` and both cluster dirs without error.
- The rendered app output contains no `image.toolkit.fluxcd.io` kinds (after T4).
- A PyYAML assert script checks:
  - The cluster app Kustomizations mirror each other, have no `$imagepolicy` marker, and use the
    right ConfigMaps and intervals.
  - Both `gotk-sync.yaml` track `deployment`, and vm-prod's path is fixed.
  - In `ci.yml`, only the publish job's `outputs` and the new job differ from the baseline, and the
    new job's `needs`, guard, permissions, concurrency, checkout ref and push target are correct.
- A bump dry-run extracts the job's `run` block from `ci.yml` and runs it with local bash and BSD sed
  against a throwaway bare origin that has `deployment` and `master`. It checks:
  - Both files are bumped with a +2/-2 diff, and the marker is dropped.
  - The commit message and author are correct, and other files are untouched.
  - An older tag and a re-run are both no-ops.
  - A push race is rejected once, retried, and keeps the concurrent commit.
  - A bad tag and a missing file fail loudly.
  - `master` is never written.
- **Manual (owner):** a real `master` push produces one bot commit on `deployment`, no extra CI run,
  and both clusters report the new image.

## Boundaries

- **Always:** keep project values out of `apps/cms-api/k8s/flux/**` (placeholders only); verify
  offline; give the owner exact commands for any cluster action; update docs and rules for the
  areas touched.
- **Ask first:**
  - Deleting the three image-* manifests.
  - Editing the generated `gotk-sync.yaml`. The path fix and the `deployment` branch switch are
    already approved.
  - Committing (Yes/No with the file list and message; no `Co-Authored-By`).
  - Pushing to or merging into `deployment` or `master`.
- **Never:**
  - Run `kubectl`, `helm` or `flux` against a real cluster, including `--dry-run=client`.
  - Read or touch `apps/cms-api/k8s/secret.yaml`, `apps/cms-api/k8s/configmap.yaml` or any `.env*`.
  - Edit `gotk-components.yaml`.
  - Give CI any cluster credentials.
  - Change existing `master` CI jobs beyond the publish `outputs`.

## Success Criteria

1. A `master` push that changes cms-api ends with one `github-actions[bot]` commit on `deployment`.
   It sets `APP_IMAGE_TAG` in both cluster files to the `<run>-<sha7>` just pushed to GHCR. `master`
   gets no new commit.
2. No workflow run is started by that commit.
3. A bump from an older run never replaces a newer tag, and a push race is retried rather than
   failing.
4. Both clusters' Flux `GitRepository` tracks `deployment`, and vm-prod has a working path and an
   app Kustomization that mirrors vm-dev.
5. No `image.toolkit.fluxcd.io` objects are rendered from this repo anymore.
6. Both clusters use `GitRepository interval: 1m` and app `Kustomization interval: 3m`, `prune: true`.
7. The docs (`cms-api-flux-deployment.md`, `-techstack.md`, `k8s/README.md`, `k8s-secrets.md`)
   describe this same-repo, `deployment`-branch flow, with no separate GitOps repo and no image
   automation.
8. Owner-verified: after the bot commit, both clusters run the new tag within about 5 minutes.

## Open Questions

1. **Stale `apps/cms-api/SPEC.md`** (the old Flux DRAFT, shipped via PRs #63/#64). Can it be reduced
   to a pointer in this work's clean-up step?

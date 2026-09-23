# Todo: cms-api CI/CD on Flux

Spec: `apps/cms-api/SPEC.md` · Plan: `tasks/plan.md` · History: `tasks/archive.md`

## Phase 0: Clean baseline

- [x] **Task 0: Settle the uncommitted helmfile work**. Done: committed as `62438de`.
  - Acceptance: `git status` is clean for the files this plan touches (the pending helmfile edits
    are committed, or discarded on your call).
  - Verify: `git status --short` shows none of `k8s/*`, `ci.yml`, `Dockerfile`, `docs/*`.
  - Files: none new (commit only, needs a Yes/No first).
  - Deps: none · Size: XS

## Phase 1: Flux templates

- [x] **Task 1: Core workload templates + ConfigMap template**
  - Acceptance:
    - `k8s/flux/app/{kustomization,deployment,service}.yaml` use only `${APP_NAME}`,
      `${APP_SERVICE_NAME}`, `${APP_NAMESPACE}`, `${APP_ENV}`, `${APP_PORT}`, `${APP_IMAGE_REPO}`
      and `${APP_IMAGE_TAG}`.
    - The Deployment has init container `init` (`…:${APP_IMAGE_TAG}-init`) and container `app`,
      both with `envFrom` on the `-secrets` Secret. The app sets `PORT` through
      `command: ["sh","-c","PORT=${APP_PORT} exec bun dist/src/main"]`, with `/health` probes
      (15/20, 5/10) and resources 100m/128Mi → 500m/512Mi. The Service is ClusterIP on
      `${APP_PORT}`.
    - `k8s/config.env.example` lists exactly the six `APP_*` keys, with empty placeholders.
  - Verify:
    - `kubectl kustomize k8s/flux/app` succeeds.
    - The placeholder set from `… | grep -o '\${[A-Z_]*}' | LC_ALL=C sort -u` is exactly the
      7 vars.
    - Fake `envsubst` (same order as Flux), then PyYAML asserts: names, images, envFrom, int
      ports, the `PORT` command, every env value a string, probes, resources, selector.
    - The literal scan (non-comment lines) finds nothing.
  - Done: all checks pass. Along the way, a quoted `env: PORT="${APP_PORT}"` turned out to become
    an int, because kustomize drops quotes before Flux runs envsubst. The Flux source
    (`fluxcd/pkg` `SubstituteVariables`: AsYAML, then envsubst, then YAMLToJSON) confirms it. You
    chose the `command` wrapper, and the SPEC is updated.
  - Files: `k8s/flux/app/kustomization.yaml`, `k8s/flux/app/deployment.yaml`,
    `k8s/flux/app/service.yaml`, `k8s/config.env.example`
  - Deps: Task 0 · Size: M

- [x] **Task 2: Image automation templates**. Done: all checks pass. The API version
  (`image.toolkit.fluxcd.io/v1`) and field names were checked against the fluxcd.io docs. The
  Flux envsubst source (`fluxcd/pkg/envsubst`) confirms that only `${…}` is expanded, so
  `extract: '$n'` is safe. The local simulation now passes an explicit `APP_*` list to GNU
  envsubst to match. The IUA uses the bootstrap `flux-system` GitRepository, no `update.path`,
  and a `policySelector` on the app label. Task 7 must list "GitRepository `flux-system` with a
  write key + image controllers" as prerequisites.
  - Acceptance:
    - `ImageRepository` (`image: ${APP_IMAGE_REPO}`), `ImagePolicy` (filter
      `^(?P<n>\d+)-[a-f0-9]{7}$`, extract `$n`, numerical asc) and `ImageUpdateAutomation`
      (commits to the GitOps repo's branch, `update.strategy: Setters`) are in `flux-system`.
    - All three are named `${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}` and listed in
      `app/kustomization.yaml`.
  - Verify:
    - The files parse (python yaml) and `kubectl kustomize k8s/flux/app` still succeeds.
    - `printf '57-a1b2c3d\n57-a1b2c3d-init\nlatest\n' | grep -E '^[0-9]+-[a-f0-9]{7}$'` prints
      only `57-a1b2c3d`.
  - Files: `k8s/flux/app/image-repository.yaml`, `k8s/flux/app/image-policy.yaml`,
    `k8s/flux/app/image-update.yaml`, `k8s/flux/app/kustomization.yaml`
  - Deps: Task 1 · Size: M

- [x] **Task 3: Flux entry Kustomization**. Done: all 7 checks pass (structure, a single
  setter marker on the `APP_IMAGE_TAG` line, `<full-app-name>` 3× on non-comment lines, no
  literals). Added the `<path-to-app-dir>` and `<initial-tag>` placeholders, plus
  `wait: true`/`timeout: 5m`. Task 7 must document the placeholders and that `app/` stays
  outside the bootstrap Kustomization's path.
  - Acceptance:
    - `k8s/flux/kustomization.flux.yaml` (`kustomize.toolkit.fluxcd.io/v1`, in `flux-system`)
      points at `./app` with `prune: true`.
    - `postBuild.substituteFrom` is the ConfigMap `<full-app-name>-config`.
    - `postBuild.substitute.APP_IMAGE_TAG` carries the
      `# {"$imagepolicy": "flux-system:<full-app-name>:tag"}` marker.
    - `<full-app-name>` stays a placeholder. A header comment says the owner fills it in when
      copying.
  - Verify: the file parses. `grep -c '<full-app-name>'` gives 3 (name, ConfigMap, marker). The
    literal scan finds nothing.
  - Files: `k8s/flux/kustomization.flux.yaml`
  - Deps: Task 2 · Size: XS

### Checkpoint: Flux templates
- [x] Tasks 1–3 verify steps re-run green together.
- [x] Human review of `k8s/flux/` (substitution and marker placement) before any CI change.
- [x] Commit (Yes/No confirmation).

## Phase 2: Producer side and owner inputs

- [x] **Task 4: CI publish job → sortable tags**. Done: the `check-ci.py` asserts pass (tag
  step, both builds tagged from `vars.CMS_API_IMAGE_REPO`, `-init` pushed first, no
  `latest`/`migrate`/literal repo, and every other job unchanged vs HEAD). Also: a fail-fast
  guard for an unset `CMS_API_IMAGE_REPO`, the OCI source label now comes from
  `github.server_url`/`github.repository`, and the dead `APP_PORT` build arg is dropped (the
  Dockerfile stopped using it in `62438de`). The owner creates the `CMS_API_IMAGE_REPO` repo
  variable, and `CMS_API_APP_PORT` can be deleted.
  - Acceptance:
    - In `cms-api-ghcr-publish`, the tag is `${{ github.run_number }}-<sha7>`, and the image
      repo is `${{ vars.CMS_API_IMAGE_REPO }}`, not a literal.
    - Pushes are `<tag>-init` and then `<tag>`. No `latest`, `latest-migrate` or `-migrate`
      tags remain.
    - Comments are updated. No other job changes.
  - Verify:
    - `ci.yml` parses (python yaml).
    - `grep -n 'latest\|-migrate\|project-abyssoftime-v2/cms-api' .github/workflows/ci.yml`
      finds nothing in the cms-api publish job.
    - `git diff` only touches that job.
    - Remind the owner to create the `CMS_API_IMAGE_REPO` repo variable.
  - Files: `.github/workflows/ci.yml`
  - Deps: Task 0 · Size: S

- [x] **Task 5: Secret template for manual creation**. Done: the check passes (no
  `APP_*`/`PORT` keys, the secret key list is identical and in the same order as `62438de`, the
  header documents `kubectl create secret generic … --from-env-file=<(grep non-empty)`, the
  update-in-place variant and `rollout restart`, with no helmfile mention).
  `apps/cms-api/.env.example` is unchanged: the only divergence is `PORT`, which is intentional.
  - Acceptance:
    - `k8s/.env.example` has no `APP_*` keys and no `PORT`.
    - The header explains the `kubectl create secret generic <full-app-name>-secrets
      --from-env-file` flow (dropping empty values) instead of helmfile.
    - `apps/cms-api/.env.example` is unchanged unless the key list diverged.
  - Verify:
    - `grep -c '^APP_' k8s/.env.example` gives 0.
    - The non-`APP_*` key list is unchanged from before (diff the keys).
  - Files: `k8s/.env.example`
  - Deps: Task 1 · Size: XS

### Checkpoint: CI + inputs
- [x] `cd apps/cms-api && bun run lint && bun run test && bun run build` pass (regression guard). Lint 0 errors (1 pre-existing warning in `src/main.ts`), 152/152 suites, 1117 tests, build OK.
- [x] Commit (Yes/No confirmation).

## Phase 3: Remove helmfile

- [x] **Task 6: Delete helmfile artifacts** (ask before deleting). Done after your Yes: `git rm`
  of the 5 tracked files, and `secrets-chart/` is gone. `k8s/` now tracks `.env.example`,
  `config.env.example` and `flux/`. The Flux checks are still green. The remaining
  `helmfile`/`secrets-chart` refs are `SPEC.md` (intentional) and the 4 docs/rule files for
  Tasks 7–9. `ci.yml` is clean.
  - Acceptance: `k8s/helmfile.yaml.gotmpl`, `k8s/values.yaml.gotmpl` and `k8s/secrets-chart/`
    are removed.
  - Verify: `ls k8s` shows `.env.example`, `config.env.example` and `flux/`.
    `grep -rn 'helmfile\|secrets-chart' --exclude-dir=node_modules --exclude-dir=tasks .` finds
    only docs/rule files, which Tasks 7–9 fix.
  - Files: the 3 paths above
  - Deps: Tasks 1–3 · Size: S

## Phase 4: Docs, rules, wrap-up

- [x] **Task 7: Deployment doc**. Done: `check-doc.sh` passes 33/33 (naming contract, all 7
  variables, prerequisites, owner setup incl. placeholders and the app/-outside-bootstrap rule,
  migration `helm uninstall` of both releases, day-2 ops, `run_number` and command/CMD caveats,
  GHCR visibility, no helmfile commands). The old doc was deleted after your Yes. Correction
  found while writing: a rollback must `flux suspend image update` first, because a plain revert
  gets overwritten by the automation. The SPEC user story is fixed. Dangling links are left for
  Task 8 (the techstack doc) and Task 9 (`ENTRYPOINT.md`).
  - Acceptance:
    - `docs/documents/cms-api-flux-deployment.md` replaces `cms-api-k3s-deployment.md`
      (the old file is deleted, ask first).
    - It covers the naming contract, the ConfigMap and Secret keys, owner prerequisites
      (Flux controllers, write deploy key, `CMS_API_IMAGE_REPO` var), the one-time migration
      (`helm uninstall` of both old releases), how a deploy happens, rollback (revert the tag
      commit), restart after a Secret change, and the `run_number` caveat.
  - Verify: every SPEC "Owner prerequisites" and "Migration" step appears in the doc. No
    helmfile instructions remain.
  - Files: `docs/documents/cms-api-flux-deployment.md`,
    `docs/documents/cms-api-k3s-deployment.md` (delete)
  - Deps: Tasks 1–6 · Size: S

- [x] **Task 8: Techstack decision doc**. Done: `check-techstack.py` passes (all required topics,
  8 sections, each an options × criteria table with one `**Verdict**` row and exactly one
  `**Chosen`). Covers delivery (Flux/helmfile/Argo CD/CI push), tag delivery (automation/manual
  bump/`latest`), rendering (plain/HelmRelease), manifest home (separate repo/this repo), project
  info (ConfigMap/Secret/Git), tag format, the `PORT` injection and the migrator suffix. The old
  doc was deleted after your Yes, and its history is referenced as
  `git show c1168e6:…` (verified to exist).
  - Acceptance:
    - `docs/documents/cms-api-flux-deployment-techstack.md` replaces
      `cms-api-k3s-deployment-techstack.md` (delete, ask first).
    - It has comparison tables for Flux vs helmfile, image automation vs a ConfigMap tag bump vs
      `latest` + restart, plain manifests vs the shared chart, a separate GitOps repo vs in-repo,
      and a manual ConfigMap vs a Secret for project info.
  - Verify: each table has options × criteria and a stated winner (per the
    `docs/workflow.md` Decision rationale rule).
  - Files: the 2 techstack docs
  - Deps: Task 7 · Size: S

- [x] **Task 9: Rule, index and cross-refs**. Done: `check-t9.sh` passes (no stale refs in the
  rule, `ENTRYPOINT.md`, `dockerfile.md` or the memory file and index, apart from whitelisted history;
  the index links both new docs with no dangling links; the rule covers the manual Secret/ConfigMap and
  forbids cluster commands incl. `--dry-run=client`; `dockerfile.md` and the Dockerfile `CMD` comment
  point at the Deployment `command`). Also fixed stale `dockerfile.md` text not in the plan: the
  `APP_PORT` build-arg paragraph and build command (dead since `62438de`), and the migrator described
  as a k8s `Job` (it's now the `init` container, `<tag>-init`). The repo sweep only finds
  intentional historical mentions, and all 6 check scripts pass together.
  - Acceptance:
    - `docs/rules/k8s-secrets.md` describes the manual Secret and ConfigMap flow: agents never
      touch `k8s/.env*` other than `.env.example`, and never create cluster objects.
    - `docs/ENTRYPOINT.md` entries point to the new docs.
    - `docs/documents/dockerfile.md` refers to `-init`, not `-migrate`, and notes that the runner
      `CMD` is repeated in `k8s/flux/app/deployment.yaml`'s `command`. A one-line comment next to
      the Dockerfile `CMD` says the same.
    - The memory `feedback_never_touch_k8s_secret_yaml.md` no longer says helmfile builds the
      Secret.
  - Verify: `grep -rn 'helmfile\|-migrate\|secrets-prod\b' --exclude-dir=node_modules
    --exclude-dir=tasks apps/cms-api .github` finds only intentional historical mentions in the
    techstack doc.
  - Files: `docs/rules/k8s-secrets.md`, `docs/ENTRYPOINT.md`, `docs/documents/dockerfile.md`,
    the memory file
  - Deps: Tasks 7–8 · Size: S

- [x] **Task 10 (follow-up request): Secret/ConfigMap YAML templates**. Done:
  - `k8s/secret.example.yaml` and `k8s/configmap.example.yaml` are full manifests with
    `<placeholders>`, and they replace `k8s/.env.example` and `k8s/config.env.example` (removed, at
    your choice). The filled copies `k8s/secret.yaml` and `k8s/configmap.yaml` are gitignored.
  - In the Secret, required and defaulted keys are active and optional keys are commented out.
    `env.validation.ts` rejects `""` (e.g. `RATE_LIMIT_FPS: ""` → `0` → `@Min(1)`), so an empty
    optional key would stop the app booting.
  - Apply commands use `kubectl apply --server-side`, which avoids a plaintext
    `last-applied-configuration` copy of the Secret.
  - Updated the rule, `ENTRYPOINT.md`, the deployment doc, the entry-Kustomization comment and
    memory. `check-yaml-templates.py` passes 21/21, and all 6 checks are green.
  - `SPEC.md` still describes the env-file flow and is reduced at cleanup.

### Checkpoint: Complete
- [x] Every SPEC Success Criterion is ticked.
- [ ] Five-axis review (`/review`).
- [ ] Reduce `apps/cms-api/SPEC.md` back to the minimal pointer (workflow step 7).
- [x] Commit (Yes/No confirmation). Phase 4 committed before `/review` at your request; review + SPEC reduction still open.
- [ ] Owner, manual: create the namespace, Secret and ConfigMap, copy `k8s/flux/` to the GitOps
      repo, run the migration, then check that the first master push rolls the Deployment.

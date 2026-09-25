# Todo: cms-api public Ingress (vm-prod)

Spec: `apps/cms-api/SPEC.md` · Plan: `tasks/plan.md` · History: `tasks/archive.md`

## Phase 1: Manifests

- [x] **T1: Ingress Component**. Done: all 4 harness checks pass (scratchpad `check.sh` +
  `asserts.py`), and two mutants (a wrong middleware ref, a non-permanent redirect) are caught.
  Flux docs: an undefined `${var}` becomes `""`, and there's no fail-on-unset syntax. The only
  guard is `${var:=default}`, which doesn't help here.
  - Follow-up (your request): the host is now `api.${APP_DOMAIN}` (the bare domain is for the
    frontend and `admin.` is for cms-admin, both later), replacing `APP_HOST`. An empty
    `APP_DOMAIN` renders `api.`, which fails DNS-1123, so the apply fails instead of exposing a
    catch-all. `asserts.py` checks this.
  - Acceptance:
    - `k8s/flux/ingress/kustomization.yaml` is `kind: Component` (`kustomize.config.k8s.io/v1alpha1`)
      listing `ingress.yaml` and `middleware.yaml`.
    - Ingress `${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}` in `${APP_NAMESPACE}-${APP_ENV}`:
      `ingressClassName: traefik`, host and TLS host `api.${APP_DOMAIN}`, TLS secret `…-tls`, path `/`
      Prefix → the Service by port **name** `http`, annotations `cert-manager.io/cluster-issuer:
      ${APP_TLS_CLUSTER_ISSUER}` and `traefik.ingress.kubernetes.io/router.middlewares:
      <ns>-<name>-https-redirect@kubernetescrd`.
    - Middleware `…-https-redirect` (`traefik.io/v1alpha1`): `redirectScheme` https, permanent.
    - Each file has a header comment like the existing `k8s/flux/*.yaml`, and only `${APP_*}` plus
      generic literals.
  - Verify (scratchpad harness, see plan):
    - `kubectl kustomize apps/cms-api/k8s/flux` output is byte-identical to the pre-change snapshot.
    - Prod view renders 4 objects. Its placeholder set is exactly the 7 existing vars + `APP_DOMAIN`
      and `APP_TLS_CLUSTER_ISSUER`.
    - After fake `envsubst`, the PyYAML asserts pass: class, host, TLS, backend name and port name,
      issuer annotation, middleware ref equal to the rendered Middleware's `<ns>-<name>@kubernetescrd`,
      and a permanent redirect to https.
    - `grep -rn 'abyssoftime\|hungnh1812dev' apps/cms-api/k8s/flux/` finds nothing.
  - Files: `k8s/flux/ingress/{kustomization,ingress,middleware}.yaml` (new)
  - Deps: none · Size: S

- [x] **T2: Enable on vm-prod + ConfigMap template keys**. Done: scratchpad `check-t2.sh` passes
  (components resolve under `spec.path`, vm-dev untouched, CI sed sets exactly one tag line,
  template keys present). The merge was simulated with a 3-way `git merge-file` of the prod file
  against `origin/deployment`, not a worktree merge, since the change is uncommitted: no conflict,
  and deployment's real tag `80-9380735-amd64` is kept.
  - Acceptance:
    - `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml` gets `components: [ingress]` directly
      under `path:`, and its header comment mentions it. vm-dev's file is unchanged.
    - `k8s/configmap.example.yaml` adds `APP_DOMAIN` and `APP_TLS_CLUSTER_ISSUER` with placeholders,
      marked "only where the `ingress` component is enabled (vm-prod); set before merging to
      `deployment`, or the Flux apply fails".
  - Verify:
    - `git diff` of the prod file shows only the `components` lines and the header comment.
    - The CI sed from `.github/workflows/ci.yml` (the `APP_IMAGE_TAG` rewrite plus its `grep -c`
      check), run on a scratchpad copy, still sets exactly one tag line.
    - In a scratchpad `git worktree` of `origin/deployment`, `git merge` of this branch completes
      with no conflict on `abyssdev-apps-prod.yaml`, and the worktree is removed afterwards.
    - `git diff --quiet clusters/abyssdev/vm-dev` succeeds.
  - Files: `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml`, `k8s/configmap.example.yaml`
  - Deps: T1 · Size: XS

### Checkpoint 1: Manifests
- [x] Every T1 and T2 verify step passes (re-run the harness once at the end).
- [x] Commit `feat(cms-api): add Traefik ingress for vm-prod` (Yes/No confirmation, no co-author line),
      on the new branch `feature/cms-api-ingress`.

## Phase 2: Docs

- [ ] **T3: Runbook (`k8s/README.md`)**
  - Acceptance:
    - New section "Expose cms-api (vm-prod)" with the prerequisites in order: DNS record, inbound
      80/443, cert-manager + a Let's Encrypt ClusterIssuer (HTTP-01, `ingressClassName: traefik`,
      example YAML), the two ConfigMap keys applied **before** merging to `deployment`, and
      `CORS_ORIGINS`.
    - A verify block with `curl -I http://api.<domain>` (301/308), `curl https://api.<domain>/health` (200),
      `kubectl -n <full-namespace> get ingress,certificate`, and the ConfigMap table updated.
    - A client-IP caveat with the `HelmChartConfig` (`externalTrafficPolicy: Local`) snippet,
      presented as optional and applied by the owner.
    - The "Inbound: nothing is needed" line and the checklist are updated.
  - Verify: the doc is read end-to-end, every command runs offline or is marked as an owner step,
    and no real hostname appears.
  - Files: `k8s/README.md`
  - Deps: T1, T2 · Size: S

- [ ] **T4: Deployment doc, techstack doc and ENTRYPOINT**
  - Acceptance:
    - `cms-api-flux-deployment.md`: "There's no Ingress" is replaced with an Ingress section
      covering the Component, the vm-prod-only mechanism, the new keys, the empty-`APP_DOMAIN` gotcha (host `api.`, apply fails),
      the middleware naming and "reach it" updates.
    - `cms-api-flux-deployment-techstack.md`: comparison tables for (a) Traefik vs ingress-nginx vs
      Gateway API vs F5 NGINX, and (b) Component vs overlay dir vs second Flux Kustomization vs
      per-cluster copy.
    - `docs/ENTRYPOINT.md`: the flux-deployment bullets mention the Ingress.
  - Verify: `grep -n "no Ingress"` finds nothing in cms-api docs, and the ENTRYPOINT links resolve.
  - Files: `docs/documents/cms-api-flux-deployment.md`,
    `docs/documents/cms-api-flux-deployment-techstack.md`, `docs/ENTRYPOINT.md`
  - Deps: T1, T2 · Size: S

### Checkpoint 2: Complete
- [ ] Every SPEC Success Criterion is ticked.
- [ ] Commit `docs(cms-api): document the vm-prod ingress` (Yes/No confirmation).
- [ ] Five-axis review (`/review`).
- [ ] Reduce `apps/cms-api/SPEC.md` to the minimal pointer (workflow step 7).
- [ ] Owner, manual: DNS, cert-manager + ClusterIssuer, ConfigMap keys, merge `master` into
      `deployment`, then run the runbook verify block.

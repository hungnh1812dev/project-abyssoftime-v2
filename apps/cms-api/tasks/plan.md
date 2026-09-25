# Implementation Plan: cms-api public Ingress (vm-prod)

Spec: `apps/cms-api/SPEC.md`. Task list: `tasks/todo.md`. Prior work: `tasks/archive.md`.

## Overview

Expose cms-api on vm-prod over HTTPS on its own hostname. A kustomize Component, `k8s/flux/ingress/`,
holds a Traefik Ingress and an http→https Middleware, and the Ingress gets its certificate through a
cert-manager ClusterIssuer annotation. Only vm-prod's app Kustomization enables the Component
(`spec.components`). The hostname and issuer come from two new prod ConfigMap keys. vm-dev and the
base manifests are unchanged.

## Dependency graph

```
k8s/flux/ingress/ (Component: Ingress + Middleware)      ← T1
    │
    ├── vm-prod abyssdev-apps-prod.yaml: components: [ingress]   ← T2
    │   configmap.example.yaml: APP_HOST, APP_TLS_CLUSTER_ISSUER ← T2
    │
    └── docs: k8s/README.md runbook                              ← T3
              deployment doc + techstack doc + ENTRYPOINT        ← T4
```

T3 and T4 depend only on T1–T2 being settled, and don't depend on each other.

## Architecture decisions

- **Component, not overlay and not a second Flux Kustomization.** Enabling it is a single line in
  vm-prod's file. There's no second reconcile loop, and the base path and vm-dev stay
  byte-identical. The techstack doc gets the full comparison.
- **Traefik (bundled with k3s)** over ingress-nginx, which was retired in March 2026 and isn't
  installed, and over Gateway API, which is more moving parts for one host.
- **Backend port by name (`http`).** This avoids a numeric `${APP_PORT}` in the Ingress, which would
  hit the int-substitution gotcha.
- **`components:` goes right under `path:`** in `abyssdev-apps-prod.yaml`, away from the
  `APP_IMAGE_TAG:` line. That keeps CI's line-based sed working and lets `master → deployment`
  merges apply cleanly on top of the real tag.
- **Offline test harness in the scratchpad**, not in the repo. A throwaway kustomization with
  `resources: [<repo>/apps/cms-api/k8s/flux]` and `components: [<repo>/apps/cms-api/k8s/flux/ingress]`
  mimics Flux's `spec.path` + `spec.components`. It is then rendered with `kubectl kustomize`, filled
  with `envsubst` and fake values, and checked with PyYAML asserts. The existing
  `kubectl` v1.36 / kustomize v5.8 support Components.

## Task list

### Phase 1: Manifests
- [ ] T1: Ingress Component (Ingress + https-redirect Middleware)
- [ ] T2: Enable on vm-prod + document the new ConfigMap keys

### Checkpoint 1: Manifests
- [ ] vm-dev render is byte-identical, prod render passes all asserts, and there are no literals
- [ ] Commit (Yes/No confirmation)

### Phase 2: Docs
- [ ] T3: Runbook (`k8s/README.md`)
- [ ] T4: Deployment doc, techstack doc and ENTRYPOINT

### Checkpoint 2: Complete
- [ ] Every SPEC Success Criterion is ticked
- [ ] Commit (Yes/No confirmation)
- [ ] Five-axis review, then reduce SPEC.md to the minimal pointer (workflow steps 6–7)

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `APP_HOST` is missing from the prod ConfigMap when Flux applies. Flux substitutes an empty string, so the result is a host-less Ingress (a catch-all on every hostname). | High | The runbook orders the steps: add the keys and re-apply the ConfigMap **before** merging `master` into `deployment`. The Flux doc and the ConfigMap template call this out. Checked in T1: Flux's docs offer no fail-on-unset syntax (an undefined var becomes `""`), so this stays a documented step. |
| The Traefik middleware reference name is wrong (`<ns>-<name>@kubernetescrd`), which makes the router fail with a 404 on all routes. | High | A T1 assert checks that the rendered annotation equals `<Middleware ns>-<Middleware name>@kubernetescrd`, built from the rendered Middleware. |
| cert-manager or the ClusterIssuer is missing on vm-prod, so the Ingress serves Traefik's default self-signed cert. | Med | Owner prerequisite in the runbook, with a `kubectl get certificate` check in the verify section. |
| ServiceLB SNAT hides client IPs, so the per-IP rate limit puts every user in one bucket. | Med | Documented in the runbook, with the `HelmChartConfig` snippet. Committing it is ask-first (SPEC Open Question 2). |
| A merge conflict on `abyssdev-apps-prod.yaml` when merging `master → deployment`. | Low | The `components:` lines sit away from the tag line, and T2 verifies with a simulated merge in a temp worktree in the scratchpad. |

## Open questions (from SPEC, defaults applied if unanswered)

1. cert-manager / ClusterIssuer: **default = runbook step only**, nothing committed.
2. Traefik `externalTrafficPolicy: Local`: **default = documented only**.
3. Stray `apps/abyssdev-cms-api-prod/deployment.yaml`: **default = out of scope**, untouched.

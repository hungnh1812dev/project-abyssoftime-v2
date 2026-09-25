# Spec: cms-api public Ingress (vm-prod)

Status: **DRAFT**, awaiting approval
Date: 2026-09-25
Target app: `apps/cms-api` (+ `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml`)

The previous spec (cms-api CI/CD on Flux) is done and documented in
`docs/documents/cms-api-flux-deployment*.md`. It remains in git history.

---

## Objective

Make cms-api on **vm-prod** reachable from the internet over **HTTPS** on its own hostname. Traffic
goes through the **Traefik** ingress controller that ships with k3s, and the certificate comes from
**cert-manager + Let's Encrypt**. Today the app has only a ClusterIP Service and no Ingress.

### User stories

- **As a public-site or cms-admin user**, I call `https://api.<APP_DOMAIN>/api/v1/...`,
  `/graphql`, `/api-docs` and `/health`, and all of them reach cms-api over a valid TLS certificate.
- **As a user who types `http://`**, I get a permanent redirect to `https://`.
- **As the owner**, I set the hostname and ClusterIssuer name in the prod ConfigMap. I don't edit a
  manifest, and after a merge from `master` to `deployment`, Flux applies the change.
- **As the owner of vm-dev**, nothing changes: the local VM stays ClusterIP-only.

### Non-goals

- Installing cert-manager, creating the ClusterIssuer, DNS records, or firewall changes. The owner
  does these, and the docs list them as prerequisites.
- Changing Traefik's cluster config (e.g. `HelmChartConfig`), apart from documenting the client-IP
  caveat below.
- Exposing vm-dev, cms-admin or frontend.
- ingress-nginx. It was retired upstream in March 2026 and k3s doesn't include it (see the
  techstack doc).
- Restricting paths. All paths are public, `/api-docs` included.

---

## Design

### Only on vm-prod: a kustomize Component

Both clusters use the same `apps/cms-api/k8s/flux` path. The Ingress goes in a **kustomize
Component** that only vm-prod turns on:

```
apps/cms-api/k8s/flux/
  kustomization.yaml     # unchanged: deployment + service
  deployment.yaml        # unchanged
  service.yaml           # unchanged
  ingress/               # NEW, kind: Component
    kustomization.yaml   # components list: ingress.yaml + middleware.yaml
    ingress.yaml         # networking.k8s.io/v1 Ingress
    middleware.yaml      # traefik.io/v1alpha1 Middleware: redirectScheme https, permanent
```

`clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml` gets `spec.components: [ingress]`. Flux
resolves that path relative to `spec.path`, and the base `kustomization.yaml` stays unchanged. The
`APP_IMAGE_TAG:` line that CI rewrites with sed stays exactly as it is. vm-dev's file doesn't change.

### Ingress (`${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}`, ns `${APP_NAMESPACE}-${APP_ENV}`)

```yaml
metadata:
  annotations:
    cert-manager.io/cluster-issuer: ${APP_TLS_CLUSTER_ISSUER}
    traefik.ingress.kubernetes.io/router.middlewares: ${APP_NAMESPACE}-${APP_ENV}-${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}-https-redirect@kubernetescrd
spec:
  ingressClassName: traefik
  tls:
    - hosts: [api.${APP_DOMAIN}]
      secretName: ${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}-tls
  rules:
    - host: api.${APP_DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}
                port:
                  name: http     # the Service's named port; no numeric ${APP_PORT} needed
```

- **Middleware** `${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}-https-redirect`, in the app namespace:
  `redirectScheme: { scheme: https, permanent: true }`. Traefik's middleware reference takes the
  form `<namespace>-<name>@kubernetescrd`.
- cert-manager's HTTP-01 solver creates its own Ingress for `/.well-known/acme-challenge/...`. That
  path is longer, so Traefik gives it priority over the redirect router. Let's Encrypt also follows
  redirects.
- `ingressClassName: traefik` is a literal. It's the k3s default and not project-specific, the same
  kind of value as `/health`.

### New ConfigMap keys (prod only)

| Key | Meaning | Example (**not in code**) |
| --- | --- | --- |
| `APP_DOMAIN` | Bare site domain. cms-api is served at `api.<APP_DOMAIN>` (frontend at the bare domain, cms-admin at `admin.<APP_DOMAIN>`, both later) | `example.com` |
| `APP_TLS_CLUSTER_ISSUER` | cert-manager ClusterIssuer name | `letsencrypt-prod` |

These keys are added to `k8s/configmap.example.yaml`, marked "only needed where the `ingress`
component is enabled". vm-dev's ConfigMap can leave them out, because vm-dev never renders the
component.

### Owner prerequisites (docs only, no agent action)

1. A DNS `A`/`AAAA` record for `api.<APP_DOMAIN>` pointing at the VPS. Inbound 80 and 443 are open.
2. cert-manager is installed, with a ClusterIssuer (ACME, Let's Encrypt prod, HTTP-01 solver
   `ingressClassName: traefik`) whose name goes in `APP_TLS_CLUSTER_ISSUER`.
3. The two new keys are added to the prod ConfigMap and re-applied with `--server-side`.
4. `CORS_ORIGINS` in the prod Secret lists the real browser origins (cms-admin, frontend).
5. `master` is merged into `deployment`.

### Client IP caveat (TRUST_PROXY / rate limiting)

`TRUST_PROXY: "1"` trusts one hop (Traefik), which is correct. But k3s's ServiceLB (klipper) with
the default `externalTrafficPolicy: Cluster` SNATs traffic, so the `X-Forwarded-For` that Traefik
sends may hold the **node IP instead of the client IP**. The per-IP auth rate limit would then
share one bucket across every user. The fix is at cluster level (a Traefik `HelmChartConfig` with
`service.spec.externalTrafficPolicy: Local`), so the runbook documents it and this change doesn't
make it. See Open Questions.

---

## Tech Stack

k3s's bundled Traefik v3 (`networking.k8s.io/v1` Ingress, `traefik.io/v1alpha1` Middleware),
cert-manager (`cert-manager.io/cluster-issuer` annotation), Flux `kustomize.toolkit.fluxcd.io/v1`
(`spec.components`), and kustomize Components (`kustomize.config.k8s.io/v1alpha1`).

## Commands

```bash
# Base renders unchanged (vm-dev view): only Deployment + Service
kubectl kustomize apps/cms-api/k8s/flux

# Prod view: Flux applies spec.components on top of spec.path. Mimic it with a throwaway
# kustomization in the scratchpad (resources: <repo>/apps/cms-api/k8s/flux, components: <…>/ingress)
kubectl kustomize <scratchpad>/prod-view

# Fake substitution, same order as Flux (build → envsubst), then assert offline with PyYAML
kubectl kustomize <scratchpad>/prod-view | APP_NAME=a APP_SERVICE_NAME=s APP_NAMESPACE=n APP_ENV=prod \
  APP_PORT=3000 APP_IMAGE_REPO=r APP_IMAGE_TAG=1-abcdef0-amd64 APP_DOMAIN=example.test \
  APP_TLS_CLUSTER_ISSUER=le-test envsubst | python3 <assert script>
```

There's no `kubectl apply --dry-run`, `flux build` or `kubeconform`: the first contacts the cluster,
and the other two aren't installed (installing them is ask-first).

## Project Structure

```
apps/cms-api/k8s/flux/ingress/                    # NEW Component (3 files)
apps/cms-api/k8s/configmap.example.yaml           # + APP_DOMAIN, APP_TLS_CLUSTER_ISSUER
clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml # + spec.components: [ingress]
apps/cms-api/k8s/README.md                        # prerequisites, ConfigMap keys, verify, client-IP note
apps/cms-api/docs/documents/cms-api-flux-deployment.md          # "There's no Ingress" → Ingress section
apps/cms-api/docs/documents/cms-api-flux-deployment-techstack.md # Traefik vs ingress-nginx vs Gateway API; Component vs separate Flux Kustomization vs overlay
apps/cms-api/docs/ENTRYPOINT.md                   # pointer update
```

## Code Style

Match the existing `k8s/flux/*.yaml`: 2-space YAML, a short header comment saying what the file is
and where its values come from, and only `${APP_*}` placeholders plus generic literals (`traefik`,
`/`, `https`). Reference the Service port by **name** (`http`) so no numeric placeholder ends up in
the Ingress.

## Testing Strategy

This is infra config, so there are no unit tests. Verification:

1. `kubectl kustomize apps/cms-api/k8s/flux` output is **byte-identical** before and after
   (vm-dev is unaffected).
2. The prod view renders a Deployment, Service, Ingress and Middleware. Its placeholder set is
   exactly the 7 existing vars + `APP_DOMAIN` + `APP_TLS_CLUSTER_ISSUER`.
3. After fake substitution, PyYAML asserts check:
   - the Ingress class, host, TLS host and secret, and the backend Service name and port name `http`
   - the issuer annotation
   - the middleware annotation equals `<ns>-<middleware-name>@kubernetescrd` and matches the
     rendered Middleware's namespace and name
   - the redirect is `https` and permanent
4. `grep` finds no `abyssoftime`, `hungnh1812dev` or real hostname under `k8s/flux/**`.
5. `git diff` on `abyssdev-apps-prod.yaml` shows only the added `components` lines, and the
   `APP_IMAGE_TAG:` line is untouched, so the CI sed still matches.
6. Manual, by the owner after deploy: `curl -I http://api.<domain>` returns 301/308 to https,
   `curl https://api.<domain>/health` returns 200 with a valid Let's Encrypt cert, and
   `kubectl get certificate -n <ns>` shows Ready.

## Boundaries

- **Always:** use only `${APP_*}` in `k8s/flux/**`, leave vm-dev behavior unchanged, and update the
  runbook, deployment doc, techstack doc and ENTRYPOINT in the same change.
- **Ask first:** adding cert-manager, ClusterIssuer or Traefik `HelmChartConfig` manifests to the
  repo, installing CLI tools, changing the base `kustomization.yaml` or vm-dev files, any commit, and
  deleting files (including the stray `apps/abyssdev-cms-api-prod/deployment.yaml`, which is out of
  scope).
- **Never:** run `kubectl`/`flux`/`helm` against a cluster (not even `--dry-run=client`), read or
  edit the filled `k8s/secret.yaml` / `k8s/configmap.yaml` / `k8s/.env*`, or commit a real
  hostname or issuer name.

## Success Criteria

- [ ] `k8s/flux/ingress/` Component exists and passes Testing steps 1–5.
- [ ] vm-prod's app Kustomization enables it, and vm-dev's file is unchanged.
- [ ] `configmap.example.yaml` documents `APP_DOMAIN` and `APP_TLS_CLUSTER_ISSUER` as prod/Ingress-only.
- [ ] The runbook covers DNS, ports, cert-manager + ClusterIssuer, the new ConfigMap keys, the
      post-deploy curl checks and the client-IP caveat. The deployment doc no longer says
      "There's no Ingress".
- [ ] The techstack doc has comparison tables for the controller choice and the prod-only mechanism.

## Open Questions

1. **cert-manager on vm-prod.** Is it already installed, and what's the ClusterIssuer called? If
   it isn't installed, do you want its ClusterIssuer committed under `clusters/abyssdev/vm-prod/`
   (Flux-managed), or kept as a runbook step?
2. **Client IP for rate limiting.** Should the Traefik `HelmChartConfig`
   (`externalTrafficPolicy: Local`) be committed under `clusters/abyssdev/vm-prod/` so Flux manages
   it, or only documented?
3. **Stray `apps/abyssdev-cms-api-prod/deployment.yaml`** (an old duplicate of the Deployment).
   Should it be deleted in a separate change?

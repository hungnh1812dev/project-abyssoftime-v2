# k3s Deployment (Flux + GHCR + the `deployment` branch)

cms-admin runs on the owner's k3s VPS (`vm-prod`) at **`https://admin.<domain>`**. It uses the same
delivery path as cms-api:

1. A `master` push that changes cms-admin builds one image and pushes it to GHCR.
2. The CI job `cms-admin-bump-tag` commits that tag to the **`deployment` branch**.
3. Flux on vm-prod reads only `deployment` and applies the manifests with the new tag.

`staging` pushes still deploy cms-admin to **Render** (the `deploy-cms-admin` job). `master` no
longer touches Render.

The cluster itself (k3s, Flux bootstrap, cert-manager, Traefik, the `deployment` branch) is set up
once for all apps in cms-api's runbook, [apps/cms-api/k8s/README.md](../../../cms-api/k8s/README.md).
The Flux design (branches, reconcile loop, the tag-bump script) is in
[cms-api-flux-deployment.md](../../../cms-api/docs/documents/cms-api-flux-deployment.md). This doc
covers only what is specific to cms-admin. The reasons behind each choice are in
[cms-admin-flux-deployment-techstack.md](./cms-admin-flux-deployment-techstack.md).

## Files

| File | Role |
| --- | --- |
| `apps/cms-admin/Dockerfile` | Bun build stage, then `nginx:1.27-alpine` serving `dist/`. Requires the `VITE_API_URL` build arg |
| `apps/cms-admin/nginx.conf` | SPA fallback (`try_files … /index.html`) and `location = /healthz` (200, answered by nginx). No proxies |
| `apps/cms-admin/.dockerignore` | Keeps `node_modules`, `dist`, `.git` and **`.env*`** out of the build context. Vite would bake any `.env` value into the bundle |
| `apps/cms-admin/k8s/flux/` | Deployment, Service, Ingress, Middleware, and their `kustomization.yaml`. `${APP_*}` placeholders only |
| `apps/cms-admin/k8s/configmap.example.yaml` | ConfigMap template (7 keys). Your filled copy `k8s/configmap.yaml` is gitignored |
| `clusters/abyssdev/vm-prod/abyssdev-cms-admin-prod.yaml` | The app Flux Kustomization `abyssdev-cms-admin-sync-prod`. Holds the ConfigMap name and the one `APP_IMAGE_TAG:` line CI rewrites on `deployment` |
| `.github/workflows/ci.yml` → `cms-admin-ghcr-publish`, `cms-admin-ghcr-cleanup`, `cms-admin-bump-tag` | Build and push, opt-in cleanup, and the tag bump (see [CI](#ci)) |

## The image

- **The API URL is baked in at build time.** cms-admin is a static Vite SPA, and the browser calls
  cms-api directly. The app reads `import.meta.env.VITE_API_URL` and appends `/api/v1` (the axios
  client) and `/health` (the health gate). So the build arg must be the **bare origin**, for example
  `https://api.<domain>`, with no path.
- The build fails straight away if `VITE_API_URL` is empty (`test -n` in the Dockerfile), so an image
  can never silently point at `""`.
- One image serves exactly one API. That's fine with a single cluster. A second environment would
  need its own image, or a runtime `config.js` (see the techstack).
- `nginx.conf` used to proxy `/api/` and `/auth/` to `http://api:8080`, a docker-compose leftover.
  It's gone: the browser calls the absolute `VITE_API_URL` itself.

## What Flux applies

Names follow the cms-api naming contract: `<app-name>-<app-service-name>-<app-env>` in
`<app-namespace>-<app-env>`. With `APP_SERVICE_NAME=cms-admin` that's `abyssdev-cms-admin-prod`.

- **Deployment:** 1 replica, container `app` on port **80** (an image fact, so it's not a ConfigMap
  key), named `http`. No Secret and no `envFrom`: nothing is configured at runtime.
- **Probes:** liveness and readiness are `httpGet /healthz` on `http`. nginx answers it itself, so a
  cms-api outage never restarts cms-admin.
- **Resources:** requests `10m`/`32Mi`, limits `200m`/`128Mi`.
- **Service:** ClusterIP on port 80 → the named port `http`.
- **Ingress:** Traefik, host and TLS host **`admin.${APP_DOMAIN}`**, certificate
  `<full-app-name>-tls` from the ClusterIssuer in `APP_TLS_CLUSTER_ISSUER`, backend by port name.
  If `APP_DOMAIN` is missing or empty, the host renders as `admin.`, which isn't a valid DNS name, so
  the API server rejects the Ingress and the Flux apply fails instead of exposing a catch-all.
- **Middleware:** `<full-app-name>-https-redirect`, a permanent `redirectScheme: https`. The Ingress
  references it as `<namespace>-<name>@kubernetescrd`, so keep the two in sync.

The Ingress sits directly in the base (no kustomize Component as cms-api has), because vm-prod is
the only cluster.

### Variables substituted into `apps/cms-admin/k8s/flux/`

| Variable | Source | Used for |
| --- | --- | --- |
| `APP_NAME`, `APP_SERVICE_NAME`, `APP_ENV` | ConfigMap | Every name |
| `APP_NAMESPACE` | ConfigMap | The namespace, `${APP_NAMESPACE}-${APP_ENV}` |
| `APP_IMAGE_REPO` | ConfigMap | The image |
| `APP_IMAGE_TAG` | `postBuild.substitute` in the cluster file, written by `cms-admin-bump-tag` on `deployment` (`<run>-<sha7>-amd64`) | The image |
| `APP_DOMAIN` | ConfigMap | Ingress host and TLS host `admin.${APP_DOMAIN}` |
| `APP_TLS_CLUSTER_ISSUER` | ConfigMap | The `cert-manager.io/cluster-issuer` annotation |

The cms-api URL isn't a variable here. It's in the image.

## CI

All three jobs run only on `master` pushes that change cms-admin (they depend on `cms-admin-build`).

- **`cms-admin-ghcr-publish`**
  - Fails straight away if the repo variable `CMS_ADMIN_IMAGE_REPO` or `CMS_ADMIN_API_URL` is unset.
  - Builds `apps/cms-admin` on `ubuntu-latest` with `--build-arg VITE_API_URL=$CMS_ADMIN_API_URL`
    and the OCI source label, and pushes **`<run_number>-<sha7>-amd64`**. It's one image, so there's
    no init-first ordering like cms-api's.
  - Exposes the arch-less `<run_number>-<sha7>` as `outputs.tag`.
- **`cms-admin-ghcr-cleanup`** runs only when `CMS_ADMIN_GHCR_CLEANUP` is `true`, and keeps the newest
  **5** versions (1 per release). It needs this repo to have the Admin role on the package.
- **`cms-admin-bump-tag`** runs `.github/scripts/bump-flux-tag.sh cms-admin "$TAG"
  clusters/abyssdev/vm-prod/abyssdev-cms-admin-prod.yaml:amd64`. It has the same checkout layout
  (script from the built commit, `deployment` in `./deployment`), retry and run-number guard as
  cms-api's, and its own concurrency group `cms-admin-bump-tag`. The commit is
  `chore(cms-admin): deploy image <tag>`.

## Owner setup (one time)

Prerequisite: vm-prod is running Flux on the `deployment` branch, with cert-manager and a
ClusterIssuer (cms-api runbook steps 1–5 and 8.2).

1. **DNS:** an `A` record (plus `AAAA` for IPv6) for `admin.<domain>` pointing at the VPS. Ports 80
   and 443 are already open for cms-api.
2. **Repo variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable | Value | Required |
   | --- | --- | --- |
   | `CMS_ADMIN_IMAGE_REPO` | `ghcr.io/<owner>/project-abyssoftime-v2/cms-admin` (lowercase) | Yes |
   | `CMS_ADMIN_API_URL` | `https://api.<domain>`, the bare origin with no path | Yes |
   | `CMS_ADMIN_GHCR_CLEANUP` | `true` | No. Set it after the first deploy works |

3. **First image:** push a cms-admin change to `master`. Then, in the package settings (github.com →
   your profile → Packages → `cms-admin`):
   - **Visibility → Public.** The Deployment has no image pull secret, so the VPS can't pull a
     private image.
   - **Manage Actions access → add this repo with the Admin role**, only if you'll use cleanup.
4. **ConfigMap on the VPS:**
   ```bash
   cp apps/cms-admin/k8s/configmap.example.yaml apps/cms-admin/k8s/configmap.yaml   # gitignored
   # fill in: name abyssdev-cms-admin-prod-config, APP_SERVICE_NAME "cms-admin", APP_ENV "prod",
   # the same APP_NAME / APP_NAMESPACE / APP_DOMAIN / APP_TLS_CLUSTER_ISSUER as cms-api's
   kubectl apply --server-side -f apps/cms-admin/k8s/configmap.yaml
   ```
   The namespace is shared with cms-api, so it already exists.
5. **CORS on cms-api:** add `https://admin.<domain>` to `CORS_ORIGINS` in cms-api's `secret.yaml`,
   re-apply it, and restart cms-api (cms-api runbook step 8.4). Without it, the browser blocks every
   API call from `admin.<domain>`.
6. **Deploy:** merge `master` into `deployment`, then:
   ```bash
   flux reconcile kustomization abyssdev-cms-admin-sync-prod --with-source
   kubectl -n <app-namespace>-prod get deploy,ingress,certificate
   curl -I http://admin.<domain>/            # 301/308 to https
   curl https://admin.<domain>/healthz       # ok
   ```
   Then log in at `https://admin.<domain>` and reload a page after a few minutes to check the silent
   token refresh.

## Day-2 operations

- **A new release:** push to `master`. The bump commit lands on `deployment`, and Flux rolls the pod
  within a few minutes.
- **A new API URL:** change `CMS_ADMIN_API_URL` and push a cms-admin change (or re-run the publish
  job). The URL is in the image, so a ConfigMap change won't do it.
- **Rollback:** push a commit to `deployment` that sets `APP_IMAGE_TAG` in
  `abyssdev-cms-admin-prod.yaml` to an older `<run>-<sha7>-amd64`. It holds until the next cms-admin
  build. With cleanup on, only the last 5 releases exist.
- **Manifest change:** edit on `master`, then merge `master` into `deployment`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| CI: `Repository variable CMS_ADMIN_API_URL is not set` | Variable missing | Owner setup step 2 |
| Pod `ImagePullBackOff` | The package is private, or the tag doesn't exist yet (the `"dev"` placeholder) | Make the package public; check `APP_IMAGE_TAG` on `deployment` |
| Kustomization: `spec.rules[0].host: Invalid value: "admin."` | `APP_DOMAIN` missing from the ConfigMap | Owner setup step 4 |
| Page loads, but every API call fails with a CORS error | `https://admin.<domain>` isn't in cms-api's `CORS_ORIGINS` | Owner setup step 5 |
| API calls go to the wrong host, or to `/api/v1` on `admin.<domain>` | `CMS_ADMIN_API_URL` wrong or empty when the image was built | Fix the variable and rebuild |
| `deploy-cms-admin` (Render) fails on a `staging` push with an environment protection error | The `Production` GitHub environment only allows `master` | Allow `staging` in that environment's deployment branches, or move `CMS_ADMIN_RENDER_DEPLOY_HOOK` to a `Staging` environment |
| Login works, but the session drops on reload | The refresh cookie isn't sent to `api.<domain>` | Check cms-api's cookie settings for the cross-subdomain setup |

## Verified state

Checked offline on 2026-09-26:

- The image builds only with `VITE_API_URL` set. The container serves `/healthz` (200) and SPA deep
  links (`index.html`), the built JS contains the given API URL, and the image has no `.env*` file.
  lint, the 471 tests and the build pass.
- `kubectl kustomize apps/cms-admin/k8s/flux` renders a Deployment, Service, Ingress and Middleware.
  With fake values, names, labels, the image, int ports, the named-port Service, the TLS/rule host
  `admin.<domain>`, the issuer and the Middleware reference all check out. Flux's own envsubst
  library turns a missing or empty `APP_DOMAIN` into the invalid host `admin.`.
- The cluster file matches cms-api's (interval, prune, wait, timeout), has exactly one
  `APP_IMAGE_TAG:` line, and `kubectl kustomize clusters/abyssdev/vm-prod` renders all three apps.
- The CI jobs were asserted against the baseline `ci.yml`, and the bump was dry-run against a
  throwaway repo (own file only, re-run and older-run no-ops, a race with a cms-api bump).
- Not verified here (owner, live): the first GHCR push, the certificate, login and refresh on
  `admin.<domain>`, and CORS.

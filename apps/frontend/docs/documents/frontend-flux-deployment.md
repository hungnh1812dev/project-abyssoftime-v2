# k3s Deployment (Flux + GHCR + the `deployment` branch)

The frontend runs on the owner's k3s VPS (`vm-prod`) at the bare domain **`https://<domain>`**. It
uses the same delivery path as cms-api:

1. A `master` push that changes the frontend builds one Next.js image and pushes it to GHCR.
2. The CI job `frontend-bump-tag` commits that tag to the **`deployment` branch**.
3. Flux on vm-prod reads only `deployment` and applies the manifests with the new tag.

`staging` pushes still deploy the frontend to **Vercel** (the `deploy-frontend` job). `master` no
longer touches Vercel.

The cluster itself (k3s, Flux bootstrap, cert-manager, Traefik, the `deployment` branch) is set up
once for all apps in cms-api's runbook, [apps/cms-api/k8s/README.md](../../../cms-api/k8s/README.md).
The Flux design (branches, reconcile loop, the tag-bump script) is in
[cms-api-flux-deployment.md](../../../cms-api/docs/documents/cms-api-flux-deployment.md). This doc
covers only what is specific to the frontend. The reasons behind each choice are in
[frontend-flux-deployment-techstack.md](./frontend-flux-deployment-techstack.md).

## Files

| File | Role |
| --- | --- |
| `apps/frontend/Dockerfile` | `deps` + `builder` on `oven/bun:1-alpine`, then a `node:24-alpine` runner that starts Next's standalone `server.js` as the non-root `node` user on port 3000 |
| `apps/frontend/.dockerignore` | Keeps **`.env*`** (a real `.env.local` lives in this folder), `.next`, `.vercel`, `node_modules`, `e2e`, `*.md` and `.git` out of the build context |
| `apps/frontend/next.config.mjs` | `output: "standalone"` only when `NEXT_OUTPUT=standalone`, which only the Dockerfile sets. The Vercel build is unchanged |
| `apps/frontend/k8s/flux/` | Deployment, Service, Ingress, Middleware, and their `kustomization.yaml`. `${APP_*}` placeholders only |
| `apps/frontend/k8s/configmap.example.yaml` | ConfigMap template (7 keys). Your filled copy `k8s/configmap.yaml` is gitignored |
| `apps/frontend/k8s/secret.example.yaml` | Secret template: runtime config and secrets. Your filled copy `k8s/secret.yaml` is gitignored |
| `clusters/abyssdev/vm-prod/abyssdev-frontend-prod.yaml` | The app Flux Kustomization `abyssdev-frontend-sync-prod`. Holds the ConfigMap name and the one `APP_IMAGE_TAG:` line CI rewrites on `deployment` |
| `.github/workflows/ci.yml` → `frontend-ghcr-publish`, `frontend-ghcr-cleanup`, `frontend-bump-tag` | Build and push, opt-in cleanup, and the tag bump (see [CI](#ci)) |

## The image

- **Build-time values.** Only two things are needed at build time:
  - `GRAPHQL_URL` (required build arg). `next.config.mjs` turns its origin into
    `CMS_HEALTH_URL = <origin>/health` and inlines it into the **client** bundle, so the browser
    checks cms-api's health directly. It must be the public cms-api GraphQL URL, for example
    `https://api.<domain>/graphql`. The build fails if it's empty.
  - `AUTH_SECRET`, as a placeholder default in the Dockerfile. `src/auth.ts` throws at import time
    without it, and `next build` imports it. The real secret is set at runtime from the Secret, and
    CI passes no secret to the build.
- **No secrets in the image.** The runner stage has no `AUTH_SECRET`, and `.dockerignore` keeps every
  `.env*` file out of the build context.
- **Standalone output.** The runner copies `.next/standalone`, `.next/static` and `public`, and runs
  `node server.js` with `PORT=3000` and `HOSTNAME=0.0.0.0`. The image is about 330MB.
- **Vercel is unaffected.** Without `NEXT_OUTPUT=standalone`, `next build` produces the normal output.

## What Flux applies

Names follow the cms-api naming contract: `<app-name>-<app-service-name>-<app-env>` in
`<app-namespace>-<app-env>`. With `APP_SERVICE_NAME=frontend` that's `abyssdev-frontend-prod`.

- **Deployment:** 1 replica, container `app` on port **3000** (set in the image, so it's not a
  ConfigMap key), named `http`.
  - Runtime config comes from the Secret `<full-app-name>-secrets` via `envFrom`.
  - `AUTH_TRUST_HOST: "true"` is set literally in the Deployment. Auth.js v5 only trusts the request
    host when told to, and behind Traefik it has to.
  - `HOSTNAME: "0.0.0.0"` is set in the Deployment as well as the image. Next's standalone server
    binds to `$HOSTNAME`, and container runtimes also set `HOSTNAME` to the pod name, so pinning it in
    the pod spec keeps the bind address independent of the runtime.
- **Probes:**
  - Liveness is `tcpSocket` on `http`: it only checks the server accepts connections, so a slow
    cms-api never gets the frontend restarted.
  - Readiness is `httpGet /api/health` with `timeoutSeconds: 8`. That route always returns 200 (it
    reports cms-api's status in the body), so it checks the Next server answers requests. The route
    aborts its own cms-api call after 5s, so the probe timeout must stay above 5s: otherwise a
    hanging cms-api would make the pod NotReady and take the whole site out of rotation.
- **Resources:** requests `100m`/`192Mi`, limits `500m`/`512Mi`.
- **Service:** ClusterIP on port 3000 → the named port `http`.
- **Ingress:** Traefik, host and TLS host **`${APP_DOMAIN:=APP_DOMAIN-is-not-set}`** (the bare
  domain), certificate `<full-app-name>-tls` from the ClusterIssuer in `APP_TLS_CLUSTER_ISSUER`,
  backend by port name.
- **Middleware:** `<full-app-name>-https-redirect`, a permanent `redirectScheme: https`, referenced
  from the Ingress as `<namespace>-<name>@kubernetescrd`.

### Why the host is `${APP_DOMAIN:=APP_DOMAIN-is-not-set}`

cms-api and cms-admin prefix the domain (`api.`, `admin.`), so a missing domain renders an invalid
host and the apply fails. The frontend's host is the bare domain, and a plain `${APP_DOMAIN}` that
substitutes to nothing becomes YAML **null**. That drops the rule's `host` field, which turns the
rule into a **catch-all** for every hostname pointed at the VPS. Flux's envsubst has no `${var:?}`
form, so the host uses the default form instead: when `APP_DOMAIN` is unset or empty, the host
becomes `APP_DOMAIN-is-not-set`. The uppercase letters make it an invalid DNS name, so the API
server rejects the Ingress and the error names the problem. Keep the same form in `tls` and `rules`.

### Variables substituted into `apps/frontend/k8s/flux/`

| Variable | Source | Used for |
| --- | --- | --- |
| `APP_NAME`, `APP_SERVICE_NAME`, `APP_ENV` | ConfigMap | Every name |
| `APP_NAMESPACE` | ConfigMap | The namespace, `${APP_NAMESPACE}-${APP_ENV}` |
| `APP_IMAGE_REPO` | ConfigMap | The image |
| `APP_IMAGE_TAG` | `postBuild.substitute` in the cluster file, written by `frontend-bump-tag` on `deployment` (`<run>-<sha7>-amd64`) | The image |
| `APP_DOMAIN` | ConfigMap | Ingress host and TLS host |
| `APP_TLS_CLUSTER_ISSUER` | ConfigMap | The `cert-manager.io/cluster-issuer` annotation |

## Runtime Secret

`apps/frontend/k8s/secret.example.yaml` lists every key. The required ones:

| Key | What it is |
| --- | --- |
| `AUTH_SECRET` | Auth.js session secret (`openssl rand -base64 32`). The server throws without it |
| `CMS_API_URL` | cms-api URL for login, refresh and logout. The app calls `${CMS_API_URL}/auth/...`, and cms-api serves its routes under `/api/v1`, so use the same path form as the working Vercel value |
| `GRAPHQL_URL` | cms-api's GraphQL endpoint, `<cms-api-url>/graphql` (Nest's default path) |
| `REVALIDATE_SECRET` | Shared secret cms-api sends to `/api/revalidate` |
| `NEXT_ENV` | `"production"` (turns off dev-only request logging) |

`GRAPHQL_TOKEN` and `STRAPI_API_TOKEN` are optional. Don't set `PORT` or `AUTH_TRUST_HOST`.

For `CMS_API_URL` and `GRAPHQL_URL`, the server-side calls can use the in-cluster cms-api Service,
`http://<app-name>-cms-api-<app-env>.<app-namespace>-<app-env>.svc.cluster.local:<cms-api port>`,
which skips the round trip through Traefik. The public `https://api.<domain>` also works. The
browser-side health check uses the baked-in `CMS_HEALTH_URL`, not these keys.

## CI

All three jobs run only on `master` pushes that change the frontend (they depend on
`frontend-build`).

- **`frontend-ghcr-publish`**
  - Fails straight away if the repo variable `FRONTEND_IMAGE_REPO` or `FRONTEND_GRAPHQL_URL` is unset.
  - Builds `apps/frontend` on `ubuntu-latest` with `--build-arg GRAPHQL_URL=$FRONTEND_GRAPHQL_URL`
    and the OCI source label, and pushes **`<run_number>-<sha7>-amd64`**.
  - Exposes the arch-less `<run_number>-<sha7>` as `outputs.tag`.
- **`frontend-ghcr-cleanup`** runs only when `FRONTEND_GHCR_CLEANUP` is `true`, and keeps the newest
  **5** versions. It needs this repo to have the Admin role on the package.
- **`frontend-bump-tag`** runs `.github/scripts/bump-flux-tag.sh frontend "$TAG"
  clusters/abyssdev/vm-prod/abyssdev-frontend-prod.yaml:amd64`, with the same checkout layout, retry
  and run-number guard as cms-api's, and its own concurrency group `frontend-bump-tag`. The commit is
  `chore(frontend): deploy image <tag>`.

## Owner setup (one time)

Prerequisite: vm-prod is running Flux on the `deployment` branch, with cert-manager and a
ClusterIssuer (cms-api runbook steps 1–5 and 8.2).

1. **DNS: this is a cutover if `<domain>` points at Vercel today.** Point the `A` record (plus
   `AAAA` for IPv6) for the bare `<domain>` at the VPS when you're ready to switch, and give the
   Vercel (staging) project its own hostname first.
2. **Repo variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable | Value | Required |
   | --- | --- | --- |
   | `FRONTEND_IMAGE_REPO` | `ghcr.io/<owner>/project-abyssoftime-v2/frontend` (lowercase) | Yes |
   | `FRONTEND_GRAPHQL_URL` | `https://api.<domain>/graphql`, the **public** URL (the browser uses its origin) | Yes |
   | `FRONTEND_GHCR_CLEANUP` | `true` | No. Set it after the first deploy works |

3. **First image:** push a frontend change to `master`. Then, in the package settings (github.com →
   your profile → Packages → `frontend`):
   - **Visibility → Public.** The Deployment has no image pull secret.
   - **Manage Actions access → add this repo with the Admin role**, only if you'll use cleanup.
4. **ConfigMap and Secret on the VPS:**
   ```bash
   cp apps/frontend/k8s/configmap.example.yaml apps/frontend/k8s/configmap.yaml   # gitignored
   cp apps/frontend/k8s/secret.example.yaml apps/frontend/k8s/secret.yaml         # gitignored
   chmod 600 apps/frontend/k8s/secret.yaml
   # ConfigMap: name abyssdev-frontend-prod-config, APP_SERVICE_NAME "frontend", APP_ENV "prod",
   #   the same APP_NAME / APP_NAMESPACE / APP_DOMAIN / APP_TLS_CLUSTER_ISSUER as cms-api's
   # Secret: name <app-name>-frontend-prod-secrets; copy the values the Vercel project uses today
   kubectl apply --server-side -f apps/frontend/k8s/configmap.yaml -f apps/frontend/k8s/secret.yaml
   ```
   Use `--server-side`, or every Secret value is also stored in plain text in an annotation.
5. **CORS on cms-api:** add `https://<domain>` to `CORS_ORIGINS` in cms-api's `secret.yaml` (next to
   `https://admin.<domain>`), re-apply it, and restart cms-api. The browser calls cms-api's
   `/health` directly.
6. **Deploy:** merge `master` into `deployment`, then:
   ```bash
   flux reconcile kustomization abyssdev-frontend-sync-prod --with-source
   kubectl -n <app-namespace>-prod get deploy,ingress,certificate
   curl -I http://<domain>/                  # 301/308 to https
   curl https://<domain>/api/health          # {"healthy":true}
   ```
   Then sign in on `https://<domain>` to check `AUTH_SECRET`, `CMS_API_URL` and `AUTH_TRUST_HOST`.

## Day-2 operations

- **A new release:** push to `master`. Flux rolls the pod within a few minutes of the bump commit.
- **A Secret change:** edit `k8s/secret.yaml`, re-apply with `--server-side`, then
  `kubectl -n <app-namespace>-prod rollout restart deploy/<app-name>-frontend-prod`. Pods only read
  the Secret at start.
- **A new public GraphQL URL:** change `FRONTEND_GRAPHQL_URL` and rebuild. The health-check origin is
  in the client bundle.
- **Rollback:** push a commit to `deployment` that sets `APP_IMAGE_TAG` in
  `abyssdev-frontend-prod.yaml` to an older `<run>-<sha7>-amd64`. It holds until the next frontend
  build.
- **Manifest change:** edit on `master`, then merge `master` into `deployment`.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| CI: `Repository variable FRONTEND_GRAPHQL_URL is not set` | Variable missing | Owner setup step 2 |
| Kustomization: host `Invalid value: "APP_DOMAIN-is-not-set"` | `APP_DOMAIN` missing or empty in the ConfigMap | Owner setup step 4, then reconcile |
| Pod `CrashLoopBackOff`, log says `AUTH_SECRET must be set` | Secret missing, misnamed, or without `AUTH_SECRET` | Check the Secret name (`<full-app-name>-secrets`) and keys |
| Sign-in fails, or Auth.js reports an untrusted host | `AUTH_TRUST_HOST` removed from the Deployment | Restore it (the template sets `"true"`) |
| Sign-in returns 404 from cms-api | `CMS_API_URL` lacks the `/api/v1` path form | Use the same form as the working Vercel value |
| The "unhealthy" page shows although cms-api is up | `https://<domain>` not in cms-api's `CORS_ORIGINS`, or the image was built with a wrong `FRONTEND_GRAPHQL_URL` | Owner setup step 5; fix the variable and rebuild |
| Pod not Ready, readiness probe times out | The Next server itself is stuck (the probe allows 8s, longer than the route's 5s cms-api abort) | `kubectl logs`; check the pod's CPU and memory |
| `deploy-frontend` (Vercel) fails on a `staging` push with an environment protection error | The `Production` GitHub environment only allows `master` | Allow `staging` in that environment's deployment branches, or move the Vercel secrets to a `Staging` environment |

## Verified state

Checked offline on 2026-09-26:

- The image builds only with `GRAPHQL_URL` set, on the alpine Bun builder. The container serves
  `/api/health` (200) and `/en` (200), runs as uid 1000, has no `.env*` file under `/app`, and has no
  `AUTH_SECRET` in its config.
- A clean copy of the app (no `.env*`, `node_modules` or `.next`) builds without `NEXT_OUTPUT` (no
  `.next/standalone`, as on Vercel) and with it (`server.js`). lint and the 82 tests pass.
- `kubectl kustomize apps/frontend/k8s/flux` renders a Deployment, Service, Ingress and Middleware,
  and the structure, probes, resources, Secret reference and host all check out. Flux's own envsubst
  library (fluxcd/pkg/envsubst, non-strict and strict) turns a missing or empty `APP_DOMAIN` into the
  invalid host `APP_DOMAIN-is-not-set`, never a null or empty catch-all.
- The cluster file matches cms-api's, has exactly one `APP_IMAGE_TAG:` line, and the cluster renders
  all three apps. The CI jobs were asserted against the baseline, and the bump was dry-run, including
  a race with a cms-admin bump.
- Known local issue: `bun run build` in the owner's working copy fails with a Turbopack PostCSS error
  that also happens without these changes. Clean builds pass, so it's stale local `.next` or
  `node_modules` state.
- Not verified here (owner, live): the first GHCR push, the DNS cutover, the certificate, sign-in,
  and the `CMS_API_URL` path form.

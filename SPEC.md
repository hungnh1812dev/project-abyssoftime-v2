# Spec: cms-admin + frontend on Flux (VPS only), vm-dev retired

Status: **DRAFT**, awaiting owner approval
Date: 2026-09-26
Target areas: `.github/workflows/ci.yml`, `.github/scripts/` (new), `clusters/abyssdev/*`,
`apps/cms-admin/{Dockerfile,nginx.conf,k8s/}`, `apps/frontend/{Dockerfile,.dockerignore,next.config.mjs,k8s/}`,
Flux/deploy docs of all three apps

This spec sits at the monorepo root because it spans CI, the Flux cluster manifests and all three
apps. The CI tag-bump spec that was here has shipped, and its details now live in
`apps/cms-api/docs/documents/cms-api-flux-deployment*.md`.

---

## Objective

`master` deploys **all three apps to the VPS only (vm-prod)** through the same flow cms-api already
uses: build, then GHCR, then a bot commit on `deployment`, then Flux. `staging` deploys to the hosted
platforms: cms-api and cms-admin to Render, frontend to Vercel. The local arm64 VM cluster (vm-dev) is
retired, so every image is amd64 only.

```
push staging ─▶ CI ─▶ Render (cms-api, cms-admin) + Vercel (frontend)          [hosted "staging"]

push master  ─▶ CI build/test ─▶ <app>-ghcr-publish (amd64) ─▶ <app>-bump-tag
                                                                   │ commit APP_IMAGE_TAG
                                                                   ▼ in the app's vm-prod file
                                         `deployment` branch ─▶ Flux on vm-prod (VPS)
                                                                   ▼
                     Traefik + cert-manager:   <domain> → frontend
                                               admin.<domain> → cms-admin
                                               api.<domain> → cms-api (exists)
```

### User stories

- **As the owner**, a `master` push that changes cms-admin or frontend leads to a
  `github-actions[bot]` commit on `deployment` that sets that app's `APP_IMAGE_TAG` in its vm-prod
  file. The VPS runs the new image within about 5 minutes, and I run no `kubectl` or `flux`.
- **As a visitor**, `https://<domain>` serves the frontend and `https://admin.<domain>` serves
  cms-admin. Both have valid TLS and redirect http to https.
- **As an admin user**, cms-admin on `admin.<domain>` logs in and works against
  `https://api.<domain>`, including the silent refresh.
- **As the owner**, a `staging` push deploys cms-admin to Render and frontend to Vercel. A `master`
  push no longer touches Render or Vercel.
- **As the owner**, cms-api builds only amd64 and bumps only vm-prod. Nothing in the repo refers to
  vm-dev anymore.

### Non-goals

- Turning off the Render or Vercel projects. They remain the staging targets.
- A staging cluster, promotion gates or approvals.
- Runtime-configurable cms-admin (`config.js`). The API URL is baked in at build time.
- Changing cms-api's ingress, its Component pattern or its app code.
- Hardening the images, such as non-root nginx or read-only rootfs. That's a follow-up.
- Changing Secret or ConfigMap contents on the cluster. The owner does that from the templates.

---

## Capability map

The three modules are small and follow one pattern, so they share this single spec, with one section
each, instead of separate `SPEC-<id>.md` files.

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| `vps-only` | Retire vm-dev. cms-api goes amd64 only. Move the bump script into `.github/scripts/bump-flux-tag.sh`. Move the Render and Vercel jobs to `staging` | — |
| `cms-admin-flux` | cms-admin image, GHCR publish and bump, `k8s/flux` templates, vm-prod Kustomization, `admin.<domain>` ingress | `vps-only` |
| `frontend-flux` | frontend Dockerfile (standalone), GHCR publish and bump, `k8s/flux` templates, vm-prod Kustomization, `<domain>` ingress | `vps-only` |

Build order: `vps-only` first, then `cms-admin-flux` and `frontend-flux`, which are independent of
each other.

---

## Decisions

| Question | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Clusters | vm-prod only. Delete vm-dev for every app | Keep vm-dev for cms-api | Owner's choice. One cluster means one arch and one API URL, so there are no per-cluster images. |
| Staging | Render and Vercel jobs run on `staging` | Keep them on `master` as well | Owner's choice. `master` means the VPS. Hosted platforms become staging, as cms-api's Render job already is. |
| cms-admin API URL | Repo variable → Docker build arg `VITE_API_URL` | Runtime `config.js`, or a same-origin nginx proxy | Owner's choice. With one cluster it needs no app code change. The URL isn't secret. |
| cms-admin nginx proxies | Remove the `/api` and `/auth` proxy blocks (dead docker-compose leftovers). Add `/healthz` | Leave them | Owner's choice. They point at `http://api:8080`, which doesn't exist. The probes need a cheap endpoint. |
| frontend image | Next `output: "standalone"` on a `node:24-alpine` runner. Build stage on `oven/bun` | Full `next start` image, or a Bun runtime | The standalone image is about 5–10× smaller. Node is Next's supported server runtime. Bun stays the package manager. |
| Enabling standalone | Only when `NEXT_OUTPUT=standalone` is set, and only the Dockerfile sets it | Always on | Leaves the Vercel (staging) build exactly as it is today. |
| Build-time secrets | frontend gets only the placeholder `AUTH_SECRET`, as a builder-stage `ARG`. Real secrets go in a runtime Secret | Real secret as a build arg | Build args are visible in image history. `auth.ts` only needs a value to exist during `next build`, the same as the existing `frontend-build` job. |
| Arch suffix | Keep `<run>-<sha7>-amd64` for all apps | Drop the suffix | No tag format churn. The bump regex and the cms-api history already use it, and it's future-proof if arm64 returns. |
| Bump logic | One script `.github/scripts/bump-flux-tag.sh`, called by a bump job for each app | Copy the inline script 3×, or one combined job | No triplication. A combined job would have to `needs:` publish jobs that are skipped by change detection. |
| Bump concurrency | One group per app (`<app>-bump-tag`) | One shared group | A GitHub concurrency group holds only **one** pending job, and a new pending job cancels the older one. A shared group could silently drop a different app's bump. Cross-app races are already handled by the retry loop (different files, re-applied on a fresh tip). |
| Tag file per app | New files `abyssdev-cms-admin-prod.yaml` and `abyssdev-frontend-prod.yaml`. cms-api keeps `abyssdev-apps-prod.yaml` | One multi-doc file | The bump `sed` rewrites **every** `APP_IMAGE_TAG:` line in a file. Renaming cms-api's file is churn with no gain. |
| Ingress for new apps | Directly in each app's base `k8s/flux` | Opt-in Component, as cms-api has | The Component existed so vm-dev could stay ClusterIP. With only vm-prod left it's extra indirection. cms-api is left as it is (non-goal). |
| Container ports | Image facts, hardcoded: cms-admin 80 (nginx), frontend 3000 (`PORT` in the Dockerfile) | `${APP_PORT}` from the ConfigMap | These aren't project values, and it means fewer ConfigMap keys to get wrong. |

During the docs step, these tables go into `apps/cms-admin/docs/documents/cms-admin-flux-deployment-techstack.md`
and `apps/frontend/docs/documents/frontend-flux-deployment-techstack.md`, as `docs/workflow.md`
requires. cms-api's techstack gets the `vps-only` rows.

---

## Target state

### Module `vps-only`

- **Delete `clusters/abyssdev/vm-dev/`** (all 5 files). Deleting needs the owner's OK.
- **`cms-api-ghcr-publish`**: remove the matrix and run on `ubuntu-latest` with `ARCH=amd64`. Tags
  stay `<tag>-amd64` and `<tag>-amd64-init`, and `outputs.tag` is unchanged.
- **`cms-api-ghcr-cleanup`**: `min-versions-to-keep: 20` → **10** (2 per release × 5 releases).
- **`.github/scripts/bump-flux-tag.sh`** (new) holds the current inline bump logic, generalised:
  - Usage: `bump-flux-tag.sh <app> <tag> <cluster-file>:<arch> [...]`.
  - Commit message: `chore(<app>): deploy image <tag>`.
  - Behaviour otherwise stays byte-for-byte what it is today: tag regex, run-number guard, portable
    `sed` via a temp file, `grep` read-back, 3 attempts on a fresh `origin/deployment`, and a loud
    failure when a file is missing.
- **Every `<app>-bump-tag` job** checks out the script from the commit being built (`github.sha`,
  sparse `.github/scripts`) and `deployment` into `./deployment`, then runs
  `../.github/scripts/bump-flux-tag.sh` there. This way a bump never depends on master having been
  merged into `deployment`.
- **`cms-api-bump-tag`**: calls the script with only
  `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml:amd64`. Concurrency group `cms-api-bump-tag`
  (unchanged).
- **`deploy-cms-admin`, `deploy-frontend`**: guard `refs/heads/master` → `refs/heads/staging`.
  Nothing else changes.

### Module `cms-admin-flux`

- **`apps/cms-admin/Dockerfile`**: builder stage gains `ARG VITE_API_URL`, which is required: the
  build fails if it's empty. It's passed to `bun run build`. Runner unchanged.
- **`apps/cms-admin/nginx.conf`**: keep the SPA fallback and add `location = /healthz { return 200; }`.
  Remove the proxy blocks.
- **`apps/cms-admin/k8s/flux/`** (new): `kustomization.yaml`, `deployment.yaml`, `service.yaml`,
  `ingress.yaml`, `middleware.yaml`.
  - `${APP_*}` placeholders only. Naming follows cms-api:
    `${APP_NAME}-${APP_SERVICE_NAME}-${APP_ENV}` in `${APP_NAMESPACE}-${APP_ENV}`.
  - Deployment: 1 replica, `containerPort: 80` named `http`, liveness and readiness `httpGet /healthz`,
    requests 10m/32Mi and limits 200m/128Mi. No Secret.
  - Ingress: host `admin.${APP_DOMAIN}`, TLS secret `<full-app-name>-tls`, issuer
    `${APP_TLS_CLUSTER_ISSUER}`, https-redirect Middleware. An empty `APP_DOMAIN` gives the host
    `admin.`, which the API server rejects, so it fails closed.
- **`apps/cms-admin/k8s/configmap.example.yaml`** (new) with keys `APP_NAME`, `APP_SERVICE_NAME`,
  `APP_NAMESPACE`, `APP_ENV`, `APP_IMAGE_REPO`, `APP_DOMAIN` and `APP_TLS_CLUSTER_ISSUER`. Add the
  filled `k8s/configmap.yaml` to `apps/cms-admin/.gitignore`.
- **`clusters/abyssdev/vm-prod/abyssdev-cms-admin-prod.yaml`** (new): Kustomization
  `abyssdev-cms-admin-sync-prod`.
  - `path: ./apps/cms-admin/k8s/flux`, ConfigMap `abyssdev-cms-admin-prod-config`, and
    `APP_IMAGE_TAG: "dev"`.
  - `interval: 3m`, `prune`, `wait` and `timeout: 5m`, the same layout as cms-api's.
  - Listed in `clusters/abyssdev/vm-prod/kustomization.yaml`.
- **CI** (`master` + `push`, needs `cms-admin-build`):
  - **`cms-admin-ghcr-publish`**: amd64, fails without `vars.CMS_ADMIN_IMAGE_REPO` and
    `vars.CMS_ADMIN_API_URL`, and pushes `<tag>-amd64`. Outputs `tag`.
  - **`cms-admin-ghcr-cleanup`**: opt-in via `vars.CMS_ADMIN_GHCR_CLEANUP`, keeps 5.
  - **`cms-admin-bump-tag`**: script with `abyssdev-cms-admin-prod.yaml:amd64`, group
    `cms-admin-bump-tag`, `contents: write`.

### Module `frontend-flux`

- **`apps/frontend/next.config.mjs`**: `output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined`.
- **`apps/frontend/Dockerfile`** (new):
  - `deps`/`builder` on `oven/bun:1-alpine`.
  - Build args: `GRAPHQL_URL`, required, because `next.config` bakes it into `CMS_HEALTH_URL`, and the
    placeholder `AUTH_SECRET`.
  - `runner` on `node:24-alpine`, which copies `.next/standalone`, `.next/static` and `public`, sets
    `PORT=3000` and `HOSTNAME=0.0.0.0`, runs as the non-root `node` user, and starts with
    `CMD ["node","server.js"]`.
- **`apps/frontend/.dockerignore`** (new) must exclude `.env*` (a real `.env.local` is in that dir),
  `.next`, `.vercel`, `node_modules`, `e2e`, `*.md` and `.git`.
- **`apps/frontend/k8s/flux/`** (new): the same 5 files as cms-admin.
  - Deployment: `containerPort: 3000`, `envFrom` Secret `<full-app-name>-secrets`, literal
    `env AUTH_TRUST_HOST: "true"` (Auth.js v5 behind Traefik), liveness `tcpSocket`, readiness
    `httpGet /api/health` with `timeoutSeconds: 5`. That endpoint always returns 200 and reports
    cms-api health in the body. Requests 100m/192Mi, limits 500m/512Mi.
  - Ingress: host `${APP_DOMAIN}` (bare).
- **`apps/frontend/k8s/{configmap,secret}.example.yaml`** (new).
  - ConfigMap keys: as cms-admin.
  - Secret keys: `AUTH_SECRET`, `CMS_API_URL`, `GRAPHQL_URL`, `GRAPHQL_TOKEN`, `STRAPI_API_TOKEN`,
    `REVALIDATE_SECRET` and `NEXT_ENV=production`.
  - For `CMS_API_URL` and `GRAPHQL_URL`, the comments recommend the in-cluster cms-api Service URL.
  - Add the filled files to `apps/frontend/.gitignore`.
- **`clusters/abyssdev/vm-prod/abyssdev-frontend-prod.yaml`** (new): Kustomization
  `abyssdev-frontend-sync-prod` with ConfigMap `abyssdev-frontend-prod-config`, listed in the cluster
  `kustomization.yaml`.
- **CI**: `frontend-ghcr-publish` (vars `FRONTEND_IMAGE_REPO` and `FRONTEND_GRAPHQL_URL`),
  `frontend-ghcr-cleanup` (opt-in `FRONTEND_GHCR_CLEANUP`, keeps 5) and `frontend-bump-tag` (group
  `frontend-bump-tag`), mirroring cms-admin.

### Owner-run steps (agent never runs these)

1. **DNS**: A records for `<domain>` and `admin.<domain>` pointing at the VPS. If `<domain>` is
   currently Vercel production, this is the cutover, and Vercel staging needs its own hostname.
2. **Repo variables**: `CMS_ADMIN_IMAGE_REPO`, `CMS_ADMIN_API_URL` (`https://api.<domain>`),
   `FRONTEND_IMAGE_REPO` and `FRONTEND_GRAPHQL_URL`. Optionally, the two `*_GHCR_CLEANUP` variables.
3. **GHCR**: after the first publish, make the `cms-admin` and `frontend` packages public, the same as
   cms-api, or the VPS can't pull them (the templates have no `imagePullSecrets`). For cleanup, give
   the repo the Admin role under "Manage Actions access".
4. **On the VPS**, from the templates: the `abyssdev-cms-admin-prod-config` and
   `abyssdev-frontend-prod-config` ConfigMaps, and the frontend Secret.
5. **cms-api Secret**: add `https://<domain>` and `https://admin.<domain>` to its CORS origins.
6. Merge into `master`, then merge `master` into `deployment`. Resolve conflicts so that
   `deployment` keeps its real cms-api tag, and delete vm-dev's files there too.
7. **VM**: `flux uninstall` on the old vm-dev cluster, or just shut it down.

---

## Commands

```bash
# Offline renders (no cluster contact)
kubectl kustomize apps/cms-admin/k8s/flux
kubectl kustomize apps/frontend/k8s/flux
kubectl kustomize clusters/abyssdev/vm-prod

# Substitution check with fake values (mirrors Flux postBuild)
kubectl kustomize apps/frontend/k8s/flux \
  | APP_NAME=a APP_SERVICE_NAME=frontend APP_NAMESPACE=n APP_ENV=prod APP_IMAGE_REPO=ghcr.io/x/y \
    APP_IMAGE_TAG=90-a1b2c3d-amd64 APP_DOMAIN=example.com APP_TLS_CLUSTER_ISSUER=le \
    envsubst '${APP_NAME} ${APP_SERVICE_NAME} ${APP_NAMESPACE} ${APP_ENV} ${APP_IMAGE_REPO} ${APP_IMAGE_TAG} ${APP_DOMAIN} ${APP_TLS_CLUSTER_ISSUER}'

# Local image builds + smoke runs (local Docker only)
docker build --build-arg VITE_API_URL=https://api.example.com -t cms-admin:local apps/cms-admin
docker run --rm -p 8081:80 cms-admin:local   # curl -f localhost:8081/healthz && curl -f localhost:8081/some/route
docker build --build-arg GRAPHQL_URL=http://localhost:5000/graphql -t frontend:local apps/frontend
docker run --rm -p 3001:3000 -e AUTH_SECRET=x -e AUTH_TRUST_HOST=true frontend:local   # curl -f localhost:3001/api/health

# App checks for touched apps
(cd apps/cms-admin && bun run lint && bun run test && bun run build)
(cd apps/frontend && bun run lint && bun run test && bun run build)   # Vercel-style build, no NEXT_OUTPUT

# Bump script
bash -n .github/scripts/bump-flux-tag.sh && shellcheck .github/scripts/bump-flux-tag.sh
```

## Project Structure

```
.github/workflows/ci.yml                 → per-app ghcr-publish / ghcr-cleanup / bump-tag jobs; Render+Vercel on staging
.github/scripts/bump-flux-tag.sh         → shared bump logic (new)
clusters/abyssdev/vm-prod/               → the only cluster: flux-system/ + one app Kustomization file per app
clusters/abyssdev/vm-dev/                → deleted
apps/<app>/k8s/flux/                     → Flux templates, ${APP_*} placeholders only
apps/<app>/k8s/*.example.yaml            → ConfigMap/Secret templates; filled copies gitignored
apps/<app>/docs/documents/<app>-flux-deployment{,-techstack}.md → docs (docs step)
```

## Code Style

Match the existing cms-api manifests and CI. Every file opens with a header comment that says what it
does and why, only `${APP_*}` placeholders appear in the templates, and bash uses `set -euo pipefail`
with `::error::` on each failure path:

```yaml
# cms-admin on vm-prod (VPS): applies ../../../apps/cms-admin/k8s/flux with ${APP_*} from the prod
# ConfigMap. APP_IMAGE_TAG is written by CI (cms-admin-bump-tag) on the `deployment` branch; on master
# it stays a placeholder. Exactly one `APP_IMAGE_TAG:` line: CI rewrites it with sed.
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: abyssdev-cms-admin-sync-prod
  namespace: flux-system
spec:
  interval: 3m
  ...
    substitute:
      APP_IMAGE_TAG: "dev"
```

Portable `sed` (temp file + `mv`, never `sed -i`), no third-party actions beyond those already used in
`ci.yml`, and Prettier on changed `.ts`/`.mjs` files.

## Testing Strategy

There's no test framework for YAML or CI, so verification is offline and scripted, with the scripts
in the session scratchpad:

- **Renders**: all three `kubectl kustomize` commands above succeed. The envsubst output parses, and
  no `${` is left in it.
- **PyYAML assert script**:
  - `clusters/abyssdev/vm-dev` is gone, and no file in the repo mentions `vm-dev` except history
    notes in docs.
  - Each vm-prod app file has exactly one `APP_IMAGE_TAG:` line, the right ConfigMap name, and
    `interval: 3m`, `prune`, `wait` and `timeout: 5m`.
  - The cluster `kustomization.yaml` lists all 3 app files.
  - Ingress hosts are `admin.${APP_DOMAIN}` and `${APP_DOMAIN}`.
  - Templates contain no literal project values such as `abyssdev` or a domain.
- **`ci.yml` diff check** (PyYAML, against the baseline):
  - Only the jobs this spec names change.
  - Each new job has the right `needs`, `master` + `push` guard, permissions, concurrency group and
    required-variable checks.
  - The Render and Vercel jobs are guarded on `staging`.
- **Bump dry-run**: the same harness as the last spec, with a throwaway bare origin and BSD sed.
  It runs the script for cms-api, cms-admin and frontend and checks:
  - Each run touches only its own file with a +1/-1 diff and writes the right commit message.
  - An older tag and a re-run are no-ops.
  - Two apps racing both land.
  - A bad tag and a missing file fail loudly.
- **Images**: both build locally. cms-admin serves `/healthz` 200, an SPA deep link returns
  `index.html`, and the built JS contains the `VITE_API_URL` value. frontend serves `/api/health`
  200, runs as uid 1000, and the image has no `.env*` file (`docker run --rm frontend:local ls -a`).
- **Regression**: `bun run lint`, `bun run test` and `bun run build` pass for cms-admin and frontend.
  The frontend build **without** `NEXT_OUTPUT` produces no `.next/standalone`, so Vercel is
  unchanged.
- **Manual (owner)**:
  - A `master` push produces one bot commit per changed app, and the pods run the new tag.
  - `https://<domain>` and `https://admin.<domain>` load with valid certs, and admin login and
    refresh work.
  - A `staging` push deploys to Render and Vercel.

## Boundaries

- **Always:** placeholders only in `apps/*/k8s/flux/**`; verify offline; give the owner exact
  commands for anything that touches the cluster, DNS or GitHub settings; update the docs and rules
  of every app touched (cms-api's docs lose vm-dev and arm64).
- **Ask first:**
  - Deleting `clusters/abyssdev/vm-dev/` or any other file.
  - Editing the generated `gotk-sync.yaml` (not expected).
  - Committing: a Yes/No question with the file list and message, and no `Co-Authored-By`.
  - Pushing to or merging into `master` or `deployment`.
  - Adding a new third-party action.
- **Never:**
  - Run `kubectl`, `helm` or `flux` against a real cluster, including `--dry-run=client`.
  - Read or touch any `.env*` other than `.env.example`, or any filled `k8s/secret.yaml` or
    `k8s/configmap.yaml`.
  - Put a real secret in a build arg or an image.
  - Give CI any cluster credentials.
  - Edit `gotk-components.yaml`.

## Success Criteria

1. A `master` push that changes cms-admin or frontend produces one `github-actions[bot]` commit on
   `deployment` that sets `APP_IMAGE_TAG: "<run>-<sha7>-amd64"` in only that app's vm-prod file.
2. `kubectl kustomize clusters/abyssdev/vm-prod` renders all three app Kustomizations. After
   envsubst, the app templates render a Deployment, Service, Ingress and Middleware for each new
   app, with hosts `<domain>` and `admin.<domain>`.
3. cms-api publishes amd64 only (2 images per release), cleanup keeps 10, and the bump writes only
   vm-prod. `clusters/abyssdev/vm-dev/` no longer exists.
4. `deploy-cms-admin` and `deploy-frontend` run only on `staging` pushes.
5. The frontend image contains no `.env*` files and no real secrets, runs as non-root and serves
   `/api/health`. The Vercel-style build is unchanged.
6. The cms-admin image serves `/healthz` and SPA deep links, and it has no nginx proxy to `api:8080`.
7. All three bump jobs share one script and have their own concurrency groups. The dry-run harness
   passes every case above.
8. The docs describe the VPS-only, `staging`-hosted flow for all three apps.
9. Owner-verified: both sites are live on the VPS with valid TLS, and admin login and refresh work
   against `api.<domain>`.

## Open Questions

1. **The bare `<domain>` today**: is it Vercel production? If so, step 1 above is a production
   cutover, so pick a time and a hostname for Vercel staging.
2. **Stray `apps/abyssdev-cms-api-prod/`**: a copy of the old cms-api templates, including the
   deleted image-automation files, committed on 2026-09-24 and not referenced by any cluster. Delete
   it in this work, with your OK, or leave it?
3. **frontend `CMS_API_URL`/`GRAPHQL_URL`**: use the in-cluster cms-api Service (recommended: no
   hairpin through Traefik) or `https://api.<domain>`? It only affects the Secret template comment.

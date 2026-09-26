# Todo: cms-admin + frontend on Flux (VPS only), vm-dev retired

Spec: [`SPEC.md`](../SPEC.md) · Plan: [`tasks/plan.md`](plan.md)
Status: **DONE**. 15 of 15 tasks done. The live checks (spec criterion 9) are left to the owner.

Each checkbox update ships in the same commit as that phase's work. All verification is offline:
never run `kubectl apply`, `flux` or `helm` against a cluster, and never read `.env*` (except
`.env.example`) or a filled `k8s/secret.yaml` / `k8s/configmap.yaml`.

## Phase 1: `vps-only`

- [x] **T1: Move the bump logic into `.github/scripts/bump-flux-tag.sh`, keeping behaviour identical.** (S)
  - Files:
    - `.github/scripts/bump-flux-tag.sh` (new, executable)
    - `.github/workflows/ci.yml` (only the `cms-api-bump-tag` step)
  - Acceptance:
    - The script is called as `bump-flux-tag.sh <app> <tag> <cluster-file>:<arch> [...]`.
    - The commit message becomes `chore(<app>): deploy image <tag>`.
    - All other logic is moved as is: tag regex, run-number guard, temp-file `sed`, `grep`
      read-back, 3 attempts, and the missing-file error.
    - `cms-api-bump-tag` still passes **both** targets (vm-dev arm64, vm-prod amd64). No other job
      changes.
  - Verify:
    - `bash -n` passes on the script.
    - Parity dry-run: run the old inline block and the new script against identical bare-origin
      fixtures. The resulting `deployment` trees and commit messages must match, including the
      older-tag no-op, re-run no-op, push race, bad tag and missing file cases.
    - The `ci.yml` assert finds that only that step differs from the baseline.
  - Change during T1: the job now checks out the bump script from `github.sha` (sparse
    `.github/scripts`) and `deployment` into `./deployment`. Checking out `deployment` alone would
    fail until master is merged into it, because the script wouldn't be there yet.
  - Done: parity 8/8, both calling the script directly and running the exact `ci.yml` `run:` block
    in the CI layout. The `ci.yml` assert passes, and `bash -n` passes.
  - Deps: none

- [x] **T2: Retire vm-dev: cms-api builds amd64 only and bumps vm-prod only.** (M)
  - Files:
    - `clusters/abyssdev/vm-dev/**`: **delete** the 5 files (**ask first**)
    - `.github/workflows/ci.yml`: `cms-api-ghcr-publish`, `cms-api-ghcr-cleanup`, `cms-api-bump-tag`
      and their comments
    - `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml` (header comment: drop the vm-dev sync note)
  - Acceptance:
    - `cms-api-ghcr-publish` has no matrix. It runs on `ubuntu-latest` with `ARCH: amd64`, pushes
      `<tag>-amd64-init` and then `<tag>-amd64`, and keeps `outputs.tag`.
    - `cms-api-ghcr-cleanup` has `min-versions-to-keep: 10`.
    - `cms-api-bump-tag` passes only `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml:amd64`.
    - No `vm-dev` or `arm64` string is left in `ci.yml` or `clusters/`.
  - Verify:
    - `kubectl kustomize clusters/abyssdev/vm-prod` renders.
    - The assert script: `clusters/abyssdev/vm-dev` is absent, and `grep -rn 'vm-dev\|arm64'` over
      `ci.yml` and `clusters/` finds nothing.
    - Bump dry-run: one file changes (+1/-1) to `<tag>-amd64`, and the run-number guard still
      replaces an old `-arm64`/arch-less tag.
  - Done:
    - The owner approved deleting vm-dev.
    - The T2 assert passes 12/12.
    - The bump dry-run passes 5/5, using the exact `ci.yml` step with a stale vm-dev file still on
      `deployment`: +1/-1 on vm-prod only, arch-less, `-arm64` and placeholder tags are replaced, an
      older run is a no-op, and master is untouched.
  - Deps: T1

- [x] **T3: Move the Render (cms-admin) and Vercel (frontend) deploys to `staging`.** (XS)
  - Files: `.github/workflows/ci.yml` (`deploy-cms-admin`, `deploy-frontend`)
  - Acceptance:
    - Both guards read `github.ref == 'refs/heads/staging' && github.event_name == 'push'`.
    - Nothing else in those jobs changes.
    - The comment above the GHCR block now says "staging → Render/Vercel, master → VPS".
  - Verify: the `ci.yml` assert finds that only those two `if:` lines and the comment differ.
  - Done: the T3 assert passes 4/4. The jobs that differ from the baseline are exactly the 3
    cms-api deploy jobs plus the 2 hosted deploy jobs.
  - Deps: T2 (same file, keeps diffs sequential)

### Checkpoint 1
- [x] `kubectl kustomize clusters/abyssdev/vm-prod` renders. The parity and bump dry-runs and the
  `ci.yml` asserts pass: parity 8/8, bump 5/5, T3 4/4. T2's job-set check is superseded by T3's.
- [x] Commit: the owner confirmed. Commits `e76092e` (spec and plan) and `98f29e5` (Phase 1).

## Phase 2: `cms-admin-flux`

- [x] **T4: The cms-admin image bakes in `VITE_API_URL` and serves `/healthz`.** (S)
  - Files: `apps/cms-admin/Dockerfile`, `apps/cms-admin/nginx.conf`
  - Acceptance:
    - The builder has `ARG VITE_API_URL`, and the build fails with a clear message if it's empty.
      The value is exposed to `bun run build`.
    - `nginx.conf` has no `/api/` or `/auth/` proxy blocks, has `location = /healthz` returning
      200, and keeps the SPA fallback.
  - Verify:
    - `cd apps/cms-admin && bun run lint && bun run test && bun run build` passes.
    - `docker build --build-arg VITE_API_URL=https://api.example.com` succeeds, and a build without
      the arg fails.
    - In the smoke run, `/healthz` returns 200, `/content/foo` returns `index.html`, and
      `grep -r api.example.com` finds the value in the built JS.
  - Done:
    - Checks pass 14/14: 8 static and 6 Docker, run on the local arm64 daemon.
    - A build without the arg fails at the `test -n` step with the intended message.
    - lint is clean, 471 tests pass, and the build succeeds.
    - Also added `.env*` to `apps/cms-admin/.dockerignore`, because Vite would bake any `.env`
      values into the bundle.
    - `VITE_API_URL` must be the bare origin (`https://api.<domain>`): the app appends `/api/v1`
      and `/health`.
  - Deps: T2

- [x] **T5: Add the cms-admin `k8s/flux` templates (Deployment, Service, Ingress, Middleware).** (M)
  - Files:
    - `apps/cms-admin/k8s/flux/{kustomization,deployment,service,ingress,middleware}.yaml` (new)
  - Acceptance:
    - Only `${APP_*}` placeholders are used, named like cms-api. Each file has a header comment.
    - Deployment: `containerPort: 80` named `http`, probes on `httpGet /healthz`, requests
      10m/32Mi and limits 200m/128Mi, no Secret.
    - Ingress: host and TLS `admin.${APP_DOMAIN}`, issuer annotation, https-redirect Middleware
      reference, backend on port name `http`.
  - Verify:
    - `kubectl kustomize apps/cms-admin/k8s/flux` renders.
    - The envsubst output with fake values parses and contains no `${`.
    - The assert script: no literal `abyssdev` or domain appears, the host is
      `admin.${APP_DOMAIN}`, and the Middleware name matches the annotation.
  - Done:
    - The reusable assert `assert_templates.py <app>` passes 42/42: render, envsubst, kinds,
      names and labels, the image, int ports, the named-port Service, TLS and host, issuer,
      Middleware reference, probes, resources and no Secret.
    - The Service targets the named port `http` instead of a number.
  - Deps: T4

- [x] **T6: Wire cms-admin into vm-prod and add the ConfigMap template.** (S)
  - Files:
    - `clusters/abyssdev/vm-prod/abyssdev-cms-admin-prod.yaml` (new)
    - `clusters/abyssdev/vm-prod/kustomization.yaml`
    - `apps/cms-admin/k8s/configmap.example.yaml` (new)
    - `apps/cms-admin/.gitignore` (add `k8s/configmap.yaml`)
  - Acceptance:
    - The Kustomization `abyssdev-cms-admin-sync-prod` has `path ./apps/cms-admin/k8s/flux`,
      ConfigMap `abyssdev-cms-admin-prod-config`, exactly one `APP_IMAGE_TAG: "dev"` line, and the
      same interval, prune, wait and timeout as cms-api.
    - The cluster `kustomization.yaml` lists it.
    - The ConfigMap template holds the 7 keys from the spec, and its comments point at the file
      above.
  - Verify:
    - `kubectl kustomize clusters/abyssdev/vm-prod` renders.
    - The assert script compares against cms-api's file: the fields match, except name, path,
      ConfigMap, components and tag.
    - `git check-ignore apps/cms-admin/k8s/configmap.yaml` matches.
  - Done: the reusable `assert_cluster.py <app>` passes 18/18. The T5 templates still pass 42/42,
    and the cms-api bump still passes 5/5.
  - Deps: T5

- [x] **T7: Add the cms-admin CI jobs: GHCR publish, cleanup and bump.** (S)
  - Files: `.github/workflows/ci.yml`
  - Acceptance:
    - **`cms-admin-ghcr-publish`**:
      - Needs `cms-admin-build` and runs on `master` + `push` in the `Production` env, with
        `contents: read, packages: write`.
      - Fails without `vars.CMS_ADMIN_IMAGE_REPO` or `vars.CMS_ADMIN_API_URL`.
      - Builds with the `VITE_API_URL` build arg and the OCI source label, pushes `<tag>-amd64`,
        and outputs `tag`.
    - **`cms-admin-ghcr-cleanup`**: opt-in via `CMS_ADMIN_GHCR_CLEANUP == 'true'`, keeps 5.
    - **`cms-admin-bump-tag`**:
      - Checks out `deployment` and runs the script as
        `cms-admin <tag> clusters/abyssdev/vm-prod/abyssdev-cms-admin-prod.yaml:amd64`.
      - Uses group `cms-admin-bump-tag` with `cancel-in-progress: false` and `contents: write` only.
  - Verify:
    - The `ci.yml` assert: only the new jobs are added, and needs, guard, permissions, concurrency
      and variable checks are correct.
    - Bump dry-run for cms-admin: only its file changes, and the message is
      `chore(cms-admin): deploy image <tag>`.
  - Done:
    - The reusable `assert_ci_app.py <app>` passes 26/26 against the Phase 1 `ci.yml` baseline.
    - The reusable `bump_apps.sh cms-admin cms-api` passes 7/7: own file +1/-1, message and
      author, master untouched, re-run and older run no-ops, missing file fails, and a race with a
      cms-api bump lands both.
    - `cms-admin-ghcr-publish` pushes straight from `build-push-action`. With a single image there's
      no init-first ordering to keep.
  - Deps: T1, T6

### Checkpoint 2
- [x] The cms-admin image smoke run, the renders, the asserts and the bump dry-run all pass. The
  cms-admin lint, test and build pass. Results: parity 8/8, T3 4/4, image 14/14, templates 42/42,
  cluster 18/18, CI 26/26, bump cms-admin 7/7 and cms-api 6/6. lint is clean and 471 tests pass.
- [x] Commit: the owner confirmed. Commit `feat(cms-admin): deploy to the VPS with Flux at
  admin.<APP_DOMAIN>`.

## Phase 3: `frontend-flux`

- [x] **T8: The frontend standalone image (Dockerfile, .dockerignore, opt-in standalone).** (M, highest risk)
  - Files:
    - `apps/frontend/Dockerfile` (new)
    - `apps/frontend/.dockerignore` (new)
    - `apps/frontend/next.config.mjs`
  - Acceptance:
    - `next.config.mjs` sets `output: "standalone"` only when `NEXT_OUTPUT === "standalone"`.
    - The Dockerfile has `oven/bun` deps and builder stages.
      - Required `ARG GRAPHQL_URL` (the build fails if it's empty) and a placeholder
        `ARG AUTH_SECRET`, used in the builder only.
      - The `node:24-alpine` runner copies `standalone`, `.next/static` and `public`, sets
        `PORT=3000` and `HOSTNAME=0.0.0.0`, and runs as `USER node` with `CMD ["node","server.js"]`.
    - `.dockerignore` excludes `.env*`, `.next`, `.vercel`, `node_modules`, `e2e`, `*.md` and
      `.git`.
  - Verify:
    - `cd apps/frontend && bun run lint && bun run test && bun run build` passes, and
      `.next/standalone` is **absent** after that plain build.
    - `docker build --build-arg GRAPHQL_URL=http://localhost:5000/graphql` succeeds, and a build
      without the arg fails.
    - Smoke run with `-e AUTH_SECRET=x -e AUTH_TRUST_HOST=true`:
      - `/api/health` returns 200 and a locale page responds.
      - `id -u` returns 1000.
      - Listing `/app` (`ls -a`) shows no `.env*` file.
      - `docker history` has no real secret.
    - Fallback if the alpine builder fails: use the `oven/bun:1` Debian builder and record it in
      the spec's Decisions.
  - Done:
    - The static checks pass 17/17 (an earlier note miscounted them as 18).
    - The Docker checks pass 9/9 on the alpine Bun builder, with no fallback needed.
      - A build without the arg fails at the `test -n` step with the intended message.
      - `/api/health` returns 200 and `/en` returns 200.
      - The container runs as uid 1000, and there's no `.env*` under `/app`.
      - `AUTH_SECRET` isn't in the image env, and the image is 332MB.
    - A clean scratch copy (no `.env*`, `node_modules` or `.next`; `bun install --frozen-lockfile`):
      - The plain build passes and creates no `.next/standalone`.
      - The `NEXT_OUTPUT=standalone` build creates `server.js`.
    - lint is clean, 82 tests pass, and Prettier is clean.
    - **Local `bun run build` in the owner's working copy fails before this change as well**
      (Turbopack PostCSS `__turbopack_context__.a is not a function`, with the original
      `next.config.mjs`). That's stale local `.next`/`node_modules` state: clean builds pass. Not
      fixed here, and left to the owner.
  - Deps: T2

- [x] **T9: Add the frontend `k8s/flux` templates.** (M)
  - Files:
    - `apps/frontend/k8s/flux/{kustomization,deployment,service,ingress,middleware}.yaml` (new)
  - Acceptance:
    - Same conventions as T5.
    - Deployment: `containerPort: 3000` named `http`, `envFrom` Secret `<full-app-name>-secrets`,
      literal `AUTH_TRUST_HOST: "true"`, liveness `tcpSocket`, readiness `httpGet /api/health`
      with `timeoutSeconds: 5`, requests 100m/192Mi and limits 500m/512Mi.
    - Ingress: host and TLS `${APP_DOMAIN}` (bare).
    - **Fail closed on an empty `APP_DOMAIN`** (found during T5): unlike `admin.`/`api.`, a bare
      `${APP_DOMAIN}` becomes host `""`, which Kubernetes accepts as a **catch-all** rule. Guard it
      with Flux's `${APP_DOMAIN:?...}` form, or an equivalent, so the apply fails instead.
  - Verify:
    - `kubectl kustomize apps/frontend/k8s/flux` renders.
    - The envsubst check passes.
    - The assert script: host is `${APP_DOMAIN}`, the Secret name is correct, and no literal
      project values appear.
  - Done:
    - `assert_templates.py` now uses Flux-like substitution (`${VAR}`, `:=`, `:-`) and checks for
      null or empty hosts. frontend passes 46/46 and cms-admin 44/44.
    - Guard change: the spec's `${APP_DOMAIN:?...}` is **not supported** by Flux (fluxcd/pkg/envsubst
      README). An empty plain `${APP_DOMAIN}` gives a YAML-null host, which drops the rule host and
      leaves a catch-all. The host now uses `${APP_DOMAIN:=APP_DOMAIN-is-not-set}`: an unset or empty
      value gives an invalid DNS name, and the API server rejects it. `IsDNS1123Subdomain` was read in
      the kubernetes/apimachinery source.
    - Verified with the real fluxcd/pkg/envsubst (scratchpad `flux_domain_guard.sh`), for
      non-strict and strict modes and for a missing, empty or set domain. cms-admin's `admin.` form
      is already rejected when empty.
  - Deps: T8

- [x] **T10: Wire frontend into vm-prod and add the ConfigMap and Secret templates.** (M)
  - Files:
    - `clusters/abyssdev/vm-prod/abyssdev-frontend-prod.yaml` (new)
    - `clusters/abyssdev/vm-prod/kustomization.yaml`
    - `apps/frontend/k8s/configmap.example.yaml` (new)
    - `apps/frontend/k8s/secret.example.yaml` (new)
    - `apps/frontend/.gitignore` (add `k8s/configmap.yaml` and `k8s/secret.yaml`)
  - Acceptance:
    - The Kustomization `abyssdev-frontend-sync-prod` mirrors T6 with ConfigMap
      `abyssdev-frontend-prod-config`, and the cluster `kustomization.yaml` lists all 3 app files.
    - The Secret template has placeholder values only, for the 7 keys from the spec.
    - Its comments recommend the in-cluster cms-api Service URL for `CMS_API_URL`/`GRAPHQL_URL`.
  - Verify:
    - `kubectl kustomize clusters/abyssdev/vm-prod` renders all three.
    - The assert script: each app file has exactly one `APP_IMAGE_TAG:` line and the fields match.
    - `git check-ignore` matches both filled paths.
  - Done:
    - `assert_cluster.py frontend` passes 18/18, and the new `assert_secret_frontend.py` passes
      11/11.
    - The cluster renders all 3 app syncs, and each vm-prod app file has exactly one
      `APP_IMAGE_TAG:` line.
    - Secret template: required `AUTH_SECRET`, `CMS_API_URL`, `GRAPHQL_URL` (`<cms-api-url>/graphql`,
      Nest's default path) and `REVALIDATE_SECRET`, plus `NEXT_ENV: "production"`.
      `GRAPHQL_TOKEN` and `STRAPI_API_TOKEN` are optional and commented out.
  - Deps: T9, T6

- [x] **T11: Add the frontend CI jobs: GHCR publish, cleanup and bump.** (S)
  - Files: `.github/workflows/ci.yml`
  - Acceptance:
    - The jobs mirror T7, with these differences:
      - Variables `FRONTEND_IMAGE_REPO` and `FRONTEND_GRAPHQL_URL`, passed as the `GRAPHQL_URL`
        build arg.
      - Cleanup opt-in `FRONTEND_GHCR_CLEANUP`.
      - Group `frontend-bump-tag` and file `abyssdev-frontend-prod.yaml:amd64`.
    - The three bump groups are all different.
  - Verify:
    - The `ci.yml` assert passes.
    - Bump dry-run: frontend alone works, and a cms-admin + frontend race both land, each touching
      only its own file.
  - Done:
    - `assert_ci_app.py frontend` passes 26/26, and cms-admin still passes 26/26.
    - `bump_apps.sh frontend cms-admin` passes 7/7, including a race with cms-admin.
    - The three bump groups are distinct: `cms-api-bump-tag`, `cms-admin-bump-tag` and
      `frontend-bump-tag`.
    - The only build arg is `GRAPHQL_URL`. No secret is passed, because `AUTH_SECRET` is the
      Dockerfile's placeholder default.
  - Deps: T1, T10

### Checkpoint 3
- [x] The frontend image smoke run, the renders, the asserts and the full bump dry-run (3 apps) all
  pass. The frontend lint, test and build pass, and the Vercel-style build is unchanged.
  - Results: parity 8/8, T3 4/4.
  - Images: cms-admin 14/14, frontend 17/17 static and 8/8 Docker.
  - Templates 44/44 and 46/46. The Flux envsubst guard rejects all 6 empty or missing cases and
    passes both valid ones.
  - Cluster 18/18 twice, Secret 11/11, CI 26/26 twice.
  - Bump cms-api 6/6, cms-admin 7/7 and frontend 7/7.
  - lint is clean for both apps. Tests: frontend 82, cms-admin 471.
  - The frontend build passes in the clean-copy and Docker builds. The local working copy fails
    (existing issue, see T8).
- [x] Commit: the owner confirmed. Commit `7f81e62` feat(frontend).

## Phase 4: Docs, review and clean-up (workflow steps 4–7)

- [x] **T12: Update the cms-api docs and rules for VPS only and staging on hosted platforms.** (M)
  - Files:
    - `apps/cms-api/docs/documents/cms-api-flux-deployment.md`
    - `apps/cms-api/docs/documents/cms-api-flux-deployment-techstack.md` (add the `vps-only` rows)
    - `apps/cms-api/k8s/README.md`
    - `apps/cms-api/docs/ENTRYPOINT.md`
    - `apps/cms-api/docs/rules/k8s-secrets.md` if it mentions vm-dev
  - Acceptance:
    - These docs no longer mention `vm-dev` or `arm64`, except one "retired 2026-09" history line.
    - They describe the shared bump script and the `staging` → Render mapping.
    - Also ask the owner about deleting the stray `apps/abyssdev-cms-api-prod/` (open question 2),
      and delete it only on a yes.
  - Verify: `grep -rn 'vm-dev\|arm64' apps/cms-api/docs apps/cms-api/k8s` shows only the history
    line.
  - Done:
    - `check_t12.sh` passes 8/8.
    - vm-dev and arm64 remain only in retirement notes, in the "if arm64 comes back" guidance, and in
      the techstack's decisions now marked **Superseded 2026-09-26**.
    - The techstack gained 4 tables: VPS only, the shared script, where the job gets the script, and
      per-app concurrency.
    - The deployment doc and README gained a "Retiring vm-dev" owner step (merge, then
      `flux uninstall` on the VM).
    - `k8s-secrets.md` had nothing stale.
    - The owner approved deleting the stray `apps/abyssdev-cms-api-prod/` (6 files), and it's
      deleted.
  - Deps: T3

- [x] **T13: Add the cms-admin and frontend deployment docs and techstack tables.** (M)
  - Files:
    - `apps/cms-admin/docs/documents/cms-admin-flux-deployment{,-techstack}.md` (new)
    - `apps/frontend/docs/documents/frontend-flux-deployment{,-techstack}.md` (new)
    - both `docs/ENTRYPOINT.md`
  - Acceptance:
    - The docs cover the image, the build vars (repo variables), the templates, the cluster file,
      the CI jobs, and the owner runbook: DNS, variables, GHCR visibility, ConfigMap and Secret,
      cms-api CORS origins, and merging into `deployment`.
    - The techstack tables come from the SPEC decisions.
    - The ENTRYPOINTs link to the new docs.
  - Verify: every spec decision row appears in a techstack file, and every link resolves.
  - Done:
    - `check_t13.py` passes 23/23: both docs cover their required items (16 and 22), the techstacks
      have 5 and 7 verdict tables, both ENTRYPOINTs link the docs, all relative links resolve, and
      there's no unverified size claim.
    - The shared decisions stay in cms-api's techstack, and each app techstack links to it.
    - The frontend doc explains why `https://<domain>` also needs to be in cms-api's
      `CORS_ORIGINS`: the browser calls `CMS_HEALTH_URL` directly. It also describes the DNS
      cutover.
  - Deps: T7, T11

- [x] **T14: Five-axis review** (correctness, readability, architecture, security, performance) of
  the whole diff against the spec. (S)
  - Acceptance: findings are fixed, or accepted by the owner.
  - Verify: re-run every asserts, renders and dry-run script, plus the image smoke runs.
  - Done (review of `dde7296..HEAD` plus the working tree):
    - **Correctness, fixed:** frontend readiness `timeoutSeconds` 5 → **8**. `checkApiHealth` aborts
      its cms-api call at 5s, so with a 5s probe a *hanging* cms-api made the pod NotReady and took
      the whole site out of rotation.
    - **Correctness, hardened:** explicit `HOSTNAME: "0.0.0.0"` in the frontend Deployment. The
      image already sets it and Docker keeps it, but containerd couldn't be checked offline.
      Kubernetes `env` wins regardless. The bundled Next 16.3 docs confirm the standalone server
      binds to `PORT`/`HOSTNAME`.
    - **Correctness, docs:** the Render and Vercel jobs now run on `staging` but still use the
      `Production` environment. Both app docs now say a `master`-only branch rule would reject them,
      like cms-api's.
    - **Checked, no issue:**
      - `/_next/image` works in the image (a remote JPEG returns 200, and the musl `sharp` is
        present; SVG 400 is Next's default).
      - The two-checkout bump layout: the sparse root checkout runs first, then `deployment` in a
        subfolder, so neither cleans the other.
    - **Security:**
      - No secrets reach the images or CI build args.
      - Bump jobs have `contents: write` only, and publish jobs have `packages: write`.
      - `.env*` is excluded from both build contexts, and the frontend runs as non-root.
      - cms-admin's nginx runs as root and there's no pod `securityContext`. That's a listed
        non-goal (hardening follow-up).
    - **Architecture and readability:** consistent naming and headers across the 3 apps, and one
      bump script.
    - **Performance:** readiness calls cms-api `/health` every 10s, which is negligible.
    - **Known, not changed:** the workflow-level `ci-${ref}` concurrency with `cancel-in-progress`
      can cancel an in-flight bump when a newer `master` push arrives. That already existed for
      cms-api. The newer run bumps a higher tag anyway, and the reset-and-retry leaves no partial
      state.
    - Full regression passes: parity 8, T3 4, images 14 + 17 + 8, templates 44 and 47, the Flux guard
      at 6 rejected and 2 valid, cluster 18 and 18, Secret 11, CI 26 and 26, bumps 6, 7 and 7, docs
      8 and 23. lint is clean for both apps, with 82 and 471 tests passing.
  - Deps: T12, T13

- [x] **T15: Reduce root `SPEC.md` to a minimal pointer and set the todo status to DONE.** (XS)
  - Files: `SPEC.md`, `tasks/todo.md` (optionally archive it into `tasks/archive.md`)
  - Acceptance:
    - SPEC.md only points at the three apps' deployment docs: no feature detail and no summary.
    - The owner-run steps live in the docs, not in SPEC.md.
  - Verify: SPEC.md has no content that isn't in `docs/documents/*`.
  - Done:
    - SPEC.md is now a 6-line "No active spec" pointer to `CLAUDE.md` and each app's `SPEC.md` and
      `docs/ENTRYPOINT.md`, the same form as `apps/cms-api/SPEC.md`.
    - Everything it held is in the three apps' `*-flux-deployment{,-techstack}.md`, including the
      owner-run steps.
  - Deps: T14

### Checkpoint 4
- [x] All spec success criteria 1–8 are verified offline (see T14's full regression). Criterion 9
  is left to the owner: both sites live on the VPS with valid TLS, and admin login and refresh
  working.
- [ ] Commit: the owner confirms the file list and message (Yes/No, no `Co-Authored-By`).

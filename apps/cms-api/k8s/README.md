# cms-api deployment runbook (k3s + Flux)

Step-by-step setup for deploying cms-api with Flux to the k3s cluster **vm-prod** (a VPS), from
zero to the first deploy. (A second cluster, vm-dev on a local arm64 VM, was retired on 2026-09-26.)
cms-admin and frontend deploy to the same cluster the same way; their runbooks are in their own
`docs/documents/*-flux-deployment.md`. For the design, gotchas and day-2 details, see
[docs/documents/cms-api-flux-deployment.md](../docs/documents/cms-api-flux-deployment.md).

```
push to master ──▶ GitHub Actions ──▶ GHCR  <run>-<sha>-amd64 + <run>-<sha>-amd64-init
                        │
                        └─ cms-api-bump-tag ──▶ commits APP_IMAGE_TAG to the `deployment` branch
                           (.github/scripts/bump-flux-tag.sh)         ▲
vm-prod (k3s + Flux) ── pulls `deployment` ───────────────────────────┘   every 1m (outbound, read-only key)
      └─ applies Deployment: init (migrations) → app
```

GitHub never connects to the cluster. Every connection goes out from the VPS. Flux reads only
the `deployment` branch. `master` builds images, and it reaches Flux when you merge `master` into
`deployment`.

Placeholders used below:

| Placeholder | Meaning | Value |
| --- | --- | --- |
| `<cluster>` | Cluster folder, `clusters/abyssdev/<cluster>` | `vm-prod` |
| `<app-env>` | Environment | `prod` |
| `<config-name>` | ConfigMap name, fixed by the cluster file | `abyssdev-cms-api-prod-config` |
| `<app-kustomization>` | App Flux Kustomization | `abyssdev-cms-api-sync-prod` |
| `<app-name>`, `<app-service-name>`, `<app-namespace>` | Your values in the ConfigMap | — |
| `<full-app-name>` | `<app-name>-<app-service-name>-<app-env>` (Deployment, Service) | — |
| `<full-namespace>` | `<app-namespace>-<app-env>` | — |
| `<owner>` | Your GitHub user | — |
| `<domain>` | Bare site domain; cms-api is served at `api.<domain>` (step 8) | yours |

---

## 1. GitHub: this repo

### 1.1 Repository variables

Settings → Secrets and variables → Actions → **Variables** tab → New repository variable:

| Variable | Value | Required | What it does |
| --- | --- | --- | --- |
| `CMS_API_IMAGE_REPO` | `ghcr.io/<owner>/project-abyssoftime-v2/cms-api` (**lowercase**) | Yes | Where CI pushes images. If it isn't set, the publish job fails straight away |
| `CMS_API_GHCR_CLEANUP` | `true` | No. Set it **only after step 7** | Keeps the newest 10 image versions (5 releases × 2 images) and deletes older ones |
| `CMS_API_APP_PORT` | — | **Delete it** | No longer used |

`CMS_API_RENDER_DEPLOY_HOOK` (in the `Production` environment) is unrelated: it's the `staging` →
Render deploy (`staging` deploys to the hosted platforms, `master` to the VPS). Leave it as it is.

No secrets are needed. CI uses the built-in `GITHUB_TOKEN`: `packages: write` to publish, and
`contents: write` to push the tag to `deployment`. Nothing about the clusters is stored in GitHub.

### 1.2 The `deployment` branch

Flux reads this branch only. Create it from `master` if it doesn't exist:

```bash
git fetch origin
git push origin origin/master:refs/heads/deployment
```

If it already exists, **merge `master` into `deployment`** so that it has the cluster files and
manifests:

```bash
git switch deployment && git pull
git merge origin/master        # see 6.1 if APP_IMAGE_TAG conflicts
git push origin deployment
```

`deployment` must accept pushes from GitHub Actions. That means no branch protection or ruleset on
it, or a rule with a bypass for GitHub Actions. Otherwise `cms-api-bump-tag` fails (so do the
cms-admin and frontend bump jobs, which push the same way).

### 1.3 Build the first images

Merge or push to `master` with a change under `apps/cms-api/`. The **CMS API Deploy - GHCR** job
builds on `ubuntu-latest` and pushes two amd64 tags:

```
ghcr.io/<owner>/project-abyssoftime-v2/cms-api:<run_number>-<sha7>-amd64-init
ghcr.io/<owner>/project-abyssoftime-v2/cms-api:<run_number>-<sha7>-amd64
```

Then **CMS API Deploy - Bump Flux tag** (`cms-api-bump-tag`) runs `.github/scripts/bump-flux-tag.sh`,
which commits `chore(cms-api): deploy image <run_number>-<sha7>` to `deployment`. That commit sets
vm-prod's `APP_IMAGE_TAG` to `…-amd64`. If it fails with "merge master into deployment first", do
step 1.2.

### 1.4 Package settings (github.com → your profile → Packages → `cms-api` → Package settings)

- **Visibility → Public.** The Deployment has no image pull secret. Public packages are also free.
- **Manage Actions access → add `project-abyssoftime-v2` with role `Admin`.** This is only needed
  for the cleanup step (`CMS_API_GHCR_CLEANUP`). Without it, cleanup fails after the push.

---

## 2. GitHub: a bootstrap token

`flux bootstrap` connects Flux to this repo. It commits `clusters/abyssdev/<cluster>/flux-system/`
to `deployment` and adds an SSH deploy key. Create a **fine-grained personal access token**
(Settings → Developer settings → Fine-grained tokens), limited to `project-abyssoftime-v2`, with:

| Permission | Access |
| --- | --- |
| Administration | **Read and write** (to add the deploy key) |
| Contents | Read and write (for the bootstrap commit) |
| Metadata | Read-only |

The token is used **only during bootstrap**. Flux then talks to GitHub with a **read-only** SSH
deploy key; Flux never pushes. The token isn't stored in the cluster, and you can delete it
afterwards.

---

## 3. VM / VPS: k3s and the Flux CLI

Do this on the VPS.

### 3.1 k3s

If k3s isn't installed yet:

```bash
curl -sfL https://get.k3s.io | sh -
```

Point `kubectl`/`flux` at it (k3s writes its kubeconfig as root-only):

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown "$(id -u):$(id -g)" ~/.kube/config
kubectl get nodes          # Ready
```

### 3.2 Flux CLI

```bash
curl -s https://fluxcd.io/install.sh | sudo bash
flux --version
flux check --pre           # all checks must pass
```

### 3.3 Network

- **Outbound** from the VPS: `github.com` (SSH 22 for git, 443), `ghcr.io` and
  `pkg-containers.githubusercontent.com` (443, images). Also whatever the app needs, such as your
  Postgres host (`DB_HOST`) and your storage and email providers.
- **Inbound:** nothing is needed for deploys. vm-prod serves the apps publicly, so it needs 80 and
  443 open (step 8).

---

## 4. Install Flux (bootstrap)

On the VPS:

```bash
export GITHUB_TOKEN=<the fine-grained token from step 2>

flux bootstrap github \
  --owner=<owner> \
  --repository=project-abyssoftime-v2 \
  --branch=deployment \
  --path=clusters/abyssdev/<cluster> \
  --personal

unset GITHUB_TOKEN
```

| Flag | Why |
| --- | --- |
| `--branch=deployment` | Flux reads only `deployment`, where CI writes the image tag. **Required.** |
| `--path=clusters/abyssdev/<cluster>` | The folder Flux applies: `flux-system/` plus that cluster's app Kustomization |
| `--personal` | The repo belongs to a user, not an org |

No extra components and no write-access key are needed: this setup doesn't use image automation,
so the default controllers and a read-only deploy key are enough.

**Already bootstrapped** (on `master`, or with vm-prod's old path)? Re-run the bootstrap command
above, or switch the cluster in place:

```bash
kubectl -n flux-system patch gitrepository flux-system --type merge \
  -p '{"spec":{"ref":{"branch":"deployment"}}}'
kubectl -n flux-system patch kustomization flux-system --type merge \
  -p '{"spec":{"path":"./clusters/abyssdev/<cluster>"}}'
```

This is needed because Flux reads its own `gotk-sync.yaml` from the branch and path it's on now, so
changing that file in Git can't move it. On vm-prod, the old path
`./clusters/local-vm/abyssdev/cms-api` doesn't exist anymore.

Verify:

```bash
flux check
flux get sources git        # flux-system  Ready=True, revision deployment@sha1:…
```

---

## 5. Cluster inputs: namespace, Secret and ConfigMap

These two objects hold everything that isn't in code. Create them on the cluster **before** step
6. Otherwise Flux fails on the missing ConfigMap.

Get the templates onto the machine where you run `kubectl`, from a clone of this repo or with
`scp apps/cms-api/k8s/*.example.yaml <host>:~/cms-api-k8s/`.

### 5.1 Namespace

```bash
kubectl create namespace <full-namespace>
```

### 5.2 ConfigMap: project info (`flux-system` namespace)

```bash
cp configmap.example.yaml configmap.yaml
```

Fill in `configmap.yaml`, quoting every value:

```yaml
metadata:
  name: <config-name>                     # abyssdev-cms-api-prod-config
  namespace: flux-system                  # must stay flux-system
data:
  APP_NAME: "<app-name>"
  APP_SERVICE_NAME: "<app-service-name>"
  APP_NAMESPACE: "<app-namespace>"
  APP_ENV: "<app-env>"
  APP_PORT: "3000"
  APP_IMAGE_REPO: "ghcr.io/<owner>/project-abyssoftime-v2/cms-api"   # same as CMS_API_IMAGE_REPO
  # The Ingress (step 8):
  APP_DOMAIN: "<domain>"                  # bare domain; cms-api is served at api.<domain>
  APP_TLS_CLUSTER_ISSUER: "<issuer-name>" # e.g. letsencrypt-prod
```

The name must match `substituteFrom` in `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml`.

### 5.3 Secret: runtime config and secrets (`<full-namespace>`)

```bash
cp secret.example.yaml secret.yaml
chmod 600 secret.yaml
```

Fill in `secret.yaml`:

- Set `metadata.name: <full-app-name>-secrets` and `namespace: <full-namespace>`.
- Fill every **active** key: JWT (`openssl rand -base64 32`), `CORS_ORIGINS`, `DB_*`.
- **Uncomment only the optional keys you use**, such as your storage provider's credentials
  (Cloudinary is the default) and your email provider's keys.
- **Quote every value**, and never leave an optional key as `""`: an empty value fails validation
  and the app won't boot.
- Don't add `PORT` or `APP_*`.

### 5.4 Apply

```bash
kubectl apply --server-side -f configmap.yaml -f secret.yaml
kubectl -n flux-system get configmap <config-name>
kubectl -n <full-namespace> get secret <full-app-name>-secrets
```

Always use `--server-side`. A plain `kubectl apply` also stores every Secret value in plain text
in an annotation. Keep `secret.yaml` private: it's gitignored in this repo, but on the host it's
just a file.

---

## 6. Deploy cms-api

The manifests are already in this repo. There's nothing to copy:

```
clusters/abyssdev/<cluster>/
├── flux-system/                   ← created by bootstrap, don't edit
├── kustomization.yaml             ← flux-system/ + one app file per app
├── abyssdev-apps-prod.yaml        ← cms-api's app Kustomization: path ./apps/cms-api/k8s/flux, <config-name>, APP_IMAGE_TAG
├── abyssdev-cms-admin-prod.yaml   ← cms-admin (see its own deployment doc)
└── abyssdev-frontend-prod.yaml    ← frontend (see its own deployment doc)
apps/cms-api/k8s/flux/             ← Deployment + Service, ${APP_*} only
└── ingress/                       ← Ingress + https redirect (Component, enabled by vm-prod, step 8)
```

Once `deployment` contains them (step 1.2) and has a real tag (1.3 or 6.1), Flux applies them on
its next poll.

### 6.1 Switching from Flux image automation (one time)

Earlier, Flux image automation committed tags to `deployment`. The first time you merge `master`
into `deployment` after this change, the cluster file's `APP_IMAGE_TAG` line conflicts. Keep the real
tag and drop the trailing comment:

```yaml
      APP_IMAGE_TAG: "75-4bef740"
```

After the merge, `prune: true` removes the old image-automation objects from the cluster.

### 6.2 Retiring vm-dev (one time, 2026-09-26)

`clusters/abyssdev/vm-dev/` was deleted from `master`. When you merge `master` into `deployment`,
take that deletion and keep `deployment`'s real tag in vm-prod's cluster file. Then run
`flux uninstall` on the old VM, or shut it down. Until then its Flux sync fails with "path not
found", and nothing on the VM is deleted by that failure.

### 6.3 Switching from the old helmfile deploy (one time)

If cms-api still runs from Helm, remove it just before or after the merge above. Flux can't take
over the Helm-made Deployment, because its selector labels differ and selectors can't change.
Expect a short downtime.

```bash
helm -n abyssoftime-prod uninstall abyssoftime-cms-api-prod abyssoftime-cms-api-prod-secrets
```

---

## 7. Verify the first deploy

```bash
flux reconcile source git flux-system                    # don't wait for the 1m poll
flux get kustomizations                                  # <app-kustomization>  Ready=True
kubectl -n <full-namespace> get pods                     # Init:0/1 → Running
kubectl -n <full-namespace> logs deploy/<full-app-name> -c init   # migrations
kubectl -n <full-namespace> port-forward svc/<full-app-name> 3000:3000
curl localhost:3000/health
```

Then test the automatic path: push a cms-api change to `master`. Within a few minutes you should see
a `chore(cms-api): deploy image <tag>` commit on `deployment`, no extra CI run, and a new pod on
vm-prod.

Once this works, you can turn on GHCR cleanup: set `CMS_API_GHCR_CLEANUP=true` (step 1.1).

---

## 8. Expose cms-api to the internet (vm-prod)

vm-prod serves cms-api at **`https://api.<domain>`** through the Traefik that comes with k3s. The
bare `<domain>` is the frontend and `admin.<domain>` is cms-admin, both on the same cluster (see their
deployment docs). The Ingress lives in `apps/cms-api/k8s/flux/ingress/`, and vm-prod's cluster file
turns it on (`components: [ingress]`).

Do 8.1–8.4 **before** merging `master` into `deployment`. Otherwise the Flux apply fails: with no
`APP_DOMAIN`, the host renders as `api.`, and the API server rejects it.

### 8.1 DNS and firewall

- An `A` (and `AAAA`, if the VPS has IPv6) record for `api.<domain>` pointing at the VPS, plus
  `<domain>` and `admin.<domain>` for the frontend and cms-admin.
- Inbound TCP **80 and 443** open on the VPS (provider firewall and `ufw`, if used). Port 80 has to
  stay open: Let's Encrypt validates over it, and Traefik redirects it to https.

```bash
dig +short api.<domain>                  # the VPS IP
```

### 8.2 cert-manager and a ClusterIssuer

Install cert-manager (check [the docs](https://cert-manager.io/docs/installation/kubectl/) for the
current release):

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager-webhook
```

Create the Let's Encrypt ClusterIssuer. Its name is what goes into `APP_TLS_CLUSTER_ISSUER`:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <you@example.com>              # expiry notices
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

```bash
kubectl apply --server-side -f cluster-issuer.yaml
kubectl get clusterissuer letsencrypt-prod    # READY True
```

If you want to test without touching Let's Encrypt's production rate limits, make a second issuer
with `server: https://acme-staging-v02.api.letsencrypt.org/directory`, point
`APP_TLS_CLUSTER_ISSUER` at it first, then switch back. The staging cert isn't browser-trusted.

### 8.3 ConfigMap keys

Add both keys to vm-prod's `configmap.yaml` (step 5.2) and re-apply:

```bash
#   APP_DOMAIN: "<domain>"                     # bare, no scheme, no "api."
#   APP_TLS_CLUSTER_ISSUER: "letsencrypt-prod"
kubectl apply --server-side -f configmap.yaml
```

### 8.4 CORS

Browsers call cms-api from the other subdomains, so `CORS_ORIGINS` in vm-prod's `secret.yaml` has to
list them: `"https://<domain>,https://admin.<domain>"`. Then re-apply and `rollout restart` (see
Everyday commands).

### 8.5 Deploy and verify

Merge `master` into `deployment` (step 1.2), then:

```bash
flux reconcile kustomization abyssdev-cms-api-sync-prod --with-source
kubectl -n <full-namespace> get ingress,certificate      # certificate READY True, within ~1-2 min
curl -I http://api.<domain>/health                       # 301/308, Location: https://api.<domain>/health
curl https://api.<domain>/health                         # 200, no -k needed
```

If the certificate stays not ready, run `kubectl -n <full-namespace> describe certificate` and
`kubectl get challenges -A`. The usual causes are DNS not pointing at the VPS yet, or port 80 being
closed.

### 8.6 Real client IPs (recommended)

cms-api rate-limits auth routes per client IP, and trusts one proxy hop (`TRUST_PROXY: "1"`, which
is Traefik). But k3s's built-in load balancer (ServiceLB) uses `externalTrafficPolicy: Cluster` by
default. That rewrites the source address, so Traefik may see the node's IP for every request, and
then all users share one rate-limit bucket. To keep the real client IP, tell k3s's Traefik to use
`Local`:

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    service:
      spec:
        externalTrafficPolicy: Local
```

Save it as `/var/lib/rancher/k3s/server/manifests/traefik-config.yaml` on the VPS. k3s picks it up
and redeploys Traefik, with a brief blip on 80 and 443. This affects every Ingress on the cluster,
so it's a cluster setting and isn't committed with cms-api.

---

## Flux configuration reference

Everything Flux-related that you might tune:

| Setting | Where | Default here | Notes |
| --- | --- | --- | --- |
| Branch Flux reads | `clusters/abyssdev/vm-prod/flux-system/gotk-sync.yaml` (GitRepository `ref.branch`) | `deployment` | Change it in-cluster too (step 4) |
| Git poll | same file, GitRepository `interval` | 1m | Created by bootstrap |
| App reconcile / drift fix | `clusters/abyssdev/vm-prod/abyssdev-apps-prod.yaml` `spec.interval` | 3m | Also runs right after each new revision |
| Rollout health timeout | same file, `wait: true`, `timeout` | 5m | Ready only once pods are healthy |
| Deployed tag | `APP_IMAGE_TAG` line in the same file, **on `deployment`** | set by `cms-api-bump-tag` via `.github/scripts/bump-flux-tag.sh` (`<run>-<sha7>-amd64`) | On `master` it's a placeholder. Keep it on one line (CI edits it with `sed`) |
| Public Ingress on/off | same file, `spec.components: [ingress]` | on | Needs the step 8 prerequisites first |

Nothing else needs configuring for Flux: no webhooks, no inbound ports, and no extra secrets in
Flux. The only inbound ports are 80 and 443, for vm-prod's public Ingress.

## Everyday commands

```bash
# Ship a manifest change (resources, probes, intervals, cluster files)
git switch deployment && git pull && git merge origin/master && git push origin deployment

# Change a secret value
vi secret.yaml && kubectl apply --server-side -f secret.yaml
kubectl -n <full-namespace> rollout restart deploy/<full-app-name>

# Change project info (e.g. port)
vi configmap.yaml && kubectl apply --server-side -f configmap.yaml
flux reconcile kustomization <app-kustomization>

# Roll back / pin a tag: set APP_IMAGE_TAG to an older <run>-<sha7>-amd64 in vm-prod's cluster file on
# `deployment`, commit, push. It holds until the next cms-api build on master.
flux reconcile kustomization <app-kustomization> --with-source

# Pause cms-api deploys
flux suspend kustomization <app-kustomization>
```

With cleanup on, only the last 5 releases exist in GHCR, so you can't roll back further than that.
Rolling back doesn't undo database migrations.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| CI: `Repository variable CMS_API_IMAGE_REPO is not set` | Variable missing | Step 1.1 |
| CI cleanup step: 403 / not found | Repo lacks the Admin role on the package | Step 1.4, or unset `CMS_API_GHCR_CLEANUP` |
| `cms-api-bump-tag`: "… is not on the deployment branch" | `deployment` doesn't have the cluster files yet | Merge `master` into `deployment` (step 1.2) |
| `cms-api-bump-tag`: push rejected 3× / protected branch | `deployment` doesn't accept pushes from Actions | Remove the protection, or add an Actions bypass (step 1.2) |
| `cms-api-bump-tag`: "APP_IMAGE_TAG was not set" | The `APP_IMAGE_TAG:` line was reformatted (for example split over two lines) | Put `APP_IMAGE_TAG: "<tag>"` back on one line |
| New tag on `deployment`, but the cluster doesn't change | Flux still reads `master` or an old path | `flux get sources git` should show `deployment@…`; otherwise patch or re-bootstrap (step 4) |
| Kustomization: `ConfigMap … not found` | ConfigMap missing, misnamed, or not in `flux-system` | Step 5.2: the name must match the cluster file |
| Pod `ImagePullBackOff` | Wrong `APP_IMAGE_REPO`, the tag doesn't exist (for example the old `"dev"` placeholder), or the package is private | Check the ConfigMap and the tag on `deployment`, and the package visibility |
| Pod `Init:CrashLoopBackOff`, and `kubectl logs … -c init` says `exec format error` | The tag's CPU arch doesn't match the node (for example a leftover `-arm64` tag from the retired vm-dev) | vm-prod needs `…-amd64` on `deployment`; the next `master` build sets it. For an arm64 node, add an arm64 build back to `cms-api-ghcr-publish` and pass `<file>:arm64` to the bump script |
| Pod `Init:CrashLoopBackOff` | Migrations failed: DB unreachable or wrong `DB_*` | `kubectl logs … -c init`, fix `secret.yaml`, re-apply, restart |
| App `CrashLoopBackOff` on boot | Env validation: a required key is missing, or an optional key is `""` | `kubectl logs …`, fix `secret.yaml` |
| Manifest change on `master` not live | `deployment` not updated | Merge `master` into `deployment` |
| Kustomization: `spec.rules[0].host: Invalid value: "api."`. New image tags stop reaching vm-prod too | `APP_DOMAIN` missing from vm-prod's ConfigMap. Flux applies all or nothing, so the Deployment is held back as well | Step 8.3, then `flux reconcile kustomization abyssdev-cms-api-sync-prod` |
| Kustomization: `no matches for kind "Middleware"` | Traefik isn't installed (k3s was started with `--disable traefik`) | Re-enable the bundled Traefik, or install Traefik v3 with its CRDs |
| Browser shows `TRAEFIK DEFAULT CERT`, and the certificate isn't ready | DNS not pointing at the VPS yet, port 80 closed, or `APP_TLS_CLUSTER_ISSUER` doesn't match a ClusterIssuer | Steps 8.1–8.3, `kubectl get challenges -A` |
| `api.<domain>` returns 404 for every path | The Ingress middleware annotation doesn't match the Middleware (renamed by hand) | Keep `ingress.yaml`'s annotation `<ns>-<middleware-name>@kubernetescrd` in sync with `middleware.yaml` |
| Auth rate limit trips for everyone at once | All requests share the node IP | Step 8.6 |
| Deploys stopped after renaming `ci.yml` | `run_number` restarted at 1, so the bump job treats new tags as older | See the `run_number` caveat in the deployment doc |

## Checklist

- [ ] `CMS_API_IMAGE_REPO` set, `CMS_API_APP_PORT` deleted
- [ ] `deployment` exists, contains `master`, and accepts pushes from GitHub Actions
- [ ] GHCR package public (+ Admin role for this repo, if you'll use cleanup)
- [ ] Fine-grained token created (Administration RW, Contents RW, Metadata R)
- [ ] VPS: k3s running, `kubectl get nodes` works, `flux check --pre` passes
- [ ] VPS: `flux bootstrap github … --branch=deployment --path=clusters/abyssdev/vm-prod`
      (or the two `kubectl patch` commands)
- [ ] VPS: namespace, ConfigMap (`<config-name>` in `flux-system`) and Secret applied with
      `--server-side`
- [ ] `APP_IMAGE_TAG` on `deployment` is a real tag in vm-prod's cluster file
- [ ] Old Helm releases uninstalled; old vm-dev VM `flux uninstall`ed or shut down (step 6.2)
- [ ] `flux get kustomizations` Ready, pod Running, `/health` OK
- [ ] A test push to `master` produces a bot commit on `deployment` and a new pod
- [ ] vm-prod: DNS for `api.<domain>`, ports 80/443, cert-manager + ClusterIssuer, `APP_DOMAIN` +
      `APP_TLS_CLUSTER_ISSUER` in the ConfigMap, all **before** the merge (step 8)
- [ ] vm-prod: `curl https://api.<domain>/health` returns 200 with a trusted cert, and http redirects
- [ ] (Recommended) vm-prod: Traefik `externalTrafficPolicy: Local` (step 8.6)
- [ ] (Optional) `CMS_API_GHCR_CLEANUP=true`; bootstrap token deleted

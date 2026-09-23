# cms-api deployment runbook (k3s + Flux)

Step-by-step setup for deploying cms-api to a k3s VPS with Flux, from zero to first deploy. For
the design, gotchas and day-2 details, see
[docs/documents/cms-api-flux-deployment.md](../docs/documents/cms-api-flux-deployment.md).

```
push to master ──▶ GitHub Actions ──▶ GHCR  <run>-<sha> + <run>-<sha>-init
                                         ▲
VPS (k3s + Flux) ── polls tags ──────────┘   every 5m (outbound)
      │  commits new tag ──▶ GitOps repo       (outbound, deploy key)
      │  pulls GitOps repo ◀─┘                 every 1m (outbound)
      └─ applies Deployment: init (migrations) → app
```

GitHub never connects to the VPS. Every connection goes out from the VPS.

Placeholders used below (cms-api prod values):

| Placeholder | Meaning | prod |
| --- | --- | --- |
| `<app-name>` | Application | `abyssoftime` |
| `<app-service-name>` | Service | `cms-api` |
| `<app-namespace>` | Base namespace | `abyssoftime` |
| `<app-env>` | Environment | `prod` |
| `<full-app-name>` | `<app-name>-<app-service-name>-<app-env>` | `abyssoftime-cms-api-prod` |
| `<full-namespace>` | `<app-namespace>-<app-env>` | `abyssoftime-prod` |
| `<owner>` | Your GitHub user | — |
| `<gitops-repo>` | The GitOps repo Flux watches | e.g. `k3s-gitops` |
| `<cluster>` | Folder name for this cluster in the GitOps repo | e.g. `vps` |

---

## 1. GitHub: this repo (app + CI)

### 1.1 Repository variables

Settings → Secrets and variables → Actions → **Variables** tab → New repository variable:

| Variable | Value | Required | What it does |
| --- | --- | --- | --- |
| `CMS_API_IMAGE_REPO` | `ghcr.io/<owner>/project-abyssoftime-v2/cms-api` (**lowercase**) | Yes | Where CI pushes images. If it isn't set, the publish job fails straight away |
| `CMS_API_GHCR_CLEANUP` | `true` | No. Set it **only after step 7** | Keeps the newest 10 image versions (5 releases) and deletes older ones |
| `CMS_API_APP_PORT` | — | **Delete it** | No longer used |

`CMS_API_RENDER_DEPLOY_HOOK` (in the `Production` environment) is unrelated: it's the `staging` →
Render deploy. Leave it as it is.

No secrets are needed. CI uses the built-in `GITHUB_TOKEN` (`packages: write`), and nothing
about the VPS is stored in GitHub.

### 1.2 Build the first images

Merge or push to `master` with a change under `apps/cms-api/`. The **CMS API Deploy - GHCR**
job pushes two tags:

```
ghcr.io/<owner>/project-abyssoftime-v2/cms-api:<run_number>-<sha7>-init
ghcr.io/<owner>/project-abyssoftime-v2/cms-api:<run_number>-<sha7>
```

Write down the app tag (e.g. `57-a1b2c3d`): it's your `<initial-tag>` in step 6. You can find it in
the job's **Compute image tag** step, or on the package page.

### 1.3 Package settings (github.com → your profile → Packages → `cms-api` → Package settings)

- **Visibility → Public.** The manifests have no image pull secret, and Flux scans tags without
  credentials. Public packages are also free.
- **Manage Actions access → add `project-abyssoftime-v2` with role `Admin`.** Only needed for
  the cleanup step (`CMS_API_GHCR_CLEANUP`). Without it, cleanup fails after the push.

---

## 2. GitHub: the GitOps repo and a bootstrap token

Flux keeps the cluster's desired state in a **separate** repo. `flux bootstrap` creates it if it
doesn't exist (private is fine), so you don't need to create it by hand.

Create a **fine-grained personal access token** (Settings → Developer settings → Fine-grained
tokens), limited to `<gitops-repo>` (or to all repos if it doesn't exist yet), with:

| Permission | Access |
| --- | --- |
| Administration | **Read and write** (to add the deploy key) |
| Contents | Read and write |
| Metadata | Read-only |

The token is used **only during bootstrap**. Flux then talks to GitHub with an SSH deploy key it
creates, and the token isn't stored in the cluster. You can delete the token afterwards.

---

## 3. VPS: k3s and the Flux CLI

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
  `pkg-containers.githubusercontent.com` (443, images). Plus whatever the app needs, such as your
  Postgres host (`DB_HOST`) and your storage and email providers.
- **Inbound:** nothing is needed for deploys. Only open what your users need (e.g. 80/443 for an
  ingress).

---

## 4. Install Flux (bootstrap)

On the VPS, or any machine whose kubeconfig points at the k3s cluster:

```bash
export GITHUB_TOKEN=<the fine-grained token from step 2>

flux bootstrap github \
  --owner=<owner> \
  --repository=<gitops-repo> \
  --branch=main \
  --path=clusters/<cluster> \
  --personal \
  --components-extra=image-reflector-controller,image-automation-controller \
  --read-write-key

unset GITHUB_TOKEN
```

| Flag | Why |
| --- | --- |
| `--components-extra=image-reflector-controller,image-automation-controller` | Image automation (scan GHCR tags, write the new tag to Git). **Required.** Not installed by default |
| `--read-write-key` | Lets image automation **push** tag commits to the GitOps repo. Without it, deploys stall after the first one |
| `--path=clusters/<cluster>` | The folder Flux applies automatically. Only the entry file goes here, **not** `app/` (see step 6) |
| `--personal` | The repo belongs to a user, not an org |

This creates `clusters/<cluster>/flux-system/` in the GitOps repo, a `flux-system` GitRepository
(polls every 1m) and Kustomization, and a write deploy key on the repo.

Verify:

```bash
flux check                                          # all controllers ✔, including image-*
kubectl -n flux-system get deploy                   # 6 controllers Running
flux get sources git                                # flux-system  Ready=True
```

Already have Flux without the image controllers? Re-run the same `bootstrap` command with the two
extra flags. It's idempotent.

---

## 5. VPS: namespace, Secret and ConfigMap

These two objects hold everything that isn't in code. Create them **before** step 6. Otherwise
Flux fails on the missing ConfigMap.

Get the templates onto the machine where you run `kubectl`, from a clone of this repo or with
`scp apps/cms-api/k8s/*.example.yaml <vps>:~/cms-api-k8s/`.

### 5.1 Namespace

```bash
kubectl create namespace abyssoftime-prod           # <full-namespace>
```

### 5.2 ConfigMap: project info (`flux-system` namespace)

```bash
cp configmap.example.yaml configmap.yaml
```

Fill in `configmap.yaml`, quoting every value:

```yaml
metadata:
  name: abyssoftime-cms-api-prod-config
  namespace: flux-system                  # must stay flux-system
data:
  APP_NAME: "abyssoftime"
  APP_SERVICE_NAME: "cms-api"
  APP_NAMESPACE: "abyssoftime"
  APP_ENV: "prod"
  APP_PORT: "3000"
  APP_IMAGE_REPO: "ghcr.io/<owner>/project-abyssoftime-v2/cms-api"   # same as CMS_API_IMAGE_REPO
```

### 5.3 Secret: runtime config and secrets (`<full-namespace>`)

```bash
cp secret.example.yaml secret.yaml
chmod 600 secret.yaml
```

Fill in `secret.yaml`:

- Set `metadata.name: abyssoftime-cms-api-prod-secrets` and `namespace: abyssoftime-prod`.
- Fill every **active** key: JWT (`openssl rand -base64 32`), `CORS_ORIGINS`, `DB_*`.
- **Uncomment only the optional keys you use**, such as your storage provider's credentials
  (Cloudinary is the default) and your email provider's keys.
- **Quote every value**, and never leave an optional key as `""`: an empty value fails validation
  and the app won't boot.
- Don't add `PORT` or `APP_*`.

### 5.4 Apply

```bash
kubectl apply --server-side -f configmap.yaml -f secret.yaml
kubectl -n flux-system get configmap abyssoftime-cms-api-prod-config
kubectl -n abyssoftime-prod get secret abyssoftime-cms-api-prod-secrets
```

Always use `--server-side`. A plain `kubectl apply` also stores every Secret value in plain text
in an annotation. Keep `secret.yaml` private: it's gitignored in this repo, but on the VPS it's
just a file.

---

## 6. GitOps repo: add cms-api

Clone the GitOps repo (it now contains `clusters/<cluster>/flux-system/`) and copy the templates
from `apps/cms-api/k8s/flux/`:

```
<gitops-repo>/
├── clusters/<cluster>/
│   ├── flux-system/                         ← created by bootstrap, don't edit
│   └── abyssoftime-cms-api-prod.yaml        ← kustomization.flux.yaml, placeholders filled
└── apps/abyssoftime-cms-api-prod/           ← app/ copied unchanged
```

```bash
SRC=<path-to-this-repo>/apps/cms-api/k8s/flux
cd <gitops-repo>
NAME=abyssoftime-cms-api-prod
CLUSTER=<cluster>
TAG=<initial-tag>                  # from step 1.2, e.g. 57-a1b2c3d

mkdir -p apps/$NAME
cp $SRC/app/*.yaml apps/$NAME/     # leave the ${APP_*} as they are: Flux fills them from the ConfigMap

sed -e "s|<full-app-name>|$NAME|g" \
    -e "s|<path-to-app-dir>|./apps/$NAME|" \
    -e "s|<initial-tag>|$TAG|" \
    $SRC/kustomization.flux.yaml > clusters/$CLUSTER/$NAME.yaml

grep -n '<' clusters/$CLUSTER/$NAME.yaml | grep -v '#'   # must print nothing

git add apps/$NAME clusters/$CLUSTER/$NAME.yaml
git commit -m "feat: deploy $NAME with Flux"
git push
```

**`app/` must stay outside `clusters/<cluster>/`.** Everything under that folder is applied by
the bootstrap Kustomization without substitution, so `${APP_NAME}` would reach the cluster
literally.

### 6.1 Switching from the old helmfile deploy (one time)

If cms-api still runs from Helm, remove it just before or after the push above. Flux can't take
over the Helm-made Deployment, because its selector labels differ and selectors can't change.
Expect a short downtime.

```bash
helm -n abyssoftime-prod uninstall abyssoftime-cms-api-prod abyssoftime-cms-api-prod-secrets
```

---

## 7. Verify the first deploy

```bash
flux reconcile kustomization flux-system --with-source   # don't wait for the 1m poll
flux get kustomizations                                  # abyssoftime-cms-api-prod  Ready=True
flux get images repository                               # scanned tags
flux get images policy                                   # selected tag = newest <run>-<sha>
kubectl -n abyssoftime-prod get pods                     # Init:0/1 → Running
kubectl -n abyssoftime-prod logs deploy/abyssoftime-cms-api-prod -c init   # migrations
kubectl -n abyssoftime-prod port-forward svc/abyssoftime-cms-api-prod 3000:3000
curl localhost:3000/health
```

Then test the automatic path: push a cms-api change to `master`. Within about 10 minutes you
should see a `chore(abyssoftime-cms-api-prod): update image tag` commit in the GitOps repo and a
new pod.

Once this works, you can turn on GHCR cleanup: set `CMS_API_GHCR_CLEANUP=true` (step 1.1).

---

## Flux configuration reference

Everything Flux-related that you might tune:

| Setting | Where | Default here | Notes |
| --- | --- | --- | --- |
| GitOps repo poll | `clusters/<cluster>/flux-system/gotk-sync.yaml` (GitRepository `interval`) | 1m | Created by bootstrap |
| App reconcile / drift fix | `clusters/<cluster>/<full-app-name>.yaml` `spec.interval` | 10m | Also runs right after each Git change |
| Rollout health timeout | same file, `wait: true`, `timeout` | 5m | Ready only once pods are healthy |
| GHCR tag scan | `apps/<full-app-name>/image-repository.yaml` `interval` | 5m | Lower it for faster deploys |
| Tag commit to Git | `apps/<full-app-name>/image-update.yaml` `interval` | 5m | Commit author `fluxcdbot` |
| Which tags count | `image-policy.yaml` `filterTags.pattern` | `^(?P<n>\d+)-[a-f0-9]{7}$` | Must match the CI tag format |
| Deployed tag | `APP_IMAGE_TAG` line in the entry file | set by automation | Don't edit by hand unless automation is suspended |

Nothing else needs configuring: no webhooks, no inbound ports, no extra secrets in Flux.

## Everyday commands

```bash
# Change a secret value
vi secret.yaml && kubectl apply --server-side -f secret.yaml
kubectl -n abyssoftime-prod rollout restart deploy/abyssoftime-cms-api-prod

# Change project info (e.g. port)
vi configmap.yaml && kubectl apply --server-side -f configmap.yaml
flux reconcile kustomization abyssoftime-cms-api-prod

# Roll back / pin a tag (a plain revert would be overwritten by automation)
flux suspend image update abyssoftime-cms-api-prod
#   → in the GitOps repo, revert the "update image tag" commit (or set APP_IMAGE_TAG), push
flux reconcile kustomization abyssoftime-cms-api-prod --with-source
flux resume image update abyssoftime-cms-api-prod     # once a fixed image is pushed

# Pause all deploys
flux suspend kustomization abyssoftime-cms-api-prod
```

With cleanup on, only the last 5 releases exist in GHCR, so you can't roll back further than that.
Rolling back doesn't undo database migrations.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| CI: `Repository variable CMS_API_IMAGE_REPO is not set` | Variable missing | Step 1.1 |
| CI cleanup step: 403 / not found | Repo lacks the Admin role on the package | Step 1.3, or unset `CMS_API_GHCR_CLEANUP` |
| Kustomization: `ConfigMap … not found` | ConfigMap missing, or not in `flux-system` | Step 5.2 |
| Objects named `${APP_NAME}-…` or rejected names | `app/` placed under `clusters/<cluster>/` | Move it to `apps/<full-app-name>/` (step 6) |
| `flux get images repository`: auth / 401 | GHCR package is private | Make it public (step 1.3) |
| Pod `ImagePullBackOff` | Wrong `APP_IMAGE_REPO`, `<initial-tag>` doesn't exist, or the package is private | Check the ConfigMap and the tag. The policy fixes the tag within 5m |
| Pod `Init:CrashLoopBackOff` | Migrations failed: DB unreachable or wrong `DB_*` | `kubectl logs … -c init`, fix `secret.yaml`, re-apply, restart |
| App `CrashLoopBackOff` on boot | Env validation: a required key is missing, or an optional key is `""` | `kubectl logs …`, fix `secret.yaml` |
| New images never deploy | No write deploy key (`--read-write-key` missing), or image controllers not installed | Re-run bootstrap with both flags (step 4). Check `flux get images update` |
| Deploys stopped after renaming `ci.yml` | `run_number` restarted at 1, so new tags are "older" | See the `run_number` caveat in the deployment doc |

## Checklist

- [ ] `CMS_API_IMAGE_REPO` set, `CMS_API_APP_PORT` deleted
- [ ] First `master` build pushed `<tag>` + `<tag>-init`; tag noted
- [ ] GHCR package public (+ Admin role for this repo, if you'll use cleanup)
- [ ] Fine-grained token created (Administration RW, Contents RW, Metadata R)
- [ ] k3s running, `kubectl get nodes` works, `flux check --pre` passes
- [ ] `flux bootstrap github … --components-extra=image-reflector-controller,image-automation-controller --read-write-key`
- [ ] Namespace, ConfigMap (`flux-system`) and Secret applied with `--server-side`
- [ ] `app/` → `apps/<full-app-name>/`, entry file → `clusters/<cluster>/`, placeholders filled, pushed
- [ ] Old Helm releases uninstalled
- [ ] `flux get kustomizations` Ready, pod Running, `/health` OK
- [ ] A test push to `master` auto-deploys
- [ ] (Optional) `CMS_API_GHCR_CLEANUP=true`; bootstrap token deleted

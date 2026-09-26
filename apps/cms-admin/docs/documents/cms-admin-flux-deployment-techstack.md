# k3s Deployment (Flux) — Tech/Pattern/Design Decisions

Comparison tables for the choices behind cms-admin's Flux deployment, following repo root
`docs/workflow.md`'s "Decision rationale" rule. See
[cms-admin-flux-deployment.md](./cms-admin-flux-deployment.md) for how it's implemented. The shared
decisions (Flux vs. alternatives, the `deployment` branch, the CI bump commit, the shared bump
script, per-app concurrency groups, VPS only) are recorded once, in
[cms-api-flux-deployment-techstack.md](../../../cms-api/docs/documents/cms-api-flux-deployment-techstack.md).

## Where cms-admin gets the API URL: build arg (chosen) vs. runtime `config.js` vs. same-origin nginx proxy

The app reads `import.meta.env.VITE_API_URL`, which Vite inlines at build time.

| Criteria | Repo variable → `VITE_API_URL` build arg (chosen) | Runtime `config.js` from a ConfigMap | Relative URL + nginx proxies `/api` to the cms-api Service |
| --- | --- | --- | --- |
| App code change | None | Read `window.__CONFIG__` before `import.meta.env` | None |
| One image for several environments | No | Yes | Yes |
| Browser → API path | Straight to `https://api.<domain>` | Same | Through admin's nginx, then in-cluster |
| Extra moving parts | None | An entrypoint that writes `config.js`, plus a ConfigMap key | A templated `nginx.conf` with the Service DNS name |
| Fit with one cluster (VPS only) | Exact: there's one API URL | Solves a problem that doesn't exist | Also bypasses the public API and its rate limiting per client IP |
| **Verdict** | **Chosen (user decision)**: no code change, and one cluster means one URL | Rejected for now: worth it only if a second environment runs the same image | Rejected: extra config, and admin traffic would skip the public API |

## nginx proxies to `api:8080`: remove (chosen) vs. keep

| Criteria | Remove, keep only the SPA fallback + `/healthz` (chosen) | Keep |
| --- | --- | --- |
| Target exists | — | No: `api:8080` was a docker-compose service name |
| Effect on calls | None: the app calls the absolute `VITE_API_URL` | `/api/*` and `/auth/*` on `admin.<domain>` would return 502 |
| **Verdict** | **Chosen (user decision)**: dead config that only fails | Rejected |

## Health probe target: nginx `/healthz` (chosen) vs. `/` vs. TCP

| Criteria | `location = /healthz { return 200; }` (chosen) | `httpGet /` | `tcpSocket` |
| --- | --- | --- | --- |
| Checks nginx is serving HTTP | Yes | Yes | Only that the port is open |
| Cost per probe | No file read, no access log | Reads and sends `index.html` | Smallest |
| Depends on cms-api | No | No | No |
| **Verdict** | **Chosen**: a real HTTP check with no side effects | Rejected: noisy logs for the same signal | Rejected: misses a broken nginx config that still listens |

## Ingress placement: in the base (chosen) vs. a kustomize Component like cms-api

| Criteria | Ingress + Middleware in the base `kustomization.yaml` (chosen) | `ingress/` Component enabled by the cluster file |
| --- | --- | --- |
| Clusters that need it off | None (vm-prod only) | — |
| Files and indirection | 5 files in one folder | A second `kustomization.yaml` (`kind: Component`) and `spec.components` in the cluster file |
| **Verdict** | **Chosen**: cms-api's Component existed to keep the retired vm-dev internal | Rejected: indirection with nothing to switch off |

## Container port: fixed 80 (chosen) vs. `${APP_PORT}` from the ConfigMap

| Criteria | Literal `80` (chosen) | `${APP_PORT}` |
| --- | --- | --- |
| Where the port is decided | The image (`nginx.conf` `listen 80`) | The ConfigMap, which must match the image anyway |
| Ways to get it wrong | None | A ConfigMap value different from `listen 80` breaks probes and the Service |
| "No project values in code" | 80 is an image fact, not a project value | — |
| **Verdict** | **Chosen**: one fewer key to keep in sync | Rejected: configurability the image can't honour |

## Image repository and tags

cms-admin follows cms-api's tag format, `<run_number>-<sha7>-amd64` (orderable by the bump's
run-number guard, names the commit, keeps the arch explicit). It uses its own GHCR package
(`CMS_ADMIN_IMAGE_REPO`). Cleanup keeps 5 versions, which is 5 releases at one image each.

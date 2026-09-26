# k3s Deployment (Flux) — Tech/Pattern/Design Decisions

Comparison tables for the choices behind the frontend's Flux deployment, following repo root
`docs/workflow.md`'s "Decision rationale" rule. See
[frontend-flux-deployment.md](./frontend-flux-deployment.md) for how it's implemented. The shared
decisions (Flux vs. alternatives, the `deployment` branch, the CI bump commit, the shared bump
script, per-app concurrency groups, VPS only) are recorded once, in
[cms-api-flux-deployment-techstack.md](../../../cms-api/docs/documents/cms-api-flux-deployment-techstack.md).

## Image shape: Next standalone on Node (chosen) vs. full `next start` image vs. Bun runtime

| Criteria | `output: "standalone"`, runner `node:24-alpine` (chosen) | Full app + `node_modules`, `next start` | Standalone, run with Bun |
| --- | --- | --- | --- |
| What ships | Only the traced server files, `.next/static` and `public` (image about 330MB) | Every dependency, dev tooling included | Same as chosen |
| Runtime support | Next's supported server runtime | Supported | Not an officially supported Next server runtime |
| Build tool | Bun (`bun install`, `bun run build`), as in CI | Same | Same |
| **Verdict** | **Chosen**: a small runtime surface on the supported runtime | Rejected: ships everything the server never loads | Rejected: an unsupported runtime for the public site |

## Enabling standalone: only when `NEXT_OUTPUT=standalone` (chosen) vs. always

| Criteria | Opt-in via `NEXT_OUTPUT`, set only by the Dockerfile (chosen) | `output: "standalone"` always |
| --- | --- | --- |
| Vercel (staging) build | Unchanged | Changes the output Vercel receives |
| Local `bun run build` | Unchanged | Creates `.next/standalone` every time |
| **Verdict** | **Chosen**: the VPS image gets standalone, and nothing else changes | Rejected: a risk to the working Vercel deploy for no benefit |

## Build stages: Bun alpine builder (chosen) vs. Debian builder vs. Node builder

| Criteria | `oven/bun:1-alpine` (chosen) | `oven/bun:1` (Debian) | `node:24-alpine` with Bun installed |
| --- | --- | --- | --- |
| Native modules (SWC, lightningcss) on musl | Worked in the local build | Always glibc | Same as chosen |
| Image pull size | Smallest | Larger | Extra install step |
| **Verdict** | **Chosen**: builds cleanly, so no fallback needed | Fallback if an alpine build ever breaks | Rejected: extra step for no gain |

## Build-time secrets: a placeholder `AUTH_SECRET` (chosen) vs. the real secret as a build arg

| Criteria | Placeholder `ARG AUTH_SECRET` default, builder stage only (chosen) | Real secret via `--build-arg` |
| --- | --- | --- |
| Why a value is needed | `src/auth.ts` throws at import time, and `next build` imports it | Same |
| Leaks | None: the placeholder isn't a secret, and the runner stage has no `AUTH_SECRET` | Build args are visible in image history |
| Runtime value | From the k8s Secret | Would also need the Secret anyway |
| **Verdict** | **Chosen**: the same trick the existing `frontend-build` CI job uses | Rejected: puts a real secret in the image |

## Empty-domain guard: `${APP_DOMAIN:=APP_DOMAIN-is-not-set}` (chosen) vs. `${APP_DOMAIN:?}` vs. plain `${APP_DOMAIN}`

The frontend's host is the bare domain, so there's no prefix to make an empty value invalid.

| Criteria | `${APP_DOMAIN:=APP_DOMAIN-is-not-set}` (chosen) | `${APP_DOMAIN:?msg}` | Plain `${APP_DOMAIN}` |
| --- | --- | --- | --- |
| Supported by Flux's envsubst | Yes (`:=` default form) | **No**: listed as unsupported in fluxcd/pkg/envsubst | Yes |
| Result when unset or empty | Host `APP_DOMAIN-is-not-set`: invalid (uppercase), so the API server rejects the Ingress and names the problem | — | YAML null: the rule loses its `host`, which makes it a **catch-all** for every hostname |
| Verified | With the real fluxcd/pkg/envsubst, in non-strict and strict modes | — | Reproduced the null host with the same library |
| **Verdict** | **Chosen**: fails closed, with a readable error | Rejected: doesn't exist in Flux | Rejected: silently exposes a catch-all |

## Probes: TCP liveness + `/api/health` readiness (chosen) vs. `/api/health` for both vs. `/` for both

| Criteria | Liveness `tcpSocket`, readiness `httpGet /api/health` with an 8s timeout (chosen) | `/api/health` for both | `/` for both |
| --- | --- | --- | --- |
| Depends on cms-api | Readiness only, and the route always returns 200 | Liveness too: a slow cms-api can time out the probe and restart the pod | `/` renders pages that call cms-api |
| Restart on a cms-api outage | No | Possible | Possible |
| NotReady on a hanging cms-api | No: the route aborts its cms-api call at 5s, and the probe waits 8s | Yes, at the default 1s timeout | Yes |
| **Verdict** | **Chosen**: restarts only when the server itself is gone | Rejected: couples restarts to cms-api | Rejected: heavy and coupled |

## Runtime config: one Secret via `envFrom` (chosen) vs. ConfigMap + Secret split

| Criteria | All runtime keys in the Secret (chosen) | Non-secret keys (`NEXT_ENV`, URLs) in a ConfigMap |
| --- | --- | --- |
| Objects the owner maintains | 1 | 2 |
| Precedent | cms-api's runtime Secret holds its URLs too | — |
| **Verdict** | **Chosen**: matches cms-api, one place for runtime values | Rejected: splits a handful of keys for little gain |

## Container port and Ingress placement

Like cms-admin: the port (3000, set in the image) is a literal, not a ConfigMap key, and the Ingress
sits in the base instead of a Component, because vm-prod is the only cluster. See
[cms-admin-flux-deployment-techstack.md](../../../cms-admin/docs/documents/cms-admin-flux-deployment-techstack.md)
for those tables.

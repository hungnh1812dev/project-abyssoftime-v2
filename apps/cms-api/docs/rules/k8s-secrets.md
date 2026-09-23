# k8s Secret and ConfigMap Rules

cms-api's deployment has two hand-made cluster inputs. Both are created by the user with
`kubectl`, never by an agent, and neither is ever committed with real values:

- **The Secret** `<app-name>-<app-service-name>-<app-env>-secrets` holds real, private runtime
  config (DB credentials, JWT signing keys, third-party API keys). The user fills a gitignored
  `apps/cms-api/k8s/.env*` file (e.g. `.env.local`) from the `k8s/.env.example` template and runs
  `kubectl create secret generic … --from-env-file`.
- **The ConfigMap** `<app-name>-<app-service-name>-<app-env>-config` holds project info (the
  `APP_*` keys) that Flux substitutes into `k8s/flux/app/`. The user fills a private copy of
  `k8s/config.env.example`.

Rules:

- **Never read, edit, create, or delete any `apps/cms-api/k8s/.env*` file other than
  `.env.example`** (covered by the global `.env*` rule too). Not even to check its current values,
  verify a fix, or "just look."
- **Never put real project values in the repo.** That covers `k8s/config.env.example`,
  `k8s/.env.example` and `k8s/flux/**`, which hold placeholders and `${APP_*}` only. The one
  exception is `<full-app-name>`, `<path-to-app-dir>` and `<initial-tag>` in
  `k8s/flux/kustomization.flux.yaml`, which stay placeholders here and are filled in by the user
  in the GitOps repo.
- **Never run `kubectl`, `helm` or `flux` against the real cluster.** That includes
  `kubectl apply --dry-run=client`, which still contacts the kubeconfig's API server. To test the
  templates, use `kubectl kustomize k8s/flux/app | envsubst '<APP_* list>'` with fake values and
  assert offline. When a change needs a cluster action (create or update the Secret or ConfigMap,
  `rollout restart`, `flux suspend`), tell the user the exact command instead.
- **A new, renamed or changed app env var** goes in both `apps/cms-api/k8s/.env.example` and
  `apps/cms-api/.env.example`. A new ConfigMap key goes in `k8s/config.env.example` and must be
  used as `${KEY}` in `k8s/flux/app/`. Tell the user which value to add to their Secret or
  ConfigMap, and to `rollout restart` after a Secret change.
- If a task seems to require touching the real env file or the cluster objects (e.g. "fix my
  DB_HOST"), stop and tell the user what needs to change and why. They update it themselves.

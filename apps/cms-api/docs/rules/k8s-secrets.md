# k8s Secret and ConfigMap Rules

cms-api's deployment has two hand-made cluster inputs. The user creates both with
`kubectl apply --server-side` from a filled-in, gitignored copy of a committed template. An agent never creates them, and
neither is ever committed with real values:

- **The Secret** `<app-name>-<app-service-name>-<app-env>-secrets` holds real, private runtime
  config (DB credentials, JWT signing keys, third-party API keys). The template is
  `k8s/secret.example.yaml`, and the filled copy is `k8s/secret.yaml` (gitignored).
- **The ConfigMap** `<app-name>-<app-service-name>-<app-env>-config` holds project info (the
  `APP_*` keys) that Flux substitutes into `k8s/flux/`. The template is
  `k8s/configmap.example.yaml`, and the filled copy is `k8s/configmap.yaml` (gitignored). Each
  cluster has its own, named in that cluster's app Kustomization
  (`clusters/abyssdev/<cluster>/abyssdev-apps-*.yaml`).

Rules:

- **Never read, edit, create, or delete the filled copies** `apps/cms-api/k8s/secret.yaml` and
  `apps/cms-api/k8s/configmap.yaml`, or any `apps/cms-api/k8s/.env*` file (the global `.env*`
  rule covers those too). Not even to check current values, verify a fix, or "just look."
- **Never put real project values in the repo.** That covers `k8s/secret.example.yaml`,
  `k8s/configmap.example.yaml` and `k8s/flux/**`, which hold `<placeholders>` and `${APP_*}`
  only. The cluster app Kustomizations in `clusters/abyssdev/*/` may only hold the literal ConfigMap
  name Flux needs to start from, plus `APP_IMAGE_TAG`. On `master` the tag is a placeholder; CI
  writes the real one on the `deployment` branch.
- **Never run `kubectl`, `helm` or `flux` against the real cluster.** That includes
  `kubectl apply --dry-run=client`, which still contacts the kubeconfig's API server. To test the
  templates, use `kubectl kustomize k8s/flux | envsubst '<APP_* list>'` with fake values and
  assert offline (PyYAML for the Secret/ConfigMap templates). When a change needs a cluster action
  (apply the Secret or ConfigMap, `rollout restart`, `flux reconcile`, point Flux at a branch),
  tell the user the exact command instead.
- **Secret template values** are quoted strings. Optional keys stay commented out: an empty `""`
  is not "unset" and fails `env.validation.ts` (e.g. `RATE_LIMIT_FPS: ""` → `0` → `@Min(1)`).
- **A new, renamed or changed app env var** goes in both `k8s/secret.example.yaml` and
  `apps/cms-api/.env.example`. A new ConfigMap key goes in `k8s/configmap.example.yaml` and must
  be used as `${KEY}` in `k8s/flux/`. Tell the user what to add to their filled copy, to
  re-apply it, and to `rollout restart` after a Secret change.
- If a task seems to require touching a filled copy or the cluster objects (e.g. "fix my
  DB_HOST"), stop and tell the user what needs to change and why. They update it themselves.

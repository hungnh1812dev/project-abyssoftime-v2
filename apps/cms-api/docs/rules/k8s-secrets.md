# k8s Secret File Rules

cms-api's real, private deployment secrets (DB credentials, JWT signing keys, third-party API keys)
live in `apps/cms-api/k8s/.env`, filled in by the user and never generated or filled in by an agent.
`helmfile.yaml.gotmpl` renders the k8s Secret from it. It is gitignored — see `apps/cms-api/.gitignore`.

- **Never read, edit, create, or delete `apps/cms-api/k8s/.env`** (covered by the global `.env*`
  rule too). Not even to check its current values, verify a fix, or "just look." To test the
  helmfile parsing, render against a fake env file somewhere else.
- `apps/cms-api/k8s/.env.example` is the committed template (placeholders only) and the only one an
  agent should edit. Any change to what env vars the app needs (new var, renamed var, changed
  default) goes in both it and `apps/cms-api/.env.example`.
- If a task seems to require touching `k8s/.env` (e.g. "fix my DB_HOST"), stop and tell the user
  what needs to change and why — they update it themselves.

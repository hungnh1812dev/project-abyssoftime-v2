# k8s Secret File Rules

cms-api's real, private deployment secrets (DB credentials, JWT signing keys, third-party API keys)
live in a gitignored `apps/cms-api/k8s/.env*` file (e.g. `.env.local`), filled in by the user and never
generated or filled in by an agent. The user exports it into the shell and `helmfile.yaml.gotmpl`
builds the k8s Secret from those env vars — it never reads the file itself.

- **Never read, edit, create, or delete any `apps/cms-api/k8s/.env*` file other than `.env.example`**
  (covered by the global `.env*` rule too). Not even to check its current values, verify a fix, or "just look." To test the
  helmfile render, export fake values (e.g. `env -i … helmfile template`).
- `apps/cms-api/k8s/.env.example` is the committed template (placeholders only) and the only one an
  agent should edit. Its key names are also the list helmfile puts in the Secret. Any change to what env vars the app needs (new var, renamed var, changed
  default) goes in both it and `apps/cms-api/.env.example`.
- If a task seems to require touching the real env file (e.g. "fix my DB_HOST"), stop and tell the user
  what needs to change and why — they update it themselves.

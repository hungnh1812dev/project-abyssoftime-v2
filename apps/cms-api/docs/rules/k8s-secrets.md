# k8s Secret File Rules

`apps/cms-api/k8s/secret.yaml` holds real, private deployment secrets (DB credentials, JWT
signing keys, third-party API keys) filled in by the user, never generated or filled in by an
agent. It is gitignored — see `apps/cms-api/.gitignore`.

- **Never read, edit, create, or delete `apps/cms-api/k8s/secret.yaml`.** Not even to check its
  current values, verify a fix, or "just look." Treat it exactly like a `.env` file.
- `apps/cms-api/k8s/secret.example.yaml` is the only file an agent should read or edit — it is
  the committed template, placeholders only, no real values. Any change to what env vars the
  Secret needs (new var, renamed var, changed default) belongs there, not in `secret.yaml`.
- If a task seems to require touching `secret.yaml` (e.g. "fix my DB_HOST"), stop and tell the
  user what needs to change and why — they update `secret.yaml` themselves.

# Implementation Plan: cms-admin + frontend on Flux (VPS only), vm-dev retired

Spec: [`SPEC.md`](../SPEC.md) · Tasks: [`tasks/todo.md`](todo.md) · Previous plan: [`tasks/archive.md`](archive.md)

## Overview

This plan follows the three spec modules in order: first `vps-only`, then `cms-admin-flux` and
`frontend-flux`. The last two don't depend on each other, but they run one after the other because
both edit `ci.yml` and `clusters/abyssdev/vm-prod/kustomization.yaml`.

Each app module is one vertical slice, built from the image outward:

1. The image builds and serves its health endpoint locally.
2. The k8s templates render.
3. The cluster Kustomization picks the app up.
4. CI publishes the image and bumps the tag.

After that come the workflow's clean-up steps (4 to 7 in `docs/workflow.md`): docs, review, and
reducing SPEC.md to a pointer.

## Dependency graph

```
T1 bump script extracted (behaviour-preserving)
 └─ T2 retire vm-dev (cms-api amd64-only, bump vm-prod only)
     ├─ T3 Render/Vercel → staging            (independent of T4+, touches ci.yml only)
     │
     ├─ T4 cms-admin image ─ T5 cms-admin templates ─ T6 cms-admin cluster wiring ─ T7 cms-admin CI
     │
     └─ T8 frontend image ─ T9 frontend templates ─ T10 frontend cluster wiring ─ T11 frontend CI
                                                     (after T6: same kustomization.yaml)
T12 cms-api docs ── after T2/T3
T13 cms-admin + frontend docs ── after T7, T11
T14 review → T15 SPEC.md reduction + cleanup
```

## Architecture decisions

These are all settled in the spec, and the full tables are in SPEC.md's Decisions section:

- **Bump script:** one script, `.github/scripts/bump-flux-tag.sh <app> <tag> <file>:<arch>...`, with a
  concurrency group per app. T1 extracts it without changing any behaviour, so the dry-run harness can
  check it against the current inline script before anything else changes.
- **Arch suffix:** `-amd64` stays on every tag.
- **Tag files:** one vm-prod app file per app, each with exactly one `APP_IMAGE_TAG:` line.
- **Ingress:** the new apps put it straight in their base manifests, with no Component.
- **cms-admin API URL:** a build arg from the `CMS_ADMIN_API_URL` repo variable.
- **frontend image:** standalone output behind `NEXT_OUTPUT=standalone`, so Vercel builds don't
  change, on a `node:24-alpine` non-root runner. It gets no real secrets at build time.
- **Open question 3 default:** the frontend Secret template recommends the in-cluster cms-api Service
  URL for `CMS_API_URL`/`GRAPHQL_URL`. It's only a comment, so the owner can override it.

## Phases

- **Phase 1 — `vps-only`** (T1–T3), then Checkpoint 1: commit.
- **Phase 2 — `cms-admin-flux`** (T4–T7), then Checkpoint 2: commit.
- **Phase 3 — `frontend-flux`** (T8–T11), then Checkpoint 3: commit.
- **Phase 4 — docs, review and clean-up** (T12–T15), then Checkpoint 4: commit.

Commits are batched per phase, as the workflow's commit rules require. Each commit needs a Yes/No
confirmation with the file list and message, and no `Co-Authored-By`.

## Verification tooling

Everything runs locally. The scripts live in the session scratchpad and are never committed.

| Tool | Status | Used for |
| --- | --- | --- |
| `kubectl kustomize` | installed | offline renders only, never against a cluster |
| `envsubst` | installed | Flux postBuild substitution check |
| `python3` + PyYAML | installed | assert scripts for cluster files, templates and the `ci.yml` diff |
| `docker` | installed | local image builds and smoke runs. Images build natively as arm64 on this Mac, and CI builds amd64. The Dockerfiles are arch-neutral. |
| `shellcheck` | **not installed** | `bash -n` is the required check. shellcheck runs only if the owner installs it; it's not a gate. |
| Bump harness | from the last spec | re-created in the scratchpad: throwaway bare origin with `master` and `deployment`, BSD sed |

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Moving the bump script changes behaviour and breaks cms-api deploys | High | T1 is behaviour-only. The dry-run harness runs the old inline block and the new script against the same fixture and compares the resulting `deployment` trees and commits before T2 starts. |
| frontend `next build` fails on `oven/bun:1-alpine`: musl native binaries (lightningcss, sharp, SWC), `reactCompiler` babel, or a network font fetch | Med | T8 builds it locally first. The fallbacks, in order: `oven/bun:1` (Debian) builder, then `node:24-alpine` for the builder with `bun` installed. Either one gets recorded as a spec decision change. |
| Standalone tracing misses files in the Bun `node_modules` layout, and the container crashes at runtime | Med | T8 smoke-runs the image and hits `/api/health` plus one locale page, not just `docker build`. |
| `output: "standalone"` leaks into Vercel builds | Med | It's enabled only by `NEXT_OUTPUT`. T8 checks that a plain `bun run build` creates no `.next/standalone`. |
| `.env.local` in `apps/frontend` gets copied into the image | High | `.dockerignore` excludes `.env*`. T8 lists the image filesystem (`ls -a` on `/app`) and asserts no `.env*` file. The agent never opens `.env.local` itself. |
| One GitHub concurrency group drops a pending bump for another app | Med | Groups are per app (spec decision). T11's `ci.yml` assert checks that the three group names differ. |
| cms-admin `tsc -b` inside Docker behaves differently from local | Low | T4 builds the image, and `bun run build` passes locally first. |
| `deployment` still has vm-dev files after the owner merges, and Flux on the old VM keeps reconciling | Low | This is an owner step in the spec (merge and delete vm-dev on `deployment`, then `flux uninstall` on the VM). The bump no longer targets vm-dev, so no CI failure depends on it. |
| cms-admin login breaks on `admin.<domain>` because of CORS or cookies | Med (live only) | Owner steps 2 and 5 in the spec. The docs in T13 spell out the exact CORS origins. It's verified manually after the deploy, since it can't be checked offline. |

## Parallelization

T3 can run alongside T4–T11, since it's one `ci.yml` hunk. Phase 2 and Phase 3 run sequentially on
purpose, because both edit `ci.yml` and the same cluster `kustomization.yaml`. One agent does it all,
so nothing is gained by parallelizing.

## Open questions (from SPEC.md; none block tasks)

1. Is the bare `<domain>` on Vercel production now? This only affects the owner's cutover step and the
   docs in T13.
2. Stray `apps/abyssdev-cms-api-prod/`: T12 asks the owner whether to delete it (ask first) and leaves
   it if the answer is no.
3. frontend's cms-api URL: the default above is used in T10.

# Workflow Rules

Repo-wide — applies to every app (`apps/cms-api`, `apps/cms-admin`, `apps/frontend`) unless that
app's own `docs/rules/*` overrides a specific point.

## Feature workflow

For any new feature/page/module:

1. **Spec** — write the spec first.
2. **Build (plan)** — override old `tasks/todo.md` and `tasks/plan.md` with the new task breakdown.
3. **Build (execute)** — implement in multiple steps, verifying as you go.
4. **Update spec** — reflect the final state in `/docs/specs/*`.
5. **Update docs/rules** — reflect the final state in `/docs/documents/*`. If the feature adds a new endpoint, also update the Swagger doc. If the change adds, changes, or removes a rule, also update the relevant `docs/rules/*` file (the working app's own if the rule is app-specific, or the repo-root `docs/rules/*`/`docs/workflow.md` if it's shared across apps).
6. **Review** — conduct a five-axis code review: correctness, readability, architecture, security, performance.
7. **Clean up** — delete the completed spec from `/specs/*.md`, must be run after Review complete.
8. **Complete** — workflow done.

### `[CAREFUL]` features

- If a feature's request/spec is tagged `[CAREFUL]`, use the Opus model for the **Spec**, **Build (plan)** and **Review** phases.
- Use the Sonnet model for all other phases (Spec, Build (execute), Update spec, Update docs, Clean up).

## Module rules

- Build each feature as its own module (same convention as `src/modules/*`).
- A module file must be **max 500 lines**. If it grows past that, break it into smaller files.
- Each module must be independent of other modules (no tight coupling between module internals).
- When adding a new feature, minimize its effect/coupling on existing modules/features — prefer new files/modules and additive changes (new ports, new adapters) over editing shared internals of unrelated modules.

## Root docs

- Each app's `SPEC.md`/`CLAUDE.md` — and the repo root's `SPEC.md`/`CLAUDE.md` — only contain guidance pointing to module/rule files, not the module or rule details themselves.
- Keep `SPEC.md` as small as possible: once a feature's details are fully captured in `/docs/documents/*`, remove that feature's section from `SPEC.md` rather than letting it accumulate already-documented content.

## Decision rationale

- Whenever a task involves choosing among multiple viable tech-stack options, libraries, patterns, or designs, show a comparison table (options vs. criteria — fit for this repo, complexity, maintenance cost, existing precedent, etc.) explaining why the chosen option wins over the alternatives, not just a one-line justification.
- Save that comparison table to `docs/documents/<module-name>-techstack.md` (one file per module the decision belongs to) rather than leaving it only in conversation or buried in the spec/plan.

## Commit rules

- Always ask the user before committing — never run `git commit` without explicit confirmation for that commit. Confirmation means showing the exact staged file list and the full commit message and getting a yes on that — agreeing to a commit _strategy_ (e.g. how many commits, how they're grouped) is not the same as confirming the commit itself.
- Ask that confirmation as an actual Yes/No question (e.g. via the question-asking tool), not a free-text prompt — the user should be able to select an option instead of having to type "yes"/"y"/etc.
- Always remove `Co-Authored-By` from commit messages.
- Reference the `/git-commit` skill for commit message format.
- During `/build`, don't commit after every single spec/task file — batch commits at feature/checkpoint boundaries (e.g. a "Checkpoint" line in `tasks/plan.md`/`tasks/todo.md`, or a full Phase) instead. Still verify (tests, build) after each task; only the commit frequency is batched.
- Checkpoint commit timing: if a checkpoint is automatically verifiable (e.g. `test:cov`/`build`/`lint` passing), commit once that checkpoint's automated checks pass. If a checkpoint requires manual verification (e.g. a live app/DB walkthrough) that can't be done headlessly, commit as soon as the last task _before_ that checkpoint is complete — don't hold the commit open waiting on manual verification that may not happen for a while.

## Test coverage

- `coverageThreshold` in `package.json` is a per-path whitelist: add an entry (`"branches": 80`) only when a file/folder gets a dedicated spec suite — don't switch to a `global` threshold + exclude-list model (Jest's `coverageThreshold` keys are inclusion globs only; there's no negation syntax).
- Do not add `coverageThreshold` entries for Prisma service/repository files or controller (`presentation/*.controller.ts`) files, even once they have spec files with high branch coverage.

## Formatting

- All changed `.js`, `.ts`, `.tsx` files must be run through Prettier before testing or committing.

## Linting

- Always lint via `bun run lint` — never invoke `eslint` directly (e.g. `bunx eslint .`, `bunx eslint <glob>`). The project's own script is already correctly scoped and finishes in ~5-10s; ad-hoc `eslint .` invocations re-run type-aware checking across the whole repo and can take 10+ minutes, pegging a CPU core the whole time.

## Naming convention

- Use clear, unambiguous names.

## Unclear issues

- If a requirement or issue is unclear, always ask the user before proceeding.

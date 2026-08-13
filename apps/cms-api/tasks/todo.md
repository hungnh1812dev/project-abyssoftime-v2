# Todo — Additional Email Providers (Resend, Brevo, SendGrid)

See `tasks/plan.md` for full context, architecture decisions, and risks. See `SPEC.md` for the spec
(objective, confirmed assumptions, boundaries, success criteria).

**Plan awaiting review.** One open item carries into implementation: whether any provider needs more
than a single API key (`tasks/plan.md` Open Questions #1), resolved per-provider as each sender is
built, not guessed up front. Brevo's exact SDK shape (Open Questions #2) is unverified — T4 must
confirm it against real docs/types before writing code.

## Phase 1 — Resend (first vertical slice, establishes the pattern)

- [x] **T1 — Resend env vars + dependency.** Add `RESEND_API_KEY: string = ""` to
  `env.validation.ts`; extend the `EMAIL_PROVIDER` type/comment to include `"resend"`. Add
  `RESEND_API_KEY=` under the existing Email Sender section of `.env.example`, and update its
  `EMAIL_PROVIDER` comment to list `resend`. Install the `resend` package.
  - Acceptance: app boots with `RESEND_API_KEY` unset (defaults to `""`, no validation error);
    `EMAIL_PROVIDER=resend` passes env validation; `resend` appears in `package.json` `dependencies`.
  - Verify: `bun install && bun run build`.
  - Files: `src/config/env.validation.ts`, `.env.example`, `package.json`, `bun.lock`
  - Deps: none. Size: S

- [x] **T2 — `ResendEmailSender` + `resolve-email-sender.ts` wiring.** New class implementing
  `IEmailSender` (`sendOtpEmail`, `sendPasswordResetEmail`) per `SPEC.md`'s Code Style example:
  constructs a `Resend` client from `RESEND_API_KEY`, reads `EMAIL_FROM`/`FRONTEND_URL` from
  `ConfigService` in the constructor, calls `templateRenderer.renderOtpEmail`/
  `renderPasswordResetEmail` for HTML, sends via the SDK's `emails.send()`. Wire it into
  `resolveEmailSender`: explicit `EMAIL_PROVIDER === "resend"` branch, and insert into `"auto"`
  between the existing `SMTP_HOST` check and the console fallback (checks `RESEND_API_KEY`).
  - Acceptance: `EMAIL_PROVIDER=resend` resolves to `ResendEmailSender`; `sendOtpEmail`/
    `sendPasswordResetEmail` call the SDK with the renderer's HTML output verbatim as `html`, correct
    `to`/`from`/`subject`; constructing `ConsoleEmailSender`/`SmtpEmailSender`/`GmailApiEmailSender`
    (i.e. any other provider selected) never constructs a `Resend` client, even with
    `RESEND_API_KEY` unset; `"auto"` with no provider env vars set still falls through to
    `ConsoleEmailSender` exactly as today.
  - Verify: `bun run test` — new `resend-email.sender.spec.ts` (mocked `Resend` client, same pattern
    as `smtp-email.sender.spec.ts`'s mocked `MailerService`); extend `resolve-email-sender.spec.ts`
    with the new branch + auto-order cases. `bun run lint`.
  - Files: `src/modules/auth/infrastructure/email/resend-email.sender.ts`,
    `src/modules/auth/infrastructure/email/resend-email.sender.spec.ts`,
    `src/modules/auth/infrastructure/email/resolve-email-sender.ts`,
    `src/modules/auth/infrastructure/email/resolve-email-sender.spec.ts`
  - Deps: T1. Size: M

- [ ] **Checkpoint A** — `bun run build && bun run lint && bun run test:cov` all green.
  `EMAIL_PROVIDER` unset/`smtp`/`gmail`/`console` behave identically to before this phase (no
  regression). **Manual:** set a real `RESEND_API_KEY` + `EMAIL_PROVIDER=resend` locally, trigger
  register/resend-OTP and forgot-password, confirm both emails actually arrive with correct content.
  Commit.
  - Automated portion done 2026-08-13 (build/lint/test:cov green, 149 suites / 1081 tests, no
    regressions in the pre-existing provider paths). **Manual send test deferred** — not yet run
    against a real `RESEND_API_KEY`. Revisit before considering Resend production-ready.

## Phase 2 — Brevo

- [x] **T3 — Brevo env vars + dependency.** Add `BREVO_API_KEY: string = ""` to `env.validation.ts`;
  extend `EMAIL_PROVIDER` to include `"brevo"`. Add `BREVO_API_KEY=` to `.env.example`, update the
  `EMAIL_PROVIDER` comment. Install `@getbrevo/brevo`.
  - Acceptance: same shape as T1 — boots with the key unset, `EMAIL_PROVIDER=brevo` validates,
    dependency installed.
  - Verify: `bun install && bun run build`.
  - Files: `src/config/env.validation.ts`, `.env.example`, `package.json`, `bun.lock`
  - Deps: none (parallel with T1/T2). Size: S

- [x] **T4 — `BrevoEmailSender` + `resolve-email-sender.ts` wiring.** **Before writing code**, verify
  the real `@getbrevo/brevo` v6.0.3 client/method shape against its shipped TypeScript types
  (`node_modules/@getbrevo/brevo`) or official docs — `tasks/plan.md`'s Context section flags the
  shape used in `SPEC.md` as an unverified AI summary, not a confirmed fact. Then implement
  `BrevoEmailSender` implementing `IEmailSender`, same constructor/render/send shape as
  `ResendEmailSender`. Wire into `resolveEmailSender`: explicit `"brevo"` branch, and insert into
  `"auto"` between the `resend` check and the console fallback (checks `BREVO_API_KEY`).
  - Acceptance: same acceptance shape as T2, substituting Brevo; explicit regression check that the
    Resend branch/tests from T2 are unmodified and still pass.
  - Verify: `bun run test` — new `brevo-email.sender.spec.ts` (mocked Brevo client); extend
    `resolve-email-sender.spec.ts`. `bun run lint`.
  - Files: `src/modules/auth/infrastructure/email/brevo-email.sender.ts`,
    `src/modules/auth/infrastructure/email/brevo-email.sender.spec.ts`,
    `src/modules/auth/infrastructure/email/resolve-email-sender.ts`,
    `src/modules/auth/infrastructure/email/resolve-email-sender.spec.ts`
  - Deps: T2 (same file), T3. Size: M

- [ ] **Checkpoint B** — same as Checkpoint A, for Brevo, plus explicit regression: Resend path
  (Checkpoint A's manual send) still works unmodified. Commit.
  - Automated portion done 2026-08-13 (build/lint/test:cov green, 150 suites / 1095 tests, no
    regressions — `resend-email.sender.ts`/`resolve-email-sender.ts` untouched by Phase 2's code).
    **Manual send tests deferred** — neither the Resend regression send nor a real Brevo send
    (`BREVO_API_KEY` + `EMAIL_PROVIDER=brevo`) has been run yet. Revisit before Brevo is considered
    production-ready.

## Phase 3 — SendGrid

- [ ] **T5 — SendGrid env vars + dependency.** Add `SENDGRID_API_KEY: string = ""` to
  `env.validation.ts`; extend `EMAIL_PROVIDER` to include `"sendgrid"`. Add `SENDGRID_API_KEY=` to
  `.env.example`, update the `EMAIL_PROVIDER` comment (now lists all 6 values). Install
  `@sendgrid/mail`.
  - Acceptance: same shape as T1/T3.
  - Verify: `bun install && bun run build`.
  - Files: `src/config/env.validation.ts`, `.env.example`, `package.json`, `bun.lock`
  - Deps: none (parallel with T1–T4). Size: S

- [ ] **T6 — `SendGridEmailSender` + `resolve-email-sender.ts` wiring (final `"auto"` order).**
  Implements `IEmailSender` using `@sendgrid/mail`'s confirmed pattern: `sgMail.setApiKey(...)` at
  construction, `sgMail.send({ to, from, subject, html })` per send call. Wire into
  `resolveEmailSender`: explicit `"sendgrid"` branch, and insert into `"auto"` between the `brevo`
  check and the console fallback (checks `SENDGRID_API_KEY`) — this completes the final order
  `gmail → smtp → resend → brevo → sendgrid → console`.
  - Acceptance: same acceptance shape as T2/T4, substituting SendGrid; explicit regression check that
    Resend and Brevo branches/tests are unmodified; full `"auto"` chain tested end-to-end (each of
    the 6 env-var combinations resolves to the expected sender class).
  - Verify: `bun run test` — new `sendgrid-email.sender.spec.ts` (mocked `sgMail`); extend
    `resolve-email-sender.spec.ts` with the full 6-branch auto-order matrix. `bun run lint`.
  - Files: `src/modules/auth/infrastructure/email/sendgrid-email.sender.ts`,
    `src/modules/auth/infrastructure/email/sendgrid-email.sender.spec.ts`,
    `src/modules/auth/infrastructure/email/resolve-email-sender.ts`,
    `src/modules/auth/infrastructure/email/resolve-email-sender.spec.ts`
  - Deps: T4 (same file), T5. Size: M

- [ ] **Checkpoint C** — same as B, for SendGrid, plus regression: Resend and Brevo paths both still
  work unmodified. All three provider-specific `SPEC.md` success criteria now met. Commit.

## Phase 4 — Docs, review, cleanup (`docs/rules/workflow.md` steps 4–8)

- [ ] **T7 — New/updated techstack docs.** `docs/documents/auth-email-providers-techstack.md` (new)
  — the official-SDK-vs-raw-fetch comparison table from `SPEC.md`'s Tech Stack section, plus any
  provider-specific integration notes discovered during T2/T4/T6 (e.g. the real Brevo shape).
  `docs/documents/auth-email-techstack.md` — add Resend/Brevo/SendGrid rows to the existing provider
  comparison.
  - Verify: both files exist and are linked from `docs/ENTRYPOINT.md`.
  - Files: `docs/documents/auth-email-providers-techstack.md`,
    `docs/documents/auth-email-techstack.md`, `docs/ENTRYPOINT.md`
  - Deps: T6. Size: S

- [ ] **T8 — Update `auth.md` + repo-wide stale-provider-list sweep.** Rewrite `auth.md`'s
  email-sending section to list all 6 providers and the final `"auto"` order. Then **grep the whole
  repo** for `"gmail" | "smtp" | "console"` and similar enumerations (`.env.example` comments already
  done in T1/T3/T5 — verify here; `docs/api-reference.md`/`docs/cms-admin-integration.md` only if
  either mentions `EMAIL_PROVIDER`) and fix every stale list — a fixed file list is exactly what went
  wrong in the JWT Bearer migration closeout.
  - Verify: `grep -rn 'EMAIL_PROVIDER' docs/ .env.example` — every hit lists all 6 values.
  - Files: `docs/documents/auth.md`, `docs/api-reference.md` (if applicable),
    `docs/cms-admin-integration.md` (if applicable)
  - Deps: T7. Size: S–M

- [ ] **T9 — Five-axis review** (correctness, readability, architecture, security, performance) via
  `agent-skills:code-reviewer`. Security axis must explicitly cover: no API key ever logged (request
  bodies, error messages); a sender for a non-selected provider is never constructed or called;
  send failures propagate rather than being silently swallowed; the three new SDKs are inert with no
  network activity when their provider isn't selected.
  - Verify: findings triaged; anything Critical/Important fixed and re-verified.
  - Deps: T8. Size: S

- [ ] **T10 — Cleanup.** Reduce `SPEC.md` back to a pointer at `docs/documents/auth-email.md` (or
  wherever the final content lands), per `docs/rules/workflow.md`'s root-docs rule.
  - Files: `SPEC.md`
  - Deps: T9. Size: XS

- [ ] **Checkpoint D (final)** — Re-verify every success criterion in `SPEC.md` against the shipped
  code, not against this checklist. `bun run build && bun run lint && bun run test:cov` green. Commit.

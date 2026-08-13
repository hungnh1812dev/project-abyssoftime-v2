# Plan: Additional Email Providers (Resend, Brevo, SendGrid)

See `SPEC.md` for the full spec (objective, confirmed assumptions, boundaries, success criteria).
This plan implements it as three near-identical vertical slices (one per provider) plus a docs phase.

## Context

`cms-api` sends OTP/password-reset email via `IEmailSender`, currently backed by Gmail API, SMTP
(`nodemailer`), or a Console dev fallback, selected by `EMAIL_PROVIDER` (`resolve-email-sender.ts`).
This plan adds three more interchangeable senders — Resend, Brevo, SendGrid — using each vendor's
official Node SDK, with zero change to `IEmailSender`, the Handlebars template renderer, or any
`application/services/*` caller (SPEC.md Assumptions 2–3).

Because all three providers are structurally identical (one SDK client, two send calls, same
`IEmailSender` shape), the highest-risk unknown isn't architecture — it's whether the *exact* SDK
call signature assumed for Brevo (`@getbrevo/brevo` v6.0.3) is correct. A pre-planning doc check
confirmed SendGrid's `sgMail.setApiKey()` / `sgMail.send({to, from, subject, html})` pattern matches
SPEC.md's assumption, but the Brevo v6 client shape returned by that check (`new BrevoClient({apiKey})`
+ `brevo.transactionalEmails.sendTransacEmail(...)`) came from an AI-summarized README, not a
first-hand read of the SDK's type definitions — **not trusted as fact**. T4 (Brevo) must verify the
real shape against `node_modules/@getbrevo/brevo`'s types or official docs before writing code
(`source-driven-development`), not copy the summary verbatim.

## Corrections found during planning (supersede SPEC.md)

None. SPEC.md's assumptions all held up against the codebase read during spec-writing; no
architectural surprises found while planning (unlike the token-blacklist feature's Prisma-schema
correction — this feature touches no schema).

## Architecture Decisions

- **Each sender is constructed lazily inside `resolveEmailSender`'s branches**, exactly like
  `GmailApiEmailSender`/`SmtpEmailSender`/`ConsoleEmailSender` today — never instantiated unless its
  `EMAIL_PROVIDER` value (or "auto" match) actually selects it. This is what keeps an unset
  `RESEND_API_KEY`/`BREVO_API_KEY`/`SENDGRID_API_KEY` inert when a different provider is active
  (SPEC.md's "Never do" boundary) — no code needs to special-case "key missing," construction simply
  never happens.
- **Send failures propagate uncaught**, matching `SmtpEmailSender`/`GmailApiEmailSender` today (no
  try/catch swallowing in either). A thrown SDK error bubbles up through `IEmailSender` to the
  calling service (`register`/`resend-otp`/`forgot-password`), which already handles/logs errors the
  same way regardless of which sender threw.
- **`EMAIL_FROM` is read once in each sender's constructor**, same pattern `SmtpEmailSender` uses for
  `FRONTEND_URL` — no new "from" env var (SPEC.md Assumption 5).
- **`"auto"` fallthrough is built up incrementally, one provider at a time**, so the chain is always
  in a shippable, correctly-ordered state at every checkpoint: Phase 1 adds `resend` between the
  existing `smtp` check and the `console` fallback; Phase 2 inserts `brevo` between `resend` and
  `console`; Phase 3 inserts `sendgrid` between `brevo` and `console`. Final order (confirmed):
  `gmail → smtp → resend → brevo → sendgrid → console`.
- **Official SDKs, not raw `fetch`** — decision table already in `SPEC.md`'s Tech Stack section; not
  repeated here. The comparison gets persisted to `docs/documents/auth-email-providers-techstack.md`
  in Phase 4 (T7) per `docs/rules/workflow.md`'s decision-rationale rule.

## Dependency Graph

```
T1 Resend env vars + dependency
 └─→ T2 ResendEmailSender + resolve-email-sender wiring (auto: …→resend→console)
        │
T3 Brevo env vars + dependency (parallel with T1/T2)
        │
        └─→ T4 BrevoEmailSender + resolve-email-sender wiring (auto: …→resend→brevo→console)
               — depends on T2 (same file, sequential edit) and T3
               │
T5 SendGrid env vars + dependency (parallel with T1–T4)
        │
        └─→ T6 SendGridEmailSender + resolve-email-sender wiring (auto: final order)
               — depends on T4 (same file, sequential edit) and T5
               │
               └─→ T7 techstack docs → T8 auth.md + stale-wording sweep → T9 five-axis review → T10 cleanup
```

Env-var/dependency tasks (T1, T3, T5) are independent of each other and could run in parallel; the
sender-implementation tasks (T2, T4, T6) are forced sequential because they all edit
`resolve-email-sender.ts`. Each provider phase ships a fully working, independently-verifiable slice
— Resend works end-to-end before Brevo is even started, matching the vertical-slicing goal and
keeping the blast radius of any one provider's SDK surprises contained to its own phase.

## Task List

### Phase 1 — Resend (first vertical slice, establishes the pattern)

- **T1** — Resend env vars + dependency. S
- **T2** — `ResendEmailSender` + `resolve-email-sender.ts` wiring. M

**Checkpoint A** — `bun run build && bun run lint && bun run test:cov` green. `EMAIL_PROVIDER=smtp`
(or unset) still behaves identically to today. Manual: set a real `RESEND_API_KEY` +
`EMAIL_PROVIDER=resend` locally, confirm one OTP email and one password-reset email actually arrive.
Commit.

### Phase 2 — Brevo

- **T3** — Brevo env vars + dependency. S
- **T4** — `BrevoEmailSender` + `resolve-email-sender.ts` wiring. Verify the real `@getbrevo/brevo`
  v6 client/method shape first (source-driven-development) — do not assume the shape from SPEC.md's
  placeholder. M

**Checkpoint B** — same as Checkpoint A, for Brevo, plus regression: Resend path from Checkpoint A
still passes unmodified. Commit.

### Phase 3 — SendGrid

- **T5** — SendGrid env vars + dependency. S
- **T6** — `SendGridEmailSender` + `resolve-email-sender.ts` wiring (final `"auto"` order). M

**Checkpoint C** — same as B, for SendGrid, plus regression: Resend and Brevo paths still pass. All
three provider-specific `SPEC.md` success criteria now met. Commit.

### Phase 4 — Docs, review, cleanup (`docs/rules/workflow.md` steps 4–8)

- **T7** — `docs/documents/auth-email-providers-techstack.md` (new — SDK-vs-raw-fetch decision
  table) + `docs/documents/auth-email-techstack.md` (add Resend/Brevo/SendGrid rows). S
- **T8** — Update `docs/documents/auth.md` (email-sending section lists all 6 providers) + grep the
  repo for any other place enumerating `gmail`/`smtp`/`console` as "the" provider list (e.g.
  `.env.example` comments, `docs/api-reference.md` if it mentions `EMAIL_PROVIDER`) and update those
  too — a fixed file list is exactly what went wrong in the JWT Bearer migration closeout. S–M
- **T9** — Five-axis review (correctness, readability, architecture, security, performance) via
  `agent-skills:code-reviewer`. Security axis must explicitly cover: no API key ever logged; a sender
  for an unselected provider is never constructed/called; send failures aren't silently swallowed. S
- **T10** — Cleanup: reduce `SPEC.md` back to a pointer at the new docs, per
  `docs/rules/workflow.md`'s root-docs rule. XS

**Checkpoint D (final)** — every success criterion in `SPEC.md` re-verified against shipped code
(not against this checklist); `build`/`lint`/`test:cov` green; review findings resolved. Commit.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Assumed Brevo SDK shape (from an AI-summarized README, not first-hand) is wrong | Med (wasted rewrite in T4) | T4 explicitly requires verifying the real `@getbrevo/brevo` v6 types/docs before writing code, not copying SPEC.md's placeholder |
| A vendor SDK's client constructor eagerly validates/network-calls on an empty API key | Med (would break other providers when that key is unset) | Lazy construction inside `resolveEmailSender`'s branches (Architecture Decisions) — never constructed unless selected; Checkpoint A/B/C explicitly test the non-selected case |
| Real vendor sends can't run in CI (need live API keys, cost money/quota) | Low | No e2e changes (SPEC.md); manual verification per provider at each checkpoint instead |
| Trial/sandbox vendor accounts rate-limit or require sender-domain verification, making manual checks flaky | Low–Med | Use each vendor's test/sandbox mode where available; budget time for domain verification before Checkpoint A/B/C, not during |
| `"auto"` order change is unreachable in practice (needs *no* `SMTP_HOST`/`GMAIL_CLIENT_ID` but a new key set) so gets under-tested | Low | Each checkpoint explicitly tests both the new-provider-selected path and the "nothing changed for existing deployments" regression |
| Docs elsewhere still describe only 3 providers | Med (docs actively incomplete) | T8 is a repo-wide grep sweep, not a fixed file list — same lesson recorded from the token-blacklist closeout |

## Notes found during implementation

- **T2:** `resend`'s SDK (`resend.emails.send()`) does not throw on API failure — it resolves
  `{ data: null, error: {...} }` instead, unlike `MailerService`/`GmailApiEmailSender` which throw.
  SPEC.md's Code Style example didn't check the `error` field. `ResendEmailSender` now checks
  `error` and throws explicitly, to preserve the "send failures propagate uncaught" architecture
  decision. Worth checking whether Brevo/SendGrid's SDKs have the same resolve-not-throw shape when
  T4/T6 verify their real client types.

## Open Questions

1. Whether any of the three providers needs more config than a single API key (SPEC.md's one
   remaining open item) — resolved per-provider at T2/T4/T6 against each SDK's actual minimal send
   call, not guessed here.
2. ~~Brevo's exact client/method shape (see Context) — resolved at T4, not before.~~ **Resolved at
   T4**: `@getbrevo/brevo@6.0.3` ships a Fern-generated SDK. Verified against its shipped `.d.mts`
   types (not the AI-summarized README): `new BrevoClient({ apiKey })` and
   `client.transactionalEmails.sendTransacEmail({ sender: { email }, to: [{ email }], subject,
   htmlContent })`, matching SPEC.md's original assumption. `sendTransacEmail` returns an
   `HttpResponsePromise<T>` (a `Promise<T>` subclass — `await` resolves the parsed body directly, no
   `.data` unwrap needed) and rejects with a `BrevoError`/`BrevoTimeoutError` on failure, so no
   `{data, error}` conversion is needed — errors propagate uncaught exactly like
   `SmtpEmailSender`/`GmailApiEmailSender`, unlike `ResendEmailSender`'s explicit throw.

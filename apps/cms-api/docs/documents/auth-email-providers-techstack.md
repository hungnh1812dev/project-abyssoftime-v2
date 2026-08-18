# Auth Email Sender — Resend/Brevo/SendGrid SDK Decision

Decision rationale for the three `IEmailSender` implementations added in the 2026-08-13 iteration
(`ResendEmailSender`, `BrevoEmailSender`, `SendGridEmailSender`), per repo root `docs/workflow.md`'s
decision-rationale rule. See `docs/documents/auth-email-techstack.md` for the original
Gmail/SMTP/Console provider comparison these three sit alongside.

## Options considered

| Option | Fit for this repo | Complexity | Maintenance | Precedent |
|---|---|---|---|---|
| **Official SDKs** (`resend`, `@getbrevo/brevo`, `@sendgrid/mail`) | High — typed request/response shapes, matches how `nodemailer` is already wrapped | Low — each is a thin `new Client(apiKey).send(...)` call | Vendor-maintained, follows their API changes | `@nestjs-modules/mailer`/`nodemailer` already used for SMTP |
| Raw `fetch` per provider | Low — three different REST/auth/error shapes to hand-roll and keep in sync with each vendor's docs | Higher — no typed request/response, manual retry/error handling | We own all API-drift risk | `GmailApiEmailSender` uses raw `fetch` (chosen there for a narrow OAuth2 flow, not a general precedent) |

## Chosen: official SDKs

Official SDKs win: lower complexity, and the "raw fetch" precedent (Gmail) was a one-off necessity
(OAuth2 token flow), not a repo-wide preference. All three ship maintained, typed clients — raw HTTP
would mean hand-rolling request/error shapes for three different APIs with no upstream benefit.

**Trade-off:** each SDK is a new vendor-specific dependency; switching a provider's transport later
means a code change (a new `IEmailSender` implementation), not just config. Acceptable — the whole
point of the `IEmailSender` port is that this cost is paid once per provider, not once per caller.

## Provider-specific integration notes

Discovered verifying each SDK's real shape against its shipped types (`source-driven-development`),
not the AI-summarized shapes `SPEC.md` started from:

- **Resend (`resend`)** — `resend.emails.send()` does **not** throw on API failure; it resolves
  `{ data: null, error: {...} }` instead, unlike the other four senders. `ResendEmailSender` checks
  `error` and throws explicitly, to preserve the repo-wide "send failures propagate uncaught"
  contract (`Architecture Decisions` in `tasks/plan.md`).
- **Brevo (`@getbrevo/brevo@6.0.3`)** — ships a Fern-generated SDK: `new BrevoClient({ apiKey })` and
  `client.transactionalEmails.sendTransacEmail({ sender: { email }, to: [{ email }], subject,
  htmlContent })`. `sendTransacEmail` returns an `HttpResponsePromise<T>` (a `Promise<T>` subclass —
  `await` resolves the parsed body directly, no `.data` unwrap needed) and rejects with a
  `BrevoError`/`BrevoTimeoutError` on failure — errors propagate uncaught, matching
  `SmtpEmailSender`/`GmailApiEmailSender`, unlike Resend's resolve-not-throw shape.
- **SendGrid (`@sendgrid/mail@8.1.6`)** — `index.d.ts` confirms `export = mail`: the package exports a
  module-level singleton `MailService` instance, not a constructor (unlike `Resend`/`BrevoClient`).
  `SendGridEmailSender` calls `sgMail.setApiKey(...)` in its constructor instead of `new`-ing a
  client. `sgMail.send()` traces through `@sendgrid/client`'s `axios(...).catch(error =>
  reject(...))` — it rejects on API failure, so no explicit error-checking is needed, same as Brevo.
  **Test gotcha:** because `@sendgrid/mail` exports a singleton object rather than a class, mocking it
  by referencing an outer `const mockFn = jest.fn()` directly inside the `jest.mock(...)` factory hits
  Jest's mock-hoisting TDZ (the factory runs before the outer `const` initializes) — this only
  surfaces under real Jest (`bun run test`/`test:cov`), not Bun's own test runner (`bun test`), so
  always verify with the former. Fixed by declaring the mocks inline inside the factory and obtaining
  typed handles afterward via `jest.mocked(sgMail.setApiKey)`/`jest.mocked(sgMail.send)`.

All three senders are constructed lazily inside `resolveEmailSender`'s branches, so an unset API key
is inert unless that provider is actually selected — see `tasks/plan.md`'s Architecture Decisions for
the full rationale.

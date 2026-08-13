# Spec: Additional Email Providers (Resend, Brevo, SendGrid)

## Assumptions

Confirmed with the user (2026-08-13):

1. **Single active provider via env config** — not runtime-selectable per call/tenant, not a fallback chain. `EMAIL_PROVIDER` picks exactly one active sender, same as today's `gmail`/`smtp`/`console`.
2. **Interface stays narrow** — the three new senders implement the existing `IEmailSender` port as-is (`sendOtpEmail`, `sendPasswordResetEmail`). No generalization to a generic `sendEmail(templateName, data)`; that would touch all five senders for a scope this feature doesn't need.
3. **Rendering stays local** — HTML/text continues to be rendered by the existing `IEmailTemplateRenderer` (Handlebars, `renderers/handlebars-email-template.renderer.ts`) before being handed to the sender. The three new senders are dumb transports, like Gmail/SMTP/Console today — no vendor-hosted templates (SendGrid dynamic templates, Brevo template IDs), no vendor lock-in.
4. **Official Node SDKs**, one per provider: `resend`, `@getbrevo/brevo`, `@sendgrid/mail`. Chosen over raw `fetch` calls (how the Gmail sender is built) because these three vendors ship maintained, typed SDKs — raw HTTP would mean hand-rolling request/error shapes for three different APIs with no upstream benefit. See Tech Stack below for the fuller comparison; the fuller table required by `docs/rules/workflow.md`'s decision-rationale rule will be persisted to `docs/documents/auth-email-providers-techstack.md` during Build.
5. **`EMAIL_FROM` is reused as-is** — no new provider-specific "from" env var. It already exists generically (default `no-reply@example.com`) and is read directly by each sender's constructor, same pattern `SmtpEmailSender` uses for `FRONTEND_URL`.
6. Each provider needs exactly one new env var: `RESEND_API_KEY`, `BREVO_API_KEY`, `SENDGRID_API_KEY`. No sender ID / region / other provider-specific config in this iteration — flag if any of the three actually requires more than an API key to send (to be confirmed during Build against each SDK's minimal send call).
7. **`EMAIL_PROVIDER` enum extends to** `"auto" | "gmail" | "smtp" | "console" | "resend" | "brevo" | "sendgrid"` — confirmed 2026-08-13.
8. **`"auto"` resolution order** — new checks are appended *after* the existing `gmail → smtp` checks, before falling through to console: `gmail → smtp → resend → brevo → sendgrid → console`. Confirmed 2026-08-13 — zero behavior change for any existing deployment.
9. All three new SDKs go in `dependencies` (not `optionalDependencies`), matching `nodemailer`/`@nestjs-modules/mailer` precedent — always installed, inert unless their `EMAIL_PROVIDER`/API key is actually set.

## Objective

`cms-api` currently sends transactional email (OTP verification, password reset) via three interchangeable senders behind the `IEmailSender` port: Gmail API, SMTP (`nodemailer`), and a Console dev/test fallback, selected by the `EMAIL_PROVIDER` env var (`docs/documents/auth-email-techstack.md`). This spec adds three more interchangeable senders — **Resend**, **Brevo**, and **SendGrid** — so an operator can pick any of these managed transactional-email APIs instead of running their own SMTP relay or using Gmail's API, without touching any calling code (`register`/`resend-otp`/`forgot-password` services stay untouched — they depend only on `IEmailSender`).

**Users:** whoever deploys `cms-api` and wants a managed transactional-email provider instead of SMTP/Gmail — no end-user-facing change; OTP and reset emails look identical regardless of which provider sends them.

**Success looks like:** setting `EMAIL_PROVIDER=resend` (or `brevo`/`sendgrid`) plus that provider's API key sends real OTP/reset emails through that vendor's API, using the same Handlebars-rendered HTML the SMTP/Gmail path already produces — with zero change to `register`/`resend-otp`/`forgot-password` service code.

## Tech Stack

| Option | Fit for this repo | Complexity | Maintenance | Precedent |
|---|---|---|---|---|
| **Official SDKs** (`resend`, `@getbrevo/brevo`, `@sendgrid/mail`) | High — typed request/response shapes, matches how `nodemailer` is already wrapped | Low — each is a thin `new Client(apiKey).send(...)` call | Vendor-maintained, follows their API changes | `@nestjs-modules/mailer`/`nodemailer` already used for SMTP |
| Raw `fetch` per provider | Low — three different REST/auth/error shapes to hand-roll and keep in sync with each vendor's docs | Higher — no typed request/response, manual retry/error handling | We own all API-drift risk | `GmailApiEmailSender` uses raw `fetch` (chosen there for a narrow OAuth2 flow, not a general precedent) |

Official SDKs win: lower complexity, and the "raw fetch" precedent (Gmail) was a one-off necessity (OAuth2 token flow), not a repo-wide preference.

- NestJS 11 / existing `IEmailSender` port and `resolveEmailSender` factory (`infrastructure/email/resolve-email-sender.ts`) — no changes to the DI wiring pattern, only new branches.
- **New dependencies:** `resend`, `@getbrevo/brevo`, `@sendgrid/mail`.
- Existing `IEmailTemplateRenderer`/Handlebars renderer — untouched, reused as-is.

## Commands

```
Build:        bun run build
Test:         bun run test
Test (cov):   bun run test:cov
Test (e2e):   bun run test:e2e
Lint:         bun run lint          # never `bunx eslint .` directly — see docs/rules/workflow.md
Dev:          bun run start:dev
```

## Project Structure

```
apps/cms-api/
  src/config/env.validation.ts                          → EMAIL_PROVIDER enum gains "resend" | "brevo" | "sendgrid"; RESEND_API_KEY, BREVO_API_KEY, SENDGRID_API_KEY added
  src/modules/auth/infrastructure/email/
    resend-email.sender.ts                               → NEW, implements IEmailSender via `resend` SDK
    resend-email.sender.spec.ts                           → NEW
    brevo-email.sender.ts                                 → NEW, implements IEmailSender via `@getbrevo/brevo` SDK
    brevo-email.sender.spec.ts                             → NEW
    sendgrid-email.sender.ts                              → NEW, implements IEmailSender via `@sendgrid/mail` SDK
    sendgrid-email.sender.spec.ts                          → NEW
    resolve-email-sender.ts                                → extended with 3 new branches + "auto" fallthrough order (Assumption 8)
    resolve-email-sender.spec.ts                           → extended with 3 new branch cases
  .env.example                                             → EMAIL_PROVIDER comment + 3 new API-key lines
  docs/documents/auth-email-techstack.md                   → updated: Resend/Brevo/SendGrid rows added to the provider comparison
  docs/documents/auth-email-providers-techstack.md         → NEW: SDK-vs-raw-fetch decision table (per workflow.md's decision-rationale rule)
  docs/documents/auth.md                                    → updated: email-sending section lists all 6 providers
```

No changes to `domain/ports/email-sender.port.ts`, `auth.module.ts` DI wiring shape, `renderers/*`, `templates/handlebars/*`, or any `application/services/*` caller.

## Code Style

Follow the existing sender shape exactly (`smtp-email.sender.ts` as precedent):

```ts
// src/modules/auth/infrastructure/email/resend-email.sender.ts
import { IEmailSender, SendOtpEmailParams, SendPasswordResetEmailParams } from "../../domain/ports/email-sender.port";
import { Resend } from "resend";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { type IEmailTemplateRenderer } from "./renderers/email-template-renderer";

@Injectable()
export class ResendEmailSender implements IEmailSender {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(
    configService: ConfigService<EnvironmentVariables, true>,
    private readonly templateRenderer: IEmailTemplateRenderer,
  ) {
    this.resend = new Resend(configService.get("RESEND_API_KEY", { infer: true }));
    this.from = configService.get("EMAIL_FROM", { infer: true });
    this.frontendUrl = configService.get("FRONTEND_URL", { infer: true });
  }

  async sendOtpEmail({ email, otp }: SendOtpEmailParams): Promise<void> {
    await this.resend.emails.send({
      from: this.from,
      to: email,
      subject: "Verify your email",
      html: this.templateRenderer.renderOtpEmail({ otp }),
    });
  }

  async sendPasswordResetEmail({ email, resetToken }: SendPasswordResetEmailParams): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${resetToken}`;

    await this.resend.emails.send({
      from: this.from,
      to: email,
      subject: "Reset your password",
      html: this.templateRenderer.renderPasswordResetEmail({ resetUrl }),
    });
  }
}
```

Brevo and SendGrid senders follow the same shape, substituting each SDK's client construction and send-call signature (to be confirmed against each SDK's current API during Build — `source-driven-development` applies here since SDK surfaces change).

- DI tokens/interfaces unchanged — no new `Symbol`s, these plug into the existing `EMAIL_SENDER` token via `resolveEmailSender`.
- No comments explaining *what* the code does — only non-obvious *why*, matching existing sender files (which currently have none).

## Testing Strategy

- **Jest unit tests**, mocked SDK clients — same pattern as `smtp-email.sender.spec.ts` (mocked `MailerService`) and `gmail-api-email.sender.spec.ts` (mocked `fetch`). Each new spec asserts: correct `to`/`subject`/`from` passed through, `templateRenderer` output used verbatim as `html`, SDK client constructed with the right API key.
- `resolve-email-sender.spec.ts` — extend with one case per new provider (`EMAIL_PROVIDER=resend|brevo|sendgrid` → correct sender class instantiated) plus a case covering the new `"auto"` fallthrough order (Assumption 8).
- No `coverageThreshold` entries added for these files beyond what's already customary for this repo (colocated spec files get normal Jest coverage; no Prisma/controller involvement here so the existing exclusion rule doesn't apply either way).
- No e2e changes — sending real email through three new live vendor APIs isn't something CI should do; e2e continues to run with `EMAIL_PROVIDER=console` (or unset/auto with no provider env vars, per current e2e setup).
- Manual verification: for each of the three providers, set the real API key + `EMAIL_PROVIDER=<provider>` locally and confirm one OTP email and one password-reset email actually arrive, before calling the feature done.

## Boundaries

- **Always do:** run `bun run test:cov`, `bun run build`, `bun run lint` before considering any task done; keep `IEmailSender`'s two-method shape, `resolve-email-sender.ts`'s existing gmail/smtp/console branches, and every `application/services/*` caller completely untouched.
- **Ask first:** whether any of the three providers needs more config than a single API key once its SDK is actually integrated (Assumption 6).
- **Never do:** log a raw API key or full email body anywhere; make any of the three new senders' construction throw or perform network calls unless that provider is actually selected (mirroring how Gmail/SMTP client construction today is inert unless chosen — an unset `RESEND_API_KEY` must not break the app when `EMAIL_PROVIDER` is `smtp`/`gmail`/`console`/unset).

### New env vars (`src/config/env.validation.ts`) — proposed, confirm before implementing

```
EMAIL_PROVIDER = "auto"   // now: "auto" | "gmail" | "smtp" | "console" | "resend" | "brevo" | "sendgrid"
RESEND_API_KEY = ""
BREVO_API_KEY = ""
SENDGRID_API_KEY = ""
```

## Success Criteria

- [ ] `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` set → OTP and password-reset emails send via Resend's API, using the same Handlebars HTML the SMTP path renders.
- [ ] `EMAIL_PROVIDER=brevo` + `BREVO_API_KEY` set → same, via Brevo.
- [ ] `EMAIL_PROVIDER=sendgrid` + `SENDGRID_API_KEY` set → same, via SendGrid.
- [ ] `EMAIL_PROVIDER` unset/`"auto"` with none of the new API keys set → behavior identical to today (gmail → smtp → console fallthrough unchanged).
- [ ] Zero changes required in `register.service.ts`/`resend-otp.service.ts`/`forgot-password.service.ts` — they only ever depend on `IEmailSender`.
- [ ] `bun run test:cov`, `bun run build`, `bun run lint` all clean; no e2e changes needed.
- [ ] `.env.example`, `docs/documents/auth.md`, `docs/documents/auth-email-techstack.md`, `docs/documents/auth-email-providers-techstack.md` all updated.
- [ ] Manually verified: at least one real send through each of the three new providers.

## Open Questions

All spec-level questions resolved as of 2026-08-13 (`"auto"` fallthrough order and `EMAIL_PROVIDER` enum spelling both confirmed). One implementation-level question remains, to be resolved during Build:

1. Confirm each provider truly only needs an API key (no sender ID, region, or account-level "verified sender" config beyond `EMAIL_FROM`) — flag if any SDK's minimal send call needs more.

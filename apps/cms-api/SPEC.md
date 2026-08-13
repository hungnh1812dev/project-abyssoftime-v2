# Spec

No active spec. See `docs/documents/auth.md` (Domain port section), `docs/documents/auth-email-techstack.md`,
and `docs/documents/auth-email-providers-techstack.md` for the completed Additional Email Providers
feature — `cms-api` now selects one of six `IEmailSender` implementations via `EMAIL_PROVIDER`
(`gmail`/`smtp`/`resend`/`brevo`/`sendgrid`/`console`, `"auto"` resolving in that order), with the
three new senders (Resend, Brevo, SendGrid) each wrapping their vendor's official Node SDK behind the
existing port, zero change to any `application/services/*` caller.

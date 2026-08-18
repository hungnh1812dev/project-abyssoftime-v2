# Auth Module — Tech/Pattern/Design Decisions

Comparison tables for the choices made building `src/modules/auth/**`, per repo root `docs/workflow.md`'s "Decision rationale" rule. See [auth.md](./auth.md) for the module's full implementation writeup.

## Password / OTP hashing library

| Criteria                       | `Bun.password` (built-in)                          | `bcrypt` (native binding)                    | `bcryptjs` (chosen)                          |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| New dependency?                | None — Bun global                                    | Yes, + native compilation                        | Yes, pure JS                                     |
| Works under this repo's tests  | **No** — `bun run test` runs Jest, whose `testEnvironment: "node"` executes every test file under a real Node process; `Bun` is `undefined` there regardless of which binary launched the Jest CLI | Yes                                              | Yes                                              |
| Install/build risk             | None                                                  | Native compilation can fail across OS/arch        | None — no native step                            |
| Matches original approved plan | Was the original pick, until it broke                | Was the plan's *first* pick before a Bun-first pivot | Reverts to this after the `Bun.password` pivot failed |
| **Verdict**                    | Rejected — breaks the test suite                     | Rejected — avoids native-binding risk on principle (this project runs on Bun; no reason to add a native compile step when a pure-JS option exists) | **Chosen** |

Full account of the failure and pivot: `tasks/plan.md` finding 3.

## Token / session strategy

| Criteria                  | Server-side sessions (DB/Redis-backed)         | Stateless JWT (chosen)                          |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| New infra                  | Needs a session store (Redis, or a DB table)       | None — signed/verified in-process                    |
| Per-request DB cost        | One lookup per request (or a cache layer)          | Zero — `JwtAuthGuard` only verifies a signature       |
| Instant revocation         | Yes — delete the session row                       | No — a leaked token is valid until it expires (accepted tradeoff, not a gap to fix later) |
| Permission-change latency  | Immediate                                          | Up to ~15 min (access-token TTL) for an already-logged-in user; refresh re-syncs sooner |
| Fit for this repo           | Would need a new model/infra just for this feature  | Env vars (`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`COOKIE_*`) already existed, unused, clearly signaling stateless JWT was the intended design |
| **Verdict**                | Rejected — over-engineered for the stated scope, and the env vars already pointed at JWT | **Chosen** |

## Password-reset token hashing

| Criteria                    | `bcrypt`/`bcryptjs`                              | SHA-256 (chosen)                                |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| What it's hashing             | Best for **low-entropy** secrets (passwords, OTPs) where brute-force resistance matters | The token itself is already a high-entropy random value (`crypto.randomBytes(32)`) — nothing to brute-force |
| Cost                          | Deliberately slow (that's the point for passwords)   | Fast — no reason to pay the slow-hash cost for an already-unguessable value |
| Precedent in this codebase    | Used for `password`/`otpCodeHash` (low-entropy)      | N/A — this is the one high-entropy secret in the module |
| **Verdict**                  | Rejected for this specific field — wrong tool for a high-entropy token | **Chosen** — matches the "hash the right way for what you're hashing" principle; `otpCodeHash`/`password` correctly stay on `bcryptjs` |

## Email delivery

| Criteria             | Real provider now (e.g. SES, Resend, SendGrid)  | Port + console-stub (chosen)                      |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| New dependency          | A provider SDK + API keys/secrets to manage            | None                                                      |
| Scope fit                | Real email delivery was explicitly deferred for this cycle | Matches the deferred scope exactly                        |
| Swap-in cost later        | N/A                                                   | One line in `auth.module.ts` (`{ provide: EMAIL_SENDER, useClass: ConsoleEmailSender }` → a real implementation of the same `IEmailSender` port) |
| **Verdict**              | Rejected — out of scope for this cycle                | **Chosen** |

## Email template rendering

| Criteria                  | TS template-literal functions                       | Handlebars `.hbs` files (chosen)                   |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| New dependency               | None                                                | `handlebars`                                       |
| Output escaping               | Manual — raw `${value}` interpolation, nothing escapes by default | `{{value}}` HTML-escapes by default; safe unless explicitly opted out with `{{{value}}}` |
| Editing without touching TS  | No — templates are TS source, require a rebuild to change copy | Yes — `.hbs` files are plain markup, editable independent of application code |
| Build step                   | None                                                | `nest-cli.json` asset copy (`templates/handlebars/**/*.hbs` → `dist/src/...`) |
| **Verdict**                  | Rejected — kept alongside Handlebars during evaluation, since removed to avoid maintaining two copies of the same two templates | **Chosen** |

## SMTP send library

| Criteria              | Direct `nodemailer.createTransport()` | `@nestjs-modules/mailer` (chosen)                 |
| ------------------------ | ---------------------------------------- | -------------------------------------------------- |
| New dependency            | None — `nodemailer` already required      | Yes — `@nestjs-modules/mailer` (pulls in optional template-adapter deps: `mjml`, `pug`, `ejs`, `nunjucks`, `liquidjs`, unused here since HTML is pre-rendered by `IEmailTemplateRenderer` before `sendMail`) |
| NestJS DI fit              | Manual instantiation inside `SmtpEmailSender`'s constructor | `MailerModule.forRootAsync()` registers `MailerService` as an injectable, config-driven provider |
| **Verdict**                | Viable, smaller dependency footprint      | **Chosen** — accepted the extra dependency weight for NestJS-native module/DI integration |

## Auth strategy library

| Criteria                  | Passport (`@nestjs/passport` + `passport-jwt`) | `@nestjs/jwt` + custom `JwtAuthGuard` (chosen) |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| New dependency               | Yes — `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt` | None — `@nestjs/jwt` already installed for sign/verify |
| Token location fit           | Default `ExtractJwt` strategies target the `Authorization` header; a cookie-based token needs a custom extractor anyway | Guard reads `request.cookies[ACCESS_TOKEN_COOKIE]` directly — no extractor abstraction needed |
| Strategy count in this module | Built for pluggable/multiple strategies (local, JWT, OAuth, ...) via `PassportModule` | Exactly one strategy (stateless JWT via cookie) — the pluggability buys nothing here |
| Control flow                 | Delegates verification/user-attachment through Passport's strategy + `AuthGuard('jwt')` machinery | `JwtTokenService.verifyAccessToken()` called directly in the guard — one less layer to trace |
| **Verdict**                  | Rejected — extra dependency and indirection for a single cookie-based strategy | **Chosen** |

## Rate limiting

| Criteria              | Redis-backed / library (e.g. `nestjs-rate-limiter`) | Hand-rolled in-memory token bucket (chosen)   |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| New dependency           | Yes (+ Redis infra for a distributed deployment)          | None                                                 |
| Fit for current deployment | Overkill for a single-instance app with no Redis already in the stack | `RATE_LIMIT_FPS`/`RATE_LIMIT_BURST` env vars already existed, unused — same signal as the JWT env vars |
| Correctness at scale (multi-instance) | Correct — shared state                          | Per-instance only (a known limitation, acceptable for current deployment scale) |
| **Verdict**             | Rejected — no current need for cross-instance correctness | **Chosen** |

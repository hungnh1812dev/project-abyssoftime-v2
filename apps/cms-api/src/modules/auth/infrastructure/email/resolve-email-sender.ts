import { IEmailSender } from "../../domain/ports/email-sender.port";
import { MailerService } from "@nestjs-modules/mailer";

import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { BrevoEmailSender } from "./brevo-email.sender";
import { ConsoleEmailSender } from "./console-email.sender";
import { GmailApiEmailSender } from "./gmail-api-email.sender";
import { IEmailTemplateRenderer } from "./renderers/email-template-renderer";
import { ResendEmailSender } from "./resend-email.sender";
import { SendGridEmailSender } from "./sendgrid-email.sender";
import { SmtpEmailSender } from "./smtp-email.sender";

export function resolveEmailSender(configService: ConfigService<EnvironmentVariables, true>, mailerService: MailerService, templateRenderer: IEmailTemplateRenderer): IEmailSender {
  const provider = configService.get("EMAIL_PROVIDER", { infer: true });

  if (provider === "gmail") {
    return new GmailApiEmailSender(configService, templateRenderer);
  }
  if (provider === "smtp") {
    return new SmtpEmailSender(configService, mailerService, templateRenderer);
  }
  if (provider === "resend") {
    return new ResendEmailSender(configService, templateRenderer);
  }
  if (provider === "brevo") {
    return new BrevoEmailSender(configService, templateRenderer);
  }
  if (provider === "sendgrid") {
    return new SendGridEmailSender(configService, templateRenderer);
  }
  if (provider === "console") {
    return new ConsoleEmailSender();
  }

  // "auto": Gmail if GMAIL_CLIENT_ID is set, else SMTP if SMTP_HOST is set, else Resend if
  // RESEND_API_KEY is set, else Brevo if BREVO_API_KEY is set, else SendGrid if SENDGRID_API_KEY
  // is set, else console logging.
  const gmailClientId = configService.get("GMAIL_CLIENT_ID", { infer: true });
  if (gmailClientId) {
    return new GmailApiEmailSender(configService, templateRenderer);
  }

  const smtpHost = configService.get("SMTP_HOST", { infer: true });
  if (smtpHost) {
    return new SmtpEmailSender(configService, mailerService, templateRenderer);
  }

  const resendApiKey = configService.get("RESEND_API_KEY", { infer: true });
  if (resendApiKey) {
    return new ResendEmailSender(configService, templateRenderer);
  }

  const brevoApiKey = configService.get("BREVO_API_KEY", { infer: true });
  if (brevoApiKey) {
    return new BrevoEmailSender(configService, templateRenderer);
  }

  const sendgridApiKey = configService.get("SENDGRID_API_KEY", { infer: true });
  if (sendgridApiKey) {
    return new SendGridEmailSender(configService, templateRenderer);
  }

  return new ConsoleEmailSender();
}

import { MailerService } from "@nestjs-modules/mailer";
import { Resend } from "resend";

import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { ConsoleEmailSender } from "./console-email.sender";
import { GmailApiEmailSender } from "./gmail-api-email.sender";
import { IEmailTemplateRenderer } from "./renderers/email-template-renderer";
import { ResendEmailSender } from "./resend-email.sender";
import { resolveEmailSender } from "./resolve-email-sender";
import { SmtpEmailSender } from "./smtp-email.sender";

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}));

describe("resolveEmailSender", () => {
  const mailerService = {} as unknown as MailerService;
  const templateRenderer = {} as unknown as IEmailTemplateRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeConfig(overrides: Record<string, unknown> = {}): ConfigService<EnvironmentVariables, true> {
    return {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          EMAIL_PROVIDER: "auto",
          GMAIL_CLIENT_ID: "",
          SMTP_HOST: "",
          SMTP_PORT: 587,
          SMTP_USER: "",
          SMTP_PASSWORD: "",
          SMTP_SECURE: false,
          EMAIL_FROM: "no-reply@abyssoftime.com",
          FRONTEND_URL: "https://abyssoftime.com",
          RESEND_API_KEY: "",
          ...overrides,
        };
        return values[key];
      }),
    } as unknown as ConfigService<EnvironmentVariables, true>;
  }

  describe("EMAIL_PROVIDER=auto (default)", () => {
    it("returns a GmailApiEmailSender when GMAIL_CLIENT_ID is set", () => {
      const sender = resolveEmailSender(makeConfig({ GMAIL_CLIENT_ID: "client-id", SMTP_HOST: "smtp.example.com" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(GmailApiEmailSender);
    });

    it("returns a SmtpEmailSender when SMTP_HOST is set and GMAIL_CLIENT_ID is empty", () => {
      const sender = resolveEmailSender(makeConfig({ SMTP_HOST: "smtp.example.com" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(SmtpEmailSender);
    });

    it("returns a ResendEmailSender when RESEND_API_KEY is set and SMTP_HOST/GMAIL_CLIENT_ID are empty", () => {
      const sender = resolveEmailSender(makeConfig({ RESEND_API_KEY: "re_123" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(ResendEmailSender);
    });

    it("returns a SmtpEmailSender when SMTP_HOST is set, even with RESEND_API_KEY also set (smtp precedes resend)", () => {
      const sender = resolveEmailSender(makeConfig({ SMTP_HOST: "smtp.example.com", RESEND_API_KEY: "re_123" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(SmtpEmailSender);
    });

    it("returns a ConsoleEmailSender when SMTP_HOST, GMAIL_CLIENT_ID, and RESEND_API_KEY are empty", () => {
      const sender = resolveEmailSender(makeConfig(), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(ConsoleEmailSender);
    });
  });

  describe("explicit EMAIL_PROVIDER", () => {
    it("returns a SmtpEmailSender when EMAIL_PROVIDER=smtp, even with GMAIL_CLIENT_ID also set", () => {
      const sender = resolveEmailSender(makeConfig({ EMAIL_PROVIDER: "smtp", GMAIL_CLIENT_ID: "client-id", SMTP_HOST: "smtp.example.com" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(SmtpEmailSender);
    });

    it("returns a GmailApiEmailSender when EMAIL_PROVIDER=gmail, even with SMTP_HOST also set", () => {
      const sender = resolveEmailSender(makeConfig({ EMAIL_PROVIDER: "gmail", GMAIL_CLIENT_ID: "client-id", SMTP_HOST: "smtp.example.com" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(GmailApiEmailSender);
    });

    it("returns a ConsoleEmailSender when EMAIL_PROVIDER=console, even with other credentials set", () => {
      const sender = resolveEmailSender(makeConfig({ EMAIL_PROVIDER: "console", GMAIL_CLIENT_ID: "client-id", SMTP_HOST: "smtp.example.com" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(ConsoleEmailSender);
    });

    it("returns a ResendEmailSender when EMAIL_PROVIDER=resend, even with GMAIL_CLIENT_ID/SMTP_HOST also set", () => {
      const sender = resolveEmailSender(makeConfig({ EMAIL_PROVIDER: "resend", GMAIL_CLIENT_ID: "client-id", SMTP_HOST: "smtp.example.com" }), mailerService, templateRenderer);

      expect(sender).toBeInstanceOf(ResendEmailSender);
    });
  });

  describe("non-resend providers never construct a Resend client", () => {
    it.each(["gmail", "smtp", "console"] as const)("does not construct Resend when EMAIL_PROVIDER=%s, even with RESEND_API_KEY set", (provider) => {
      resolveEmailSender(
        makeConfig({ EMAIL_PROVIDER: provider, GMAIL_CLIENT_ID: "client-id", SMTP_HOST: "smtp.example.com", RESEND_API_KEY: "re_123" }),
        mailerService,
        templateRenderer,
      );

      expect(Resend).not.toHaveBeenCalled();
    });

    it("does not construct Resend for the auto fallthrough when RESEND_API_KEY is empty", () => {
      resolveEmailSender(makeConfig(), mailerService, templateRenderer);

      expect(Resend).not.toHaveBeenCalled();
    });
  });
});

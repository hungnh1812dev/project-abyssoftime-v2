import { BrevoClient } from "@getbrevo/brevo";

import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { BrevoEmailSender } from "./brevo-email.sender";
import { IEmailTemplateRenderer } from "./renderers/email-template-renderer";

interface SentEmail {
  sender: { email: string };
  to: { email: string }[];
  subject: string;
  htmlContent: string;
}

const sendTransacEmail = jest.fn<Promise<{ messageId: string }>, [SentEmail]>();

jest.mock("@getbrevo/brevo", () => ({
  BrevoClient: jest.fn().mockImplementation(() => ({
    transactionalEmails: { sendTransacEmail },
  })),
}));

describe("BrevoEmailSender", () => {
  const templateRenderer: IEmailTemplateRenderer = {
    renderOtpEmail: ({ otp }) => `<p>otp:${otp}</p>`,
    renderPasswordResetEmail: ({ resetUrl }) => `<a href="${resetUrl}">reset</a>`,
  };

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        BREVO_API_KEY: "xkeysib-test-key",
        EMAIL_FROM: "no-reply@abyssoftime.com",
        FRONTEND_URL: "https://abyssoftime.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService<EnvironmentVariables, true>;

  beforeEach(() => {
    jest.clearAllMocks();
    sendTransacEmail.mockResolvedValue({ messageId: "message_123" });
  });

  it("constructs the Brevo client with the configured API key", () => {
    new BrevoEmailSender(config, templateRenderer);

    expect(BrevoClient).toHaveBeenCalledWith({ apiKey: "xkeysib-test-key" });
  });

  it("sends the OTP email rendered via the injected template renderer", async () => {
    const sender = new BrevoEmailSender(config, templateRenderer);

    await sender.sendOtpEmail({ email: "target@example.com", otp: "654321" });

    expect(sendTransacEmail).toHaveBeenCalledTimes(1);
    const call = sendTransacEmail.mock.calls[0][0];
    expect(call.sender).toEqual({ email: "no-reply@abyssoftime.com" });
    expect(call.to).toEqual([{ email: "target@example.com" }]);
    expect(call.subject).toMatch(/verif/i);
    expect(call.htmlContent).toBe("<p>otp:654321</p>");
  });

  it("sends the password-reset email rendered via the injected template renderer", async () => {
    const sender = new BrevoEmailSender(config, templateRenderer);

    await sender.sendPasswordResetEmail({ email: "target@example.com", resetToken: "reset-abc" });

    expect(sendTransacEmail).toHaveBeenCalledTimes(1);
    const call = sendTransacEmail.mock.calls[0][0];
    expect(call.to).toEqual([{ email: "target@example.com" }]);
    expect(call.subject).toMatch(/reset/i);
    expect(call.htmlContent).toBe('<a href="https://abyssoftime.com/reset-password?token=reset-abc">reset</a>');
  });

  it("propagates the error when the Brevo API call rejects", async () => {
    sendTransacEmail.mockRejectedValue(new Error("Bad Request"));
    const sender = new BrevoEmailSender(config, templateRenderer);

    await expect(sender.sendOtpEmail({ email: "target@example.com", otp: "654321" })).rejects.toThrow("Bad Request");
  });
});

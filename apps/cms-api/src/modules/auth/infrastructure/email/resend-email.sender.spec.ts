import { Resend } from "resend";

import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { IEmailTemplateRenderer } from "./renderers/email-template-renderer";
import { ResendEmailSender } from "./resend-email.sender";

interface SentEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

interface SendResult {
  data: { id: string } | null;
  error: { message: string; name: string; statusCode: number } | null;
}

const send = jest.fn<Promise<SendResult>, [SentEmail]>();

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send },
  })),
}));

describe("ResendEmailSender", () => {
  const templateRenderer: IEmailTemplateRenderer = {
    renderOtpEmail: ({ otp }) => `<p>otp:${otp}</p>`,
    renderPasswordResetEmail: ({ resetUrl }) => `<a href="${resetUrl}">reset</a>`,
  };

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        RESEND_API_KEY: "re_test_key",
        EMAIL_FROM: "no-reply@abyssoftime.com",
        FRONTEND_URL: "https://abyssoftime.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService<EnvironmentVariables, true>;

  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({ data: { id: "email_123" }, error: null });
  });

  it("constructs the Resend client with the configured API key", () => {
    new ResendEmailSender(config, templateRenderer);

    expect(Resend).toHaveBeenCalledWith("re_test_key");
  });

  it("sends the OTP email rendered via the injected template renderer", async () => {
    const sender = new ResendEmailSender(config, templateRenderer);

    await sender.sendOtpEmail({ email: "target@example.com", otp: "654321" });

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.from).toBe("no-reply@abyssoftime.com");
    expect(call.to).toBe("target@example.com");
    expect(call.subject).toMatch(/verif/i);
    expect(call.html).toBe("<p>otp:654321</p>");
  });

  it("sends the password-reset email rendered via the injected template renderer", async () => {
    const sender = new ResendEmailSender(config, templateRenderer);

    await sender.sendPasswordResetEmail({ email: "target@example.com", resetToken: "reset-abc" });

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.to).toBe("target@example.com");
    expect(call.subject).toMatch(/reset/i);
    expect(call.html).toBe('<a href="https://abyssoftime.com/reset-password?token=reset-abc">reset</a>');
  });

  it("throws when the Resend API returns an error instead of a resolved send", async () => {
    send.mockResolvedValue({ data: null, error: { message: "invalid_from_address", name: "invalid_from_address", statusCode: 422 } });
    const sender = new ResendEmailSender(config, templateRenderer);

    await expect(sender.sendOtpEmail({ email: "target@example.com", otp: "654321" })).rejects.toThrow(/invalid_from_address/);
  });
});

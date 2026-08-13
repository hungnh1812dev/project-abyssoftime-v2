import sgMail from "@sendgrid/mail";

import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { IEmailTemplateRenderer } from "./renderers/email-template-renderer";
import { SendGridEmailSender } from "./sendgrid-email.sender";

interface SentEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
}

jest.mock("@sendgrid/mail", () => ({
  __esModule: true,
  default: {
    setApiKey: jest.fn(),
    send: jest.fn(),
  },
}));

const setApiKey = jest.mocked(sgMail.setApiKey);
const send = jest.mocked(sgMail.send) as jest.Mock<Promise<[{ statusCode: number }, object]>, [SentEmail]>;

describe("SendGridEmailSender", () => {
  const templateRenderer: IEmailTemplateRenderer = {
    renderOtpEmail: ({ otp }) => `<p>otp:${otp}</p>`,
    renderPasswordResetEmail: ({ resetUrl }) => `<a href="${resetUrl}">reset</a>`,
  };

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        SENDGRID_API_KEY: "SG.test-key",
        EMAIL_FROM: "no-reply@abyssoftime.com",
        FRONTEND_URL: "https://abyssoftime.com",
      };
      return values[key];
    }),
  } as unknown as ConfigService<EnvironmentVariables, true>;

  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue([{ statusCode: 202 }, {}]);
  });

  it("configures the SendGrid client with the configured API key", () => {
    new SendGridEmailSender(config, templateRenderer);

    expect(setApiKey).toHaveBeenCalledWith("SG.test-key");
  });

  it("sends the OTP email rendered via the injected template renderer", async () => {
    const sender = new SendGridEmailSender(config, templateRenderer);

    await sender.sendOtpEmail({ email: "target@example.com", otp: "654321" });

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.to).toBe("target@example.com");
    expect(call.from).toBe("no-reply@abyssoftime.com");
    expect(call.subject).toMatch(/verif/i);
    expect(call.html).toBe("<p>otp:654321</p>");
  });

  it("sends the password-reset email rendered via the injected template renderer", async () => {
    const sender = new SendGridEmailSender(config, templateRenderer);

    await sender.sendPasswordResetEmail({ email: "target@example.com", resetToken: "reset-abc" });

    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.to).toBe("target@example.com");
    expect(call.subject).toMatch(/reset/i);
    expect(call.html).toBe('<a href="https://abyssoftime.com/reset-password?token=reset-abc">reset</a>');
  });

  it("propagates the error when the SendGrid API call rejects", async () => {
    send.mockRejectedValue(new Error("Bad Request"));
    const sender = new SendGridEmailSender(config, templateRenderer);

    await expect(sender.sendOtpEmail({ email: "target@example.com", otp: "654321" })).rejects.toThrow("Bad Request");
  });
});

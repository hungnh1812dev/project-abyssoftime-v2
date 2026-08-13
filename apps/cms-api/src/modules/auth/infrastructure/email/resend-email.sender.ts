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
    await this.send(email, "Verify your email", this.templateRenderer.renderOtpEmail({ otp }));
  }

  async sendPasswordResetEmail({ email, resetToken }: SendPasswordResetEmailParams): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password?token=${resetToken}`;

    await this.send(email, "Reset your password", this.templateRenderer.renderPasswordResetEmail({ resetUrl }));
  }

  // resend's SDK resolves { data, error } instead of throwing on API failures — unlike
  // MailerService/GmailApiEmailSender, so failures must be converted to a throw explicitly to keep
  // the "send failures propagate uncaught" contract every IEmailSender implementation relies on.
  private async send(to: string, subject: string, html: string): Promise<void> {
    const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });

    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }
  }
}

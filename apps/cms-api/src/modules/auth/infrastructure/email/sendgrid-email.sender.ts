import { IEmailSender, SendOtpEmailParams, SendPasswordResetEmailParams } from "../../domain/ports/email-sender.port";
import sgMail from "@sendgrid/mail";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { type IEmailTemplateRenderer } from "./renderers/email-template-renderer";

@Injectable()
export class SendGridEmailSender implements IEmailSender {
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(
    configService: ConfigService<EnvironmentVariables, true>,
    private readonly templateRenderer: IEmailTemplateRenderer,
  ) {
    sgMail.setApiKey(configService.get("SENDGRID_API_KEY", { infer: true }));
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

  private async send(to: string, subject: string, html: string): Promise<void> {
    await sgMail.send({ to, from: this.from, subject, html });
  }
}

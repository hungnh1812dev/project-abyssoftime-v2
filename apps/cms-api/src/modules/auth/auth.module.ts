import { AccessTokenModule } from "../access-tokens/access-token.module";
import { MailerModule, MailerService } from "@nestjs-modules/mailer";

import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportModule } from "@nestjs/passport";

import { ApiTokenStrategy } from "@/common/strategies/api-token.strategy";
import { JwtRefreshStrategy } from "@/common/strategies/jwt-refresh.strategy";
import { JwtStrategy } from "@/common/strategies/jwt.strategy";
import { LocalStrategy } from "@/common/strategies/local.strategy";
import { type EnvironmentVariables } from "@/config/env.validation";
import { RoleModule } from "@/modules/roles/role.module";
import { UserModule } from "@/modules/users/user.module";

import { ForgotPasswordService } from "./application/services/forgot-password.service";
import { GetMeService } from "./application/services/get-me.service";
import { HasUsersService } from "./application/services/has-users.service";
import { LoginService } from "./application/services/login.service";
import { LogoutService } from "./application/services/logout.service";
import { RefreshTokenService } from "./application/services/refresh-token.service";
import { RegisterService } from "./application/services/register.service";
import { ResendOtpService } from "./application/services/resend-otp.service";
import { ResetPasswordService } from "./application/services/reset-password.service";
import { VerifyOtpService } from "./application/services/verify-otp.service";
import { EMAIL_SENDER } from "./domain/ports/email-sender.port";
import { EMAIL_TEMPLATE_RENDERER } from "./infrastructure/email/renderers/email-template-renderer";
import { HandlebarsEmailTemplateRenderer } from "./infrastructure/email/renderers/handlebars-email-template.renderer";
import { resolveEmailSender } from "./infrastructure/email/resolve-email-sender";
import { AuthController } from "./presentation/auth.controller";

@Module({
  imports: [
    UserModule,
    RoleModule,
    AccessTokenModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => ({
        transport: {
          host: configService.get("SMTP_HOST", { infer: true }),
          port: configService.get("SMTP_PORT", { infer: true }),
          secure: configService.get("SMTP_SECURE", { infer: true }),
          requireTLS: true,
          auth: {
            user: configService.get("SMTP_USER", { infer: true }),
            pass: configService.get("SMTP_PASSWORD", { infer: true }),
          },
        },
        defaults: { from: configService.get("EMAIL_FROM", { infer: true }) },
      }),
    }),
    PassportModule.register({ defaultStrategy: "jwt" }),
  ],
  controllers: [AuthController],
  providers: [
    RegisterService,
    VerifyOtpService,
    ResendOtpService,
    HasUsersService,
    LoginService,
    RefreshTokenService,
    LogoutService,
    ForgotPasswordService,
    ResetPasswordService,
    GetMeService,
    JwtStrategy,
    JwtRefreshStrategy,
    ApiTokenStrategy,
    LocalStrategy,
    { provide: EMAIL_TEMPLATE_RENDERER, useClass: HandlebarsEmailTemplateRenderer },
    {
      provide: EMAIL_SENDER,
      useFactory: resolveEmailSender,
      inject: [ConfigService, MailerService, EMAIL_TEMPLATE_RENDERER],
    },
  ],
})
export class AuthModule {}

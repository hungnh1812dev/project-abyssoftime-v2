import { plainToInstance, Transform } from "class-transformer";
import { IsIn, IsInt, IsString, Min, MinLength, ValidateIf, validateSync } from "class-validator";

export const SUPPORTED_DB_DRIVERS = ["postgresql", "mysql", "sqlite"] as const;
export type DbDriver = (typeof SUPPORTED_DB_DRIVERS)[number];

export class EnvironmentVariables {
  // DB Connection
  @IsIn(SUPPORTED_DB_DRIVERS)
  DB_DRIVER: DbDriver = "postgresql";

  @IsString()
  @MinLength(1)
  DB_HOST: string = "localhost";

  @IsString()
  @MinLength(1)
  DB_NAME: string = "abyssoftime-cms";

  @IsString()
  DB_PASSWORD: string = "";

  @IsString()
  @MinLength(1)
  DB_PORT: string = "5432";

  @IsString()
  @MinLength(1)
  DB_USERNAME: string = "postgres";

  // JWT
  @IsString()
  @MinLength(1)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(1)
  JWT_REFRESH_SECRET!: string;

  // COOKIE
  @Transform(({ value }: { value: unknown }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsIn([true, false])
  COOKIE_SECURE!: boolean;

  @IsIn(["lax", "strict", "none"])
  COOKIE_SAMESITE!: "lax" | "strict" | "none";

  // CORS — comma-separated exact origins allowed to make credentialed requests. See docs/documents/cors.md.
  @IsString()
  @MinLength(1)
  CORS_ORIGINS!: string;

  // RATE LIMIT
  @Transform(({ value }: { value: unknown }) => (value === undefined ? 5 : Number(value)))
  @IsInt()
  @Min(1)
  RATE_LIMIT_FPS: number = 5;

  @Transform(({ value }: { value: unknown }) => (value === undefined ? 10 : Number(value)))
  @IsInt()
  @Min(1)
  RATE_LIMIT_BURST: number = 10;

  @IsString()
  @MinLength(1)
  CONTENT_TYPES_DIR: string = "content-types";

  @Transform(({ value }: { value: unknown }) => (value === undefined ? 10 * 1024 * 1024 : Number(value)))
  @IsInt()
  @Min(1)
  MEDIA_MAX_UPLOAD_BYTES: number = 10 * 1024 * 1024;

  @Transform(({ value }: { value: unknown }) => (value === undefined ? 8080 : Number(value)))
  @IsInt()
  @Min(1)
  SERVER_PORT: number = 8080;

  // Express "trust proxy" setting — how many hops of X-Forwarded-For to trust in front of this app.
  // Default "1" assumes a single reverse-proxy hop (e.g. Render's edge). See docs/documents/auth.md.
  @IsString()
  @MinLength(1)
  TRUST_PROXY: string = "1";

  // Which email sender to use when multiple providers' credentials are configured.
  // "auto" keeps the old implicit behavior: Gmail if GMAIL_CLIENT_ID is set, else SMTP if
  // SMTP_HOST is set, else Resend if RESEND_API_KEY is set, else Brevo if BREVO_API_KEY is set,
  // else SendGrid if SENDGRID_API_KEY is set, else console logging. See resolve-email-sender.ts.
  @IsIn(["auto", "gmail", "smtp", "resend", "brevo", "sendgrid", "console"])
  EMAIL_PROVIDER: "auto" | "gmail" | "smtp" | "resend" | "brevo" | "sendgrid" | "console" = "auto";

  // SMTP — SMTP_HOST unset means "use ConsoleEmailSender" (dev/test fallback), see resolve-email-sender.ts
  @IsString()
  SMTP_HOST: string = "";

  @Transform(({ value }: { value: unknown }) => (value === undefined ? 587 : Number(value)))
  @IsInt()
  @Min(1)
  SMTP_PORT: number = 587;

  @IsString()
  SMTP_USER: string = "";

  @IsString()
  SMTP_PASSWORD: string = "";

  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return false;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsIn([true, false])
  SMTP_SECURE: boolean = false;

  // Patches Node's DNS resolver to skip AAAA records so SMTP always connects over IPv4. Works
  // around ISPs that advertise unreachable IPv6 routes to mail providers (EHOSTUNREACH). Disable
  // if this host's IPv6 connectivity is known-good. See bootstrap/force-ipv4-dns.ts.
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return true;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsIn([true, false])
  SMTP_FORCE_IPV4_DNS: boolean = true;

  // Gmail API (OAuth2 over HTTPS) — bypasses SMTP entirely, for hosts that block outbound SMTP
  // ports (e.g. Render free tier). See EMAIL_PROVIDER above and resolve-email-sender.ts.
  @IsString()
  GMAIL_CLIENT_ID: string = "";

  @IsString()
  GMAIL_CLIENT_SECRET: string = "";

  @IsString()
  GMAIL_REFRESH_TOKEN: string = "";

  @IsString()
  GMAIL_SENDER_EMAIL: string = "";

  @IsString()
  @MinLength(1)
  EMAIL_FROM: string = "no-reply@example.com";

  @IsString()
  @MinLength(1)
  FRONTEND_URL: string = "http://localhost:3000";

  // Resend (https://resend.com) — see EMAIL_PROVIDER above and resolve-email-sender.ts.
  @IsString()
  RESEND_API_KEY: string = "";

  // Brevo (https://brevo.com) — see EMAIL_PROVIDER above and resolve-email-sender.ts.
  @IsString()
  BREVO_API_KEY: string = "";

  // SendGrid (https://sendgrid.com) — see EMAIL_PROVIDER above and resolve-email-sender.ts.
  @IsString()
  SENDGRID_API_KEY: string = "";

  // Redis — optional cache for the refresh-token blacklist (see
  // docs/documents/token-blacklist-techstack.md). Off by default; the client is never constructed
  // when disabled. REDIS_URL is only required when the flag is on.
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return false;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  @IsIn([true, false])
  REDIS_ENABLED: boolean = false;

  @ValidateIf((env: EnvironmentVariables) => env.REDIS_ENABLED === true)
  @IsString()
  @MinLength(1)
  REDIS_URL: string = "";
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Environment variable validation failed: ${errors.toString()}`);
  }

  return validatedConfig;
}

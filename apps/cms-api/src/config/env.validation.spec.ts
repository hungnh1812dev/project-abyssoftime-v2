import { validate } from "./env.validation";

describe("validate", () => {
  const requiredConfig = {
    JWT_ACCESS_SECRET: "access-secret",
    JWT_REFRESH_SECRET: "refresh-secret",
    COOKIE_SECURE: "true",
    COOKIE_SAMESITE: "lax",
    CORS_ORIGINS: "http://localhost:3000",
  };

  it("throws when required fields are missing", () => {
    expect(() => validate({})).toThrow(/Environment variable validation failed/);
  });

  it("throws when DB_DRIVER is not one of the supported drivers", () => {
    expect(() => validate({ ...requiredConfig, DB_DRIVER: "not-a-real-driver" })).toThrow();
  });

  it("applies defaults for every field with one, given only the required fields", () => {
    const result = validate(requiredConfig);

    expect(result.DB_DRIVER).toBe("postgresql");
    expect(result.DB_HOST).toBe("localhost");
    expect(result.DB_NAME).toBe("abyssoftime-cms");
    expect(result.DB_PASSWORD).toBe("");
    expect(result.DB_PORT).toBe("5432");
    expect(result.DB_USERNAME).toBe("postgres");
    expect(result.RATE_LIMIT_FPS).toBe(5);
    expect(result.RATE_LIMIT_BURST).toBe(10);
    expect(result.CONTENT_TYPES_DIR).toBe("content-types");
    expect(result.MEDIA_MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    expect(result.SERVER_PORT).toBe(8080);
    expect(result.SMTP_HOST).toBe("");
    expect(result.SMTP_PORT).toBe(587);
    expect(result.SMTP_USER).toBe("");
    expect(result.SMTP_PASSWORD).toBe("");
    expect(result.SMTP_SECURE).toBe(false);
    expect(result.SMTP_FORCE_IPV4_DNS).toBe(true);
    expect(result.EMAIL_FROM).toBe("no-reply@example.com");
    expect(result.FRONTEND_URL).toBe("http://localhost:3000");
    expect(result.REDIS_ENABLED).toBe(false);
    expect(result.REDIS_URL).toBe("");
    expect(result.RESEND_API_KEY).toBe("");
    expect(result.BREVO_API_KEY).toBe("");
    expect(result.SENDGRID_API_KEY).toBe("");
  });

  it("accepts EMAIL_PROVIDER=resend", () => {
    const result = validate({ ...requiredConfig, EMAIL_PROVIDER: "resend" });

    expect(result.EMAIL_PROVIDER).toBe("resend");
  });

  it("overrides RESEND_API_KEY when explicitly provided", () => {
    const result = validate({ ...requiredConfig, RESEND_API_KEY: "re_123" });

    expect(result.RESEND_API_KEY).toBe("re_123");
  });

  it("accepts EMAIL_PROVIDER=brevo", () => {
    const result = validate({ ...requiredConfig, EMAIL_PROVIDER: "brevo" });

    expect(result.EMAIL_PROVIDER).toBe("brevo");
  });

  it("overrides BREVO_API_KEY when explicitly provided", () => {
    const result = validate({ ...requiredConfig, BREVO_API_KEY: "xkeysib-123" });

    expect(result.BREVO_API_KEY).toBe("xkeysib-123");
  });

  it("accepts EMAIL_PROVIDER=sendgrid", () => {
    const result = validate({ ...requiredConfig, EMAIL_PROVIDER: "sendgrid" });

    expect(result.EMAIL_PROVIDER).toBe("sendgrid");
  });

  it("overrides SENDGRID_API_KEY when explicitly provided", () => {
    const result = validate({ ...requiredConfig, SENDGRID_API_KEY: "SG.123" });

    expect(result.SENDGRID_API_KEY).toBe("SG.123");
  });

  it("transforms COOKIE_SECURE 'true' to boolean true", () => {
    const result = validate({ ...requiredConfig, COOKIE_SECURE: "true" });

    expect(result.COOKIE_SECURE).toBe(true);
  });

  it("transforms COOKIE_SECURE 'false' to boolean false", () => {
    const result = validate({ ...requiredConfig, COOKIE_SECURE: "false" });

    expect(result.COOKIE_SECURE).toBe(false);
  });

  it("passes an already-boolean COOKIE_SECURE straight through", () => {
    const result = validate({ ...requiredConfig, COOKIE_SECURE: true });

    expect(result.COOKIE_SECURE).toBe(true);
  });

  it("rejects a COOKIE_SECURE value that isn't 'true'/'false'/a boolean", () => {
    expect(() => validate({ ...requiredConfig, COOKIE_SECURE: "yes" })).toThrow();
  });

  it("rejects a COOKIE_SAMESITE value outside lax/strict/none", () => {
    expect(() => validate({ ...requiredConfig, COOKIE_SAMESITE: "invalid" })).toThrow();
  });

  it("rejects an empty CORS_ORIGINS value", () => {
    expect(() => validate({ ...requiredConfig, CORS_ORIGINS: "" })).toThrow();
  });

  it("overrides RATE_LIMIT_FPS/RATE_LIMIT_BURST when explicitly provided", () => {
    const result = validate({ ...requiredConfig, RATE_LIMIT_FPS: "20", RATE_LIMIT_BURST: "40" });

    expect(result.RATE_LIMIT_FPS).toBe(20);
    expect(result.RATE_LIMIT_BURST).toBe(40);
  });

  it("overrides MEDIA_MAX_UPLOAD_BYTES and SERVER_PORT when explicitly provided", () => {
    const result = validate({ ...requiredConfig, MEDIA_MAX_UPLOAD_BYTES: "1024", SERVER_PORT: "9090" });

    expect(result.MEDIA_MAX_UPLOAD_BYTES).toBe(1024);
    expect(result.SERVER_PORT).toBe(9090);
  });

  it("overrides the SMTP/email fields when explicitly provided", () => {
    const result = validate({
      ...requiredConfig,
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "2525",
      SMTP_USER: "user@example.com",
      SMTP_PASSWORD: "hunter2",
      SMTP_SECURE: "true",
      SMTP_FORCE_IPV4_DNS: "false",
      EMAIL_FROM: "hello@abyssoftime.com",
      FRONTEND_URL: "https://abyssoftime.com",
    });

    expect(result.SMTP_HOST).toBe("smtp.example.com");
    expect(result.SMTP_PORT).toBe(2525);
    expect(result.SMTP_USER).toBe("user@example.com");
    expect(result.SMTP_PASSWORD).toBe("hunter2");
    expect(result.SMTP_SECURE).toBe(true);
    expect(result.SMTP_FORCE_IPV4_DNS).toBe(false);
    expect(result.EMAIL_FROM).toBe("hello@abyssoftime.com");
    expect(result.FRONTEND_URL).toBe("https://abyssoftime.com");
  });

  it("rejects a SMTP_FORCE_IPV4_DNS value that isn't 'true'/'false'/a boolean", () => {
    expect(() => validate({ ...requiredConfig, SMTP_FORCE_IPV4_DNS: "yes" })).toThrow();
  });

  it("defaults REDIS_ENABLED to false and REDIS_URL to empty", () => {
    const result = validate(requiredConfig);

    expect(result.REDIS_ENABLED).toBe(false);
    expect(result.REDIS_URL).toBe("");
  });

  it("accepts REDIS_ENABLED true when REDIS_URL is set", () => {
    const result = validate({ ...requiredConfig, REDIS_ENABLED: "true", REDIS_URL: "redis://localhost:6379" });

    expect(result.REDIS_ENABLED).toBe(true);
    expect(result.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("rejects REDIS_ENABLED true with an empty REDIS_URL", () => {
    expect(() => validate({ ...requiredConfig, REDIS_ENABLED: "true" })).toThrow(/Environment variable validation failed/);
  });

  it("rejects a REDIS_ENABLED value that isn't 'true'/'false'/a boolean", () => {
    expect(() => validate({ ...requiredConfig, REDIS_ENABLED: "yes" })).toThrow();
  });

  it("falls back to defaults when the numeric fields are present but explicitly undefined", () => {
    const result = validate({
      ...requiredConfig,
      RATE_LIMIT_FPS: undefined,
      RATE_LIMIT_BURST: undefined,
      MEDIA_MAX_UPLOAD_BYTES: undefined,
      SERVER_PORT: undefined,
    });

    expect(result.RATE_LIMIT_FPS).toBe(5);
    expect(result.RATE_LIMIT_BURST).toBe(10);
    expect(result.MEDIA_MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    expect(result.SERVER_PORT).toBe(8080);
  });
});

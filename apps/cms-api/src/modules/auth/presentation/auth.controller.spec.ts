import { ForgotPasswordDto } from "../application/dto/forgot-password.dto";
import { LoginDto } from "../application/dto/login.dto";
import { RegisterDto } from "../application/dto/register.dto";
import { ResendOtpDto } from "../application/dto/resend-otp.dto";
import { ResetPasswordDto } from "../application/dto/reset-password.dto";
import { VerifyOtpDto } from "../application/dto/verify-otp.dto";
import { ForgotPasswordService } from "../application/services/forgot-password.service";
import { GetMeService } from "../application/services/get-me.service";
import { HasUsersService } from "../application/services/has-users.service";
import { LoginService } from "../application/services/login.service";
import { LogoutService } from "../application/services/logout.service";
import { RefreshTokenService } from "../application/services/refresh-token.service";
import { RegisterService } from "../application/services/register.service";
import { ResendOtpService } from "../application/services/resend-otp.service";
import { ResetPasswordService } from "../application/services/reset-password.service";
import { VerifyOtpService } from "../application/services/verify-otp.service";
import { type Request, type Response } from "express";

import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { REFRESH_TOKEN_COOKIE } from "@/common/guards/jwt-refresh.guard";
import { type ValidatedLoginUser } from "@/common/strategies/local.strategy";
import { type AuthenticatedRefreshRequest, type AuthenticatedRequest } from "@/common/types/authenticated-request";
import { RoleEntity } from "@/modules/roles/domain/entities/role.entiry";
import { UserEntity } from "@/modules/users/domain/entities/user.entity";

import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  let controller: AuthController;
  let registerService: jest.Mocked<RegisterService>;
  let verifyOtpService: jest.Mocked<VerifyOtpService>;
  let resendOtpService: jest.Mocked<ResendOtpService>;
  let hasUsersService: jest.Mocked<HasUsersService>;
  let loginService: jest.Mocked<LoginService>;
  let refreshTokenService: jest.Mocked<RefreshTokenService>;
  let logoutService: jest.Mocked<LogoutService>;
  let forgotPasswordService: jest.Mocked<ForgotPasswordService>;
  let resetPasswordService: jest.Mocked<ResetPasswordService>;
  let getMeService: jest.Mocked<GetMeService>;
  let res: jest.Mocked<Pick<Response, "cookie" | "clearCookie">>;

  const configValues: Record<string, unknown> = { COOKIE_SECURE: true, COOKIE_SAMESITE: "lax" };

  beforeEach(async () => {
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterService, useValue: { execute: jest.fn() } },
        { provide: VerifyOtpService, useValue: { execute: jest.fn() } },
        { provide: ResendOtpService, useValue: { execute: jest.fn() } },
        { provide: HasUsersService, useValue: { execute: jest.fn() } },
        { provide: LoginService, useValue: { execute: jest.fn() } },
        { provide: RefreshTokenService, useValue: { execute: jest.fn() } },
        { provide: LogoutService, useValue: { execute: jest.fn() } },
        { provide: ForgotPasswordService, useValue: { execute: jest.fn() } },
        { provide: ResetPasswordService, useValue: { execute: jest.fn() } },
        { provide: GetMeService, useValue: { execute: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => configValues[key]) } },
      ],
    }).compile();

    controller = module.get(AuthController);
    registerService = module.get(RegisterService);
    verifyOtpService = module.get(VerifyOtpService);
    resendOtpService = module.get(ResendOtpService);
    hasUsersService = module.get(HasUsersService);
    loginService = module.get(LoginService);
    refreshTokenService = module.get(RefreshTokenService);
    logoutService = module.get(LogoutService);
    forgotPasswordService = module.get(ForgotPasswordService);
    resetPasswordService = module.get(ResetPasswordService);
    getMeService = module.get(GetMeService);
  });

  it("register() delegates to RegisterService", async () => {
    const dto: RegisterDto = { email: "jane@example.com", name: "Jane Doe", username: "janedoe", password: "s3cret", accountType: true };
    registerService.execute.mockResolvedValue(undefined);

    const result = await controller.register(dto);

    expect(registerService.execute).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: "Registration successful. Check your email for the verification code." });
  });

  it("verifyOtp() delegates to VerifyOtpService", async () => {
    const dto: VerifyOtpDto = { email: "jane@example.com", otp: "123456" };
    verifyOtpService.execute.mockResolvedValue(undefined);

    const result = await controller.verifyOtp(dto);

    expect(verifyOtpService.execute).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: "Email verified successfully." });
  });

  it("resendOtp() delegates to ResendOtpService", async () => {
    const dto: ResendOtpDto = { email: "jane@example.com" };
    resendOtpService.execute.mockResolvedValue(undefined);

    const result = await controller.resendOtp(dto);

    expect(resendOtpService.execute).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: "A new verification code has been sent." });
  });

  it("hasUsers() delegates to HasUsersService and reports true", async () => {
    hasUsersService.execute.mockResolvedValue(true);

    const result = await controller.hasUsers();

    expect(hasUsersService.execute).toHaveBeenCalled();
    expect(result).toEqual({ hasUsers: true });
  });

  it("hasUsers() reports false when no user exists", async () => {
    hasUsersService.execute.mockResolvedValue(false);

    const result = await controller.hasUsers();

    expect(result).toEqual({ hasUsers: false });
  });

  it("login() defaults rememberMe to false when omitted, returns accessToken in the body, and sets only the refresh cookie", () => {
    const dto: LoginDto = { email: "jane@example.com", password: "s3cret" };
    const validatedUser = { user: { documentId: "user-1" }, role: { slug: "admin" } } as unknown as ValidatedLoginUser;
    const req = { user: validatedUser } as unknown as Request & { user: ValidatedLoginUser };
    loginService.execute.mockReturnValue({ accessToken: "access-token", refreshToken: "refresh-token", refreshTokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000 });

    const result = controller.login(dto, req, res as unknown as Response);

    expect(loginService.execute).toHaveBeenCalledWith(validatedUser, false);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      "refresh-token",
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 }),
    );
    expect(result).toEqual({ message: "Login successful.", accessToken: "access-token" });
  });

  it("login() passes rememberMe:true through and sets a 30-day refresh cookie", () => {
    const dto: LoginDto = { email: "jane@example.com", password: "s3cret", rememberMe: true };
    const validatedUser = { user: { documentId: "user-1" }, role: { slug: "admin" } } as unknown as ValidatedLoginUser;
    const req = { user: validatedUser } as unknown as Request & { user: ValidatedLoginUser };
    loginService.execute.mockReturnValue({ accessToken: "access-token", refreshToken: "refresh-token", refreshTokenMaxAgeMs: 30 * 24 * 60 * 60 * 1000 });

    const result = controller.login(dto, req, res as unknown as Response);

    expect(loginService.execute).toHaveBeenCalledWith(validatedUser, true);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, "refresh-token", expect.objectContaining({ maxAge: 30 * 24 * 60 * 60 * 1000 }));
    expect(result).toEqual({ message: "Login successful.", accessToken: "access-token" });
  });

  it("refresh() delegates to RefreshTokenService with the guard-verified sub/rememberMe, returns the rotated accessToken in the body, and rotates only the refresh cookie", async () => {
    const req = { user: { sub: "user-1", rememberMe: true } } as unknown as AuthenticatedRefreshRequest;
    refreshTokenService.execute.mockResolvedValue({ accessToken: "new-access-token", refreshToken: "new-refresh-token", refreshTokenMaxAgeMs: 30 * 24 * 60 * 60 * 1000 });

    const result = await controller.refresh(req, res as unknown as Response);

    expect(refreshTokenService.execute).toHaveBeenCalledWith("user-1", true);
    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, "new-refresh-token", expect.objectContaining({ maxAge: 30 * 24 * 60 * 60 * 1000 }));
    expect(result).toEqual({ message: "Token refreshed.", accessToken: "new-access-token" });
  });

  it("refresh() defaults rememberMe to false for a pre-change refresh token that carries no rememberMe field", async () => {
    const req = { user: { sub: "user-1" } } as unknown as AuthenticatedRefreshRequest;
    refreshTokenService.execute.mockResolvedValue({ accessToken: "new-access-token", refreshToken: "new-refresh-token", refreshTokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000 });

    await controller.refresh(req, res as unknown as Response);

    expect(refreshTokenService.execute).toHaveBeenCalledWith("user-1", false);
  });

  it("logout() passes the refresh cookie to LogoutService and clears only the refresh cookie", async () => {
    const req = { cookies: { [REFRESH_TOKEN_COOKIE]: "raw-refresh-token" } } as unknown as Request;
    logoutService.execute.mockResolvedValue(undefined);

    const result = await controller.logout(req, res as unknown as Response);

    expect(logoutService.execute).toHaveBeenCalledWith("raw-refresh-token");
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE);
    expect(result).toEqual({ message: "Logged out." });
  });

  it("logout() passes undefined to LogoutService when there is no refresh cookie, and still clears the cookie", async () => {
    const req = { cookies: {} } as unknown as Request;
    logoutService.execute.mockResolvedValue(undefined);

    const result = await controller.logout(req, res as unknown as Response);

    expect(logoutService.execute).toHaveBeenCalledWith(undefined);
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE);
    expect(result).toEqual({ message: "Logged out." });
  });

  it("me() delegates to GetMeService with the caller's sub and returns the mapped DTO", async () => {
    const user = new UserEntity("user-1", "jane@example.com", "Jane Doe", "janedoe", "secret", true, true, "role-1", new Date(), new Date());
    const role = new RoleEntity("role-1", "Editor", "editor", ["document:read"], 20, false, new Date(), new Date(), null);
    const req = { user: { sub: "user-1", roleSlug: "editor", level: 20, permissions: ["document:read"] } } as unknown as AuthenticatedRequest;
    getMeService.execute.mockResolvedValue({ user, role });

    const result = await controller.me(req);

    expect(getMeService.execute).toHaveBeenCalledWith("user-1");
    expect(result.documentId).toBe("user-1");
    expect(result.roleId).toBe("role-1");
    expect(result.role?.documentId).toBe("role-1");
  });

  it("forgotPassword() delegates to ForgotPasswordService", async () => {
    const dto: ForgotPasswordDto = { email: "jane@example.com" };
    forgotPasswordService.execute.mockResolvedValue(undefined);

    const result = await controller.forgotPassword(dto);

    expect(forgotPasswordService.execute).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: "If that email is registered, a password reset link has been sent." });
  });

  it("resetPassword() delegates to ResetPasswordService", async () => {
    const dto: ResetPasswordDto = { token: "raw-token", newPassword: "new-s3cret" };
    resetPasswordService.execute.mockResolvedValue(undefined);

    const result = await controller.resetPassword(dto);

    expect(resetPasswordService.execute).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ message: "Password reset successfully." });
  });
});

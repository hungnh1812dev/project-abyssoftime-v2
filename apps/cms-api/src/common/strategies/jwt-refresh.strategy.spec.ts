import { REFRESH_TOKEN_COOKIE } from "../guards/jwt-refresh.guard";
import { type TokenBlacklistService } from "../token-blacklist/token-blacklist.service";
import { type RefreshTokenPayload } from "../types/jwt-payload";
import { type Request } from "express";

import { UnauthorizedException } from "@nestjs/common";
import { type ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { jwtRefreshCookieExtractor, JwtRefreshStrategy } from "./jwt-refresh.strategy";

describe("jwtRefreshCookieExtractor", () => {
  it("returns the refresh token when the cookie is present", () => {
    const req = { cookies: { [REFRESH_TOKEN_COOKIE]: "good-refresh-token" } } as unknown as Request;

    expect(jwtRefreshCookieExtractor(req)).toBe("good-refresh-token");
  });

  it("returns null when the cookie is absent", () => {
    const req = { cookies: {} } as unknown as Request;

    expect(jwtRefreshCookieExtractor(req)).toBeNull();
  });

  it("returns null when req.cookies itself is undefined", () => {
    const req = {} as unknown as Request;

    expect(jwtRefreshCookieExtractor(req)).toBeNull();
  });

  it("returns null when the cookie value isn't a non-empty string", () => {
    const req = { cookies: { [REFRESH_TOKEN_COOKIE]: "" } } as unknown as Request;

    expect(jwtRefreshCookieExtractor(req)).toBeNull();
  });
});

describe("JwtRefreshStrategy", () => {
  let configService: { get: jest.Mock };
  let tokenBlacklistService: { isBlacklisted: jest.Mock };
  let strategy: JwtRefreshStrategy;

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue("refresh-secret") };
    tokenBlacklistService = { isBlacklisted: jest.fn().mockResolvedValue(false) };
    strategy = new JwtRefreshStrategy(configService as unknown as ConfigService<EnvironmentVariables, true>, tokenBlacklistService as unknown as TokenBlacklistService);
  });

  it("reads the secret from JWT_REFRESH_SECRET", () => {
    expect(configService.get).toHaveBeenCalledWith("JWT_REFRESH_SECRET", { infer: true });
  });

  it("validate() returns the payload unchanged when the jti is not blacklisted", async () => {
    const payload: RefreshTokenPayload = { sub: "user-1", rememberMe: true, jti: "jti-1" };

    await expect(strategy.validate(payload)).resolves.toEqual(payload);
    expect(tokenBlacklistService.isBlacklisted).toHaveBeenCalledWith("jti-1");
  });

  it("validate() throws Unauthorized when the jti is blacklisted", async () => {
    tokenBlacklistService.isBlacklisted.mockResolvedValue(true);
    const payload: RefreshTokenPayload = { sub: "user-1", rememberMe: true, jti: "jti-1" };

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it("validate() skips the blacklist check and passes through when jti is absent (pre-migration token)", async () => {
    const payload: RefreshTokenPayload = { sub: "user-1", rememberMe: true };

    await expect(strategy.validate(payload)).resolves.toEqual(payload);
    expect(tokenBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });
});

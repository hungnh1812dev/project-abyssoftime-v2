import { type AccessTokenPayload, type RefreshTokenPayload } from "../types/jwt-payload";

import { type ConfigService } from "@nestjs/config";
import { type JwtService } from "@nestjs/jwt";

import { type EnvironmentVariables } from "@/config/env.validation";

import { JwtTokenService } from "./jwt-token.service";

describe("JwtTokenService", () => {
  let jwtService: jest.Mocked<Pick<JwtService, "sign" | "verify">>;
  let configService: { get: jest.Mock };
  let service: JwtTokenService;

  const accessPayload: AccessTokenPayload = { sub: "user-1", roleSlug: "admin", level: 50, permissions: ["role:read"] };
  const refreshPayload: RefreshTokenPayload = { sub: "user-1", rememberMe: false };
  const rememberedRefreshPayload: RefreshTokenPayload = { sub: "user-1", rememberMe: true };

  beforeEach(() => {
    jwtService = { sign: jest.fn(), verify: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        if (key === "JWT_ACCESS_SECRET") return "access-secret";
        if (key === "JWT_REFRESH_SECRET") return "refresh-secret";
        throw new Error(`unexpected config key "${key}"`);
      }),
    };

    service = new JwtTokenService(jwtService as unknown as JwtService, configService as unknown as ConfigService<EnvironmentVariables, true>);
  });

  it("signAccessToken() signs with the access secret and a 15m expiry", () => {
    jwtService.sign.mockReturnValue("access-token");

    const result = service.signAccessToken(accessPayload);

    expect(jwtService.sign).toHaveBeenCalledWith(accessPayload, { secret: "access-secret", expiresIn: "15m" });
    expect(result).toBe("access-token");
  });

  it("signRefreshToken() signs with the refresh secret and a 7d expiry when rememberMe is false", () => {
    jwtService.sign.mockReturnValue("refresh-token");

    const result = service.signRefreshToken(refreshPayload);

    const [signedPayload, options] = jwtService.sign.mock.calls[0] as [RefreshTokenPayload, unknown];
    expect(signedPayload.sub).toBe(refreshPayload.sub);
    expect(signedPayload.rememberMe).toBe(refreshPayload.rememberMe);
    expect(signedPayload.jti).toEqual(expect.any(String));
    expect(options).toEqual({ secret: "refresh-secret", expiresIn: "7d" });
    expect(result).toBe("refresh-token");
  });

  it("signRefreshToken() signs with the refresh secret and a 30d expiry when rememberMe is true", () => {
    jwtService.sign.mockReturnValue("remembered-refresh-token");

    const result = service.signRefreshToken(rememberedRefreshPayload);

    const [signedPayload, options] = jwtService.sign.mock.calls[0] as [RefreshTokenPayload, unknown];
    expect(signedPayload.sub).toBe(rememberedRefreshPayload.sub);
    expect(signedPayload.rememberMe).toBe(rememberedRefreshPayload.rememberMe);
    expect(signedPayload.jti).toEqual(expect.any(String));
    expect(options).toEqual({ secret: "refresh-secret", expiresIn: "30d" });
    expect(result).toBe("remembered-refresh-token");
  });

  it("signRefreshToken() generates a unique jti on every call", () => {
    jwtService.sign.mockReturnValue("refresh-token");

    service.signRefreshToken(refreshPayload);
    service.signRefreshToken(refreshPayload);

    const [firstCallPayload] = jwtService.sign.mock.calls[0] as [RefreshTokenPayload, unknown];
    const [secondCallPayload] = jwtService.sign.mock.calls[1] as [RefreshTokenPayload, unknown];

    expect(firstCallPayload.jti).toEqual(expect.any(String));
    expect(firstCallPayload.jti).not.toBe(secondCallPayload.jti);
  });

  it("getRefreshTokenMaxAgeMs(false) returns the 7-day cookie maxAge", () => {
    expect(service.getRefreshTokenMaxAgeMs(false)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("getRefreshTokenMaxAgeMs(true) returns the 30-day cookie maxAge", () => {
    expect(service.getRefreshTokenMaxAgeMs(true)).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("verifyAccessToken() verifies with the access secret", () => {
    jwtService.verify.mockReturnValue(accessPayload);

    const result = service.verifyAccessToken("access-token");

    expect(jwtService.verify).toHaveBeenCalledWith("access-token", { secret: "access-secret" });
    expect(result).toEqual(accessPayload);
  });

  it("verifyRefreshToken() verifies with the refresh secret", () => {
    jwtService.verify.mockReturnValue(refreshPayload);

    const result = service.verifyRefreshToken("refresh-token");

    expect(jwtService.verify).toHaveBeenCalledWith("refresh-token", { secret: "refresh-secret" });
    expect(result).toEqual(refreshPayload);
  });
});

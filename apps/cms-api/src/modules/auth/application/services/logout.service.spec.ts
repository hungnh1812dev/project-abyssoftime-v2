import { type TokenBlacklistService } from "@/common/token-blacklist/token-blacklist.service";
import { type JwtTokenService } from "@/common/token/jwt-token.service";
import { type RefreshTokenPayload } from "@/common/types/jwt-payload";

import { LogoutService } from "./logout.service";

describe("LogoutService", () => {
  let jwtTokenService: jest.Mocked<Pick<JwtTokenService, "verifyRefreshToken">>;
  let tokenBlacklistService: jest.Mocked<Pick<TokenBlacklistService, "blacklist">>;
  let service: LogoutService;

  beforeEach(() => {
    jwtTokenService = { verifyRefreshToken: jest.fn() };
    tokenBlacklistService = { blacklist: jest.fn() };
    service = new LogoutService(jwtTokenService as unknown as JwtTokenService, tokenBlacklistService as unknown as TokenBlacklistService);
  });

  it("blacklists the decoded jti/sub/exp with reason 'logout' when the cookie verifies", async () => {
    const payload: RefreshTokenPayload = { sub: "user-1", rememberMe: true, jti: "jti-1", exp: 1_700_000_000 };
    jwtTokenService.verifyRefreshToken.mockReturnValue(payload);
    tokenBlacklistService.blacklist.mockResolvedValue(undefined);

    await service.execute("valid-refresh-token");

    expect(jwtTokenService.verifyRefreshToken).toHaveBeenCalledWith("valid-refresh-token");
    expect(tokenBlacklistService.blacklist).toHaveBeenCalledWith({
      jti: "jti-1",
      userId: "user-1",
      expiresAt: new Date(1_700_000_000 * 1000),
      reason: "logout",
    });
  });

  it("does nothing when no cookie value is passed", async () => {
    await service.execute(undefined);

    expect(jwtTokenService.verifyRefreshToken).not.toHaveBeenCalled();
    expect(tokenBlacklistService.blacklist).not.toHaveBeenCalled();
  });

  it("swallows a verification failure (garbage/expired token) without throwing or writing", async () => {
    jwtTokenService.verifyRefreshToken.mockImplementation(() => {
      throw new Error("jwt expired");
    });

    await expect(service.execute("garbage-token")).resolves.toBeUndefined();
    expect(tokenBlacklistService.blacklist).not.toHaveBeenCalled();
  });

  it("skips the write for a pre-migration token that verifies but carries no jti", async () => {
    const payload: RefreshTokenPayload = { sub: "user-1", rememberMe: false };
    jwtTokenService.verifyRefreshToken.mockReturnValue(payload);

    await service.execute("old-token-no-jti");

    expect(tokenBlacklistService.blacklist).not.toHaveBeenCalled();
  });
});

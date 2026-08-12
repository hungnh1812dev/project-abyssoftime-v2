import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { TokenBlacklistService } from "@/common/token-blacklist/token-blacklist.service";
import { JwtTokenService } from "@/common/token/jwt-token.service";
import { RoleEntity } from "@/modules/roles/domain/entities/role.entiry";
import { type IRoleRepository, ROLE_REPOSITORY } from "@/modules/roles/domain/repositories/role.repository";
import { UserEntity } from "@/modules/users/domain/entities/user.entity";
import { type IUserRepository, USER_REPOSITORY } from "@/modules/users/domain/repositories/user.repository";

import { RefreshTokenService } from "./refresh-token.service";

describe("RefreshTokenService", () => {
  let service: RefreshTokenService;
  let users: jest.Mocked<IUserRepository>;
  let roles: jest.Mocked<IRoleRepository>;
  let jwtTokenService: jest.Mocked<Pick<JwtTokenService, "signAccessToken" | "signRefreshToken" | "getRefreshTokenMaxAgeMs">>;
  let tokenBlacklistService: jest.Mocked<Pick<TokenBlacklistService, "tryClaim">>;

  const adminRole = new RoleEntity("role-admin", "Admin", "admin", ["user:read"], 50, true, new Date(), new Date(), null);
  const verifiedUser = new UserEntity("user-1", "jane@example.com", "Jane Doe", "janedoe", "hashed-password", true, true, "role-admin", new Date(), new Date());

  beforeEach(async () => {
    users = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      findByIds: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      hasAnyVerified: jest.fn(),
      completeVerification: jest.fn(),
      findByResetTokenHash: jest.fn(),
    };
    roles = {
      findAll: jest.fn(),
      findBySlug: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      hasAny: jest.fn(),
    };
    jwtTokenService = { signAccessToken: jest.fn(), signRefreshToken: jest.fn(), getRefreshTokenMaxAgeMs: jest.fn() };
    tokenBlacklistService = { tryClaim: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: USER_REPOSITORY, useValue: users },
        { provide: ROLE_REPOSITORY, useValue: roles },
        { provide: JwtTokenService, useValue: jwtTokenService },
        { provide: TokenBlacklistService, useValue: tokenBlacklistService },
      ],
    }).compile();

    service = module.get(RefreshTokenService);
  });

  // Refresh-token verification (signature/expiry) now happens in JwtRefreshStrategy before this
  // service ever runs — see jwt-refresh.strategy.spec.ts. This service only re-derives state from
  // an already-verified `sub`.
  it("throws UnauthorizedException when the token's subject no longer exists, and claims nothing", async () => {
    users.findById.mockResolvedValue(null);

    await expect(service.execute("user-1", false, "old-jti", 1700000000)).rejects.toThrow(UnauthorizedException);
    expect(tokenBlacklistService.tryClaim).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the user has no role assigned, and claims nothing", async () => {
    users.findById.mockResolvedValue(new UserEntity("user-1", "jane@example.com", "Jane Doe", "janedoe", "hashed-password", true, true, null, new Date(), new Date()));

    await expect(service.execute("user-1", false, "old-jti", 1700000000)).rejects.toThrow(UnauthorizedException);
    expect(tokenBlacklistService.tryClaim).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException when the user's assigned role no longer exists, and claims nothing", async () => {
    // IRoleRepository.findById's type says non-null, but prisma-role.repository.ts returns
    // `null as unknown as RoleEntity` on a miss — e.g. the role was deleted after this user's
    // session was established. Every other findById caller in the codebase guards this; this one
    // must too, or it throws an unhandled TypeError instead of a controlled 401.
    users.findById.mockResolvedValue(verifiedUser);
    roles.findById.mockResolvedValue(null as unknown as RoleEntity);

    await expect(service.execute("user-1", false, "old-jti", 1700000000)).rejects.toThrow(UnauthorizedException);
    expect(tokenBlacklistService.tryClaim).not.toHaveBeenCalled();
  });

  it("re-fetches the user and role fresh from the database, atomically claims the consumed jti before signing, and rotates both tokens preserving rememberMe:true", async () => {
    users.findById.mockResolvedValue(verifiedUser);
    roles.findById.mockResolvedValue(adminRole);
    tokenBlacklistService.tryClaim.mockResolvedValue(true);
    jwtTokenService.signAccessToken.mockReturnValue("new-access-token");
    jwtTokenService.signRefreshToken.mockReturnValue("new-refresh-token");
    jwtTokenService.getRefreshTokenMaxAgeMs.mockReturnValue(30 * 24 * 60 * 60 * 1000);

    const result = await service.execute("user-1", true, "old-jti", 1700000000);

    expect(users.findById).toHaveBeenCalledWith("user-1");
    expect(roles.findById).toHaveBeenCalledWith("role-admin");
    expect(tokenBlacklistService.tryClaim).toHaveBeenCalledWith({ jti: "old-jti", userId: "user-1", expiresAt: new Date(1700000000 * 1000), reason: "rotation" });
    expect(jwtTokenService.signAccessToken).toHaveBeenCalledWith({
      sub: "user-1",
      roleSlug: adminRole.slug,
      level: adminRole.level,
      permissions: adminRole.permissions,
    });
    expect(jwtTokenService.signRefreshToken).toHaveBeenCalledWith({ sub: "user-1", rememberMe: true });
    expect(jwtTokenService.getRefreshTokenMaxAgeMs).toHaveBeenCalledWith(true);
    expect(result).toEqual({ accessToken: "new-access-token", refreshToken: "new-refresh-token", refreshTokenMaxAgeMs: 30 * 24 * 60 * 60 * 1000 });
  });

  it("rotates both tokens preserving rememberMe:false, and claims the consumed jti", async () => {
    users.findById.mockResolvedValue(verifiedUser);
    roles.findById.mockResolvedValue(adminRole);
    tokenBlacklistService.tryClaim.mockResolvedValue(true);
    jwtTokenService.signAccessToken.mockReturnValue("new-access-token");
    jwtTokenService.signRefreshToken.mockReturnValue("new-refresh-token");
    jwtTokenService.getRefreshTokenMaxAgeMs.mockReturnValue(7 * 24 * 60 * 60 * 1000);

    const result = await service.execute("user-1", false, "old-jti", 1700000000);

    expect(jwtTokenService.signRefreshToken).toHaveBeenCalledWith({ sub: "user-1", rememberMe: false });
    expect(jwtTokenService.getRefreshTokenMaxAgeMs).toHaveBeenCalledWith(false);
    expect(tokenBlacklistService.tryClaim).toHaveBeenCalledWith({ jti: "old-jti", userId: "user-1", expiresAt: new Date(1700000000 * 1000), reason: "rotation" });
    expect(result).toEqual({ accessToken: "new-access-token", refreshToken: "new-refresh-token", refreshTokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000 });
  });

  it("throws UnauthorizedException and never signs new tokens when the claim loses the race (concurrently replayed cookie)", async () => {
    users.findById.mockResolvedValue(verifiedUser);
    roles.findById.mockResolvedValue(adminRole);
    tokenBlacklistService.tryClaim.mockResolvedValue(false);

    await expect(service.execute("user-1", false, "old-jti", 1700000000)).rejects.toThrow(UnauthorizedException);
    expect(jwtTokenService.signAccessToken).not.toHaveBeenCalled();
    expect(jwtTokenService.signRefreshToken).not.toHaveBeenCalled();
  });

  it("skips claiming when the consumed token carries no jti (pre-migration token), and still rotates successfully", async () => {
    users.findById.mockResolvedValue(verifiedUser);
    roles.findById.mockResolvedValue(adminRole);
    jwtTokenService.signAccessToken.mockReturnValue("new-access-token");
    jwtTokenService.signRefreshToken.mockReturnValue("new-refresh-token");
    jwtTokenService.getRefreshTokenMaxAgeMs.mockReturnValue(7 * 24 * 60 * 60 * 1000);

    const result = await service.execute("user-1", false);

    expect(tokenBlacklistService.tryClaim).not.toHaveBeenCalled();
    expect(result).toEqual({ accessToken: "new-access-token", refreshToken: "new-refresh-token", refreshTokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000 });
  });

  it("skips claiming when jti is present but exp is missing", async () => {
    users.findById.mockResolvedValue(verifiedUser);
    roles.findById.mockResolvedValue(adminRole);
    jwtTokenService.signAccessToken.mockReturnValue("new-access-token");
    jwtTokenService.signRefreshToken.mockReturnValue("new-refresh-token");
    jwtTokenService.getRefreshTokenMaxAgeMs.mockReturnValue(7 * 24 * 60 * 60 * 1000);

    await service.execute("user-1", false, "old-jti");

    expect(tokenBlacklistService.tryClaim).not.toHaveBeenCalled();
  });
});

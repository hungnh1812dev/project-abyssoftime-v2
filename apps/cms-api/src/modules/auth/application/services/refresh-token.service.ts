import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { TokenBlacklistService } from "@/common/token-blacklist/token-blacklist.service";
import { JwtTokenService } from "@/common/token/jwt-token.service";
import { type IRoleRepository, ROLE_REPOSITORY } from "@/modules/roles/domain/repositories/role.repository";
import { type IUserRepository, USER_REPOSITORY } from "@/modules/users/domain/repositories/user.repository";

import { type LoginResult } from "./login.service";

@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    private readonly jwtTokenService: JwtTokenService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  async execute(sub: string, rememberMe: boolean, jti?: string, exp?: number): Promise<LoginResult> {
    const user = await this.users.findById(sub);
    if (!user) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    if (!user.roleId) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const role = await this.roles.findById(user.roleId);
    if (!role) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Atomically claim the old jti (a Postgres unique-constraint INSERT, not a plain upsert)
    // *before* signing anything: a plain check-then-write (isBlacklisted() then blacklist()) would
    // leave a window where two concurrent requests replaying the same not-yet-consumed cookie both
    // pass the check and both mint a valid pair — defeating "rotation makes refresh tokens
    // single-use". Losing the claim (already used by a concurrent refresh, or already logged out)
    // rejects before any signing happens, so no tokens are minted for a losing replay. Pre-migration
    // tokens carry no jti/exp and cannot be claimed (see jwt-payload.ts) — skip straight to signing.
    if (jti && exp) {
      const claimed = await this.tokenBlacklistService.tryClaim({ jti, userId: sub, expiresAt: new Date(exp * 1000), reason: "rotation" });
      if (!claimed) {
        throw new UnauthorizedException("Invalid or expired refresh token");
      }
    }

    const accessToken = this.jwtTokenService.signAccessToken({ sub: user.documentId, roleSlug: role.slug, level: role.level, permissions: role.permissions });
    const newRefreshToken = this.jwtTokenService.signRefreshToken({ sub: user.documentId, rememberMe });
    const refreshTokenMaxAgeMs = this.jwtTokenService.getRefreshTokenMaxAgeMs(rememberMe);

    return { accessToken, refreshToken: newRefreshToken, refreshTokenMaxAgeMs };
  }
}

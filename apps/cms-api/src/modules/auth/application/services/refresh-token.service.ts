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

    const accessToken = this.jwtTokenService.signAccessToken({ sub: user.documentId, roleSlug: role.slug, level: role.level, permissions: role.permissions });
    const newRefreshToken = this.jwtTokenService.signRefreshToken({ sub: user.documentId, rememberMe });
    const refreshTokenMaxAgeMs = this.jwtTokenService.getRefreshTokenMaxAgeMs(rememberMe);

    // Written last, after the new pair is signed: if this throws, the controller never sets the
    // new cookie and the old (still-valid) token survives — a consistent state (see tasks/plan.md).
    // Pre-migration tokens carry no jti/exp and cannot be blacklisted (see jwt-payload.ts).
    if (jti && exp) {
      await this.tokenBlacklistService.blacklist({ jti, userId: sub, expiresAt: new Date(exp * 1000), reason: "rotation" });
    }

    return { accessToken, refreshToken: newRefreshToken, refreshTokenMaxAgeMs };
  }
}

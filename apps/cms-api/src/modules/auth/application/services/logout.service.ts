import { Injectable } from "@nestjs/common";

import { TokenBlacklistService } from "@/common/token-blacklist/token-blacklist.service";
import { JwtTokenService } from "@/common/token/jwt-token.service";
import { type RefreshTokenPayload } from "@/common/types/jwt-payload";

@Injectable()
export class LogoutService {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  // Logout is a public, always-200, idempotent route — any verification failure (missing, garbage,
  // or expired cookie) is swallowed rather than thrown.
  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }

    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtTokenService.verifyRefreshToken(refreshToken);
    } catch {
      return;
    }

    // Pre-migration tokens carry no jti and cannot be blacklisted (see jwt-payload.ts).
    if (!payload.jti || !payload.exp) {
      return;
    }

    await this.tokenBlacklistService.blacklist({
      jti: payload.jti,
      userId: payload.sub,
      expiresAt: new Date(payload.exp * 1000),
      reason: "logout",
    });
  }
}

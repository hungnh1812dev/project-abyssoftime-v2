import { Injectable, Logger } from "@nestjs/common";

import { TokenBlacklistService } from "@/common/token-blacklist/token-blacklist.service";
import { JwtTokenService } from "@/common/token/jwt-token.service";
import { type RefreshTokenPayload } from "@/common/types/jwt-payload";

@Injectable()
export class LogoutService {
  private readonly logger = new Logger(LogoutService.name);

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

    // A transient write failure (e.g. a dropped DB connection) must not turn a public, always-200
    // route into a 500 — the client still gets a normal logout and its cookie still gets cleared;
    // the token just stays valid until it naturally expires, same as it would have before this
    // feature existed.
    try {
      await this.tokenBlacklistService.blacklist({
        jti: payload.jti,
        userId: payload.sub,
        expiresAt: new Date(payload.exp * 1000),
        reason: "logout",
      });
    } catch (error) {
      this.logger.error("Failed to blacklist refresh token on logout", error instanceof Error ? error.stack : String(error));
    }
  }
}

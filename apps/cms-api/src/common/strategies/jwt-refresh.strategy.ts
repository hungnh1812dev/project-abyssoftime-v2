import { type Request } from "express";
import { Strategy, type StrategyOptions } from "passport-jwt";

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";

import { REFRESH_TOKEN_COOKIE } from "@/common/guards/jwt-refresh.guard";
import { TokenBlacklistService } from "@/common/token-blacklist/token-blacklist.service";
import { RefreshTokenPayload } from "@/common/types/jwt-payload";
import { EnvironmentVariables } from "@/config/env.validation";

// passport-jwt ships no cookie extractor (only header/body/query ones) — a plain function is its
// documented, idiomatic way to read the token from somewhere else, here the httpOnly refresh_token cookie.
export function jwtRefreshCookieExtractor(req: Request): string | null {
  const token: unknown = req.cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof token === "string" && token.length > 0 ? token : null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, "jwt-refresh") {
  constructor(
    configService: ConfigService<EnvironmentVariables, true>,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: jwtRefreshCookieExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get("JWT_REFRESH_SECRET", { infer: true }),
    } satisfies StrategyOptions);
  }

  async validate(payload: RefreshTokenPayload): Promise<RefreshTokenPayload> {
    if (payload.jti && (await this.tokenBlacklistService.isBlacklisted(payload.jti))) {
      throw new UnauthorizedException();
    }

    return payload;
  }
}

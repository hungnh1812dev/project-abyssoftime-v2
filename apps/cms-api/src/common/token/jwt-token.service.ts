import { type AccessTokenPayload, type RefreshTokenPayload } from "../types/jwt-payload";
import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

import { type EnvironmentVariables } from "@/config/env.validation";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
const REFRESH_TOKEN_TTL_REMEMBERED = "30d";
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS_REMEMBERED = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(payload, { secret: this.configService.get("JWT_ACCESS_SECRET", { infer: true }), expiresIn: ACCESS_TOKEN_TTL });
  }

  signRefreshToken(payload: RefreshTokenPayload): string {
    const expiresIn = payload.rememberMe ? REFRESH_TOKEN_TTL_REMEMBERED : REFRESH_TOKEN_TTL;
    return this.jwtService.sign({ ...payload, jti: randomUUID() }, { secret: this.configService.get("JWT_REFRESH_SECRET", { infer: true }), expiresIn });
  }

  getRefreshTokenMaxAgeMs(rememberMe: boolean): number {
    return rememberMe ? REFRESH_TOKEN_MAX_AGE_MS_REMEMBERED : REFRESH_TOKEN_MAX_AGE_MS;
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token, { secret: this.configService.get("JWT_ACCESS_SECRET", { infer: true }) });
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    return this.jwtService.verify<RefreshTokenPayload>(token, { secret: this.configService.get("JWT_REFRESH_SECRET", { infer: true }) });
  }
}

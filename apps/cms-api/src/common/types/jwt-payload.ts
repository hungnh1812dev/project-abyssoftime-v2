export interface AccessTokenPayload {
  sub: string;
  roleSlug: string;
  level: number;
  permissions: string[];
}

export interface RefreshTokenPayload {
  sub: string;
  // Optional, not required: a refresh token minted before this field existed won't carry it at
  // runtime — readers must treat a missing value as `false` (see RefreshTokenService).
  rememberMe?: boolean;
  // Optional, not required, same reasoning as rememberMe: a token minted before the refresh-token
  // blacklist shipped carries neither jti nor exp — readers must treat their absence as "this
  // token cannot be blacklisted" rather than crash. `exp` is the standard JWT claim (Unix seconds)
  // that passport-jwt/jsonwebtoken merge onto the decoded payload at verify time.
  jti?: string;
  exp?: number;
}

export interface BlacklistEntry {
  jti: string;
  userId: string | null;
  expiresAt: Date;
  reason: "logout" | "rotation";
}

// Postgres — authoritative, always present.
export interface ITokenBlacklistStore {
  blacklist(entry: BlacklistEntry): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean>;
}
export const TOKEN_BLACKLIST_STORE = Symbol("TOKEN_BLACKLIST_STORE");

// Redis — optional, may be unavailable/degraded. `null` means "don't know, ask the store" (see
// docs/documents/token-blacklist-techstack.md's sticky-degraded-cache decision).
export interface ITokenBlacklistCache {
  blacklist(entry: BlacklistEntry): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean | null>;
}
export const TOKEN_BLACKLIST_CACHE = Symbol("TOKEN_BLACKLIST_CACHE");

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
  // Atomic claim (INSERT, not upsert): true if this call is the first to blacklist this jti,
  // false if it was already blacklisted (by a concurrent claim or a prior logout). Closes the
  // check-then-write race a plain isBlacklisted()-then-blacklist() pair would leave open — see
  // docs/documents/token-blacklist-techstack.md.
  tryClaim(entry: BlacklistEntry): Promise<boolean>;
}
export const TOKEN_BLACKLIST_STORE = Symbol("TOKEN_BLACKLIST_STORE");

// Redis — optional, may be unavailable/degraded. `null` means "don't know, ask the store" (see
// docs/documents/token-blacklist-techstack.md's sticky-degraded-cache decision).
export interface ITokenBlacklistCache {
  blacklist(entry: BlacklistEntry): Promise<void>;
  isBlacklisted(jti: string): Promise<boolean | null>;
}
export const TOKEN_BLACKLIST_CACHE = Symbol("TOKEN_BLACKLIST_CACHE");

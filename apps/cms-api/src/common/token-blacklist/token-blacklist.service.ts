import { Inject, Injectable } from "@nestjs/common";

import { type BlacklistEntry, type ITokenBlacklistCache, type ITokenBlacklistStore, TOKEN_BLACKLIST_CACHE, TOKEN_BLACKLIST_STORE } from "./token-blacklist.port";

@Injectable()
export class TokenBlacklistService {
  constructor(
    @Inject(TOKEN_BLACKLIST_STORE) private readonly store: ITokenBlacklistStore,
    @Inject(TOKEN_BLACKLIST_CACHE) private readonly cache: ITokenBlacklistCache | null,
  ) {}

  async blacklist(entry: BlacklistEntry): Promise<void> {
    await this.store.blacklist(entry);
    if (this.cache) {
      await this.cache.blacklist(entry);
    }
  }

  // Atomic claim: true only for the call that actually inserted the row (see
  // ITokenBlacklistStore.tryClaim). A losing claim isn't mirrored to the cache — there's nothing
  // new to mirror, the winner's write already covers this jti.
  async tryClaim(entry: BlacklistEntry): Promise<boolean> {
    const claimed = await this.store.tryClaim(entry);
    if (claimed && this.cache) {
      await this.cache.blacklist(entry);
    }
    return claimed;
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    if (this.cache) {
      const cached = await this.cache.isBlacklisted(jti);
      if (cached !== null) {
        return cached;
      }
    }

    return this.store.isBlacklisted(jti);
  }
}

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

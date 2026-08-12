import { Global, Module } from "@nestjs/common";

import { PrismaTokenBlacklistStore } from "./prisma-token-blacklist.store";
import { TOKEN_BLACKLIST_CACHE, TOKEN_BLACKLIST_STORE } from "./token-blacklist.port";
import { TokenBlacklistService } from "./token-blacklist.service";

// Redis cache is a null provider until Phase 4 (redis-token-blacklist.cache.ts) fills it in behind
// an env flag — TokenBlacklistService already handles a null cache by asking the store directly.
@Global()
@Module({
  providers: [{ provide: TOKEN_BLACKLIST_STORE, useClass: PrismaTokenBlacklistStore }, { provide: TOKEN_BLACKLIST_CACHE, useValue: null }, TokenBlacklistService],
  exports: [TokenBlacklistService],
})
export class TokenBlacklistModule {}

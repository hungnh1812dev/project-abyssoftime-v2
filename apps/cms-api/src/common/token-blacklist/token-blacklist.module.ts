import { type Redis } from "ioredis";

import { Global, Module } from "@nestjs/common";

import { PrismaTokenBlacklistStore } from "./prisma-token-blacklist.store";
import { RedisClientLifecycle } from "./redis-client-lifecycle";
import { REDIS_CLIENT, RedisClientProvider } from "./redis-client.provider";
import { RedisTokenBlacklistCache } from "./redis-token-blacklist.cache";
import { TOKEN_BLACKLIST_CACHE, TOKEN_BLACKLIST_STORE } from "./token-blacklist.port";
import { TokenBlacklistService } from "./token-blacklist.service";

// The Redis client is null when REDIS_ENABLED is off (redis-client.provider.ts) — the cache
// derives straight from it, so TokenBlacklistService gets a real RedisTokenBlacklistCache only
// when a client exists, and null (asks the store directly) otherwise.
@Global()
@Module({
  providers: [
    { provide: TOKEN_BLACKLIST_STORE, useClass: PrismaTokenBlacklistStore },
    RedisClientProvider,
    RedisClientLifecycle,
    {
      provide: TOKEN_BLACKLIST_CACHE,
      useFactory: (client: Redis | null) => (client ? new RedisTokenBlacklistCache(client) : null),
      inject: [REDIS_CLIENT],
    },
    TokenBlacklistService,
  ],
  exports: [TokenBlacklistService],
})
export class TokenBlacklistModule {}

import { type Redis } from "ioredis";

import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from "@nestjs/common/constants";

import { PrismaTokenBlacklistStore } from "./prisma-token-blacklist.store";
import { REDIS_CLIENT, RedisClientProvider } from "./redis-client.provider";
import { RedisTokenBlacklistCache } from "./redis-token-blacklist.cache";
import { TokenBlacklistModule } from "./token-blacklist.module";
import { TOKEN_BLACKLIST_CACHE, TOKEN_BLACKLIST_STORE } from "./token-blacklist.port";
import { TokenBlacklistService } from "./token-blacklist.service";

interface CacheFactoryProvider {
  provide: symbol;
  useFactory: (client: Redis | null) => RedisTokenBlacklistCache | null;
  inject: symbol[];
}

describe("TokenBlacklistModule", () => {
  it("is a global module", () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, TokenBlacklistModule)).toBe(true);
  });

  it("binds the store to its Prisma implementation and registers the Redis client provider + service", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TokenBlacklistModule) as unknown[];

    expect(providers).toContainEqual({ provide: TOKEN_BLACKLIST_STORE, useClass: PrismaTokenBlacklistStore });
    expect(providers).toContainEqual(RedisClientProvider);
    expect(providers).toContainEqual(TokenBlacklistService);
  });

  it("derives the cache from the Redis client: null when no client, a RedisTokenBlacklistCache when one exists", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TokenBlacklistModule) as unknown[];
    const cacheProvider = providers.find((p): p is CacheFactoryProvider => typeof p === "object" && p !== null && (p as { provide?: unknown }).provide === TOKEN_BLACKLIST_CACHE);

    expect(cacheProvider).toBeDefined();
    expect(cacheProvider?.inject).toEqual([REDIS_CLIENT]);
    expect(cacheProvider?.useFactory(null)).toBeNull();
    expect(cacheProvider?.useFactory({} as Redis)).toBeInstanceOf(RedisTokenBlacklistCache);
  });

  it("exports TokenBlacklistService", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, TokenBlacklistModule)).toEqual([TokenBlacklistService]);
  });
});

import Redis from "ioredis";

import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

// Returns null when the flag is off — no Redis client is ever constructed, so nothing connects.
// See docs/documents/token-blacklist-techstack.md.
export function createRedisClient(configService: ConfigService): Redis | null {
  if (!configService.get<boolean>("REDIS_ENABLED")) {
    return null;
  }

  return new Redis(configService.getOrThrow<string>("REDIS_URL"));
}

export const RedisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: createRedisClient,
  inject: [ConfigService],
};

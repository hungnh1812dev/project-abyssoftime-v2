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

  // maxRetriesPerRequest: 1 — ioredis's default (20, with growing backoff) can take tens of
  // seconds to surface a failed command after an outage, which would leave /auth/refresh and
  // /auth/logout hanging well past any reasonable request timeout before the sticky-degraded
  // cache ever gets a chance to kick in. Failing fast is what makes "kill Redis mid-session"
  // degrade to Postgres promptly instead of just eventually.
  return new Redis(configService.getOrThrow<string>("REDIS_URL"), { maxRetriesPerRequest: 1 });
}

export const RedisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: createRedisClient,
  inject: [ConfigService],
};

import { type Redis } from "ioredis";

import { Injectable, Logger } from "@nestjs/common";

import { type BlacklistEntry, type ITokenBlacklistCache } from "./token-blacklist.port";

const KEY_PREFIX = "refresh-blacklist:";

// Sticky-degraded cache (see docs/documents/token-blacklist-techstack.md): any Redis error, read
// or write, permanently untrusts the cache for this process — every later call returns null
// without touching Redis again, and TokenBlacklistService falls through to Postgres.
@Injectable()
export class RedisTokenBlacklistCache implements ITokenBlacklistCache {
  private readonly logger = new Logger(RedisTokenBlacklistCache.name);
  private trusted = true;

  constructor(private readonly client: Redis) {}

  async blacklist(entry: BlacklistEntry): Promise<void> {
    if (!this.trusted) {
      return;
    }

    const ttlMs = entry.expiresAt.getTime() - Date.now();
    if (ttlMs <= 0) {
      return;
    }

    try {
      await this.client.set(`${KEY_PREFIX}${entry.jti}`, entry.reason, "PX", ttlMs);
    } catch (error) {
      this.degrade(error);
    }
  }

  async isBlacklisted(jti: string): Promise<boolean | null> {
    if (!this.trusted) {
      return null;
    }

    try {
      const value = await this.client.get(`${KEY_PREFIX}${jti}`);
      return value !== null;
    } catch (error) {
      this.degrade(error);
      return null;
    }
  }

  private degrade(error: unknown): void {
    this.trusted = false;
    this.logger.error("Redis error — token blacklist cache permanently degraded to Postgres-only for this process", error instanceof Error ? error.stack : String(error));
  }
}

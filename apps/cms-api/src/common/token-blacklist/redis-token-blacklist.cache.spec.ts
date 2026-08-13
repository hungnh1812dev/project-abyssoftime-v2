import { type Redis } from "ioredis";

import { Logger } from "@nestjs/common";

import { RedisTokenBlacklistCache } from "./redis-token-blacklist.cache";
import { type BlacklistEntry } from "./token-blacklist.port";

describe("RedisTokenBlacklistCache", () => {
  let client: jest.Mocked<Pick<Redis, "get" | "set">>;
  let cache: RedisTokenBlacklistCache;

  const entry: BlacklistEntry = { jti: "jti-1", userId: "user-1", expiresAt: new Date(Date.now() + 60_000), reason: "logout" };

  beforeEach(() => {
    client = { get: jest.fn(), set: jest.fn() };
    cache = new RedisTokenBlacklistCache(client as unknown as Redis);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("while healthy", () => {
    it("isBlacklisted returns true on a hit", async () => {
      client.get.mockResolvedValue("logout");

      await expect(cache.isBlacklisted("jti-1")).resolves.toBe(true);
      expect(client.get).toHaveBeenCalledWith("refresh-blacklist:jti-1");
    });

    it("isBlacklisted returns false on a miss", async () => {
      client.get.mockResolvedValue(null);

      await expect(cache.isBlacklisted("jti-1")).resolves.toBe(false);
    });

    it("blacklist SETs the key with the reason as value and a PX ttl derived from expiresAt", async () => {
      client.set.mockResolvedValue("OK");
      const expiresAt = new Date(Date.now() + 5000);

      await cache.blacklist({ ...entry, expiresAt });

      expect(client.set).toHaveBeenCalledWith("refresh-blacklist:jti-1", "logout", "PX", expect.any(Number));
      const ttlArg = client.set.mock.calls[0][3] as number;
      expect(ttlArg).toBeGreaterThan(0);
      expect(ttlArg).toBeLessThanOrEqual(5000);
    });

    it("blacklist no-ops without calling Redis when expiresAt is already in the past", async () => {
      await cache.blacklist({ ...entry, expiresAt: new Date(Date.now() - 1000) });

      expect(client.set).not.toHaveBeenCalled();
    });
  });

  describe("once degraded by a Redis error", () => {
    it("a thrown error on isBlacklisted degrades the cache: returns null, logs, and never calls Redis again", async () => {
      client.get.mockRejectedValueOnce(new Error("ECONNRESET"));

      await expect(cache.isBlacklisted("jti-1")).resolves.toBeNull();
      expect(Logger.prototype.error).toHaveBeenCalled();

      client.get.mockResolvedValue("logout");
      await expect(cache.isBlacklisted("jti-1")).resolves.toBeNull();
      expect(client.get).toHaveBeenCalledTimes(1);
    });

    it("a thrown error on blacklist degrades the cache: swallows the error and stops future Redis calls", async () => {
      client.set.mockRejectedValueOnce(new Error("ECONNRESET"));

      await expect(cache.blacklist(entry)).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();

      await cache.blacklist(entry);
      expect(client.set).toHaveBeenCalledTimes(1);

      await expect(cache.isBlacklisted(entry.jti)).resolves.toBeNull();
      expect(client.get).not.toHaveBeenCalled();
    });
  });
});

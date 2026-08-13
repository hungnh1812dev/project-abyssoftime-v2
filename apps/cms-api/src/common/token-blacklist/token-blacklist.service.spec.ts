import { type BlacklistEntry, type ITokenBlacklistCache, type ITokenBlacklistStore } from "./token-blacklist.port";
import { TokenBlacklistService } from "./token-blacklist.service";

describe("TokenBlacklistService", () => {
  let store: jest.Mocked<ITokenBlacklistStore>;
  let cache: jest.Mocked<ITokenBlacklistCache>;

  const entry: BlacklistEntry = { jti: "jti-1", userId: "user-1", expiresAt: new Date("2026-01-08T00:00:00.000Z"), reason: "logout" };

  beforeEach(() => {
    store = { blacklist: jest.fn(), isBlacklisted: jest.fn(), tryClaim: jest.fn() };
    cache = { blacklist: jest.fn(), isBlacklisted: jest.fn() };
  });

  describe("blacklist()", () => {
    it("writes to the store when there is no cache", async () => {
      const service = new TokenBlacklistService(store, null);
      store.blacklist.mockResolvedValue(undefined);

      await service.blacklist(entry);

      expect(store.blacklist).toHaveBeenCalledWith(entry);
    });

    it("mirrors to the cache after writing to the store when a cache is present", async () => {
      const service = new TokenBlacklistService(store, cache);
      store.blacklist.mockResolvedValue(undefined);
      cache.blacklist.mockResolvedValue(undefined);

      await service.blacklist(entry);

      expect(store.blacklist).toHaveBeenCalledWith(entry);
      expect(cache.blacklist).toHaveBeenCalledWith(entry);
    });
  });

  describe("tryClaim()", () => {
    it("claims via the store and mirrors to the cache when the claim succeeds", async () => {
      const service = new TokenBlacklistService(store, cache);
      store.tryClaim.mockResolvedValue(true);
      cache.blacklist.mockResolvedValue(undefined);

      const result = await service.tryClaim(entry);

      expect(store.tryClaim).toHaveBeenCalledWith(entry);
      expect(cache.blacklist).toHaveBeenCalledWith(entry);
      expect(result).toBe(true);
    });

    it("does not mirror to the cache when the claim loses the race (already claimed)", async () => {
      const service = new TokenBlacklistService(store, cache);
      store.tryClaim.mockResolvedValue(false);

      const result = await service.tryClaim(entry);

      expect(cache.blacklist).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("works with no cache present", async () => {
      const service = new TokenBlacklistService(store, null);
      store.tryClaim.mockResolvedValue(true);

      const result = await service.tryClaim(entry);

      expect(result).toBe(true);
    });
  });

  describe("isBlacklisted()", () => {
    it("asks the store directly when there is no cache", async () => {
      const service = new TokenBlacklistService(store, null);
      store.isBlacklisted.mockResolvedValue(true);

      const result = await service.isBlacklisted("jti-1");

      expect(store.isBlacklisted).toHaveBeenCalledWith("jti-1");
      expect(result).toBe(true);
    });

    it("uses the cache's answer without asking the store when the cache returns a definite boolean", async () => {
      const service = new TokenBlacklistService(store, cache);
      cache.isBlacklisted.mockResolvedValue(true);

      const result = await service.isBlacklisted("jti-1");

      expect(cache.isBlacklisted).toHaveBeenCalledWith("jti-1");
      expect(store.isBlacklisted).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("falls through to the store when the cache returns null (degraded/unknown)", async () => {
      const service = new TokenBlacklistService(store, cache);
      cache.isBlacklisted.mockResolvedValue(null);
      store.isBlacklisted.mockResolvedValue(false);

      const result = await service.isBlacklisted("jti-1");

      expect(cache.isBlacklisted).toHaveBeenCalledWith("jti-1");
      expect(store.isBlacklisted).toHaveBeenCalledWith("jti-1");
      expect(result).toBe(false);
    });
  });
});

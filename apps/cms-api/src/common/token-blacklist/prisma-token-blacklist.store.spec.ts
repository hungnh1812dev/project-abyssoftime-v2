import { Prisma } from "@/prisma/application/client";
import { PrismaService } from "@/prisma/application/prisma.service";

import { PrismaTokenBlacklistStore } from "./prisma-token-blacklist.store";
import { type BlacklistEntry } from "./token-blacklist.port";

describe("PrismaTokenBlacklistStore", () => {
  let store: PrismaTokenBlacklistStore;
  let prisma: {
    refreshTokenBlacklist: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  const entry: BlacklistEntry = { jti: "jti-1", userId: "user-1", expiresAt: new Date("2026-01-08T00:00:00.000Z"), reason: "logout" };

  const p2002Error = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test", meta: { target: ["jti"] } });

  beforeEach(() => {
    prisma = {
      refreshTokenBlacklist: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    store = new PrismaTokenBlacklistStore(prisma as unknown as PrismaService);
  });

  describe("blacklist()", () => {
    it("upserts by jti with the given userId/expiresAt/reason", async () => {
      prisma.refreshTokenBlacklist.upsert.mockResolvedValue({});

      await store.blacklist(entry);

      expect(prisma.refreshTokenBlacklist.upsert).toHaveBeenCalledWith({
        where: { jti: "jti-1" },
        create: { jti: "jti-1", userId: "user-1", expiresAt: entry.expiresAt, reason: "logout" },
        update: { userId: "user-1", expiresAt: entry.expiresAt, reason: "logout" },
      });
    });

    it("accepts a null userId and passes it through", async () => {
      prisma.refreshTokenBlacklist.upsert.mockResolvedValue({});

      await store.blacklist({ ...entry, userId: null });

      const [{ create, update }] = prisma.refreshTokenBlacklist.upsert.mock.calls[0] as [{ create: BlacklistEntry; update: Partial<BlacklistEntry> }];
      expect(create.userId).toBeNull();
      expect(update.userId).toBeNull();
    });

    it("resolves without error when blacklisting the same jti twice (idempotent upsert, no PK conflict)", async () => {
      prisma.refreshTokenBlacklist.upsert.mockResolvedValue({});

      await store.blacklist(entry);
      await store.blacklist({ ...entry, reason: "rotation" });

      expect(prisma.refreshTokenBlacklist.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("tryClaim()", () => {
    it("returns true after a successful INSERT (first claimer)", async () => {
      prisma.refreshTokenBlacklist.create.mockResolvedValue({});

      const result = await store.tryClaim(entry);

      expect(prisma.refreshTokenBlacklist.create).toHaveBeenCalledWith({
        data: { jti: "jti-1", userId: "user-1", expiresAt: entry.expiresAt, reason: "logout" },
      });
      expect(result).toBe(true);
    });

    it("returns false when the jti already exists (P2002 unique-constraint violation — concurrent claim or prior logout)", async () => {
      prisma.refreshTokenBlacklist.create.mockRejectedValue(p2002Error());

      const result = await store.tryClaim(entry);

      expect(result).toBe(false);
    });

    it("rethrows any error other than P2002", async () => {
      prisma.refreshTokenBlacklist.create.mockRejectedValue(new Error("connection lost"));

      await expect(store.tryClaim(entry)).rejects.toThrow("connection lost");
    });
  });

  describe("isBlacklisted()", () => {
    it("returns true when a row exists with a future expiresAt", async () => {
      prisma.refreshTokenBlacklist.findUnique.mockResolvedValue({ jti: "jti-1", expiresAt: new Date(Date.now() + 60_000) });

      const result = await store.isBlacklisted("jti-1");

      expect(prisma.refreshTokenBlacklist.findUnique).toHaveBeenCalledWith({ where: { jti: "jti-1" } });
      expect(result).toBe(true);
    });

    it("returns false when no row is found", async () => {
      prisma.refreshTokenBlacklist.findUnique.mockResolvedValue(null);

      const result = await store.isBlacklisted("unknown-jti");

      expect(result).toBe(false);
    });

    it("returns false when the row's expiresAt is in the past", async () => {
      prisma.refreshTokenBlacklist.findUnique.mockResolvedValue({ jti: "jti-1", expiresAt: new Date(Date.now() - 60_000) });

      const result = await store.isBlacklisted("jti-1");

      expect(result).toBe(false);
    });
  });
});

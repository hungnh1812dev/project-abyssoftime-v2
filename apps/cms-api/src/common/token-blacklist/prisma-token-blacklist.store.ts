import { Injectable } from "@nestjs/common";

import { Prisma } from "@/prisma/application/client";
import { PrismaService } from "@/prisma/application/prisma.service";

import { type BlacklistEntry, type ITokenBlacklistStore } from "./token-blacklist.port";

@Injectable()
export class PrismaTokenBlacklistStore implements ITokenBlacklistStore {
  constructor(private readonly prisma: PrismaService) {}

  async blacklist(entry: BlacklistEntry): Promise<void> {
    await this.prisma.refreshTokenBlacklist.upsert({
      where: { jti: entry.jti },
      create: { jti: entry.jti, userId: entry.userId, expiresAt: entry.expiresAt, reason: entry.reason },
      update: { userId: entry.userId, expiresAt: entry.expiresAt, reason: entry.reason },
    });
  }

  async tryClaim(entry: BlacklistEntry): Promise<boolean> {
    try {
      await this.prisma.refreshTokenBlacklist.create({
        data: { jti: entry.jti, userId: entry.userId, expiresAt: entry.expiresAt, reason: entry.reason },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    const row = await this.prisma.refreshTokenBlacklist.findUnique({ where: { jti } });
    return row !== null && row.expiresAt.getTime() > Date.now();
  }
}

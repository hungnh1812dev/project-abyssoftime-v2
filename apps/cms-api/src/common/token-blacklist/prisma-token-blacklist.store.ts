import { Injectable } from "@nestjs/common";

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

  async isBlacklisted(jti: string): Promise<boolean> {
    const row = await this.prisma.refreshTokenBlacklist.findUnique({ where: { jti } });
    return row !== null && row.expiresAt.getTime() > Date.now();
  }
}

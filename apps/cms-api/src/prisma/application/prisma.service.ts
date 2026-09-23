import { EnvironmentVariables } from "../../config/env.validation";
import { PrismaPg } from "@prisma/adapter-pg";

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { PrismaClient } from "./client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    const host = configService.get("DB_HOST", { infer: true });
    const port = Number(configService.get("DB_PORT", { infer: true }));
    const database = configService.get("DB_NAME", { infer: true });
    const user = configService.get("DB_USERNAME", { infer: true });
    const password = configService.get("DB_PASSWORD", { infer: true });

    super({ adapter: new PrismaPg({ host, port, database, user, password }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

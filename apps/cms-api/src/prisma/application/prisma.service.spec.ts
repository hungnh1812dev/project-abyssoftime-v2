import { PrismaPg } from "@prisma/adapter-pg";

import { type ConfigService } from "@nestjs/config";

import { type EnvironmentVariables } from "@/config/env.validation";

import { PrismaService } from "./prisma.service";

jest.mock("@prisma/adapter-pg", () => ({ PrismaPg: jest.fn().mockImplementation((options: unknown) => ({ kind: "pg", options })) }));

jest.mock("./client", () => {
  class MockPrismaClient {
    public readonly options: unknown;
    public $connect = jest.fn().mockResolvedValue(undefined);
    public $disconnect = jest.fn().mockResolvedValue(undefined);

    constructor(options: unknown) {
      this.options = options;
    }
  }

  return { PrismaClient: MockPrismaClient };
});

type MockPrismaClient = { options: unknown; $connect: jest.Mock; $disconnect: jest.Mock };

describe("PrismaService", () => {
  const dbConfig = { DB_HOST: "db-host", DB_PORT: "6543", DB_NAME: "my-db", DB_USERNAME: "my-user", DB_PASSWORD: "my-password" };

  const makeConfigService = (): ConfigService<EnvironmentVariables, true> => {
    return { get: jest.fn((key: string) => dbConfig[key as keyof typeof dbConfig]) } as unknown as ConfigService<EnvironmentVariables, true>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds a PrismaPg adapter", () => {
    new PrismaService(makeConfigService());

    expect(PrismaPg).toHaveBeenCalledWith({ host: "db-host", port: 6543, database: "my-db", user: "my-user", password: "my-password" });
  });

  it("onModuleInit() connects to the database", async () => {
    const service = new PrismaService(makeConfigService());

    await service.onModuleInit();

    expect((service as unknown as MockPrismaClient).$connect).toHaveBeenCalledTimes(1);
  });

  it("onModuleDestroy() disconnects from the database", async () => {
    const service = new PrismaService(makeConfigService());

    await service.onModuleDestroy();

    expect((service as unknown as MockPrismaClient).$disconnect).toHaveBeenCalledTimes(1);
  });
});

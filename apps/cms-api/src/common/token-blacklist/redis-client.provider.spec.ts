import Redis from "ioredis";

import { ConfigService } from "@nestjs/config";

import { createRedisClient, REDIS_CLIENT, RedisClientProvider } from "./redis-client.provider";

jest.mock("ioredis", () => ({ __esModule: true, default: jest.fn() }));

describe("createRedisClient", () => {
  const RedisConstructor = Redis as unknown as jest.Mock;

  beforeEach(() => {
    RedisConstructor.mockClear();
  });

  function configServiceStub(values: Record<string, unknown>): ConfigService {
    return { get: (key: string) => values[key], getOrThrow: (key: string) => values[key] } as unknown as ConfigService;
  }

  it("returns null and never constructs a client when REDIS_ENABLED is false", () => {
    const configService = configServiceStub({ REDIS_ENABLED: false, REDIS_URL: "" });

    const client = createRedisClient(configService);

    expect(client).toBeNull();
    expect(RedisConstructor).not.toHaveBeenCalled();
  });

  it("constructs a client from REDIS_URL when REDIS_ENABLED is true", () => {
    const configService = configServiceStub({ REDIS_ENABLED: true, REDIS_URL: "redis://localhost:6379" });

    createRedisClient(configService);

    expect(RedisConstructor).toHaveBeenCalledWith("redis://localhost:6379");
  });
});

describe("RedisClientProvider", () => {
  it("provides REDIS_CLIENT via the createRedisClient factory, injecting ConfigService", () => {
    expect(RedisClientProvider).toEqual({ provide: REDIS_CLIENT, useFactory: createRedisClient, inject: [ConfigService] });
  });
});

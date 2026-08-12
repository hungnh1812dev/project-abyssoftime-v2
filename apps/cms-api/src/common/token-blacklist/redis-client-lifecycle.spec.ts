import { type Redis } from "ioredis";

import { RedisClientLifecycle } from "./redis-client-lifecycle";

describe("RedisClientLifecycle", () => {
  it("does nothing on module destroy when there is no client", () => {
    const lifecycle = new RedisClientLifecycle(null);

    expect(() => lifecycle.onModuleDestroy()).not.toThrow();
  });

  it("disconnects the client on module destroy", () => {
    const client = { disconnect: jest.fn() } as unknown as Redis;
    const lifecycle = new RedisClientLifecycle(client);

    lifecycle.onModuleDestroy();

    expect(client.disconnect).toHaveBeenCalled();
  });
});

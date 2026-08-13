import { type Redis } from "ioredis";

import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";

import { REDIS_CLIENT } from "./redis-client.provider";

// Without this, the Redis client's background reconnect socket keeps its process alive past
// `app.close()` — closing the client on module teardown is what lets a graceful shutdown (or an
// e2e test's afterAll) actually exit.
@Injectable()
export class RedisClientLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}

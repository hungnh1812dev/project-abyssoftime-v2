import { GLOBAL_MODULE_METADATA, MODULE_METADATA } from "@nestjs/common/constants";

import { PrismaTokenBlacklistStore } from "./prisma-token-blacklist.store";
import { TokenBlacklistModule } from "./token-blacklist.module";
import { TOKEN_BLACKLIST_CACHE, TOKEN_BLACKLIST_STORE } from "./token-blacklist.port";
import { TokenBlacklistService } from "./token-blacklist.service";

describe("TokenBlacklistModule", () => {
  it("is a global module", () => {
    expect(Reflect.getMetadata(GLOBAL_MODULE_METADATA, TokenBlacklistModule)).toBe(true);
  });

  it("binds the store to its Prisma implementation, defaults the cache to null, and registers the service", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, TokenBlacklistModule) as unknown[];

    expect(providers).toEqual([{ provide: TOKEN_BLACKLIST_STORE, useClass: PrismaTokenBlacklistStore }, { provide: TOKEN_BLACKLIST_CACHE, useValue: null }, TokenBlacklistService]);
  });

  it("exports TokenBlacklistService", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, TokenBlacklistModule)).toEqual([TokenBlacklistService]);
  });
});

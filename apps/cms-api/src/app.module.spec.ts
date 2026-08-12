import { MODULE_METADATA } from "@nestjs/common/constants";

import { AppController } from "./app.controller";
import { AppModule } from "./app.module";
import { SeedModule } from "./bootstrap/seed.module";
import { TokenBlacklistModule } from "./common/token-blacklist/token-blacklist.module";
import { TokenModule } from "./common/token/token.module";
import { ConfigModule } from "./config/config.module";
import { AccessTokenModule } from "./modules/access-tokens/access-token.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ContentTypeModule } from "./modules/content-type/content-type.module";
import { DocumentModule } from "./modules/document/document.module";
import { GraphqlModule } from "./modules/graphql/graphql.module";
import { MediaModule } from "./modules/media/media.module";
import { PermissionModule } from "./modules/permissions/permission.module";
import { RoleModule } from "./modules/roles/role.module";
import { StorageModule } from "./modules/storage/storage.module";
import { UserModule } from "./modules/users/user.module";
import { PrismaModule } from "./prisma/prisma.module";

jest.mock("./config/config.module", () => ({ ConfigModule: class MockConfigModule {} }));

describe("AppModule", () => {
  it("imports every feature module, with ConfigModule loaded first", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule)).toEqual([
      ConfigModule,
      PrismaModule,
      TokenModule,
      TokenBlacklistModule,
      PermissionModule,
      RoleModule,
      UserModule,
      AccessTokenModule,
      AuthModule,
      StorageModule,
      MediaModule,
      ContentTypeModule,
      DocumentModule,
      GraphqlModule,
      SeedModule,
    ]);
  });

  it("registers AppController", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule)).toEqual([AppController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule)).toBeUndefined();
  });
});

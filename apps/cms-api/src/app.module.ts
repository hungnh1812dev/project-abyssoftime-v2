import { Module } from "@nestjs/common";

import { AppController } from "./app.controller";
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

@Module({
  imports: [
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
  ],
  controllers: [AppController],
})
export class AppModule {}

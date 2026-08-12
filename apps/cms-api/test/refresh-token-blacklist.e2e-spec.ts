import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { type App } from "supertest/types";

import { type INestApplication } from "@nestjs/common";

import { type IRoleRepository, ROLE_REPOSITORY } from "@/modules/roles/domain/repositories/role.repository";
import { type IUserRepository, USER_REPOSITORY } from "@/modules/users/domain/repositories/user.repository";
import { PrismaService } from "@/prisma/application/prisma.service";

import { bootTestApp } from "./utils/app-test.util";

const PASSWORD = "S3curePass!";
const BCRYPT_SALT_ROUNDS = 10;

// Proves the refresh-token-blacklist vertical slice end to end (T5+T6): a real login/logout/refresh
// cycle against Postgres, not mocked services — logout must actually revoke the session, and a
// session that never logged out must keep refreshing exactly as before.
describe("Refresh token blacklist / logout (e2e)", () => {
  const runId = randomUUID().slice(0, 8);

  let app: INestApplication<App>;
  let users: IUserRepository;
  let prisma: PrismaService;
  let userId: string;
  let email: string;

  beforeAll(async () => {
    app = await bootTestApp();
    users = app.get(USER_REPOSITORY);
    prisma = app.get(PrismaService);
    const roles = app.get<IRoleRepository>(ROLE_REPOSITORY);

    const guestRole = await roles.findBySlug("guest");
    email = `refresh-blacklist-${runId}@example.com`;
    const hashedPassword = await bcrypt.hash(PASSWORD, BCRYPT_SALT_ROUNDS);

    const user = await users.create({
      email,
      name: "Refresh Blacklist Test",
      username: `refresh-blacklist-${runId}`,
      password: hashedPassword,
      accountType: true,
      verified: true,
      roleId: guestRole.documentId,
    });
    userId = user.documentId;
  });

  afterAll(async () => {
    await prisma.refreshTokenBlacklist.deleteMany({ where: { userId } });
    await users.delete(userId);
    await app.close();
  });

  it("logout blacklists the session's refresh token, so a subsequent /auth/refresh with it 401s", async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
    await agent.post("/api/v1/auth/logout").expect(200);

    const refreshRes = await agent.post("/api/v1/auth/refresh");

    expect(refreshRes.status).toBe(401);

    const rows = await prisma.refreshTokenBlacklist.findMany({ where: { userId, reason: "logout" } });
    expect(rows.length).toBeGreaterThan(0);

    // expiresAt comes from the token's own 7-day (non-rememberMe) exp claim, not a fixed constant —
    // assert it lands close to "now + 7d" rather than just "in the future".
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expiresAtMs = rows[0].expiresAt.getTime();
    expect(expiresAtMs).toBeGreaterThan(Date.now() + sevenDaysMs - 60_000);
    expect(expiresAtMs).toBeLessThan(Date.now() + sevenDaysMs + 60_000);
  });

  it("without logging out, /auth/refresh with a valid session cookie still succeeds (regression guard)", async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);

    const refreshRes = await agent.post("/api/v1/auth/refresh");

    expect(refreshRes.status).toBe(200);
    expect(typeof (refreshRes.body as { accessToken?: unknown }).accessToken).toBe("string");
  });
});

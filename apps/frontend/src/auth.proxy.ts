import NextAuth from "next-auth";

import { proxyAuthConfig } from "@/auth.config";

// Mirrors auth.ts's guard — this module has its own NextAuth() instance (see auth.config.ts's
// `proxyAuthConfig` comment for why), so it needs its own fail-loud check rather than relying on
// auth.ts having already run it.
if (!process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET must be set — see .env.example");
}

export const { auth } = NextAuth(proxyAuthConfig);

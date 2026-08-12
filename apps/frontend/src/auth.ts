import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Auth.js silently falls back to an insecure default secret if this is unset — that's exactly the
// `SESSION_SECRET ?? "abyssoftime-default-secret-key"` pattern this migration is retiring (D3), so
// fail loudly instead.
if (!process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET must be set — see .env.example");
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

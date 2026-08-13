// The bare `import type {}` lines are required, not decorative — without a top-level
// import/export, TS treats this file as a global script, and `declare module "next-auth"` then
// replaces the real module instead of merging with it (silently losing every existing export).
import type {} from "next-auth";
import type {} from "next-auth/jwt";

// accessToken/refreshToken are deliberately NOT added to `User` (and therefore never reach
// `Session.user`, which is typed from `User`) — the session callback in auth.config.ts constructs
// its own minimal object, and this keeps the type system honest about what's allowed to leak to
// the client. They're read off `user` inside the jwt callback via a local cast instead.
declare module "next-auth" {
  interface User {
    roleSlug: string | null;
  }

  // `accessTokenExpires` is a plain timestamp (not a secret) so the client can drive
  // useSessionTimeout's countdown without polling the server every second (T13). `error` surfaces
  // a failed/blacklisted refresh so the client can force a clean re-login instead of silently
  // retrying forever.
  interface Session {
    accessTokenExpires?: number;
    error?: "RefreshTokenError";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    roleSlug?: string | null;
    error?: "RefreshTokenError";
  }
}

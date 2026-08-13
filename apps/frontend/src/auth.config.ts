import type { JWT } from "next-auth/jwt";

import { CredentialsSignin, type NextAuthConfig, type User } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { CmsAuthError, cmsGetMe, cmsLogin } from "@/lib/auth/cms-auth.client";
import { decodeTokenExpiryMs } from "@/lib/auth/decode-token-expiry";
import { refreshAccessToken } from "@/lib/auth/refresh-coalescer";

// Shared by both the full (`authConfig`) and proxy-only (`proxyAuthConfig`) jwt callbacks — a
// fresh sign-in always persists the same fields onto the token regardless of which config runs it.
function persistUserToToken(token: JWT, user: User): JWT {
  // accessToken/refreshToken are intentionally absent from the `User` type (see next-auth.d.ts)
  // so they can never structurally reach `Session.user` — read via a local cast instead of
  // widening that type.
  const { accessToken, refreshToken } = user as unknown as { accessToken: string; refreshToken: string };
  token.name = user.name;
  token.email = user.email;
  token.roleSlug = user.roleSlug;
  token.accessToken = accessToken;
  token.refreshToken = refreshToken;
  token.accessTokenExpires = decodeTokenExpiryMs(accessToken) ?? undefined;
  delete token.error;
  return token;
}

// Refresh on an early skew window, not at expiry (Correction 5/D10) — a request that lands with
// the token already technically valid but seconds from expiring should still get a fresh one
// rather than risking the expiry landing mid-request.
const EARLY_REFRESH_SKEW_MS = 60_000;

// Auth.js's Credentials provider maps any thrown error to the same generic
// `error=CredentialsSignin&code=credentials` unless the thrown error subclasses CredentialsSignin
// with its own `code` — that's how cms-api's 403 (unverified) is told apart from its 401 (wrong
// credentials) on the client (T8 reads `code` from `signIn(..., { redirect: false })`).
class UnverifiedAccountError extends CredentialsSignin {
  code = "unverified";
}

// Split from auth.ts (which calls NextAuth(authConfig)) so future OAuth providers drop in here
// without restructuring. The proxy guard (T11) does NOT use this config directly — see
// `proxyAuthConfig` below — because its `jwt` callback attempts a refresh, and the proxy and a
// same-request Server Component render are separate `auth()` calls that don't share the
// refresh-coalescer's in-memory `inFlight` map (each independently decodes the request cookie and
// re-runs `callbacks.jwt`). Two callers racing the same refresh token trips cms-api's single-use
// blacklist (`tryClaim()`) for whichever one loses.
export const authConfig = {
  pages: { signIn: "/auth" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
        rememberMe: {},
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;
        const rememberMe = credentials?.rememberMe === "true" || credentials?.rememberMe === true;

        try {
          const { accessToken, refreshToken } = await cmsLogin(email, password, rememberMe);
          const me = await cmsGetMe(accessToken);

          // Custom fields (accessToken/refreshToken/roleSlug) ride along on the returned user
          // object only as far as the jwt callback below, which persists them onto the token —
          // Auth.js's default jwt callback discards anything beyond name/email/image.
          return {
            id: me.documentId,
            email: me.email,
            name: me.name,
            roleSlug: me.roleSlug,
            accessToken,
            refreshToken,
          };
        } catch (error) {
          if (error instanceof CmsAuthError && error.status === 403) throw new UnverifiedAccountError();
          if (error instanceof CmsAuthError && error.status === 401) return null;
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    // Defining our own `jwt` callback fully replaces Auth.js's default (they don't chain — see
    // @auth/core/lib/init.js), so name/email must be persisted here too, not just the custom
    // fields, or the session callback below has nothing to read them back from.
    async jwt({ token, user, trigger }) {
      if (user) return persistUserToToken(token, user);

      if (!token.accessToken || !token.refreshToken) return token;

      // `trigger === "update"` is useSessionTimeout's "extend session" action — always attempt a
      // refresh then, even if a previous attempt already failed (a stale error shouldn't block a
      // deliberate retry). Otherwise, once refresh has failed once, don't keep hammering cms-api
      // with an already-blacklisted token on every request — wait for an explicit retry or a
      // fresh login.
      const isExpiringSoon = Date.now() >= (token.accessTokenExpires ?? 0) - EARLY_REFRESH_SKEW_MS;
      const shouldRefresh = trigger === "update" || (!token.error && isExpiringSoon);
      if (!shouldRefresh) return token;

      const refreshed = await refreshAccessToken(token.refreshToken);
      if (!refreshed) {
        token.error = "RefreshTokenError";
        return token;
      }

      token.accessToken = refreshed.accessToken;
      token.refreshToken = refreshed.refreshToken;
      token.accessTokenExpires = decodeTokenExpiryMs(refreshed.accessToken) ?? undefined;
      delete token.error;
      return token;
    },
    // Exhaustively reconstructed, not a mutation of the passed-in `session` — this is the only
    // client-facing surface, and it must never carry accessToken/refreshToken. A failed refresh
    // (token.error set) clears the user fields too — nav filtering and route guards read
    // `session.user.roleSlug`, so this is what makes "clears the session" actually fail closed
    // instead of coasting on a stale role until the encrypted cookie itself expires.
    async session({ session, token }) {
      return {
        ...session,
        user: {
          name: token.error ? null : (token.name ?? null),
          email: token.error ? null : (token.email ?? null),
          roleSlug: token.error ? null : (token.roleSlug ?? null),
        },
        accessTokenExpires: token.accessTokenExpires,
        error: token.error,
      };
    },
  },
} satisfies NextAuthConfig;

// Proxy-only variant: identical providers/pages/session shape, but its `jwt` callback never
// attempts a refresh — it only decodes whatever the last real (Node) render or login already
// persisted into the JWE, purely for the route-gating decision (which needs `roleSlug`/`error`,
// not a live access token). This is what makes it safe to run alongside the Node-side `authConfig`
// without the two racing cms-api's single-use refresh token — only one config (`authConfig`, via
// `HeaderBar`/`requireRole`/the session route) is ever allowed to call `refreshAccessToken()`.
export const proxyAuthConfig = {
  ...authConfig,
  callbacks: {
    async jwt({ token, user }) {
      if (user) return persistUserToToken(token, user);
      return token;
    },
    session: authConfig.callbacks.session,
  },
} satisfies NextAuthConfig;

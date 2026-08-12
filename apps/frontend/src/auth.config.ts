import { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { CmsAuthError, cmsGetMe, cmsLogin } from "@/lib/auth/cms-auth.client";
import { decodeTokenExpiryMs } from "@/lib/auth/decode-token-expiry";

// Auth.js's Credentials provider maps any thrown error to the same generic
// `error=CredentialsSignin&code=credentials` unless the thrown error subclasses CredentialsSignin
// with its own `code` — that's how cms-api's 403 (unverified) is told apart from its 401 (wrong
// credentials) on the client (T8 reads `code` from `signIn(..., { redirect: false })`).
class UnverifiedAccountError extends CredentialsSignin {
  code = "unverified";
}

// Split from auth.ts (which calls NextAuth(authConfig)) so this provider list stays Edge-safe —
// the proxy guard (T11) imports it indirectly via `auth()` without pulling in Node-only code, and
// future OAuth providers drop in here without restructuring.
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
    async jwt({ token, user }) {
      if (user) {
        // accessToken/refreshToken are intentionally absent from the `User` type (see
        // next-auth.d.ts) so they can never structurally reach `Session.user` — read via a local
        // cast instead of widening that type.
        const { accessToken, refreshToken } = user as unknown as { accessToken: string; refreshToken: string };
        token.name = user.name;
        token.email = user.email;
        token.roleSlug = user.roleSlug;
        token.accessToken = accessToken;
        token.refreshToken = refreshToken;
        token.accessTokenExpires = decodeTokenExpiryMs(accessToken) ?? undefined;
      }
      return token;
    },
    // Exhaustively reconstructed, not a mutation of the passed-in `session` — this is the only
    // client-facing surface, and it must never carry accessToken/refreshToken/accessTokenExpires.
    async session({ session, token }) {
      return {
        ...session,
        user: {
          name: token.name ?? null,
          email: token.email ?? null,
          roleSlug: token.roleSlug ?? null,
        },
      };
    },
  },
} satisfies NextAuthConfig;

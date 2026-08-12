import { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { CmsAuthError, cmsGetMe, cmsLogin } from "@/lib/auth/cms-auth.client";

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
    // T7 adds the Session/JWT module augmentation (src/types/next-auth.d.ts); until then these
    // custom fields are carried through an explicit cast rather than typed as `any`.
    async jwt({ token, user }) {
      if (user) {
        const { accessToken, refreshToken, roleSlug } = user as unknown as {
          accessToken: string;
          refreshToken: string;
          roleSlug: string | null;
        };
        Object.assign(token, { accessToken, refreshToken, roleSlug });
      }
      return token;
    },
  },
} satisfies NextAuthConfig;

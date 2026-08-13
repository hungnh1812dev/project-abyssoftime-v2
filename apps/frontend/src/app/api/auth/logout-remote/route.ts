import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

import { cmsLogout } from "@/lib/auth/cms-auth.client";

// signOut() alone only clears the local Auth.js cookie — cms-api's refresh token would stay live
// and replayable. UserMenu calls this route first, then signOut(). getToken() (not auth()) is used
// because the session callback deliberately strips refreshToken before it ever reaches auth().
//
// No explicit CSRF token: this relies on Auth.js's default `SameSite=Lax` session cookie, which
// blocks the cookie from riding along on a cross-site POST. If that cookie's SameSite policy is
// ever relaxed for another reason, this route needs its own CSRF check added at the same time.
export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.AUTH_SECRET });

  if (token?.refreshToken) {
    // Best-effort: the client clears its own session either way once it calls signOut()
    // afterward — a failed remote revocation shouldn't strand the user mid-logout.
    await cmsLogout(token.refreshToken).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

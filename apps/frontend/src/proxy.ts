import type { NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import i18n from "@/i18n";
import { getApiHealth } from "@/lib/health/healthCache";
import { getNavRouteRules, isAccessDenied } from "@/lib/nav/nav-rules-cache";
import { stripLocale } from "@/lib/nav/strip-locale";
import { defaultLocale, locales } from "@/utils/Constants";

// Auth.js's docs say `export { auth as proxy }` — that would replace this file's health gate and
// i18n rewrite outright (they don't compose). Wrapping our own callback instead preserves
// health-gate → role-guard → i18n order and reads the role off `request.auth`.
export const proxy = auth(async (request, event: NextFetchEvent) => {
  const healthy = await getApiHealth((promise) => event.waitUntil(promise));
  if (!healthy) {
    return NextResponse.rewrite(new URL("/unhealthy", request.url));
  }

  const { pathname } = request.nextUrl;
  const locale = locales.find((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  // i18n rewrites rather than redirects, so an unprefixed request (e.g. `/secret`) must be
  // gated exactly like its locale-prefixed twin (e.g. `/en/secret`) — strip whichever prefix is
  // present, if any, before resolving the route rule.
  const path = locale ? stripLocale(pathname, locale) || "/" : pathname;

  const rules = await getNavRouteRules((promise) => event.waitUntil(promise));
  const roleSlug = request.auth?.user?.roleSlug;

  if (isAccessDenied(rules, path, roleSlug)) {
    const redirectUrl = new URL(`/${locale ?? defaultLocale}/auth`, request.url);
    redirectUrl.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return i18n(request);
});

export const config = {
  matcher: [
    // Skip internal Next.js paths, API routes, and the unhealthy-state page itself
    // (so a direct/rewritten hit on /unhealthy doesn't get re-gated or rewritten by i18n)
    "/((?!_next|api|unhealthy).*)",
  ],
};

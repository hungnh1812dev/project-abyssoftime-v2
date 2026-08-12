import { redirect } from "next/navigation";
import { after } from "next/server";

import { auth } from "@/auth";
import { getNavRouteRules, isAccessDenied } from "@/lib/nav/nav-rules-cache";

/**
 * Defence in depth for a protected Server Component: `proxy.ts` (T11) already gates every route
 * it matches, but a page that's ever dropped from the proxy matcher must still refuse to render.
 * Reads the same `nav-rules-cache` singleton the proxy reads and the same `isAccessDenied`
 * decision, so the two can't drift onto different answers for the same path.
 */
export async function requireRole(path: string, locale: string): Promise<void> {
  const [session, rules] = await Promise.all([auth(), getNavRouteRules((promise) => after(promise))]);

  if (isAccessDenied(rules, path, session?.user?.roleSlug)) {
    const returnTo = `/${locale}${path}`;
    redirect(`/${locale}/auth?returnTo=${encodeURIComponent(returnTo)}`);
  }
}

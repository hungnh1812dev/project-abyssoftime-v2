import { CmsAuthError, cmsRefresh, type CmsLoginResult } from "./cms-auth.client";

// Module-level, keyed on the refresh token value itself — same single-flight shape as
// `src/lib/health/healthCache.ts`. cms-api blacklists a refresh token the instant it's consumed
// (tryClaim()), so N Server Component requests crossing an expiry boundary must share one
// in-flight cms-api call rather than each rotating the token and invalidating the others (D10).
const inFlight = new Map<string, Promise<CmsLoginResult | null>>();

/**
 * Rotates the access/refresh token pair, coalescing concurrent callers passing the same
 * `refreshToken` onto a single underlying cms-api request. Never throws — a rejected/blacklisted
 * refresh resolves to `null` so the caller (the `jwt` callback) can surface it as a forced
 * re-login instead of an unhandled rejection.
 */
export function refreshAccessToken(refreshToken: string, fetcher: (token: string) => Promise<CmsLoginResult> = cmsRefresh): Promise<CmsLoginResult | null> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const promise = fetcher(refreshToken)
    .catch((error: unknown) => {
      if (error instanceof CmsAuthError) return null;
      throw error;
    })
    .finally(() => {
      inFlight.delete(refreshToken);
    });

  inFlight.set(refreshToken, promise);
  return promise;
}

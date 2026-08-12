import { isRoleAllowed } from "@/lib/nav/role-match";
import { buildRouteRules, resolveRule, type RouteRule } from "@/lib/nav/route-rules";
import { getHeader } from "@/views/header/header.service";

const TTL_MS = 300_000; // mirrors header's own next.revalidate window

// Safety net for a header fetch that has never once succeeded (no stale cache to fall back on) —
// mirrors SessionGuard's PROTECTED_PATHS (still live until T14) so a cold-start outage can't
// silently expose everything gated today. T1's real CMS audit (deferred, plan Correction 8) is
// the long-term source of truth; this list only matters in this one failure mode.
export const KNOWN_PROTECTED_PATHS: readonly string[] = [
  "/cv",
  "/cv-2",
  "/vaccine",
  "/learning/english",
  "/learning/develop/react",
  "/learning/develop/architecture",
  "/learning/develop/go",
  "/interview",
  "/interview/answers",
  "/secret",
  "/account",
];

const AUTH_PATH = "/auth";

type Cache = { rules: RouteRule[]; checkedAt: number };

let cache: Cache | null = null;
let inFlight: Promise<RouteRule[]> | null = null;

function refresh(): Promise<RouteRule[]> {
  if (inFlight) return inFlight;

  inFlight = getHeader()
    .then((header) => {
      const rules = buildRouteRules(header?.nav ?? []);
      cache = { rules, checkedAt: Date.now() };
      return rules;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Stale-while-revalidate cache of nav route rules (same shape as healthCache). `null` means the
 * header has never once been fetched successfully — callers must fail closed for
 * `KNOWN_PROTECTED_PATHS` rather than treat `null` as "no rules exist" (which would fail open).
 */
export async function getNavRouteRules(
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<RouteRule[] | null> {
  if (!cache) {
    try {
      return await refresh();
    } catch {
      return null;
    }
  }

  if (Date.now() - cache.checkedAt >= TTL_MS) {
    waitUntil(refresh().catch(() => {}));
  }

  return cache.rules;
}

/** Pure gate decision, kept apart from the cache/network code above so it's unit-testable. */
export function isAccessDenied(
  rules: RouteRule[] | null,
  path: string,
  roleSlug: string | null | undefined,
): boolean {
  if (path === AUTH_PATH || path.startsWith(`${AUTH_PATH}/`)) return false;
  if (rules === null) return KNOWN_PROTECTED_PATHS.includes(path) && !roleSlug;
  return !isRoleAllowed(resolveRule(rules, path), roleSlug);
}

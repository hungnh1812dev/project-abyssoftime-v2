import type { HeaderNavItem } from "@/views/header/header.types";

export interface RouteRule {
  path: string;
  requiresRole: string;
}

export function buildRouteRules(nav: HeaderNavItem[]): RouteRule[] {
  const rules: RouteRule[] = [];

  for (const item of nav) {
    if (item.link) rules.push({ path: item.link, requiresRole: item.requiresRole });
    for (const sub of item.subNavigations) {
      if (sub.link) rules.push({ path: sub.link, requiresRole: sub.requiresRole });
    }
  }

  return rules;
}

function matches(rulePath: string, path: string): boolean {
  if (rulePath === "/") return path === "/";
  if (path === rulePath) return true;
  return path.startsWith(rulePath) && path[rulePath.length] === "/";
}

export function resolveRule(rules: RouteRule[], path: string): string {
  let best: RouteRule | undefined;

  for (const rule of rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
  }

  return best?.requiresRole ?? "";
}

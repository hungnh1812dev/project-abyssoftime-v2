import type { HeaderNavItem } from "@/views/header/header.types";

import { isRoleAllowed } from "./role-match";

export function filterNavTree(nav: HeaderNavItem[], roleSlug: string | null | undefined): HeaderNavItem[] {
  const result: HeaderNavItem[] = [];

  for (const item of nav) {
    if (!isRoleAllowed(item.requiresRole, roleSlug)) continue;

    const subNavigations = item.subNavigations.filter((sub) => isRoleAllowed(sub.requiresRole, roleSlug));
    if (subNavigations.length === 0 && !item.link) continue;

    result.push({ ...item, subNavigations });
  }

  return result;
}

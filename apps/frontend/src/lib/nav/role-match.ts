const PUBLIC_TOKENS = new Set(["", "all"]);

// "" / missing / "all" → public. Otherwise a comma-separated allow-list of role slugs.
export function isRoleAllowed(
  requiresRole: string | null | undefined,
  roleSlug: string | null | undefined,
): boolean {
  const raw = (requiresRole ?? "").trim().toLowerCase();
  if (PUBLIC_TOKENS.has(raw)) return true;
  if (!roleSlug) return false;

  return raw
    .split(",")
    .map((slug) => slug.trim())
    .includes(roleSlug.trim().toLowerCase());
}

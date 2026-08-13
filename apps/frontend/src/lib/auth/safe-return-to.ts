const DEFAULT_RETURN_TO = "/";

// Only a same-origin relative path is safe to send the browser to after login. `returnTo` comes
// from a query param an attacker controls, so an absolute URL, a protocol-relative `//evil.com`,
// or the `/\evil.com` backslash trick (some URL parsers treat `\` like `/`) must all fall back to
// the default rather than becoming an open redirect.
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_RETURN_TO;
  return raw;
}

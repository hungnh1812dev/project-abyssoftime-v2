// `atob` (not `Buffer`) so this stays usable from the jwt callback, which Auth.js can run in the
// Edge runtime once proxy.ts composes `auth()` (T11).
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return atob(padded);
}

// Reads the `exp` claim off a JWT without verifying its signature — safe here because the token
// just came directly from cms-api's own login/refresh response, never from an untrusted party.
export function decodeTokenExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

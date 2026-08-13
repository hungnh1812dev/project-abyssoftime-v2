const CMS_API_URL = process.env.CMS_API_URL ?? "http://localhost:5000";
const REFRESH_TOKEN_COOKIE = "refresh_token";

export class CmsAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CmsAuthError";
    this.status = status;
  }
}

export interface CmsLoginResult {
  accessToken: string;
  refreshToken: string;
}

export interface CmsMeResult {
  documentId: string;
  email: string;
  name: string;
  username: string;
  roleSlug: string | null;
  roleName: string | null;
}

// cms-api sets refresh_token only via Set-Cookie (never in the JSON body) — the frontend is a
// separate origin in production, so that cookie never reaches the browser. It's read off the raw
// response here and carried inside our own JWE instead (plan Correction 6).
function extractRefreshToken(res: Response): string {
  const cookies = res.headers.getSetCookie();
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name?.trim() === REFRESH_TOKEN_COOKIE && value) return decodeURIComponent(value);
  }
  throw new CmsAuthError(502, "cms-api login response did not set a refresh_token cookie");
}

export async function cmsLogin(email: string, password: string, rememberMe: boolean): Promise<CmsLoginResult> {
  const res = await fetch(`${CMS_API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe }),
  });

  if (res.status === 401) throw new CmsAuthError(401, "Invalid email or password");
  if (res.status === 403) throw new CmsAuthError(403, "Email not verified");
  if (!res.ok) throw new CmsAuthError(res.status, `cms-api login failed with status ${res.status}`);

  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, refreshToken: extractRefreshToken(res) };
}

export async function cmsGetMe(accessToken: string): Promise<CmsMeResult> {
  const res = await fetch(`${CMS_API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new CmsAuthError(res.status, `cms-api /auth/me failed with status ${res.status}`);

  const body = (await res.json()) as {
    documentId: string;
    email: string;
    name: string;
    username: string;
    role: { slug: string; name: string } | null;
  };

  return {
    documentId: body.documentId,
    email: body.email,
    name: body.name,
    username: body.username,
    roleSlug: body.role?.slug ?? null,
    roleName: body.role?.name ?? null,
  };
}

// Same request shape as cmsLogin's rotation half: the refresh token travels as a Cookie header
// (never a body), and cms-api responds with a fresh access token plus a rotated refresh_token
// cookie — the consumed one is blacklisted server-side the moment this call lands (tryClaim()).
export async function cmsRefresh(refreshToken: string): Promise<CmsLoginResult> {
  const res = await fetch(`${CMS_API_URL}/auth/refresh`, {
    method: "POST",
    headers: { Cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
  });

  if (!res.ok) throw new CmsAuthError(res.status, `cms-api refresh failed with status ${res.status}`);

  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, refreshToken: extractRefreshToken(res) };
}

// cms-api's logout endpoint reads the refresh token off a `refresh_token` cookie, never a body or
// Authorization header (see jwtRefreshCookieExtractor) — the same asymmetry as login's Set-Cookie,
// mirrored in the opposite direction.
export async function cmsLogout(refreshToken: string): Promise<void> {
  const res = await fetch(`${CMS_API_URL}/auth/logout`, {
    method: "POST",
    headers: { Cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
  });

  if (!res.ok) throw new CmsAuthError(res.status, `cms-api logout failed with status ${res.status}`);
}

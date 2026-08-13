import { afterEach, describe, expect, mock, test } from "bun:test";

import { CmsAuthError, cmsGetMe, cmsLogin, cmsLogout, cmsRefresh } from "./cms-auth.client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("cmsLogin", () => {
  test("returns the access token and the refresh token parsed off Set-Cookie", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { message: "Login successful.", accessToken: "access-abc" }, { "Set-Cookie": "refresh_token=refresh-xyz; HttpOnly; Path=/" }),
    ) as unknown as typeof fetch;

    const result = await cmsLogin("jane@example.com", "pw", false);

    expect(result).toEqual({ accessToken: "access-abc", refreshToken: "refresh-xyz" });
  });

  test("URL-decodes the refresh token value", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { accessToken: "a" }, { "Set-Cookie": "refresh_token=abc%3Bdef; HttpOnly" }),
    ) as unknown as typeof fetch;

    const result = await cmsLogin("jane@example.com", "pw", false);

    expect(result.refreshToken).toBe("abc;def");
  });

  test("throws CmsAuthError(401) on wrong credentials", async () => {
    globalThis.fetch = mock(async () => jsonResponse(401, { message: "Unauthorized" })) as unknown as typeof fetch;

    await expect(cmsLogin("jane@example.com", "wrong", false)).rejects.toMatchObject({
      status: 401,
    });
  });

  test("throws CmsAuthError(403) distinctly on an unverified account", async () => {
    globalThis.fetch = mock(async () => jsonResponse(403, { message: "Forbidden" })) as unknown as typeof fetch;

    const error = await cmsLogin("jane@example.com", "pw", false).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CmsAuthError);
    expect((error as CmsAuthError).status).toBe(403);
  });

  test("throws CmsAuthError(502) when a 200 response has no refresh_token cookie", async () => {
    globalThis.fetch = mock(async () => jsonResponse(200, { accessToken: "a" })) as unknown as typeof fetch;

    await expect(cmsLogin("jane@example.com", "pw", false)).rejects.toMatchObject({ status: 502 });
  });

  test("propagates the original status for an unexpected error code", async () => {
    globalThis.fetch = mock(async () => jsonResponse(500, { message: "boom" })) as unknown as typeof fetch;

    await expect(cmsLogin("jane@example.com", "pw", false)).rejects.toMatchObject({ status: 500 });
  });

  test("sends rememberMe through to cms-api", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { accessToken: "a" }, { "Set-Cookie": "refresh_token=r; HttpOnly" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await cmsLogin("jane@example.com", "pw", true);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "jane@example.com", password: "pw", rememberMe: true });
  });
});

describe("cmsGetMe", () => {
  test("maps role slug/name from the /auth/me response", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, {
        documentId: "doc-1",
        email: "jane@example.com",
        name: "Jane Doe",
        username: "janedoe",
        role: { slug: "admin", name: "Admin" },
      }),
    ) as unknown as typeof fetch;

    const me = await cmsGetMe("access-abc");

    expect(me).toEqual({
      documentId: "doc-1",
      email: "jane@example.com",
      name: "Jane Doe",
      username: "janedoe",
      roleSlug: "admin",
      roleName: "Admin",
    });
  });

  test("passes the access token as a Bearer header", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { documentId: "d", email: "e", name: "n", username: "u", role: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await cmsGetMe("access-abc");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-abc");
  });

  test("roleSlug/roleName are null when the user has no role", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { documentId: "d", email: "e", name: "n", username: "u", role: null }),
    ) as unknown as typeof fetch;

    const me = await cmsGetMe("access-abc");

    expect(me.roleSlug).toBeNull();
    expect(me.roleName).toBeNull();
  });

  test("throws CmsAuthError on a non-2xx response", async () => {
    globalThis.fetch = mock(async () => jsonResponse(401, { message: "Unauthorized" })) as unknown as typeof fetch;

    await expect(cmsGetMe("expired")).rejects.toMatchObject({ status: 401 });
  });
});

describe("cmsRefresh", () => {
  test("forwards the refresh token as a Cookie header and returns the rotated pair", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { message: "Token refreshed.", accessToken: "access-new" }, { "Set-Cookie": "refresh_token=refresh-new; HttpOnly; Path=/" }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await cmsRefresh("refresh-old");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:5000/auth/refresh");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Cookie).toBe("refresh_token=refresh-old");
    expect(result).toEqual({ accessToken: "access-new", refreshToken: "refresh-new" });
  });

  test("throws CmsAuthError(401) when the refresh token is invalid, expired, or already used", async () => {
    globalThis.fetch = mock(async () => jsonResponse(401, { message: "Unauthorized" })) as unknown as typeof fetch;

    await expect(cmsRefresh("stale")).rejects.toMatchObject({ status: 401 });
  });

  test("throws CmsAuthError(502) when a 200 response has no refresh_token cookie", async () => {
    globalThis.fetch = mock(async () => jsonResponse(200, { accessToken: "a" })) as unknown as typeof fetch;

    await expect(cmsRefresh("refresh-old")).rejects.toMatchObject({ status: 502 });
  });
});

describe("cmsLogout", () => {
  test("forwards the refresh token as a Cookie header, since that's what cms-api's extractor reads", async () => {
    const fetchMock = mock(async () => jsonResponse(200, { message: "Logged out." }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await cmsLogout("refresh-xyz");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:5000/auth/logout");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Cookie).toBe("refresh_token=refresh-xyz");
  });

  test("throws CmsAuthError on a non-2xx response", async () => {
    globalThis.fetch = mock(async () => jsonResponse(401, { message: "Invalid or expired refresh token" })) as unknown as typeof fetch;

    await expect(cmsLogout("stale")).rejects.toMatchObject({ status: 401 });
  });
});

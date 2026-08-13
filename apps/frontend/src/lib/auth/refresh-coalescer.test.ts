import { describe, expect, mock, test } from "bun:test";

import { CmsAuthError } from "./cms-auth.client";
import { refreshAccessToken } from "./refresh-coalescer";

describe("refreshAccessToken", () => {
  test("resolves with the rotated pair on success", async () => {
    const fetcher = mock(async () => ({ accessToken: "access-new", refreshToken: "refresh-new" }));

    const result = await refreshAccessToken("refresh-old-1", fetcher);

    expect(result).toEqual({ accessToken: "access-new", refreshToken: "refresh-new" });
  });

  test("resolves null instead of throwing when cms-api rejects the refresh token", async () => {
    const fetcher = mock(async () => {
      throw new CmsAuthError(401, "Invalid or expired refresh token");
    });

    const result = await refreshAccessToken("refresh-old-2", fetcher);

    expect(result).toBeNull();
  });

  test("N concurrent calls for the same refresh token produce exactly one cms-api call (D10)", async () => {
    let resolveFetch!: (value: { accessToken: string; refreshToken: string }) => void;
    const pending = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetcher = mock(async () => pending);

    const calls = Array.from({ length: 10 }, () => refreshAccessToken("refresh-old-3", fetcher));
    resolveFetch({ accessToken: "access-new", refreshToken: "refresh-new" });
    const results = await Promise.all(calls);

    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toEqual({ accessToken: "access-new", refreshToken: "refresh-new" });
    }
  });

  test("a later call for a different (already-rotated) refresh token is not coalesced with the finished one", async () => {
    const fetcher = mock(async (token: string) => ({ accessToken: `access-for-${token}`, refreshToken: `next-${token}` }));

    const first = await refreshAccessToken("refresh-a", fetcher);
    const second = await refreshAccessToken("refresh-b", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first?.accessToken).toBe("access-for-refresh-a");
    expect(second?.accessToken).toBe("access-for-refresh-b");
  });

  test("a failed refresh does not stick — a later call for the same token value retries", async () => {
    const fetcher = mock(async (): Promise<{ accessToken: string; refreshToken: string }> => {
      throw new CmsAuthError(401, "nope");
    });

    const first = await refreshAccessToken("refresh-retry", fetcher);
    expect(first).toBeNull();

    fetcher.mockImplementation(async () => ({ accessToken: "access-recovered", refreshToken: "refresh-recovered" }));
    const second = await refreshAccessToken("refresh-retry", fetcher);

    expect(second).toEqual({ accessToken: "access-recovered", refreshToken: "refresh-recovered" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("two different in-flight refresh tokens run concurrently without blocking each other", async () => {
    const fetcher = mock(async (token: string) => ({ accessToken: `access-${token}`, refreshToken: `next-${token}` }));

    const [a, b] = await Promise.all([refreshAccessToken("refresh-x", fetcher), refreshAccessToken("refresh-y", fetcher)]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a?.accessToken).toBe("access-refresh-x");
    expect(b?.accessToken).toBe("access-refresh-y");
  });
});

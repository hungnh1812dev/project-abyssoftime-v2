import { describe, expect, test } from "bun:test";

import { decodeTokenExpiryMs } from "./decode-token-expiry";

// base64url-encode a JSON payload the way a real JWT segment would be, without pulling in a JWT
// signing library just for tests.
function fakeJwt(payload: unknown): string {
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${segment}.signature`;
}

describe("decodeTokenExpiryMs", () => {
  test("reads the exp claim and converts seconds to milliseconds", () => {
    expect(decodeTokenExpiryMs(fakeJwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  test("returns null when the token doesn't have three dot-separated parts", () => {
    expect(decodeTokenExpiryMs("not-a-jwt")).toBeNull();
    expect(decodeTokenExpiryMs("only.two")).toBeNull();
    expect(decodeTokenExpiryMs("a.b.c.d")).toBeNull();
  });

  test("returns null when the payload segment isn't valid base64url JSON", () => {
    expect(decodeTokenExpiryMs("header.%%%not-base64%%%.signature")).toBeNull();
  });

  test("returns null when the decoded payload has no exp claim", () => {
    expect(decodeTokenExpiryMs(fakeJwt({ sub: "user-1" }))).toBeNull();
  });

  test("returns null when exp is present but not a number", () => {
    expect(decodeTokenExpiryMs(fakeJwt({ exp: "soon" }))).toBeNull();
  });
});

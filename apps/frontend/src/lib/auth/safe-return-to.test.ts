import { describe, expect, test } from "bun:test";

import { safeReturnTo } from "./safe-return-to";

describe("safeReturnTo", () => {
  test("passes through a same-origin relative path", () => {
    expect(safeReturnTo("/secret")).toBe("/secret");
    expect(safeReturnTo("/cv-2/main")).toBe("/cv-2/main");
  });

  test("preserves query strings on a relative path", () => {
    expect(safeReturnTo("/secret?tab=details")).toBe("/secret?tab=details");
  });

  test("falls back to / for null, undefined, or empty", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });

  test("falls back to / for an absolute URL to another origin", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("http://evil.com/secret")).toBe("/");
  });

  test("falls back to / for a protocol-relative URL", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
  });

  test("falls back to / for a backslash open-redirect trick", () => {
    expect(safeReturnTo("/\\evil.com")).toBe("/");
  });

  test("falls back to / for a path that doesn't start with a slash", () => {
    expect(safeReturnTo("evil.com")).toBe("/");
    expect(safeReturnTo("secret")).toBe("/");
  });
});

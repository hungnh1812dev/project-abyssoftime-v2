import { describe, expect, test } from "bun:test";

import type { RouteRule } from "@/lib/nav/route-rules";

import { isAccessDenied, KNOWN_PROTECTED_PATHS } from "./nav-rules-cache";

const rules: RouteRule[] = [
  { path: "/", requiresRole: "all" },
  { path: "/cv-2", requiresRole: "admin" },
  { path: "/secret", requiresRole: "super_admin" },
];

describe("isAccessDenied", () => {
  test("/auth is always exempt, even with no session", () => {
    expect(isAccessDenied(rules, "/auth", null)).toBe(false);
  });

  test("a nested /auth path is exempt too", () => {
    expect(isAccessDenied(rules, "/auth/reset", null)).toBe(false);
  });

  test("a public route is open to an anonymous visitor", () => {
    expect(isAccessDenied(rules, "/", null)).toBe(false);
  });

  test("an anonymous visitor is denied a role-gated route", () => {
    expect(isAccessDenied(rules, "/cv-2", null)).toBe(true);
  });

  test("a visitor with the right role is allowed", () => {
    expect(isAccessDenied(rules, "/secret", "super_admin")).toBe(false);
  });

  test("a visitor with an insufficient role is denied", () => {
    expect(isAccessDenied(rules, "/secret", "admin")).toBe(true);
  });

  test("an unlisted path is public even with no session (D5)", () => {
    expect(isAccessDenied(rules, "/does-not-exist", null)).toBe(false);
  });

  describe("when rules are null (header never once fetched successfully)", () => {
    test("a known legacy-protected path is denied to an anonymous visitor", () => {
      expect(isAccessDenied(null, "/cv-2", null)).toBe(true);
    });

    test("a known legacy-protected path is allowed to any authenticated visitor", () => {
      expect(isAccessDenied(null, "/cv-2", "guest")).toBe(false);
    });

    test("/auth stays exempt even with no rules at all", () => {
      expect(isAccessDenied(null, "/auth", null)).toBe(false);
    });

    test("an unlisted path stays public — failure only denies the known set, it doesn't fail open", () => {
      expect(isAccessDenied(null, "/does-not-exist", null)).toBe(false);
    });

    test("KNOWN_PROTECTED_PATHS mirrors every legacy SessionGuard path plus /secret and /account", () => {
      expect(KNOWN_PROTECTED_PATHS).toEqual([
        "/cv",
        "/cv-2",
        "/vaccine",
        "/learning/english",
        "/learning/develop/react",
        "/learning/develop/architecture",
        "/learning/develop/go",
        "/interview",
        "/interview/answers",
        "/secret",
        "/account",
      ]);
    });
  });
});

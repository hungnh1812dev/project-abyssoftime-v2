import { describe, expect, test } from "bun:test";

import { isRoleAllowed } from "./role-match";

describe("isRoleAllowed", () => {
  const publicCases: Array<[string | null | undefined, string | null | undefined]> = [
    ["", null],
    ["", "admin"],
    [null, null],
    [undefined, "admin"],
    ["all", null],
    ["ALL", "admin"],
    ["  all  ", "admin"],
  ];

  test.each(publicCases)(
    "requiresRole=%p is public for roleSlug=%p",
    (requiresRole, roleSlug) => {
      expect(isRoleAllowed(requiresRole, roleSlug)).toBe(true);
    },
  );

  test("single slug matches exactly", () => {
    expect(isRoleAllowed("admin", "admin")).toBe(true);
  });

  test("multi-slug allow-list matches any listed slug", () => {
    expect(isRoleAllowed("admin,super_admin", "super_admin")).toBe(true);
  });

  test("whitespace around slugs is trimmed", () => {
    expect(isRoleAllowed("admin, super_admin", "admin")).toBe(true);
    expect(isRoleAllowed("admin, super_admin", "super_admin")).toBe(true);
  });

  test("matching is case-insensitive on both sides", () => {
    expect(isRoleAllowed("Admin,Super_Admin", "ADMIN")).toBe(true);
    expect(isRoleAllowed("admin", "Admin")).toBe(true);
  });

  test("a slug not in the allow-list fails closed", () => {
    expect(isRoleAllowed("admin,super_admin", "editor")).toBe(false);
  });

  test("an unrecognised slug fails closed", () => {
    expect(isRoleAllowed("admin", "not_a_real_role")).toBe(false);
  });

  test("anonymous (roleSlug = null) fails closed against a restricted rule", () => {
    expect(isRoleAllowed("admin", null)).toBe(false);
    expect(isRoleAllowed("admin", undefined)).toBe(false);
  });

  test("an empty roleSlug fails closed against a restricted rule", () => {
    expect(isRoleAllowed("admin", "")).toBe(false);
  });
});

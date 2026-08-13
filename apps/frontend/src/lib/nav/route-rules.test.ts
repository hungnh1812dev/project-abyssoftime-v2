import { describe, expect, test } from "bun:test";

import type { HeaderNavItem } from "@/views/header/header.types";

import { buildRouteRules, resolveRule } from "./route-rules";

const nav: HeaderNavItem[] = [
  { title: "Home", requiresRole: "all", link: "/", subNavigations: [] },
  { title: "CV Elegant", requiresRole: "admin", link: "/cv-2", subNavigations: [] },
  {
    title: "Interview",
    requiresRole: "editor",
    link: "/interview",
    subNavigations: [{ title: "Answers", requiresRole: "admin", link: "/interview/answers" }],
  },
];

describe("buildRouteRules", () => {
  test("flattens top-level items and sub-navigations into a path table", () => {
    const rules = buildRouteRules(nav);

    expect(rules).toEqual([
      { path: "/", requiresRole: "all" },
      { path: "/cv-2", requiresRole: "admin" },
      { path: "/interview", requiresRole: "editor" },
      { path: "/interview/answers", requiresRole: "admin" },
    ]);
  });
});

describe("resolveRule", () => {
  const rules = buildRouteRules(nav);

  test("an exact match wins", () => {
    expect(resolveRule(rules, "/cv-2")).toBe("admin");
  });

  test("longest prefix wins over a shorter matching prefix", () => {
    const withChild = [...rules, { path: "/cv-2/main", requiresRole: "super_admin" }];
    expect(resolveRule(withChild, "/cv-2/main")).toBe("super_admin");
  });

  test("a path is matched by its nearest ancestor prefix", () => {
    expect(resolveRule(rules, "/interview/answers/1")).toBe("admin");
  });

  test("/ never acts as a prefix for other paths", () => {
    expect(resolveRule(rules, "/cv-2")).not.toBe("all");
  });

  test("a sibling path that merely starts with the same characters is not matched", () => {
    expect(resolveRule(rules, "/cv-22")).toBe("");
  });

  test("prefix matches only on a / boundary", () => {
    expect(resolveRule(rules, "/interview-notes")).toBe("");
  });

  test("an unlisted path is public (D5)", () => {
    expect(resolveRule(rules, "/does-not-exist")).toBe("");
  });
});

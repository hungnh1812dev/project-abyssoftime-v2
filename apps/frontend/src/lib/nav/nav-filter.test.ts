import { describe, expect, test } from "bun:test";

import type { HeaderNavItem } from "@/views/header/header.types";

import { filterNavTree } from "./nav-filter";

function item(overrides: Partial<HeaderNavItem>): HeaderNavItem {
  return {
    title: "Item",
    requiresRole: "all",
    link: "/item",
    subNavigations: [],
    ...overrides,
  };
}

describe("filterNavTree", () => {
  test("parent public + child restricted keeps the parent and drops only the restricted child", () => {
    const nav = [
      item({
        title: "Interview",
        requiresRole: "all",
        link: "/interview",
        subNavigations: [
          { title: "Public Answer", requiresRole: "all", link: "/interview/public" },
          { title: "Admin Answer", requiresRole: "admin", link: "/interview/answers" },
        ],
      }),
    ];

    const result = filterNavTree(nav, null);

    expect(result).toHaveLength(1);
    expect(result[0].subNavigations).toEqual([{ title: "Public Answer", requiresRole: "all", link: "/interview/public" }]);
  });

  test("parent restricted hides the parent and all children regardless of their own rule", () => {
    const nav = [
      item({
        title: "Interview",
        requiresRole: "admin",
        link: "/interview",
        subNavigations: [{ title: "Public Answer", requiresRole: "all", link: "/interview/public" }],
      }),
    ];

    expect(filterNavTree(nav, null)).toEqual([]);
    expect(filterNavTree(nav, "editor")).toEqual([]);
  });

  test("a parent with its own link survives even when every child is filtered out", () => {
    const nav = [
      item({
        title: "Interview",
        requiresRole: "all",
        link: "/interview",
        subNavigations: [{ title: "Admin Answer", requiresRole: "admin", link: "/interview/answers" }],
      }),
    ];

    const result = filterNavTree(nav, null);

    expect(result).toHaveLength(1);
    expect(result[0].subNavigations).toEqual([]);
  });

  test("a parent with no own link is dropped once every child is filtered out", () => {
    const nav = [
      item({
        title: "Interview",
        requiresRole: "all",
        link: "",
        subNavigations: [{ title: "Admin Answer", requiresRole: "admin", link: "/interview/answers" }],
      }),
    ];

    expect(filterNavTree(nav, null)).toEqual([]);
  });

  test("an allowed leaf item with no sub-navigations and a link is kept", () => {
    const nav = [item({ title: "CV", requiresRole: "all", link: "/cv" })];

    expect(filterNavTree(nav, null)).toEqual(nav);
  });
});

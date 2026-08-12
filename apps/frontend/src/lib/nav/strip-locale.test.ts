import { describe, expect, test } from "bun:test";

import { stripLocale } from "./strip-locale";

describe("stripLocale", () => {
  test("strips a matching locale prefix", () => {
    expect(stripLocale("/en/cv-2", "en")).toBe("/cv-2");
  });

  test("strips the prefix down to an empty string for the bare locale root", () => {
    expect(stripLocale("/en", "en")).toBe("");
  });

  test("leaves the path untouched when the locale does not prefix it", () => {
    expect(stripLocale("/vi/cv-2", "en")).toBe("/vi/cv-2");
  });

  test("leaves the path untouched when it has no locale prefix at all", () => {
    expect(stripLocale("/cv-2", "en")).toBe("/cv-2");
  });
});

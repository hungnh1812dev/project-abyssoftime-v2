import { afterEach, describe, expect, mock, test } from "bun:test";

import graphqlApi from "./graphqlApi";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("graphqlApi.fetch mock fallback (dev)", () => {
  test("falls back to the registered mock when a successful response selects an empty list", async () => {
    globalThis.fetch = mock(async () => jsonResponse(200, { data: { cvPageNews: { items: [] } } })) as unknown as typeof fetch;

    const result = await graphqlApi.fetch<unknown[]>({
      body: { query: "{ cvPageNews { items { name } } }" },
      selectKey: "cvPageNews.items",
      mock: "cv-new-main",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test("falls back to the registered mock on a GraphQL-level error", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { data: null, errors: [{ message: "Authentication required" }] }),
    ) as unknown as typeof fetch;

    const result = await graphqlApi.fetch<unknown[]>({
      body: { query: "{ cvPageNews { items { name } } }" },
      selectKey: "cvPageNews.items",
      mock: "cv-new-main",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test("still returns live data untouched when the selected result is non-empty", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse(200, { data: { cvPageNews: { items: [{ name: "Real CV" }] } } }),
    ) as unknown as typeof fetch;

    const result = await graphqlApi.fetch<{ name: string }[]>({
      body: { query: "{ cvPageNews { items { name } } }" },
      selectKey: "cvPageNews.items",
      mock: "cv-new-main",
    });

    expect(result).toEqual([{ name: "Real CV" }]);
  });
});

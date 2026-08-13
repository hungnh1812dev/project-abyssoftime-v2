import { unifyFetch } from "@/api/fetcher";
import graphqlApi from "@/api/graphqlApi";
import { registerService } from "@/api/registry";

import { HEADER_QUERY } from "./header.queries";
import type { HeaderData } from "./header.types";

export const HEADER_KEY = "header" as const;

async function _fetchHeader(): Promise<HeaderData | null> {
  const data = await graphqlApi.fetch<HeaderData>({
    body: { query: HEADER_QUERY },
    selectKey: "header",
    mock: "header",
    next: { revalidate: 300, tags: ["header"] },
  });
  return data ?? null;
}

registerService({ key: HEADER_KEY, driver: "graphql", execute: _fetchHeader });

export async function getHeader(): Promise<HeaderData | null> {
  return unifyFetch<HeaderData | null>({ apiKey: HEADER_KEY });
}

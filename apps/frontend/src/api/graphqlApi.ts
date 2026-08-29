import get from "lodash/get";

import { MockView } from "../mocks/mock-all";
import restfulApi from "./restfulApi";

export interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
  extensions?: Record<string, unknown>;
}

export interface GraphQLOptions {
  url?: string;
  body: unknown;
  headers?: Record<string, string>;
  selectKey?: string;
  mock?: string;
  next?: { revalidate?: number | false; tags?: string[] };
  cache?: RequestCache;
}

// Legacy options kept during migration — pages/views call query() until switched to services
export interface GraphQLQueryOptions {
  query: string;
  variables?: Record<string, unknown>;
  dataKey?: string;
  mock?: string;
  url?: string;
  next?: { revalidate?: number | false; tags?: string[] };
  cache?: RequestCache;
}

const DEFAULT_URL = process.env.GRAPHQL_URL ?? "http://localhost:5000/graphql";
const GRAPHQL_TOKEN = process.env.GRAPHQL_TOKEN;
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;
const isDev = process.env.NEXT_ENV !== "production";

// Primary method — used by services (portfolio interface)
const graphqlFetch = async <T>(options: GraphQLOptions): Promise<T> => {
  const { url = DEFAULT_URL, body, headers = {}, selectKey, mock, next, cache } = options;

  const authToken = GRAPHQL_TOKEN ?? STRAPI_API_TOKEN;
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  let json: { data?: Record<string, unknown>; errors?: GraphQLError[] };

  json = await restfulApi.fetch<typeof json>({
    url,
    method: "POST",
    body,
    headers: { ...authHeaders, ...headers },
    next,
    cache,
    mock,
  });

  if (json.data != null && !json.errors?.length) {
    const result = selectKey ? get(json.data, selectKey) : json.data;
    // An empty array is a legitimate response (the content type exists but has no entries yet, e.g.
    // in a fresh dev DB) — fall through to the mock below rather than handing pages a value they
    // never guard against.
    if (result != null && !(Array.isArray(result) && result.length === 0)) {
      return result as T;
    }
  }

  // Either a GraphQL-level error (e.g. an auth-required resolver) or a legitimate-but-empty result —
  // restfulApi's own mock fallback never sees either case since the HTTP call itself was a 200.
  // Registered mocks come in two shapes: a raw response envelope (`{ data: { <field>: ... } }`, for
  // services that still read `selectKey` off it) or the already-selected value directly (most CV
  // mocks). Try the envelope shape first and fall back to the bare value.
  if (isDev && mock) {
    const mockValue = MockView[mock];
    if (mockValue !== undefined) {
      const envelope = (mockValue as { data?: Record<string, unknown> } | undefined)?.data;
      const viaEnvelope = envelope && selectKey ? get(envelope, selectKey) : envelope;
      if (viaEnvelope !== undefined) return viaEnvelope as T;
      return mockValue as T;
    }
  }

  throw new Error(`GraphQL request failed for: ${url}`);
};

// Legacy method — kept until all pages/views switch to service functions
const graphqlQuery = async <T>(options: GraphQLQueryOptions): Promise<T> => {
  const { query, variables, mock, dataKey, url = DEFAULT_URL, next, cache } = options;
  return graphqlFetch<T>({
    url,
    body: { query, variables },
    selectKey: dataKey,
    mock,
    next,
    cache,
  });
};

const graphqlApi = { fetch: graphqlFetch, query: graphqlQuery };
export default graphqlApi;

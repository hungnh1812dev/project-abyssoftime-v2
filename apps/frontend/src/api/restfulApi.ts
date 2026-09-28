import { MockView } from "../mocks/mock-all";
import get from "lodash/get";

export interface ApiError extends Error {
  status?: number;
  info?: unknown;
}

export interface RestOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  selectKey?: string;
  mock?: string;
  next?: { revalidate?: number | false; tags?: string[] };
  cache?: RequestCache;
}

const isDev = process.env.NEXT_ENV !== "production";

const restfulFetch = async <T>(options: RestOptions): Promise<T> => {
  const { url, method = "GET", body, headers, selectKey, mock, next, cache } = options;

  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(50_000),
      ...(body !== undefined && {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...headers },
      }),
      ...(body === undefined && headers && { headers }),
      ...(next && { next }),
      ...(cache && { cache }),
    });

    if (res.ok) {
      const json: unknown = await res.json();
      const result = selectKey ? get(json, selectKey) : json;
      if (result != null && !(Array.isArray(result) && result.length === 0)) return result as T;
    } else {
      let info: unknown;
      try {
        info = await res.json();
      } catch {
        /* ignore parse failure */
      }
      // GraphQL validation errors come back as HTTP 400 with `{ errors: [{ message }] }`; Nest errors
      // as `{ message }`. Put them in the message itself: Node's log prints nested objects as [Object].
      const body = info as { errors?: { message?: string }[]; message?: unknown } | undefined;
      const detail = body?.errors?.map((e) => e.message).join("; ") ?? (body?.message != null ? String(body.message) : "");
      const err = new Error(`HTTP ${res.status}: Request failed for ${url}${detail ? ` — ${detail}` : ""}`) as ApiError;
      err.status = res.status;
      if (info !== undefined) err.info = info;
      throw err;
    }
  } catch (err) {
    // if ((err as ApiError).status !== undefined) throw err;
    if (isDev && mock) {
      const data = MockView[mock];
      if (data !== undefined) return data as T;
    }
    // Server-side (SSR/ISR) failures otherwise reach the logs as a bare "fetch failed" or a digest;
    // the real reason (ECONNREFUSED, ENOTFOUND, timeout, the response body) is in cause/info.
    const { status, info, cause } = err as ApiError & { cause?: unknown };
    console.error("[restfulApi] request failed", {
      method,
      url,
      status,
      info: info === undefined ? undefined : JSON.stringify(info),
      cause,
      error: (err as Error).message,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    throw err;
  }

  if (isDev && mock) {
    const data = MockView[mock];
    if (data !== undefined) return data as T;
  }

  console.error("[restfulApi] empty response", { method, url, selectKey });
  throw new Error(`Request failed for: ${url} (empty response${selectKey ? ` at ${selectKey}` : ""})`);
};

const restfulApi = { fetch: restfulFetch };
export default restfulApi;

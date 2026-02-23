/**
 * PostgREST protocol emulator for testing.
 *
 * Provides a fetch handler that interprets Supabase REST API calls
 * and routes them to a MockDBState instance. Supports the same URL
 * patterns and headers that Supabase JS client generates.
 *
 * @example
 * ```typescript
 * const db = new MockDBState({ users: [{ id: "u1", name: "Alice" }] });
 * const handler = createSupabaseRestHandler(db);
 * const mockFetch = createMockFetch([handler], []);
 * // Now supabaseClient.from("users").select() works against in-memory DB
 * ```
 */

import type { MockDBState } from "./mock_db.ts";
import type { FetchHandler } from "./mock_fetch.ts";

// =============================================================================
// URL parsing helpers
// =============================================================================

/** Extract table name from a PostgREST URL (e.g. `/rest/v1/users?...` -> `users`) */
export function extractTableFromUrl(url: string): string {
  const match = url.match(/\/rest\/v1\/([^?/]+)/);
  return match?.[1] ?? "";
}

/** Extract RPC function name from URL (e.g. `/rest/v1/rpc/my_func` -> `my_func`) */
export function extractRpcFunctionFromUrl(url: string): string {
  const match = url.match(/\/rest\/v1\/rpc\/([^?/]+)/);
  return match?.[1] ?? "";
}

/**
 * Parse PostgREST filter parameters from URL.
 *
 * Supports:
 * - `eq.VALUE` — exact equality
 * - `ilike.VALUE` — case-insensitive match
 * - `is.null` — null check
 *
 * Skips meta parameters (select, order, limit, offset, on_conflict)
 * and dot-notation keys (joined table filters).
 */
export function parsePostgrestFilters(
  url: string,
): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  const urlObj = new URL(url);

  for (const [key, value] of urlObj.searchParams) {
    // Skip PostgREST meta params
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) {
      continue;
    }

    // Skip table-prefixed filters (e.g. plan_prices.period_months)
    if (key.includes(".")) continue;

    if (value.startsWith("eq.")) {
      filters[key] = value.slice(3);
    } else if (value.startsWith("ilike.")) {
      filters[key] = value.slice(6);
    } else if (value === "is.null") {
      filters[key] = null;
    }
  }

  return filters;
}

/** Parse PostgREST options from URL params and headers */
export function parsePostgrestOptions(
  url: string,
  headers: Record<string, string>,
): {
  count?: boolean;
  head?: boolean;
  single?: boolean;
  order?: string;
  limit?: number;
  offset?: number;
} {
  const urlObj = new URL(url);
  const prefer = headers["prefer"] ?? "";

  return {
    count: prefer.includes("count=exact"),
    single: headers["accept"]?.includes("vnd.pgrst.object") ?? false,
    order: urlObj.searchParams.get("order") ?? undefined,
    limit: urlObj.searchParams.has("limit")
      ? parseInt(urlObj.searchParams.get("limit")!)
      : undefined,
    offset: urlObj.searchParams.has("offset")
      ? parseInt(urlObj.searchParams.get("offset")!)
      : undefined,
  };
}

// =============================================================================
// Header extraction helper
// =============================================================================

function extractHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([k, v]) => {
        headers[k] = v;
      });
    } else {
      Object.assign(headers, init.headers);
    }
  }
  return headers;
}

// =============================================================================
// Supabase REST API handler
// =============================================================================

/**
 * Create a fetch handler that emulates the Supabase PostgREST API.
 *
 * Handles:
 * - **HEAD** — count queries (`select('*', { count: 'exact', head: true })`)
 * - **GET** — select with filters, ordering, pagination, single row
 * - **POST** — insert and upsert (via `prefer: resolution=merge-duplicates`)
 * - **PATCH** — update with filters
 * - **DELETE** — delete with filters
 * - **RPC** — `/rest/v1/rpc/<name>` calls
 *
 * Only intercepts URLs containing `/rest/v1/` — other URLs pass through.
 *
 * @param dbState - MockDBState instance to use as the data store
 * @returns FetchHandler that can be passed to createMockFetch
 */
export function createSupabaseRestHandler(
  dbState: MockDBState,
): FetchHandler {
  return (url: string, init?: RequestInit): Response | null => {
    if (!url.includes("/rest/v1/")) return null;

    const method = init?.method ?? "GET";
    const headers = extractHeaders(init);

    // RPC calls
    if (url.includes("/rest/v1/rpc/")) {
      const fn = extractRpcFunctionFromUrl(url);
      let args: unknown = {};
      if (init?.body) {
        try {
          args = JSON.parse(init.body as string);
        } catch {
          args = {};
        }
      }
      const result = dbState.executeRpc(fn, args);
      if (result.error) {
        return new Response(JSON.stringify(result.error), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(result.data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const table = extractTableFromUrl(url);
    const filters = parsePostgrestFilters(url);
    const options = parsePostgrestOptions(url, headers);

    switch (method) {
      case "HEAD": {
        const headResult = dbState.select(
          table,
          Object.keys(filters).length > 0 ? filters : undefined,
          { ...options, count: true },
        );
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": `*/${headResult.count}`,
          },
        });
      }

      case "GET": {
        const result = dbState.select(
          table,
          Object.keys(filters).length > 0 ? filters : undefined,
          options,
        );

        const responseHeaders: Record<string, string> = {
          "content-type": "application/json",
        };
        if (result.count !== null) {
          responseHeaders["content-range"] = `0-${
            (result.data as unknown[])?.length ?? 0
          }/${result.count}`;
        }

        if (options.single) {
          if (!result.data) {
            return new Response(
              JSON.stringify({ message: "Row not found" }),
              { status: 406, headers: responseHeaders },
            );
          }
          return new Response(JSON.stringify(result.data), {
            status: 200,
            headers: responseHeaders,
          });
        }

        return new Response(JSON.stringify(result.data), {
          status: 200,
          headers: responseHeaders,
        });
      }

      case "POST": {
        let body: unknown = {};
        if (init?.body) {
          try {
            body = JSON.parse(init.body as string);
          } catch {
            body = {};
          }
        }

        const prefer = headers["prefer"] ?? "";
        const urlObj = new URL(url);
        const onConflict = urlObj.searchParams.get("on_conflict");

        let result: unknown[];
        if (prefer.includes("resolution=merge-duplicates") && onConflict) {
          result = dbState.upsert(table, body, onConflict);
        } else {
          result = dbState.insert(table, body);
        }

        const responseHeaders: Record<string, string> = {
          "content-type": "application/json",
        };

        if (prefer.includes("return=representation")) {
          if (
            headers["accept"]?.includes("vnd.pgrst.object") ||
            result.length === 1
          ) {
            return new Response(JSON.stringify(result[0]), {
              status: 201,
              headers: responseHeaders,
            });
          }
          return new Response(JSON.stringify(result), {
            status: 201,
            headers: responseHeaders,
          });
        }

        return new Response(JSON.stringify(result), {
          status: 201,
          headers: responseHeaders,
        });
      }

      case "PATCH": {
        let body: Record<string, unknown> = {};
        if (init?.body) {
          try {
            body = JSON.parse(init.body as string);
          } catch {
            body = {};
          }
        }

        const result = dbState.update(table, filters, body);
        const prefer = headers["prefer"] ?? "";

        if (prefer.includes("return=representation")) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(null, { status: 204 });
      }

      case "DELETE": {
        dbState.delete(table, filters);
        return new Response(null, { status: 204 });
      }

      default:
        return null;
    }
  };
}

// =============================================================================
// Supabase Functions invoke handler
// =============================================================================

/**
 * Create a handler for Supabase Edge Function invocations.
 *
 * Matches URLs containing `/functions/v1/` and returns a success response.
 * Useful for mocking fire-and-forget function calls (e.g. background tasks).
 *
 * @returns FetchHandler that responds with `{ success: true }`
 */
export function createSupabaseFunctionsHandler(): FetchHandler {
  return (url: string, _init?: RequestInit): Response | null => {
    if (!url.includes("/functions/v1/")) return null;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

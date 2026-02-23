/**
 * Mock fetch interceptor for Supabase Edge Function tests.
 *
 * Replaces `globalThis.fetch` with a router that matches URL patterns
 * to handler functions. Unmatched URLs throw — ensuring all external
 * calls are explicitly mocked.
 *
 * @example
 * ```typescript
 * const fetchLog: FetchCall[] = [];
 * const mockFetch = createMockFetch([myHandler], fetchLog);
 * globalThis.fetch = mockFetch;
 * // ... run edge function logic ...
 * assertFetchCount(fetchLog, "/rest/v1/", 2);
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/** Recorded fetch call for assertions */
export interface FetchCall {
  /** Full URL of the request */
  url: string;
  /** HTTP method */
  method: string;
  /** Normalized request headers */
  headers: Record<string, string>;
  /** Parsed request body (JSON-decoded if possible) */
  body: unknown;
  /** Timestamp (Date.now()) when the call was made */
  timestamp: number;
}

/**
 * A fetch handler function.
 *
 * Return a Response to handle the request, or `null` to pass
 * to the next handler in the chain.
 */
export type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Promise<Response> | Response | null;

// =============================================================================
// Core mock fetch builder
// =============================================================================

/**
 * Create a mock fetch function that routes requests through handlers.
 *
 * Handlers are checked in order — the first non-null return wins.
 * All calls are logged to `fetchLog` for later assertions.
 * Unmatched URLs throw an error with full request details.
 *
 * @param handlers - Ordered list of handler functions
 * @param fetchLog - Array to record all fetch calls into
 * @returns A function compatible with `globalThis.fetch`
 *
 * @example
 * ```typescript
 * const log: FetchCall[] = [];
 * const mock = createMockFetch([
 *   (url) => url.includes("/api") ? new Response("ok") : null,
 * ], log);
 * globalThis.fetch = mock;
 * ```
 */
export function createMockFetch(
  handlers: FetchHandler[],
  fetchLog: FetchCall[],
): typeof globalThis.fetch {
  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    const method = init?.method ??
      (input instanceof Request ? input.method : "GET");
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

    let body: unknown = null;
    if (init?.body) {
      try {
        body = typeof init.body === "string"
          ? JSON.parse(init.body)
          : init.body;
      } catch {
        body = init.body;
      }
    }

    // Log the call
    fetchLog.push({ url, method, headers, body, timestamp: Date.now() });

    // Try each handler in order
    for (const handler of handlers) {
      const result = handler(url, init);
      if (result !== null) {
        return result instanceof Promise ? await result : result;
      }
    }

    throw new Error(
      `[MockFetch] Unmocked fetch call:\n  URL: ${url}\n  Method: ${method}\n  Body: ${
        JSON.stringify(body, null, 2)
      }`,
    );
  };
}

// =============================================================================
// Assertion helpers
// =============================================================================

/** Find fetch calls matching a URL pattern (string substring or RegExp) */
export function findFetchCalls(
  log: FetchCall[],
  urlPattern: string | RegExp,
): FetchCall[] {
  return log.filter((call) => {
    if (typeof urlPattern === "string") {
      return call.url.includes(urlPattern);
    }
    return urlPattern.test(call.url);
  });
}

/**
 * Assert a URL pattern was called exactly N times.
 * Throws with the full call log on mismatch.
 */
export function assertFetchCount(
  log: FetchCall[],
  urlPattern: string | RegExp,
  expected: number,
): void {
  const calls = findFetchCalls(log, urlPattern);
  if (calls.length !== expected) {
    throw new Error(
      `Expected ${expected} fetch call(s) to ${urlPattern}, but found ${calls.length}.\n` +
        `Actual calls:\n${log.map((c) => `  ${c.method} ${c.url}`).join("\n")}`,
    );
  }
}

/** Assert a URL pattern was never called */
export function assertNotFetched(
  log: FetchCall[],
  urlPattern: string | RegExp,
): void {
  assertFetchCount(log, urlPattern, 0);
}

/** Get the body of the first matching fetch call, or throw if none found */
export function getFetchBody(
  log: FetchCall[],
  urlPattern: string | RegExp,
): unknown {
  const calls = findFetchCalls(log, urlPattern);
  if (calls.length === 0) {
    throw new Error(`No fetch calls found matching ${urlPattern}`);
  }
  return calls[0].body;
}

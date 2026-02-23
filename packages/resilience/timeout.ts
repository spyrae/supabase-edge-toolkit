/**
 * Timeout Handling Module
 *
 * Provides timeout wrapper for fetch and async operations.
 *
 * @example
 * ```typescript
 * import { withTimeout, fetchWithTimeout, TimeoutError } from "@supa-edge-toolkit/resilience";
 *
 * // Wrap any async operation
 * const result = await withTimeout(someAsyncOperation(), 10000, "operation-name");
 *
 * // Fetch with timeout
 * const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
 * ```
 */

import { DEFAULT_TIMEOUTS } from "./types.ts";

// =============================================================================
// Timeout Error
// =============================================================================

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends Error {
  readonly code = "TIMEOUT";
  readonly timeoutMs: number;
  readonly operation: string;

  constructor(operation: string, timeoutMs: number) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }

  /**
   * Timeout errors are generally retryable
   */
  get isRetryable(): boolean {
    return true;
  }

  override toString(): string {
    return `TimeoutError[${this.operation}]: timed out after ${this.timeoutMs}ms`;
  }
}

// =============================================================================
// Timeout Functions
// =============================================================================

/**
 * Wrap an async operation with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Name of the operation (for error messages)
 * @returns The result of the promise
 * @throws TimeoutError if the operation times out
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   externalApi.call(),
 *   10000,
 *   "external-api-call"
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation = "unknown",
): Promise<T> {
  let timeoutId: number | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create an AbortController with automatic timeout
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns AbortController that will abort after timeout
 *
 * @example
 * ```typescript
 * const controller = createTimeoutController(5000);
 * const response = await fetch(url, { signal: controller.signal });
 * ```
 */
export function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();

  setTimeout(() => {
    controller.abort(new TimeoutError("fetch", timeoutMs));
  }, timeoutMs);

  return controller;
}

/**
 * Fetch with timeout support
 *
 * Uses AbortController for proper request cancellation.
 *
 * @param url - URL to fetch
 * @param options - Fetch options (RequestInit)
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns Fetch Response
 * @throws TimeoutError if the request times out
 *
 * @example
 * ```typescript
 * const response = await fetchWithTimeout(
 *   "https://api.example.com/data",
 *   { method: "GET", headers: { "Authorization": "Bearer token" } },
 *   5000
 * );
 * ```
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUTS.EXTERNAL_API,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    // Convert AbortError to TimeoutError for consistent handling
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError("fetch", timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError ||
    (error instanceof Error && error.name === "AbortError");
}

/**
 * Get default timeout for a service type
 */
export function getDefaultTimeout(
  serviceType: keyof typeof DEFAULT_TIMEOUTS,
): number {
  return DEFAULT_TIMEOUTS[serviceType];
}

// Re-export types
export { DEFAULT_TIMEOUTS } from "./types.ts";
export type { TimeoutConfig } from "./types.ts";

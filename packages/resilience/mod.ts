/**
 * @supabase-edge-toolkit/resilience
 *
 * Resilience toolkit for Supabase Edge Functions.
 * Provides timeout handling, circuit breaker, and retry with exponential backoff.
 *
 * @example Basic timeout
 * ```typescript
 * import { fetchWithTimeout, TimeoutError } from "@supabase-edge-toolkit/resilience";
 *
 * try {
 *   const response = await fetchWithTimeout(url, { method: "GET" }, 5000);
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.log("Request timed out");
 *   }
 * }
 * ```
 *
 * @example Circuit breaker
 * ```typescript
 * import { CircuitBreaker } from "@supabase-edge-toolkit/resilience";
 *
 * const breaker = CircuitBreaker.forExternalApi("my-service");
 * const result = await breaker.call(async () => {
 *   return await externalClient.search(params);
 * });
 * ```
 *
 * @example Retry with exponential backoff
 * ```typescript
 * import { withRetry, RETRY_CONFIGS } from "@supabase-edge-toolkit/resilience";
 *
 * const data = await withRetry(
 *   async () => {
 *     const response = await fetch(url);
 *     if (!response.ok) throw new Error(`HTTP ${response.status}`);
 *     return response.json();
 *   },
 *   RETRY_CONFIGS.EXTERNAL_API
 * );
 * ```
 *
 * @example Combined: resilientFetch
 * ```typescript
 * import { resilientFetch, CIRCUIT_BREAKER_CONFIGS, RETRY_CONFIGS } from "@supabase-edge-toolkit/resilience";
 *
 * const response = await resilientFetch(url, {
 *   method: "GET",
 *   headers: { "Authorization": "Bearer token" },
 * }, {
 *   serviceName: "my-api",
 *   timeout: 10000,
 *   circuitBreaker: CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
 *   retry: RETRY_CONFIGS.EXTERNAL_API,
 * });
 * ```
 */

// =============================================================================
// Timeout
// =============================================================================

export {
  createTimeoutController,
  DEFAULT_TIMEOUTS,
  fetchWithTimeout,
  getDefaultTimeout,
  isTimeoutError,
  TimeoutError,
  withTimeout,
} from "./timeout.ts";

// =============================================================================
// Circuit Breaker
// =============================================================================

export {
  CIRCUIT_BREAKER_CONFIGS,
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit_breaker.ts";

// =============================================================================
// Retry
// =============================================================================

export {
  calculateRetryDelay,
  createRetryWrapper,
  isRetryableError,
  RETRY_CONFIGS,
  RetryError,
  withRetry,
} from "./retry.ts";

// =============================================================================
// Types
// =============================================================================

export type {
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitState,
  ResilientFetchConfig,
  ResilientResult,
  RetryConfig,
  RetryContext,
  TimeoutConfig,
} from "./types.ts";

// =============================================================================
// Combined: Resilient Fetch
// =============================================================================

import { DEFAULT_TIMEOUTS, fetchWithTimeout } from "./timeout.ts";
import { CIRCUIT_BREAKER_CONFIGS, CircuitBreaker } from "./circuit_breaker.ts";
import { RETRY_CONFIGS, withRetry } from "./retry.ts";
import type { CircuitBreakerConfig, ResilientFetchConfig } from "./types.ts";

/**
 * Resilient fetch that combines timeout, circuit breaker, and retry
 *
 * @param url - URL to fetch
 * @param init - Fetch options
 * @param config - Resilience configuration
 * @returns Response from fetch
 *
 * @example
 * ```typescript
 * const response = await resilientFetch(
 *   "https://api.example.com/v3/search",
 *   {
 *     method: "GET",
 *     headers: { Authorization: apiKey },
 *   },
 *   {
 *     serviceName: "my-api",
 *     timeout: 10000,
 *   }
 * );
 * ```
 */
export async function resilientFetch(
  url: string | URL,
  init?: RequestInit,
  config?: Partial<ResilientFetchConfig>,
): Promise<Response> {
  const serviceName = config?.serviceName ?? "unknown";
  const timeoutMs = typeof config?.timeout === "number"
    ? config.timeout
    : (config?.timeout?.timeoutMs ?? DEFAULT_TIMEOUTS.EXTERNAL_API);

  // Get circuit breaker (if not disabled)
  const useCircuitBreaker = config?.circuitBreaker !== false;
  const circuitBreakerConfig: CircuitBreakerConfig =
    typeof config?.circuitBreaker === "object"
      ? config.circuitBreaker
      : CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API;

  const breaker = useCircuitBreaker
    ? CircuitBreaker.getOrCreate(serviceName, circuitBreakerConfig)
    : null;

  // Get retry config (if not disabled)
  const useRetry = config?.retry !== false;
  const retryConfig = typeof config?.retry === "object"
    ? config.retry
    : RETRY_CONFIGS.EXTERNAL_API;

  // The actual fetch operation
  const operation = async (): Promise<Response> => {
    const response = await fetchWithTimeout(url, init, timeoutMs);

    // Throw on server errors to trigger circuit breaker
    if (response.status >= 500) {
      const error = new Error(`HTTP ${response.status}`) as Error & {
        statusCode: number;
      };
      error.statusCode = response.status;
      throw error;
    }

    return response;
  };

  // Wrap with circuit breaker if enabled
  const withCircuitBreaker = breaker
    ? () => breaker.call(operation)
    : operation;

  // Wrap with retry if enabled
  if (useRetry) {
    return await withRetry(withCircuitBreaker, retryConfig);
  }

  return await withCircuitBreaker();
}

/**
 * Create a pre-configured resilient fetch for a specific service
 *
 * @param serviceName - Name of the service (for logging and circuit breaker)
 * @param defaultConfig - Default configuration to use
 * @returns Configured fetch function
 *
 * @example
 * ```typescript
 * const apiFetch = createResilientFetch("my-api", {
 *   timeout: 10000,
 *   circuitBreaker: CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
 *   retry: RETRY_CONFIGS.EXTERNAL_API,
 * });
 *
 * const response = await apiFetch("/v3/search", {
 *   headers: { Authorization: apiKey },
 * });
 * ```
 */
export function createResilientFetch(
  serviceName: string,
  defaultConfig?: Omit<Partial<ResilientFetchConfig>, "serviceName">,
): (
  url: string | URL,
  init?: RequestInit,
  overrideConfig?: Partial<ResilientFetchConfig>,
) => Promise<Response> {
  return (url, init, overrideConfig) =>
    resilientFetch(url, init, {
      ...defaultConfig,
      ...overrideConfig,
      serviceName,
    });
}

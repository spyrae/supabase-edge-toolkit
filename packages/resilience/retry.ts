/**
 * Retry with Exponential Backoff Module
 *
 * Provides automatic retry for transient failures with configurable
 * exponential backoff and jitter.
 *
 * @example
 * ```typescript
 * import { withRetry, RetryError, RETRY_CONFIGS } from "@supa-edge-toolkit/resilience";
 *
 * const result = await withRetry(
 *   async () => {
 *     const response = await fetch("https://api.example.com/data");
 *     if (!response.ok) throw new Error(`HTTP ${response.status}`);
 *     return response.json();
 *   },
 *   RETRY_CONFIGS.EXTERNAL_API
 * );
 * ```
 */

import type { RetryConfig, RetryContext } from "./types.ts";
import { RETRY_CONFIGS } from "./types.ts";

// =============================================================================
// Retry Error
// =============================================================================

/**
 * Error thrown when all retry attempts are exhausted
 */
export class RetryError extends Error {
  readonly code = "RETRY_EXHAUSTED";
  readonly attempts: number;
  readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = "RetryError";
    this.attempts = attempts;
    this.lastError = lastError;
  }

  /**
   * Retry exhausted errors are not retryable
   */
  get isRetryable(): boolean {
    return false;
  }

  override toString(): string {
    return `RetryError: ${this.message} (after ${this.attempts} attempts)`;
  }
}

// =============================================================================
// Retry Functions
// =============================================================================

/**
 * Calculate delay for a retry attempt with exponential backoff
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const multiplier = config.backoffMultiplier ?? 2;

  // Exponential backoff: baseDelay * multiplier^(attempt-1)
  let delay = config.baseDelayMs * Math.pow(multiplier, attempt - 1);

  // Cap at maxDelay
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter if enabled (±25% random variation)
  if (config.jitter) {
    const jitterFactor = 0.5 + Math.random(); // 0.5 to 1.5
    delay = Math.round(delay * jitterFactor);
  }

  return delay;
}

/**
 * Check if an error is retryable based on configuration
 *
 * @param error - The error to check
 * @param config - Retry configuration
 * @returns Whether the error should trigger a retry
 */
export function isRetryableError(
  error: unknown,
  config: RetryConfig,
): boolean {
  const retryableCodes = config.retryableStatusCodes ??
    [429, 500, 502, 503, 504];
  const retryableErrorCodes = config.retryableErrorCodes ?? [];

  if (!(error instanceof Error)) {
    return false;
  }

  // Check for known retryable error types
  const err = error as unknown as Record<string, unknown>;

  // Check statusCode property
  if (
    typeof err.statusCode === "number" &&
    retryableCodes.includes(err.statusCode)
  ) {
    return true;
  }

  // Check status property
  if (
    typeof err.status === "number" && retryableCodes.includes(err.status)
  ) {
    return true;
  }

  // Check code property (string)
  if (typeof err.code === "string") {
    // Numeric code (e.g., "429")
    const numericCode = parseInt(err.code, 10);
    if (!isNaN(numericCode) && retryableCodes.includes(numericCode)) {
      return true;
    }

    // String code (e.g., "TIMEOUT", "RATE_LIMITED")
    if (retryableErrorCodes.includes(err.code)) {
      return true;
    }
  }

  // Check for isRetryable property on the error
  if (typeof err.isRetryable === "boolean") {
    return err.isRetryable;
  }

  // Check for known retryable error names
  const retryableNames = ["TimeoutError", "AbortError", "NetworkError"];
  if (retryableNames.includes(error.name)) {
    return true;
  }

  // Check error message for common retryable patterns
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    "timeout",
    "timed out",
    "rate limit",
    "too many requests",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "network error",
    "connection refused",
    "econnreset",
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with automatic retry
 *
 * @param operation - The async operation to execute
 * @param config - Retry configuration
 * @param onRetry - Optional callback called before each retry
 * @returns The result of the operation
 * @throws RetryError if all attempts are exhausted
 *
 * @example
 * ```typescript
 * const data = await withRetry(
 *   async () => {
 *     const response = await fetch(url);
 *     if (!response.ok) {
 *       const error = new Error(`HTTP ${response.status}`);
 *       (error as any).statusCode = response.status;
 *       throw error;
 *     }
 *     return response.json();
 *   },
 *   RETRY_CONFIGS.EXTERNAL_API,
 *   (ctx) => console.log(`Retry ${ctx.attempt}/${ctx.maxAttempts}`)
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = RETRY_CONFIGS.EXTERNAL_API,
  onRetry?: (context: RetryContext) => void,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Check if we should retry
      if (attempt >= config.maxAttempts) {
        // No more attempts
        break;
      }

      if (!isRetryableError(error, config)) {
        // Not a retryable error
        break;
      }

      // Calculate delay and wait
      const delayMs = calculateRetryDelay(attempt, config);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry({
          attempt,
          maxAttempts: config.maxAttempts,
          lastError: err,
          delayMs,
        });
      }

      await sleep(delayMs);
    }
  }

  // All attempts exhausted
  throw new RetryError(
    `Operation failed after ${config.maxAttempts} attempts: ${lastError?.message}`,
    config.maxAttempts,
    lastError || new Error("Unknown error"),
  );
}

/**
 * Create a retry wrapper with fixed configuration
 *
 * @param config - Retry configuration
 * @returns A function that wraps operations with retry
 *
 * @example
 * ```typescript
 * const retryExternalApi = createRetryWrapper(RETRY_CONFIGS.EXTERNAL_API);
 *
 * const data = await retryExternalApi(() => fetch(url).then(r => r.json()));
 * ```
 */
export function createRetryWrapper(
  config: RetryConfig,
): <T>(
  operation: () => Promise<T>,
  onRetry?: (context: RetryContext) => void,
) => Promise<T> {
  return (operation, onRetry) => withRetry(operation, config, onRetry);
}

// Re-export types and configs
export { RETRY_CONFIGS } from "./types.ts";
export type { RetryConfig, RetryContext } from "./types.ts";

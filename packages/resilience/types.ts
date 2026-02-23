/**
 * Resilience Module Types
 *
 * Shared types for timeout handling, circuit breaker, and retry logic.
 */

// =============================================================================
// Timeout Types
// =============================================================================

/**
 * Configuration for request timeout
 */
export interface TimeoutConfig {
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Optional abort signal to pass to fetch */
  signal?: AbortSignal;
}

/**
 * Default timeout values for different service types
 */
export const DEFAULT_TIMEOUTS: {
  readonly EXTERNAL_API: 10000;
  readonly LLM: 60000;
  readonly DATABASE: 5000;
  readonly FAST: 3000;
} = {
  /** External APIs */
  EXTERNAL_API: 10_000, // 10s
  /** LLM services (slower response times) */
  LLM: 60_000, // 60s
  /** Database operations */
  DATABASE: 5_000, // 5s
  /** Quick operations (geocoding, cache) */
  FAST: 3_000, // 3s
} as const;

// =============================================================================
// Circuit Breaker Types
// =============================================================================

/**
 * Circuit breaker states
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Configuration for circuit breaker
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Duration to keep circuit open before moving to half-open (ms) */
  resetTimeoutMs: number;
  /** Number of successful calls in half-open state before closing circuit */
  successThreshold: number;
  /** Error codes that should NOT trip the circuit (e.g., 400, 404) */
  ignoredStatusCodes?: number[];
}

/**
 * Default circuit breaker configurations
 */
export const CIRCUIT_BREAKER_CONFIGS: {
  readonly EXTERNAL_API: CircuitBreakerConfig;
  readonly LLM: CircuitBreakerConfig;
  readonly PAYMENT: CircuitBreakerConfig;
  readonly RELAXED: CircuitBreakerConfig;
} = {
  /** External APIs */
  EXTERNAL_API: {
    failureThreshold: 5,
    resetTimeoutMs: 30_000, // 30s
    successThreshold: 2,
    ignoredStatusCodes: [400, 401, 403, 404], // Client errors don't trip
  } satisfies CircuitBreakerConfig,

  /** LLM services (slower recovery) */
  LLM: {
    failureThreshold: 3,
    resetTimeoutMs: 60_000, // 60s
    successThreshold: 1,
    ignoredStatusCodes: [400, 404],
  } satisfies CircuitBreakerConfig,

  /** Payment services (strict) */
  PAYMENT: {
    failureThreshold: 3,
    resetTimeoutMs: 60_000, // 60s
    successThreshold: 2,
    ignoredStatusCodes: [400, 404],
  } satisfies CircuitBreakerConfig,

  /** Non-critical services (relaxed) */
  RELAXED: {
    failureThreshold: 10,
    resetTimeoutMs: 15_000, // 15s
    successThreshold: 3,
    ignoredStatusCodes: [400, 401, 403, 404],
  } satisfies CircuitBreakerConfig,
} as const;

/**
 * Circuit breaker state snapshot for monitoring
 */
export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: string;
  lastError?: string;
  remainingTimeoutMs: number;
}

// =============================================================================
// Retry Types
// =============================================================================

/**
 * Configuration for retry with exponential backoff
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay between retries in milliseconds */
  baseDelayMs: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Add random jitter to prevent thundering herd */
  jitter?: boolean;
  /** HTTP status codes that should trigger retry */
  retryableStatusCodes?: number[];
  /** Error codes (from exceptions) that should trigger retry */
  retryableErrorCodes?: string[];
}

/**
 * Default retry configurations
 */
export const RETRY_CONFIGS: {
  readonly EXTERNAL_API: RetryConfig;
  readonly LLM: RetryConfig;
  readonly CRITICAL: RetryConfig;
  readonly AGGRESSIVE: RetryConfig;
} = {
  /** External APIs - moderate retry */
  EXTERNAL_API: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
    backoffMultiplier: 2,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504],
  } satisfies RetryConfig,

  /** LLM services - longer delays */
  LLM: {
    maxAttempts: 2,
    baseDelayMs: 2000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504],
  } satisfies RetryConfig,

  /** Critical operations - few retries */
  CRITICAL: {
    maxAttempts: 2,
    baseDelayMs: 500,
    maxDelayMs: 2000,
    backoffMultiplier: 2,
    jitter: false,
    retryableStatusCodes: [503, 504],
  } satisfies RetryConfig,

  /** Aggressive retry for idempotent operations */
  AGGRESSIVE: {
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    backoffMultiplier: 2,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504],
  } satisfies RetryConfig,
} as const;

/**
 * Context passed to retry callback
 */
export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  lastError?: Error;
  delayMs: number;
}

// =============================================================================
// Resilient Fetch Types
// =============================================================================

/**
 * Combined configuration for resilient fetch
 */
export interface ResilientFetchConfig {
  /** Service name for logging and circuit breaker */
  serviceName: string;
  /** Timeout configuration */
  timeout?: TimeoutConfig | number;
  /** Circuit breaker configuration (or false to disable) */
  circuitBreaker?: CircuitBreakerConfig | false;
  /** Retry configuration (or false to disable) */
  retry?: RetryConfig | false;
}

/**
 * Result of a resilient operation
 */
export interface ResilientResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
  circuitState?: CircuitState;
}

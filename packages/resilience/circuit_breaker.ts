/**
 * Circuit Breaker Module
 *
 * Protects against cascading failures by failing fast when a service
 * is known to be unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF-OPEN: Testing if service has recovered
 *
 * Note: In Deno Edge Functions, each invocation is stateless.
 * Circuit state is stored in module-level Map and persists within
 * the same isolate. For distributed circuit breaking, use external
 * storage (Redis, Supabase).
 *
 * @example
 * ```typescript
 * import { CircuitBreaker, CircuitBreakerOpenError } from "@supabase-edge-toolkit/resilience";
 *
 * const breaker = CircuitBreaker.getOrCreate("my-service");
 *
 * try {
 *   const result = await breaker.call(() => externalApi.search());
 * } catch (error) {
 *   if (error instanceof CircuitBreakerOpenError) {
 *     return errorResponse("Service temporarily unavailable");
 *   }
 *   throw error;
 * }
 * ```
 */

import type {
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitState,
} from "./types.ts";
import { CIRCUIT_BREAKER_CONFIGS } from "./types.ts";

// =============================================================================
// Circuit Breaker Error
// =============================================================================

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  readonly code = "CIRCUIT_OPEN";
  readonly serviceName: string;
  readonly remainingTimeoutMs: number;

  constructor(serviceName: string, remainingTimeoutMs: number) {
    super(
      `Circuit breaker '${serviceName}' is OPEN, ` +
        `retry after ${Math.ceil(remainingTimeoutMs / 1000)}s`,
    );
    this.name = "CircuitBreakerOpenError";
    this.serviceName = serviceName;
    this.remainingTimeoutMs = remainingTimeoutMs;
  }

  /**
   * Circuit open errors are not immediately retryable
   */
  get isRetryable(): boolean {
    return false;
  }

  override toString(): string {
    return `CircuitBreakerOpenError[${this.serviceName}]: open, retry after ${
      Math.ceil(this.remainingTimeoutMs / 1000)
    }s`;
  }
}

// =============================================================================
// Circuit Breaker State Storage
// =============================================================================

/**
 * In-memory state for a circuit breaker
 */
interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  openedAt?: number;
  lastError?: string;
}

/**
 * Module-level registry of circuit breakers
 * Persists within the same Deno isolate
 */
const circuitRegistry = new Map<string, CircuitBreakerState>();

// =============================================================================
// Circuit Breaker Class
// =============================================================================

/**
 * Circuit Breaker implementation
 *
 * Tracks failures and opens the circuit to prevent cascading failures.
 */
export class CircuitBreaker {
  private readonly _name: string;
  private readonly _config: CircuitBreakerConfig;

  private constructor(name: string, config: CircuitBreakerConfig) {
    this._name = name;
    this._config = config;
  }

  // ===========================================================================
  // Static Factory Methods
  // ===========================================================================

  /**
   * Get or create a circuit breaker by name
   *
   * @param name - Unique name for this circuit breaker (e.g., "my-service")
   * @param config - Optional configuration (default: EXTERNAL_API)
   */
  static getOrCreate(
    name: string,
    config: CircuitBreakerConfig = CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
  ): CircuitBreaker {
    // Ensure state exists in registry
    if (!circuitRegistry.has(name)) {
      circuitRegistry.set(name, {
        state: "closed",
        failureCount: 0,
        successCount: 0,
      });
    }

    return new CircuitBreaker(name, config);
  }

  /**
   * Get circuit breaker with predefined config for external APIs
   */
  static forExternalApi(name: string): CircuitBreaker {
    return CircuitBreaker.getOrCreate(
      name,
      CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
    );
  }

  /**
   * Get circuit breaker with predefined config for LLM services
   */
  static forLLM(name: string): CircuitBreaker {
    return CircuitBreaker.getOrCreate(name, CIRCUIT_BREAKER_CONFIGS.LLM);
  }

  /**
   * Get circuit breaker with predefined config for payment services
   */
  static forPayment(name: string): CircuitBreaker {
    return CircuitBreaker.getOrCreate(name, CIRCUIT_BREAKER_CONFIGS.PAYMENT);
  }

  // ===========================================================================
  // State Accessors
  // ===========================================================================

  /**
   * Get current circuit state
   */
  private getState(): CircuitBreakerState {
    return circuitRegistry.get(this._name) || {
      state: "closed",
      failureCount: 0,
      successCount: 0,
    };
  }

  /**
   * Update circuit state
   */
  private setState(update: Partial<CircuitBreakerState>): void {
    const current = this.getState();
    circuitRegistry.set(this._name, { ...current, ...update });
  }

  /**
   * Current circuit state
   */
  get state(): CircuitState {
    return this.getState().state;
  }

  /**
   * Whether the circuit is allowing requests
   */
  get isAllowingRequests(): boolean {
    this.checkStateTransition();
    const state = this.getState().state;
    return state === "closed" || state === "half-open";
  }

  /**
   * Time remaining until circuit moves from open to half-open
   */
  get remainingTimeoutMs(): number {
    const { state, openedAt } = this.getState();
    if (state !== "open" || !openedAt) {
      return 0;
    }
    const elapsed = Date.now() - openedAt;
    const remaining = this._config.resetTimeoutMs - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Get stats for monitoring
   */
  get stats(): CircuitBreakerStats {
    const { state, failureCount, successCount, lastFailureTime, lastError } =
      this.getState();
    return {
      name: this._name,
      state,
      failureCount,
      successCount,
      lastFailureTime: lastFailureTime
        ? new Date(lastFailureTime).toISOString()
        : undefined,
      lastError,
      remainingTimeoutMs: this.remainingTimeoutMs,
    };
  }

  // ===========================================================================
  // Core Methods
  // ===========================================================================

  /**
   * Execute an operation with circuit breaker protection
   *
   * @param operation - The async operation to execute
   * @returns The result of the operation
   * @throws CircuitBreakerOpenError if circuit is open
   * @throws The original error if operation fails
   *
   * @example
   * ```typescript
   * const result = await breaker.call(async () => {
   *   const response = await fetch("https://api.example.com/data");
   *   return response.json();
   * });
   * ```
   */
  async call<T>(operation: () => Promise<T>): Promise<T> {
    // Check and potentially transition state
    this.checkStateTransition();

    const currentState = this.getState();

    // If open, reject immediately
    if (currentState.state === "open") {
      throw new CircuitBreakerOpenError(
        this._name,
        this.remainingTimeoutMs,
      );
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Check if state needs to transition based on time
   */
  private checkStateTransition(): void {
    const { state, openedAt } = this.getState();

    if (state === "open" && openedAt) {
      const elapsed = Date.now() - openedAt;
      if (elapsed >= this._config.resetTimeoutMs) {
        this.transitionTo("half-open");
      }
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    const { state, successCount } = this.getState();

    if (state === "half-open") {
      const newCount = successCount + 1;

      if (newCount >= this._config.successThreshold) {
        this.transitionTo("closed");
      } else {
        this.setState({ successCount: newCount });
      }
    } else if (state === "closed") {
      // Reset failure count on success
      this.setState({ failureCount: 0 });
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: unknown): void {
    // Check if this error should be ignored
    if (this.shouldIgnoreError(error)) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const { state, failureCount } = this.getState();

    this.setState({
      lastFailureTime: Date.now(),
      lastError: errorMessage.substring(0, 200),
    });

    if (state === "half-open") {
      // Any failure in half-open immediately reopens the circuit
      this.transitionTo("open");
    } else if (state === "closed") {
      const newCount = failureCount + 1;

      if (newCount >= this._config.failureThreshold) {
        this.transitionTo("open");
      } else {
        this.setState({ failureCount: newCount });
      }
    }
  }

  /**
   * Check if error should be ignored (not trip the circuit)
   */
  private shouldIgnoreError(error: unknown): boolean {
    const ignoredCodes = this._config.ignoredStatusCodes || [];

    // Check for HTTP status code in error
    if (error && typeof error === "object") {
      const err = error as Record<string, unknown>;

      // Check statusCode property
      if (
        typeof err.statusCode === "number" &&
        ignoredCodes.includes(err.statusCode)
      ) {
        return true;
      }

      // Check status property (fetch Response)
      if (
        typeof err.status === "number" && ignoredCodes.includes(err.status)
      ) {
        return true;
      }

      // Check code property (string like "404")
      if (typeof err.code === "string") {
        const numericCode = parseInt(err.code, 10);
        if (!isNaN(numericCode) && ignoredCodes.includes(numericCode)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const updates: Partial<CircuitBreakerState> = { state: newState };

    switch (newState) {
      case "open":
        updates.openedAt = Date.now();
        updates.successCount = 0;
        break;
      case "half-open":
        updates.successCount = 0;
        break;
      case "closed":
        updates.failureCount = 0;
        updates.successCount = 0;
        updates.openedAt = undefined;
        updates.lastError = undefined;
        break;
    }

    this.setState(updates);
  }

  // ===========================================================================
  // Control Methods
  // ===========================================================================

  /**
   * Force the circuit to open
   */
  forceOpen(): void {
    this.transitionTo("open");
  }

  /**
   * Force the circuit to close
   */
  forceClose(): void {
    this.transitionTo("closed");
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset(): void {
    circuitRegistry.set(this._name, {
      state: "closed",
      failureCount: 0,
      successCount: 0,
    });
  }

  // ===========================================================================
  // Static Utility Methods
  // ===========================================================================

  /**
   * Get stats for all registered circuit breakers
   */
  static getAllStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();

    for (const [name] of circuitRegistry) {
      const breaker = new CircuitBreaker(
        name,
        CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
      );
      stats.set(name, breaker.stats);
    }

    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  static resetAll(): void {
    for (const name of circuitRegistry.keys()) {
      circuitRegistry.set(name, {
        state: "closed",
        failureCount: 0,
        successCount: 0,
      });
    }
  }

  /**
   * Clear all circuit breakers (for testing)
   */
  static clearAll(): void {
    circuitRegistry.clear();
  }
}

// Re-export types
export { CIRCUIT_BREAKER_CONFIGS } from "./types.ts";
export type {
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitState,
} from "./types.ts";

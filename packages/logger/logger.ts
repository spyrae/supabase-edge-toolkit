/**
 * Structured Logger for Supabase Edge Functions
 *
 * Provides JSON-formatted logs with consistent structure for Grafana/Loki analysis.
 *
 * @example
 * import { createLogger } from "@supabase-edge-toolkit/logger";
 *
 * const logger = createLogger("my-function", requestId);
 *
 * logger.info("Processing request", { user_id: "456" });
 * logger.warn("Rate limit approaching", { remaining: 5 });
 * logger.error("Failed to call LLM", new Error("timeout"), { model: "gpt-4" });
 *
 * // With timing
 * const timer = logger.startTimer("llm_call");
 * // ... do work
 * timer.end({ tokens: 150 }); // logs duration automatically
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log entry structure for consistent parsing
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Edge function name */
  function_name: string;
  /** Request ID for correlation */
  request_id: string;
  /** Log message */
  message: string;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Duration in ms (for timed operations) */
  duration_ms?: number;
  /** Error details (for error level) */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Timer for measuring operation duration
 */
export interface Timer {
  /** End the timer and log with duration */
  end(context?: Record<string, unknown>): void;
  /** Get elapsed time without logging */
  elapsed(): number;
}

/**
 * Logger instance for a specific function/request
 */
export interface Logger {
  /** Log debug message (only in development) */
  debug(message: string, context?: Record<string, unknown>): void;
  /** Log info message */
  info(message: string, context?: Record<string, unknown>): void;
  /** Log warning message */
  warn(message: string, context?: Record<string, unknown>): void;
  /** Log error message */
  error(
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
  ): void;
  /** Start a timer for measuring duration */
  startTimer(operation: string): Timer;
  /** Create child logger with additional context */
  child(context: Record<string, unknown>): Logger;
}

/**
 * Minimum log level to output
 */
const MIN_LOG_LEVEL: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Current environment log level
 */
const CURRENT_LOG_LEVEL: LogLevel = (Deno.env.get("LOG_LEVEL") as LogLevel) ||
  "info";

/**
 * Whether we're in development mode (show debug logs)
 */
const IS_DEVELOPMENT = Deno.env.get("DENO_DEPLOYMENT_ID") === undefined;

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  // Always show debug in development
  if (level === "debug" && IS_DEVELOPMENT) return true;
  return MIN_LOG_LEVEL[level] >= MIN_LOG_LEVEL[CURRENT_LOG_LEVEL];
}

/**
 * Format error for logging
 */
function formatError(
  error: Error | unknown,
): LogEntry["error"] | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: IS_DEVELOPMENT ? error.stack : undefined,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

/**
 * Create a logger instance for an Edge Function
 *
 * @param functionName - Name of the Edge Function (e.g., "my-function")
 * @param requestId - Unique request ID for correlation
 * @param baseContext - Base context to include in all logs
 */
export function createLogger(
  functionName: string,
  requestId: string,
  baseContext?: Record<string, unknown>,
): Logger {
  const log = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error | unknown,
    durationMs?: number,
  ): void => {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      function_name: functionName,
      request_id: requestId,
      message,
    };

    // Merge base context and call context
    const mergedContext = { ...baseContext, ...context };
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    if (durationMs !== undefined) {
      entry.duration_ms = durationMs;
    }

    if (error) {
      entry.error = formatError(error);
    }

    // Output JSON to appropriate stream
    const output = JSON.stringify(entry);
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  };

  const logger: Logger = {
    debug(message: string, context?: Record<string, unknown>): void {
      log("debug", message, context);
    },

    info(message: string, context?: Record<string, unknown>): void {
      log("info", message, context);
    },

    warn(message: string, context?: Record<string, unknown>): void {
      log("warn", message, context);
    },

    error(
      message: string,
      error?: Error | unknown,
      context?: Record<string, unknown>,
    ): void {
      log("error", message, context, error);
    },

    startTimer(operation: string): Timer {
      const startTime = performance.now();

      return {
        end(context?: Record<string, unknown>): void {
          const durationMs = Math.round(performance.now() - startTime);
          log("info", `${operation} completed`, context, undefined, durationMs);
        },

        elapsed(): number {
          return Math.round(performance.now() - startTime);
        },
      };
    },

    child(additionalContext: Record<string, unknown>): Logger {
      return createLogger(functionName, requestId, {
        ...baseContext,
        ...additionalContext,
      });
    },
  };

  return logger;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Extract or generate request ID from headers
 *
 * Checks `x-request-id` and `x-correlation-id` headers, falls back to UUID.
 */
export function getRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-correlation-id") ||
    generateRequestId()
  );
}

/**
 * Log request start (helper for consistent request logging)
 */
export function logRequestStart(
  logger: Logger,
  req: Request,
  additionalContext?: Record<string, unknown>,
): void {
  const url = new URL(req.url);
  logger.info("Request received", {
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    user_agent: req.headers.get("user-agent"),
    ...additionalContext,
  });
}

/**
 * Log request end (helper for consistent response logging)
 */
export function logRequestEnd(
  logger: Logger,
  status: number,
  durationMs: number,
  additionalContext?: Record<string, unknown>,
): void {
  const level: LogLevel = status >= 500
    ? "error"
    : status >= 400
    ? "warn"
    : "info";

  const message = status >= 400 ? "Request failed" : "Request completed";

  if (level === "error") {
    logger.error(message, undefined, {
      status,
      duration_ms: durationMs,
      ...additionalContext,
    });
  } else if (level === "warn") {
    logger.warn(message, {
      status,
      duration_ms: durationMs,
      ...additionalContext,
    });
  } else {
    logger.info(message, {
      status,
      duration_ms: durationMs,
      ...additionalContext,
    });
  }
}

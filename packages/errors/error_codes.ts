/**
 * Unified Error Codes for Supabase Edge Functions
 *
 * Standardized error codes with HTTP status mapping, retry logic,
 * and default retry-after values.
 *
 * Format: CATEGORY_SPECIFIC_ERROR
 */

// =============================================================================
// Error Code Enum
// =============================================================================

export const ErrorCodes = {
  // ---------------------------------------------------------------------------
  // Validation Errors (400)
  // ---------------------------------------------------------------------------
  VALIDATION_ERROR: "VALIDATION_ERROR",
  VALIDATION_MISSING_FIELD: "VALIDATION_MISSING_FIELD",
  VALIDATION_INVALID_FORMAT: "VALIDATION_INVALID_FORMAT",
  VALIDATION_OUT_OF_RANGE: "VALIDATION_OUT_OF_RANGE",

  // ---------------------------------------------------------------------------
  // Authentication Errors (401)
  // ---------------------------------------------------------------------------
  AUTH_ERROR: "AUTH_ERROR",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_TOKEN_INVALID: "AUTH_TOKEN_INVALID",
  AUTH_MISSING_TOKEN: "AUTH_MISSING_TOKEN",
  AUTH_SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",

  // ---------------------------------------------------------------------------
  // Payment/Budget Errors (402)
  // ---------------------------------------------------------------------------
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  SUBSCRIPTION_REQUIRED: "SUBSCRIPTION_REQUIRED",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",

  // ---------------------------------------------------------------------------
  // Permission Errors (403)
  // ---------------------------------------------------------------------------
  PERMISSION_DENIED: "PERMISSION_DENIED",
  ACCESS_FORBIDDEN: "ACCESS_FORBIDDEN",
  RESOURCE_LOCKED: "RESOURCE_LOCKED",

  // ---------------------------------------------------------------------------
  // Not Found Errors (404)
  // ---------------------------------------------------------------------------
  NOT_FOUND: "NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",

  // ---------------------------------------------------------------------------
  // Rate Limiting Errors (429)
  // ---------------------------------------------------------------------------
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  RATE_LIMIT_RPM: "RATE_LIMIT_RPM",
  RATE_LIMIT_TPM: "RATE_LIMIT_TPM",
  RATE_LIMIT_DAILY: "RATE_LIMIT_DAILY",
  RATE_LIMIT_IP: "RATE_LIMIT_IP",

  // ---------------------------------------------------------------------------
  // Server Errors (500)
  // ---------------------------------------------------------------------------
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",

  // ---------------------------------------------------------------------------
  // External Service Errors (502/503)
  // ---------------------------------------------------------------------------
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",

  // LLM-specific (useful for any AI-powered edge function)
  LLM_ERROR: "LLM_ERROR",
  LLM_TIMEOUT: "LLM_TIMEOUT",
  LLM_RATE_LIMIT: "LLM_RATE_LIMIT",
  LLM_CONTENT_FILTER: "LLM_CONTENT_FILTER",

  // ---------------------------------------------------------------------------
  // Timeout Errors (504)
  // ---------------------------------------------------------------------------
  TIMEOUT_ERROR: "TIMEOUT_ERROR",
  REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",

  // ---------------------------------------------------------------------------
  // Network Errors (server-to-client reporting)
  // ---------------------------------------------------------------------------
  NETWORK_ERROR: "NETWORK_ERROR",
  NO_INTERNET: "NO_INTERNET",
  CONNECTION_REFUSED: "CONNECTION_REFUSED",

  // ---------------------------------------------------------------------------
  // Cache Errors (server-to-client reporting)
  // ---------------------------------------------------------------------------
  CACHE_ERROR: "CACHE_ERROR",
  CACHE_MISS: "CACHE_MISS",
  CACHE_EXPIRED: "CACHE_EXPIRED",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// =============================================================================
// HTTP Status Code Mapping
// =============================================================================

export const ErrorCodeToStatus: Record<ErrorCode, number> = {
  // Validation (400)
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.VALIDATION_MISSING_FIELD]: 400,
  [ErrorCodes.VALIDATION_INVALID_FORMAT]: 400,
  [ErrorCodes.VALIDATION_OUT_OF_RANGE]: 400,

  // Auth (401)
  [ErrorCodes.AUTH_ERROR]: 401,
  [ErrorCodes.AUTH_TOKEN_EXPIRED]: 401,
  [ErrorCodes.AUTH_TOKEN_INVALID]: 401,
  [ErrorCodes.AUTH_MISSING_TOKEN]: 401,
  [ErrorCodes.AUTH_SESSION_EXPIRED]: 401,

  // Payment (402)
  [ErrorCodes.PAYMENT_REQUIRED]: 402,
  [ErrorCodes.BUDGET_EXCEEDED]: 402,
  [ErrorCodes.SUBSCRIPTION_REQUIRED]: 402,
  [ErrorCodes.SUBSCRIPTION_EXPIRED]: 402,

  // Permission (403)
  [ErrorCodes.PERMISSION_DENIED]: 403,
  [ErrorCodes.ACCESS_FORBIDDEN]: 403,
  [ErrorCodes.RESOURCE_LOCKED]: 403,

  // Not Found (404)
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.USER_NOT_FOUND]: 404,
  [ErrorCodes.RESOURCE_NOT_FOUND]: 404,

  // Rate Limit (429)
  [ErrorCodes.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCodes.RATE_LIMIT_RPM]: 429,
  [ErrorCodes.RATE_LIMIT_TPM]: 429,
  [ErrorCodes.RATE_LIMIT_DAILY]: 429,
  [ErrorCodes.RATE_LIMIT_IP]: 429,

  // Server (500)
  [ErrorCodes.INTERNAL_ERROR]: 500,
  [ErrorCodes.DATABASE_ERROR]: 500,
  [ErrorCodes.CONFIGURATION_ERROR]: 500,

  // External Service (502/503)
  [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
  [ErrorCodes.LLM_ERROR]: 502,
  [ErrorCodes.LLM_TIMEOUT]: 504,
  [ErrorCodes.LLM_RATE_LIMIT]: 429,
  [ErrorCodes.LLM_CONTENT_FILTER]: 400,

  // Timeout (504)
  [ErrorCodes.TIMEOUT_ERROR]: 504,
  [ErrorCodes.REQUEST_TIMEOUT]: 504,
  [ErrorCodes.UPSTREAM_TIMEOUT]: 504,

  // Network (server-to-client, mapped to 503 when server reports)
  [ErrorCodes.NETWORK_ERROR]: 503,
  [ErrorCodes.NO_INTERNET]: 503,
  [ErrorCodes.CONNECTION_REFUSED]: 503,

  // Cache
  [ErrorCodes.CACHE_ERROR]: 500,
  [ErrorCodes.CACHE_MISS]: 404,
  [ErrorCodes.CACHE_EXPIRED]: 410,
};

// =============================================================================
// Helper to check if error is retryable
// =============================================================================

const RETRYABLE_CODES: Set<ErrorCode> = new Set([
  ErrorCodes.RATE_LIMIT_EXCEEDED,
  ErrorCodes.RATE_LIMIT_RPM,
  ErrorCodes.RATE_LIMIT_TPM,
  ErrorCodes.RATE_LIMIT_DAILY,
  ErrorCodes.SERVICE_UNAVAILABLE,
  ErrorCodes.LLM_TIMEOUT,
  ErrorCodes.LLM_RATE_LIMIT,
  ErrorCodes.TIMEOUT_ERROR,
  ErrorCodes.REQUEST_TIMEOUT,
  ErrorCodes.UPSTREAM_TIMEOUT,
  ErrorCodes.NETWORK_ERROR,
  ErrorCodes.CONNECTION_REFUSED,
]);

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

// =============================================================================
// Helper to get default retry-after for rate limits
// =============================================================================

export function getDefaultRetryAfter(code: ErrorCode): number | null {
  switch (code) {
    case ErrorCodes.RATE_LIMIT_RPM:
      return 60; // 1 minute
    case ErrorCodes.RATE_LIMIT_TPM:
      return 60;
    case ErrorCodes.RATE_LIMIT_DAILY:
      return 3600; // 1 hour
    case ErrorCodes.RATE_LIMIT_IP:
      return 300; // 5 minutes
    case ErrorCodes.RATE_LIMIT_EXCEEDED:
      return 60;
    case ErrorCodes.LLM_RATE_LIMIT:
      return 30;
    default:
      return null;
  }
}

/**
 * Unified Error Response Helper for Supabase Edge Functions
 *
 * Provides consistent error/success response format with CORS support,
 * specialized error factories, and automatic exception-to-response conversion.
 */

import {
  type ErrorCode,
  ErrorCodes,
  ErrorCodeToStatus,
  getDefaultRetryAfter,
  isRetryable,
} from "./error_codes.ts";

// =============================================================================
// Types
// =============================================================================

/** Standard error response body */
export interface ErrorResponseBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    retryAfter?: number;
    requestId?: string;
  };
}

/** Standard success response body */
export interface SuccessResponseBody<T = unknown> {
  success: true;
  data: T;
}

/** Union type for API responses */
export type ApiResponseBody<T = unknown> =
  | SuccessResponseBody<T>
  | ErrorResponseBody;

/** Options for creating error response */
export interface ErrorResponseOptions {
  /** Additional error details (field errors, context, etc.) */
  details?: unknown;
  /** Override default retry-after seconds */
  retryAfter?: number;
  /** Request ID for tracing */
  requestId?: string;
  /** Additional headers to include */
  headers?: Record<string, string>;
  /** Override status code (not recommended) */
  statusOverride?: number;
}

// =============================================================================
// CORS Headers
// =============================================================================

/** Options for configuring CORS headers */
export interface CorsOptions {
  /** Allowed origin (default: "*") */
  origin?: string;
  /** Allowed headers (default: standard set) */
  allowHeaders?: string[];
  /** Allowed methods (default: POST, GET, OPTIONS, PUT, DELETE) */
  allowMethods?: string[];
}

const DEFAULT_ALLOW_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-request-id",
];

const DEFAULT_ALLOW_METHODS = ["POST", "GET", "OPTIONS", "PUT", "DELETE"];

/**
 * Create CORS headers with configurable options
 *
 * @example
 * // Default headers
 * const headers = createCorsHeaders();
 *
 * @example
 * // Custom origin and extra headers
 * const headers = createCorsHeaders({
 *   origin: "https://example.com",
 *   allowHeaders: ["authorization", "content-type", "x-custom-header"],
 * });
 */
export function createCorsHeaders(
  options: CorsOptions = {},
): Record<string, string> {
  const {
    origin = "*",
    allowHeaders = DEFAULT_ALLOW_HEADERS,
    allowMethods = DEFAULT_ALLOW_METHODS,
  } = options;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": allowHeaders.join(", "),
    "Access-Control-Allow-Methods": allowMethods.join(", "),
  };
}

/** Default CORS headers (permissive, suitable for most edge functions) */
export const corsHeaders: Record<string, string> = createCorsHeaders();

// =============================================================================
// Response Creators
// =============================================================================

/**
 * Create a standardized error Response
 *
 * @example
 * // Simple error
 * return createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Email is required");
 *
 * @example
 * // With details
 * return createErrorResponse(
 *   ErrorCodes.VALIDATION_MISSING_FIELD,
 *   "Missing required fields",
 *   { details: { fields: ["email", "name"] } },
 * );
 *
 * @example
 * // Rate limit with retry-after
 * return createErrorResponse(
 *   ErrorCodes.RATE_LIMIT_EXCEEDED,
 *   "Too many requests",
 *   { retryAfter: 60 },
 * );
 */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  options: ErrorResponseOptions = {},
): Response {
  const { details, retryAfter, requestId, headers = {}, statusOverride } =
    options;

  const status = statusOverride ?? ErrorCodeToStatus[code] ?? 500;

  const effectiveRetryAfter = retryAfter ?? getDefaultRetryAfter(code);

  const body: ErrorResponseBody = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      ...(effectiveRetryAfter !== null && { retryAfter: effectiveRetryAfter }),
      ...(requestId && { requestId }),
    },
  };

  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    ...headers,
  };

  if (effectiveRetryAfter !== null && status === 429) {
    responseHeaders["Retry-After"] = String(effectiveRetryAfter);
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

/**
 * Create a standardized success Response
 *
 * @example
 * return createSuccessResponse({ user: { id: "123", name: "John" } });
 */
export function createSuccessResponse<T>(
  data: T,
  options: { headers?: Record<string, string>; status?: number } = {},
): Response {
  const { headers = {}, status = 200 } = options;

  const body: SuccessResponseBody<T> = {
    success: true,
    data,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Create CORS preflight response
 *
 * @example
 * if (req.method === "OPTIONS") {
 *   return createCorsResponse();
 * }
 */
export function createCorsResponse(
  options: CorsOptions = {},
): Response {
  const headers = Object.keys(options).length > 0
    ? createCorsHeaders(options)
    : corsHeaders;

  return new Response(null, {
    status: 204,
    headers,
  });
}

// =============================================================================
// Error Helpers
// =============================================================================

/**
 * Create validation error response with field details
 *
 * @example
 * return validationError("Invalid input", {
 *   email: "Invalid email format",
 *   age: "Must be at least 18",
 * });
 */
export function validationError(
  message: string,
  fieldErrors?: Record<string, string>,
  requestId?: string,
): Response {
  return createErrorResponse(ErrorCodes.VALIDATION_ERROR, message, {
    details: fieldErrors ? { fields: fieldErrors } : undefined,
    requestId,
  });
}

/** Create not found error response */
export function notFoundError(
  resource: string,
  id?: string,
  requestId?: string,
): Response {
  const message = id
    ? `${resource} with id '${id}' not found`
    : `${resource} not found`;

  return createErrorResponse(ErrorCodes.NOT_FOUND, message, { requestId });
}

/** Create auth error response */
export function authError(
  message = "Authentication required",
  code: ErrorCode = ErrorCodes.AUTH_ERROR,
  requestId?: string,
): Response {
  return createErrorResponse(code, message, { requestId });
}

/**
 * Create rate limit error response
 *
 * @example
 * return rateLimitError("Too many requests", 60, "rpm");
 */
export function rateLimitError(
  message: string,
  retryAfter?: number,
  limitType?: "rpm" | "tpm" | "daily" | "ip",
  requestId?: string,
): Response {
  let code: ErrorCode = ErrorCodes.RATE_LIMIT_EXCEEDED;
  if (limitType === "rpm") code = ErrorCodes.RATE_LIMIT_RPM;
  else if (limitType === "tpm") code = ErrorCodes.RATE_LIMIT_TPM;
  else if (limitType === "daily") code = ErrorCodes.RATE_LIMIT_DAILY;
  else if (limitType === "ip") code = ErrorCodes.RATE_LIMIT_IP;

  return createErrorResponse(code, message, {
    retryAfter,
    details: limitType ? { limitType } : undefined,
    requestId,
  });
}

/** Create internal error response (masks sensitive details) */
export function internalError(
  requestId?: string,
  publicMessage = "An unexpected error occurred",
): Response {
  return createErrorResponse(ErrorCodes.INTERNAL_ERROR, publicMessage, {
    requestId,
  });
}

/** Create external service error response */
export function externalServiceError(
  serviceName: string,
  requestId?: string,
): Response {
  return createErrorResponse(
    ErrorCodes.EXTERNAL_SERVICE_ERROR,
    `External service '${serviceName}' is temporarily unavailable`,
    {
      details: { service: serviceName },
      requestId,
    },
  );
}

/** Create payment required error response */
export function paymentRequiredError(
  message = "Payment required. Please upgrade your plan.",
  requestId?: string,
): Response {
  return createErrorResponse(
    ErrorCodes.PAYMENT_REQUIRED,
    message,
    { requestId },
  );
}

// =============================================================================
// Exception to Response Converter
// =============================================================================

/**
 * Convert any error/exception to a standardized Response
 *
 * Use this in catch blocks to ensure consistent error responses.
 * Handles: Response pass-through, AuthError, ZodError, timeout,
 * rate limit, and generic errors.
 *
 * @example
 * try {
 *   // ... some code
 * } catch (error) {
 *   console.error("Error:", error);
 *   return errorToResponse(error, requestId);
 * }
 */
export function errorToResponse(
  error: unknown,
  requestId?: string,
): Response {
  // Already a Response - return as-is
  if (error instanceof Response) {
    return error;
  }

  // Auth error from auth middleware (duck-typed)
  if (
    error instanceof Error && error.name === "AuthError" && "code" in error &&
    "statusCode" in error
  ) {
    const authErr = error as Error & { code: string; statusCode: number };
    const safeMessages: Record<string, string> = {
      "MISSING_AUTH_HEADER": "Missing authentication",
      "INVALID_AUTH_HEADER": "Invalid authentication",
      "INVALID_TOKEN": "Invalid or expired token",
      "TOKEN_EXPIRED": "Token expired",
      "MISSING_SUB_CLAIM": "Invalid token",
      "INVALID_CRON_SECRET": "Access denied",
    };
    const safeMessage = safeMessages[authErr.code] ?? "Authentication failed";
    return createErrorResponse(
      ErrorCodes.AUTH_ERROR,
      safeMessage,
      { requestId, statusOverride: authErr.statusCode },
    );
  }

  // Zod validation error (duck-typed)
  if (isZodError(error)) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.errors) {
      const path = issue.path.join(".");
      fieldErrors[path || "root"] = issue.message;
    }
    return validationError("Validation failed", fieldErrors, requestId);
  }

  // Standard Error with message
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("timeout") || error.name === "TimeoutError") {
      return createErrorResponse(
        ErrorCodes.TIMEOUT_ERROR,
        "Request timed out",
        {
          requestId,
        },
      );
    }

    if (message.includes("rate limit") || message.includes("too many")) {
      return rateLimitError(
        "Rate limit exceeded",
        undefined,
        undefined,
        requestId,
      );
    }

    if (
      message.includes("unauthorized") || message.includes("not authenticated")
    ) {
      return authError("Unauthorized", ErrorCodes.AUTH_ERROR, requestId);
    }

    // Generic error - log details but return generic message
    console.error(`[${requestId ?? "no-request-id"}] Error:`, error);
    return internalError(requestId);
  }

  // Unknown error type
  console.error(`[${requestId ?? "no-request-id"}] Unknown error:`, error);
  return internalError(requestId);
}

// =============================================================================
// Type Guards
// =============================================================================

interface ZodError {
  errors: Array<{ path: (string | number)[]; message: string }>;
  name: "ZodError";
}

function isZodError(error: unknown): error is ZodError {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ZodError" &&
    "errors" in error &&
    Array.isArray((error as ZodError).errors)
  );
}

/** Check if response body is an error response */
export function isErrorResponse(body: unknown): body is ErrorResponseBody {
  return (
    body !== null &&
    typeof body === "object" &&
    "success" in body &&
    (body as ApiResponseBody).success === false
  );
}

/** Check if response body is a success response */
export function isSuccessResponse<T>(
  body: unknown,
): body is SuccessResponseBody<T> {
  return (
    body !== null &&
    typeof body === "object" &&
    "success" in body &&
    (body as ApiResponseBody).success === true
  );
}

// =============================================================================
// Re-export utilities from error_codes
// =============================================================================

export { ErrorCodes, getDefaultRetryAfter, isRetryable };
export type { ErrorCode };

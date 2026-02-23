/**
 * @supa-edge-toolkit/errors
 *
 * Standardized error handling for Supabase Edge Functions.
 * Provides consistent error/success response format, CORS support,
 * error code mapping, and automatic exception-to-response conversion.
 *
 * @example
 * import {
 *   ErrorCodes,
 *   createErrorResponse,
 *   createSuccessResponse,
 *   validationError,
 *   errorToResponse,
 * } from "@supa-edge-toolkit/errors";
 *
 * // Simple error
 * return createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Invalid input");
 *
 * // Success response
 * return createSuccessResponse({ user: { id: "123" } });
 *
 * // Validation with field details
 * return validationError("Invalid input", { email: "Invalid format" });
 *
 * // In catch block
 * try {
 *   // ...
 * } catch (error) {
 *   return errorToResponse(error, requestId);
 * }
 */

// Error codes
export {
  type ErrorCode,
  ErrorCodes,
  ErrorCodeToStatus,
  getDefaultRetryAfter,
  isRetryable,
} from "./error_codes.ts";

// Response helpers
export {
  // Types
  type ApiResponseBody,
  // Specialized error helpers
  authError,
  // CORS
  corsHeaders,
  type CorsOptions,
  createCorsHeaders,
  createCorsResponse,
  // Response creators
  createErrorResponse,
  createSuccessResponse,
  type ErrorResponseBody,
  type ErrorResponseOptions,
  // Exception converter
  errorToResponse,
  externalServiceError,
  internalError,
  // Type guards
  isErrorResponse,
  isSuccessResponse,
  notFoundError,
  paymentRequiredError,
  rateLimitError,
  type SuccessResponseBody,
  validationError,
} from "./error_response.ts";

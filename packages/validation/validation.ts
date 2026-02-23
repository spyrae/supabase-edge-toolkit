/**
 * Request Validation Utilities for Supabase Edge Functions
 *
 * Provides helpers for validating request bodies, query parameters,
 * and headers using Zod schemas with automatic error response generation.
 *
 * @example
 * import { validateRequest, commonSchemas, z } from "@supa-edge-toolkit/validation";
 *
 * const MySchema = z.object({
 *   email: commonSchemas.email,
 *   user_id: commonSchemas.uuid("user_id"),
 * });
 *
 * Deno.serve(async (req) => {
 *   const result = await validateRequest(req, MySchema);
 *   if (result.error) return result.error;
 *   const { email, user_id } = result.data;
 *   // ...
 * });
 */

import { z, type ZodError, type ZodSchema } from "zod";
import {
  createErrorResponse,
  ErrorCodes,
  validationError,
} from "@supa-edge-toolkit/errors";

// =============================================================================
// Types
// =============================================================================

/** Result of validation - either valid data or error Response */
export type ValidationResult<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: Response };

/** Options for validateRequest */
export interface ValidateRequestOptions {
  /** Request ID for error tracing */
  requestId?: string;
  /** Custom error message (default: "Validation failed") */
  errorMessage?: string;
  /** Whether to use .strict() on schema (default: false) */
  strict?: boolean;
}

// =============================================================================
// Main Validation Functions
// =============================================================================

/**
 * Validate request body against Zod schema
 *
 * Returns ValidationResult with either parsed data or error Response.
 * Use this when you want to handle validation inline without try/catch.
 *
 * @example
 * const result = await validateRequest(req, MySchema);
 * if (result.error) return result.error;
 * const data = result.data; // Typed as z.infer<typeof MySchema>
 */
export async function validateRequest<T extends ZodSchema>(
  req: Request,
  schema: T,
  options: ValidateRequestOptions = {},
): Promise<ValidationResult<z.infer<T>>> {
  const {
    requestId,
    errorMessage = "Validation failed",
    strict = false,
  } = options;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return {
        success: false,
        error: validationError(
          "Invalid JSON body",
          { body: "Request body must be valid JSON" },
          requestId,
        ),
      };
    }

    const effectiveSchema = strict && "strict" in schema
      // deno-lint-ignore no-explicit-any
      ? (schema as any).strict()
      : schema;
    const data = effectiveSchema.parse(body);

    return { success: true, data };
  } catch (error) {
    if (isZodError(error)) {
      const fieldErrors = zodErrorToFieldErrors(error);
      return {
        success: false,
        error: validationError(errorMessage, fieldErrors, requestId),
      };
    }

    return {
      success: false,
      error: createErrorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Failed to validate request",
        { requestId },
      ),
    };
  }
}

/**
 * Parse and validate JSON body (throws on validation error)
 *
 * Use this when you prefer try/catch pattern or when using
 * errorToResponse in the catch block.
 *
 * @throws ZodError if validation fails
 * @throws SyntaxError if JSON is invalid
 *
 * @example
 * try {
 *   const data = await validateJson(req, MySchema);
 * } catch (error) {
 *   return errorToResponse(error, requestId);
 * }
 */
export async function validateJson<T extends ZodSchema>(
  req: Request,
  schema: T,
  options: { strict?: boolean } = {},
): Promise<z.infer<T>> {
  const body = await req.json();
  const effectiveSchema = options.strict && "strict" in schema
    // deno-lint-ignore no-explicit-any
    ? (schema as any).strict()
    : schema;
  return effectiveSchema.parse(body);
}

/**
 * Validate data synchronously against schema
 *
 * Use this when you already have parsed JSON or other data.
 *
 * @example
 * const result = validate(someData, MySchema);
 * if (result.error) return result.error;
 */
export function validate<T extends ZodSchema>(
  data: unknown,
  schema: T,
  options: ValidateRequestOptions = {},
): ValidationResult<z.infer<T>> {
  const {
    requestId,
    errorMessage = "Validation failed",
    strict = false,
  } = options;

  try {
    const effectiveSchema = strict && "strict" in schema
      // deno-lint-ignore no-explicit-any
      ? (schema as any).strict()
      : schema;
    const parsed = effectiveSchema.parse(data);
    return { success: true, data: parsed };
  } catch (error) {
    if (isZodError(error)) {
      const fieldErrors = zodErrorToFieldErrors(error);
      return {
        success: false,
        error: validationError(errorMessage, fieldErrors, requestId),
      };
    }

    return {
      success: false,
      error: createErrorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Failed to validate data",
        { requestId },
      ),
    };
  }
}

// =============================================================================
// Error Conversion
// =============================================================================

/**
 * Convert ZodError to field errors map
 *
 * @example
 * // ZodError for { email: "invalid", age: -5 }
 * // Returns: { email: "Invalid email format", age: "Must be positive" }
 */
export function zodErrorToFieldErrors(
  error: ZodError,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.errors) {
    const path = issue.path.join(".");
    const key = path || "root";

    // Take first error for each field
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }

  return fieldErrors;
}

// =============================================================================
// Common Schema Builders
// =============================================================================

/** Type definition for common schema builders (required for JSR) */
export interface CommonSchemas {
  uuid: (fieldName?: string) => z.ZodString;
  email: z.ZodString;
  requiredString: (fieldName: string, maxLength?: number) => z.ZodString;
  positiveInt: (fieldName?: string) => z.ZodNumber;
  nonNegativeInt: (fieldName?: string) => z.ZodNumber;
  latitude: z.ZodNumber;
  longitude: z.ZodNumber;
  coordinates: z.ZodObject<{
    lat: z.ZodNumber;
    lng: z.ZodNumber;
  }>;
  pagination: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
  }>;
  optionalPagination: z.ZodOptional<
    z.ZodObject<{
      page: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
      limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }>
  >;
  isoDate: z.ZodString;
  dateString: z.ZodString;
}

/** Common schema builders for frequently used validations */
export const commonSchemas: CommonSchemas = {
  /**
   * UUID with custom field name in error message
   * @example z.object({ user_id: commonSchemas.uuid("user_id") })
   */
  uuid: (fieldName: string = "id"): z.ZodString =>
    z.string().uuid(`${fieldName} must be a valid UUID`),

  /** Email with standard validation */
  email: z.string().email("Invalid email format"),

  /**
   * Non-empty string with optional max length
   * @example commonSchemas.requiredString("name", 100)
   */
  requiredString: (fieldName: string, maxLength?: number): z.ZodString => {
    let schema = z.string().min(1, `${fieldName} is required`);
    if (maxLength) {
      schema = schema.max(
        maxLength,
        `${fieldName} must be at most ${maxLength} characters`,
      );
    }
    return schema;
  },

  /** Positive integer */
  positiveInt: (fieldName: string = "value"): z.ZodNumber =>
    z.number().int(`${fieldName} must be an integer`).positive(
      `${fieldName} must be positive`,
    ),

  /** Non-negative integer (0 or positive) */
  nonNegativeInt: (fieldName: string = "value"): z.ZodNumber =>
    z.number().int(`${fieldName} must be an integer`).nonnegative(
      `${fieldName} must be 0 or positive`,
    ),

  /** Latitude (-90 to 90) */
  latitude: z.number().min(-90, "Latitude must be >= -90").max(
    90,
    "Latitude must be <= 90",
  ),

  /** Longitude (-180 to 180) */
  longitude: z.number().min(-180, "Longitude must be >= -180").max(
    180,
    "Longitude must be <= 180",
  ),

  /** Coordinates object */
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),

  /** Pagination params */
  pagination: z.object({
    page: z.number().int().positive().default(1),
    limit: z.number().int().min(1).max(100).default(20),
  }),

  /** Optional pagination params (allows omission) */
  optionalPagination: z.object({
    page: z.number().int().positive().optional().default(1),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }).optional(),

  /** ISO 8601 datetime string */
  isoDate: z.string().datetime({
    message: "Must be valid ISO 8601 datetime",
  }),

  /** Date string (YYYY-MM-DD format) */
  dateString: z.string().regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "Must be YYYY-MM-DD format",
  ),
};

// =============================================================================
// Request Helpers
// =============================================================================

/**
 * Extract and validate query parameters
 *
 * @example
 * const params = validateQueryParams(req, z.object({
 *   page: z.coerce.number().default(1),
 *   search: z.string().optional(),
 * }));
 */
export function validateQueryParams<T extends ZodSchema>(
  req: Request,
  schema: T,
  options: ValidateRequestOptions = {},
): ValidationResult<z.infer<T>> {
  const { requestId, errorMessage = "Invalid query parameters" } = options;

  try {
    const url = new URL(req.url);
    const params: Record<string, string> = {};

    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const data = schema.parse(params);
    return { success: true, data };
  } catch (error) {
    if (isZodError(error)) {
      const fieldErrors = zodErrorToFieldErrors(error);
      return {
        success: false,
        error: validationError(errorMessage, fieldErrors, requestId),
      };
    }

    return {
      success: false,
      error: createErrorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Failed to validate query parameters",
        { requestId },
      ),
    };
  }
}

/**
 * Validate Authorization header is present
 *
 * @returns Token string or error Response
 */
export function validateAuthHeader(
  req: Request,
  options: { requestId?: string } = {},
): { token: string; error?: never } | { token?: never; error: Response } {
  const { requestId } = options;
  const authHeader = req.headers.get("Authorization");

  if (!authHeader) {
    return {
      error: createErrorResponse(
        ErrorCodes.AUTH_ERROR,
        "Missing Authorization header",
        { requestId },
      ),
    };
  }

  if (!authHeader.startsWith("Bearer ")) {
    return {
      error: createErrorResponse(
        ErrorCodes.AUTH_ERROR,
        "Invalid Authorization header format. Expected: Bearer <token>",
        { requestId },
      ),
    };
  }

  const token = authHeader.substring(7);
  if (!token) {
    return {
      error: createErrorResponse(
        ErrorCodes.AUTH_ERROR,
        "Empty token in Authorization header",
        { requestId },
      ),
    };
  }

  return { token };
}

/**
 * Validate HTTP method
 *
 * @example
 * const methodError = validateMethod(req, ["POST", "PUT"]);
 * if (methodError) return methodError;
 */
export function validateMethod(
  req: Request,
  allowedMethods: string[],
  options: { requestId?: string } = {},
): Response | null {
  const { requestId } = options;

  if (!allowedMethods.includes(req.method)) {
    return createErrorResponse(
      ErrorCodes.VALIDATION_ERROR,
      `Method ${req.method} not allowed. Allowed: ${allowedMethods.join(", ")}`,
      { statusOverride: 405, requestId },
    );
  }

  return null;
}

// =============================================================================
// Internal helpers
// =============================================================================

interface ZodErrorShape {
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
    Array.isArray((error as ZodErrorShape).errors)
  );
}

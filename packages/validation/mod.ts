/**
 * @supa-edge-toolkit/validation
 *
 * Request validation utilities for Supabase Edge Functions.
 * Provides helpers for validating request bodies, query parameters,
 * and headers using Zod schemas with automatic error response generation.
 *
 * @example
 * import {
 *   validateRequest,
 *   commonSchemas,
 *   z,
 * } from "@supa-edge-toolkit/validation";
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

// Re-export Zod for convenience
export { z, ZodError, type ZodSchema } from "zod";

// Validation functions and types
export {
  type CommonSchemas,
  commonSchemas,
  validate,
  validateAuthHeader,
  validateJson,
  validateMethod,
  validateQueryParams,
  validateRequest,
  type ValidateRequestOptions,
  type ValidationResult,
  zodErrorToFieldErrors,
} from "./validation.ts";

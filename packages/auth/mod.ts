/**
 * @supabase-edge-toolkit/auth
 *
 * JWT auth middleware for Supabase Edge Functions.
 * Provides user token verification, service role validation,
 * cron secret checking, and secure test mode impersonation.
 *
 * @example User-facing function
 * ```typescript
 * import { verifyUserToken, AuthError } from "@supabase-edge-toolkit/auth";
 *
 * Deno.serve(async (req) => {
 *   try {
 *     const { userId } = await verifyUserToken(req);
 *     // userId is the JWT 'sub' claim
 *   } catch (error) {
 *     if (error instanceof AuthError) {
 *       return new Response(error.message, { status: error.statusCode });
 *     }
 *   }
 * });
 * ```
 *
 * @example Internal function (service role)
 * ```typescript
 * import { verifyServiceRole } from "@supabase-edge-toolkit/auth";
 *
 * await verifyServiceRole(req);
 * ```
 *
 * @example Cron job
 * ```typescript
 * import { verifyCronSecret } from "@supabase-edge-toolkit/auth";
 *
 * await verifyCronSecret(req);
 * ```
 */

export {
  AuthError,
  extractBearerToken,
  verifyCronSecret,
  verifyServiceRole,
  verifyUserToken,
} from "./middleware.ts";

export type {
  AuthErrorCode,
  AuthResult,
  VerifyUserTokenOptions,
} from "./middleware.ts";

export { isTestModeAvailable, tryTestMode } from "./test_mode.ts";

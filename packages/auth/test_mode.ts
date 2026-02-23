/**
 * Secure Test Mode for Edge Functions
 *
 * Safe impersonation for development testing:
 * - ONLY works when ENVIRONMENT === 'development'
 * - Requires valid service_role JWT (signature verified)
 * - Allows X-Test-User-Id header for impersonation
 * - In production: completely disabled, test headers ignored
 */

import { verifyServiceRole } from "./middleware.ts";
import type { AuthResult } from "./middleware.ts";

/**
 * Check if test mode is available (development environment only)
 */
export function isTestModeAvailable(): boolean {
  return Deno.env.get("ENVIRONMENT") === "development";
}

/**
 * Attempt test mode authentication
 *
 * Returns AuthResult with impersonated userId if:
 * 1. Environment is 'development'
 * 2. Request has valid service_role JWT
 * 3. X-Test-User-Id header is present
 *
 * Returns null if test mode is not applicable.
 * Throws AuthError if service_role JWT is invalid.
 *
 * @param req - Incoming request
 * @returns AuthResult with impersonated user, or null
 */
export async function tryTestMode(
  req: Request,
): Promise<AuthResult | null> {
  if (!isTestModeAvailable()) {
    return null;
  }

  const testUserId = req.headers.get("X-Test-User-Id");
  if (!testUserId) {
    return null;
  }

  // Validate service_role JWT — must be a real service_role token
  const serviceAuth = await verifyServiceRole(req);

  console.warn(
    `[TEST MODE] Impersonating user: ${testUserId} (authorized by service_role)`,
  );

  return {
    userId: testUserId,
    role: "authenticated",
    payload: {
      ...serviceAuth.payload,
      sub: testUserId,
      _testMode: true,
    },
  };
}

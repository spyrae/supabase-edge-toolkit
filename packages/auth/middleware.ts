/**
 * JWT Auth Middleware for Supabase Edge Functions
 *
 * Provides three auth modes:
 * - verifyUserToken(req) — for user-facing functions (extracts userId from JWT sub)
 * - verifyServiceRole(req) — for internal functions (validates service_role JWT)
 * - verifyCronSecret(req) — for cron jobs using shared secret
 *
 * @example
 * ```typescript
 * import { verifyUserToken, AuthError } from "@supabase-edge-toolkit/auth";
 *
 * try {
 *   const { userId } = await verifyUserToken(req);
 * } catch (error) {
 *   if (error instanceof AuthError) {
 *     return new Response(error.message, { status: error.statusCode });
 *   }
 * }
 * ```
 */

import { verify } from "djwt";
import { tryTestMode } from "./test_mode.ts";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a successful authentication
 */
export interface AuthResult {
  /** User ID from JWT 'sub' claim */
  userId: string;
  /** JWT role (e.g. 'authenticated', 'service_role') */
  role: string;
  /** Full decoded JWT payload */
  payload: Record<string, unknown>;
}

/**
 * Error codes for auth failures
 */
export type AuthErrorCode =
  | "MISSING_AUTH_HEADER"
  | "INVALID_AUTH_HEADER"
  | "INVALID_TOKEN"
  | "TOKEN_EXPIRED"
  | "MISSING_SUB_CLAIM"
  | "NOT_SERVICE_ROLE"
  | "MISSING_CRON_SECRET"
  | "INVALID_CRON_SECRET"
  | "MISSING_JWT_SECRET";

/**
 * Options for verifyUserToken
 */
export interface VerifyUserTokenOptions {
  /**
   * Allow test mode impersonation in development environment.
   * When true, a service_role JWT + X-Test-User-Id header returns
   * the test user's ID instead of the JWT's sub claim.
   * Only works when ENVIRONMENT === 'development'.
   */
  allowTestMode?: boolean;
}

// =============================================================================
// Auth Error
// =============================================================================

/**
 * Error thrown by auth middleware
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly statusCode: number;

  constructor(
    message: string,
    code: AuthErrorCode,
    statusCode = 401,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Cached CryptoKey for JWT verification.
 * Invalidates when the secret changes.
 */
let _cachedVerifyKey: CryptoKey | null = null;
let _cachedJwtSecret: string | null = null;

async function getVerifyKey(): Promise<CryptoKey> {
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET") ||
    Deno.env.get("JWT_SECRET");

  if (!jwtSecret) {
    throw new AuthError(
      "Missing SUPABASE_JWT_SECRET environment variable",
      "MISSING_JWT_SECRET",
      500,
    );
  }

  // Return cached key if secret hasn't changed
  if (_cachedVerifyKey && _cachedJwtSecret === jwtSecret) {
    return _cachedVerifyKey;
  }

  const keyData = new TextEncoder().encode(jwtSecret);
  _cachedVerifyKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  _cachedJwtSecret = jwtSecret;
  return _cachedVerifyKey;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract Bearer token from Authorization header
 *
 * @param req - Incoming request
 * @returns The bearer token string
 * @throws {AuthError} if header is missing or not Bearer format
 */
export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError(
      "Missing Authorization header",
      "MISSING_AUTH_HEADER",
    );
  }
  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthError(
      "Invalid Authorization header format",
      "INVALID_AUTH_HEADER",
    );
  }
  return authHeader.substring(7);
}

/**
 * Verify user JWT token and return the authenticated user's ID
 *
 * - Validates JWT signature using SUPABASE_JWT_SECRET
 * - Checks expiration
 * - Extracts userId from 'sub' claim
 * - Optionally supports test mode impersonation (dev only)
 *
 * @param req - Incoming request with Authorization: Bearer <token>
 * @param options - Optional configuration
 * @returns AuthResult with userId, role, and full payload
 * @throws {AuthError} if token is missing, invalid, or expired
 *
 * @example
 * ```typescript
 * const { userId, role } = await verifyUserToken(req);
 * ```
 */
export async function verifyUserToken(
  req: Request,
  options?: VerifyUserTokenOptions,
): Promise<AuthResult> {
  // Check test mode first (dev environment only)
  if (options?.allowTestMode) {
    const testResult = await tryTestMode(req);
    if (testResult) return testResult;
  }

  const token = extractBearerToken(req);
  const key = await getVerifyKey();

  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, key) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    // djwt throws specific errors for expiration
    if (message.includes("expired") || message.includes("exp")) {
      throw new AuthError("Token expired", "TOKEN_EXPIRED");
    }
    throw new AuthError(`Invalid token: ${message}`, "INVALID_TOKEN");
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new AuthError(
      "Invalid token: missing sub claim",
      "MISSING_SUB_CLAIM",
    );
  }

  const role = (payload.role as string) || "authenticated";

  return { userId: sub, role, payload };
}

/**
 * Verify that the request carries a valid service_role JWT
 *
 * Use for internal-only functions that should not be called by regular users
 * (e.g., cron triggers, inter-function calls).
 *
 * @param req - Incoming request
 * @returns AuthResult with service_role info
 * @throws {AuthError} if token is not a valid service_role JWT
 *
 * @example
 * ```typescript
 * await verifyServiceRole(req);
 * // Request is authorized as service_role
 * ```
 */
export async function verifyServiceRole(req: Request): Promise<AuthResult> {
  const token = extractBearerToken(req);
  const key = await getVerifyKey();

  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, key) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    if (message.includes("expired") || message.includes("exp")) {
      throw new AuthError("Token expired", "TOKEN_EXPIRED");
    }
    throw new AuthError(`Invalid token: ${message}`, "INVALID_TOKEN");
  }

  const role = (payload.role as string) || "";
  if (role !== "service_role") {
    throw new AuthError(
      "This endpoint requires service_role access",
      "NOT_SERVICE_ROLE",
      403,
    );
  }

  // Supabase service_role JWTs don't have 'sub' claim — use fallback
  const userId = (payload.sub as string) || "service_role";

  return { userId, role, payload };
}

/**
 * Verify cron job requests using a shared secret
 *
 * Checks that Authorization header contains the CRON_SECRET value.
 * Falls back to service_role JWT verification if secret doesn't match.
 *
 * @param req - Incoming request
 * @throws {AuthError} if CRON_SECRET is not configured or doesn't match
 *
 * @example
 * ```typescript
 * await verifyCronSecret(req);
 * // Request is authorized as cron job
 * ```
 */
export async function verifyCronSecret(req: Request): Promise<void> {
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!cronSecret) {
    // CRON_SECRET not configured — try service_role JWT as fallback
    try {
      await verifyServiceRole(req);
      return;
    } catch {
      // Not a valid service_role either
    }
    throw new AuthError(
      "Unauthorized: cron secret or service_role required",
      "MISSING_CRON_SECRET",
      403,
    );
  }

  const token = extractBearerToken(req);

  if (token !== cronSecret) {
    // It might be a service_role JWT — try that as fallback
    try {
      await verifyServiceRole(req);
      return;
    } catch {
      // Not a valid service_role either
    }

    throw new AuthError("Invalid cron secret", "INVALID_CRON_SECRET", 403);
  }
}

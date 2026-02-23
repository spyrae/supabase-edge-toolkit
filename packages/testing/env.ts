/**
 * Environment variable helpers for Supabase Edge Function tests.
 *
 * Provides save/restore utilities and sensible test defaults
 * for Supabase-specific environment variables.
 *
 * @example
 * ```typescript
 * const original = setupTestEnv({ SUPABASE_URL: "http://custom:54321" });
 * // ... run test ...
 * restoreEnv(original);
 * ```
 */

// =============================================================================
// Default test environment
// =============================================================================

/**
 * Minimal Supabase test environment defaults.
 *
 * Contains only Supabase-specific variables that Edge Functions typically need.
 * Override individual values via `setupTestEnv({ KEY: "value" })`.
 */
export const SUPABASE_TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_JWT_SECRET: "test-jwt-secret-for-unit-tests-only-32chars!",
};

// =============================================================================
// Environment helpers
// =============================================================================

/**
 * Set up test environment variables.
 *
 * Merges the provided overrides with `SUPABASE_TEST_ENV` defaults,
 * saves original values for later restoration.
 *
 * @param overrides - Additional or overriding env vars
 * @returns Original env values (pass to `restoreEnv` in cleanup)
 *
 * @example
 * ```typescript
 * let originalEnv: Record<string, string | undefined>;
 *
 * beforeEach(() => {
 *   originalEnv = setupTestEnv();
 * });
 *
 * afterEach(() => {
 *   restoreEnv(originalEnv);
 * });
 * ```
 */
export function setupTestEnv(
  overrides?: Record<string, string>,
): Record<string, string | undefined> {
  const original: Record<string, string | undefined> = {};
  const env = { ...SUPABASE_TEST_ENV, ...overrides };

  for (const [key, value] of Object.entries(env)) {
    original[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }

  return original;
}

/**
 * Restore environment variables to their original values.
 *
 * @param original - Map returned by `setupTestEnv`
 */
export function restoreEnv(
  original: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

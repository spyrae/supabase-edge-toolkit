/**
 * Test context factory for Supabase Edge Function tests.
 *
 * Creates a ready-to-use test environment with:
 * - MockDBState for in-memory database
 * - Mock fetch with Supabase REST + Functions handlers
 * - Environment variables set to test defaults
 * - Automatic cleanup
 *
 * @example
 * ```typescript
 * import { createTestContext } from "@supa-edge-toolkit/testing";
 *
 * Deno.test("my edge function", async () => {
 *   const ctx = createTestContext({
 *     dbSeed: { users: [{ id: "u1", name: "Alice" }] },
 *   });
 *
 *   try {
 *     // Test your edge function logic — fetch is already mocked
 *     const response = await fetch(
 *       "http://localhost:54321/rest/v1/users?id=eq.u1",
 *     );
 *     const data = await response.json();
 *     // assert...
 *   } finally {
 *     ctx.cleanup();
 *   }
 * });
 * ```
 */

import { MockDBState } from "./mock_db.ts";
import {
  createMockFetch,
  type FetchCall,
  type FetchHandler,
} from "./mock_fetch.ts";
import {
  createSupabaseFunctionsHandler,
  createSupabaseRestHandler,
} from "./postgrest.ts";
import { restoreEnv, setupTestEnv } from "./env.ts";

// =============================================================================
// Types
// =============================================================================

/** Configuration for createTestContext */
export interface TestContextOptions {
  /** Pre-populated database tables */
  dbSeed?: Record<string, unknown[]>;
  /** Additional fetch handlers (checked first, highest priority) */
  extraHandlers?: FetchHandler[];
  /** Environment variable overrides (merged with SUPABASE_TEST_ENV) */
  envOverrides?: Record<string, string>;
}

/** Test context returned by createTestContext */
export interface TestContext {
  /** Replacement for globalThis.fetch — routes to handlers */
  mockFetch: typeof globalThis.fetch;
  /** In-memory DB state tracker */
  dbState: MockDBState;
  /** Log of all fetch calls for assertions */
  fetchLog: FetchCall[];
  /** Original fetch — restored on cleanup */
  originalFetch: typeof globalThis.fetch;
  /** Restore original fetch and env vars */
  cleanup: () => void;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a test context with mock fetch, in-memory DB, and env setup.
 *
 * Sets `globalThis.fetch` to the mock. Call `cleanup()` when done
 * to restore the original fetch and environment.
 *
 * Handler priority (first match wins):
 * 1. `extraHandlers` (your custom handlers)
 * 2. Supabase REST handler (PostgREST emulator)
 * 3. Supabase Functions handler (returns `{ success: true }`)
 *
 * @param options - Configuration options
 * @returns TestContext with mockFetch, dbState, fetchLog, and cleanup
 */
export function createTestContext(options?: TestContextOptions): TestContext {
  const dbState = new MockDBState(options?.dbSeed);
  const fetchLog: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const originalEnv = setupTestEnv(options?.envOverrides);

  const handlers: FetchHandler[] = [
    // Extra handlers first (highest priority)
    ...(options?.extraHandlers ?? []),
    // Supabase REST API
    createSupabaseRestHandler(dbState),
    // Supabase Functions invoke
    createSupabaseFunctionsHandler(),
  ];

  const mockFetch = createMockFetch(handlers, fetchLog);
  globalThis.fetch = mockFetch;

  return {
    mockFetch,
    dbState,
    fetchLog,
    originalFetch,
    cleanup: () => {
      globalThis.fetch = originalFetch;
      restoreEnv(originalEnv);
    },
  };
}

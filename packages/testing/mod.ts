/**
 * @module @supabase-edge-toolkit/testing
 *
 * Test utilities for Supabase Edge Functions: in-memory database,
 * PostgREST protocol emulator, mock fetch with URL routing,
 * and assertion helpers.
 */

// MockDBState — in-memory database
export { MockDBState } from "./mock_db.ts";
export type { RpcResult, SelectOptions, SelectResult } from "./mock_db.ts";

// Mock fetch — URL pattern router + assertion helpers
export {
  assertFetchCount,
  assertNotFetched,
  createMockFetch,
  findFetchCalls,
  getFetchBody,
} from "./mock_fetch.ts";
export type { FetchCall, FetchHandler } from "./mock_fetch.ts";

// PostgREST handler — protocol emulator
export {
  createSupabaseFunctionsHandler,
  createSupabaseRestHandler,
  extractRpcFunctionFromUrl,
  extractTableFromUrl,
  parsePostgrestFilters,
  parsePostgrestOptions,
} from "./postgrest.ts";

// Environment helpers
export { restoreEnv, setupTestEnv, SUPABASE_TEST_ENV } from "./env.ts";

// Test context factory
export { createTestContext } from "./context.ts";
export type { TestContext, TestContextOptions } from "./context.ts";

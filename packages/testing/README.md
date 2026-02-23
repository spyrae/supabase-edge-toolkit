# @supabase-edge-toolkit/testing

Test utilities for Supabase Edge Functions: in-memory database, PostgREST
protocol emulator, mock fetch with URL routing, and assertion helpers.

## Installation

```typescript
import {
  assertFetchCount,
  createTestContext,
  MockDBState,
} from "jsr:@supabase-edge-toolkit/testing";
```

## Quick Start

```typescript
import {
  assertFetchCount,
  createTestContext,
} from "@supabase-edge-toolkit/testing";
import { afterEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

describe("my edge function", () => {
  let cleanup: () => void;

  afterEach(() => cleanup());

  it("should query users", async () => {
    const ctx = createTestContext({
      dbSeed: { users: [{ id: "u1", name: "Alice" }] },
    });
    cleanup = ctx.cleanup;

    // globalThis.fetch is already mocked — use Supabase client normally
    const response = await fetch(
      "http://localhost:54321/rest/v1/users?id=eq.u1",
    );
    const data = await response.json();

    assertEquals(data.length, 1);
    assertEquals(data[0].name, "Alice");
    assertFetchCount(ctx.fetchLog, "/rest/v1/users", 1);
  });
});
```

## API Reference

### `createTestContext(options?)`

Create a complete test environment with mock fetch, in-memory DB, and env setup.

```typescript
const ctx = createTestContext({
  dbSeed: { users: [{ id: "u1", name: "Alice" }] },
  extraHandlers: [myCustomHandler],
  envOverrides: { MY_API_KEY: "test-key" },
});

// ctx.mockFetch    — mock fetch function (also set as globalThis.fetch)
// ctx.dbState      — MockDBState instance
// ctx.fetchLog     — array of all fetch calls
// ctx.cleanup()    — restore original fetch and env
```

**Handler priority** (first match wins):

1. `extraHandlers` — your custom handlers
2. Supabase REST handler — PostgREST emulator (`/rest/v1/`)
3. Supabase Functions handler — returns `{ success: true }` (`/functions/v1/`)

Unmatched URLs throw an error with full request details.

### `MockDBState`

In-memory database that emulates Supabase/PostgREST behavior.

```typescript
const db = new MockDBState({
  users: [{ id: "u1", name: "Alice" }], // seed data
});

// Insert
db.insert("posts", { title: "Hello", user_id: "u1" });
db.insert("tags", [{ name: "deno" }, { name: "supabase" }]);

// Select
const { data, count } = db.select("users", { role: "admin" }, {
  count: true,
  order: "name.asc",
  limit: 10,
  offset: 0,
});

// Single row
const { data: user } = db.select("users", { id: "u1" }, { single: true });

// Update (adds updated_at)
db.update("users", { id: "u1" }, { name: "Alice Updated" });

// Upsert (insert or update by conflict key)
db.upsert("settings", { id: "s1", value: "new" }, "id");

// Delete
const deletedCount = db.delete("users", { id: "u1" });

// RPC
db.registerRpc("get_stats", (args) => ({ total: 42 }));
const { data: stats } = db.executeRpc("get_stats", { category: "test" });

// Reset
db.reset();
```

### `createMockFetch(handlers, fetchLog)`

Create a mock fetch function with URL pattern routing.

```typescript
const fetchLog: FetchCall[] = [];
const mockFetch = createMockFetch(
  [
    (url) => url.includes("/my-api") ? new Response("ok") : null,
    createSupabaseRestHandler(db),
  ],
  fetchLog,
);
globalThis.fetch = mockFetch;
```

### `createSupabaseRestHandler(dbState)`

PostgREST protocol emulator. Handles all standard Supabase REST operations:

| Method | Supabase JS equivalent                         | Supported |
| ------ | ---------------------------------------------- | --------- |
| HEAD   | `.select('*', { count: 'exact', head: true })` | Yes       |
| GET    | `.select()` with filters, order, limit, single | Yes       |
| POST   | `.insert()`                                    | Yes       |
| POST   | `.upsert()` (with `on_conflict`)               | Yes       |
| PATCH  | `.update()`                                    | Yes       |
| DELETE | `.delete()`                                    | Yes       |
| POST   | `.rpc()`                                       | Yes       |

**Supported filters:** `eq.VALUE`, `ilike.VALUE`, `is.null`

### `createSupabaseFunctionsHandler()`

Simple handler for `/functions/v1/` URLs. Returns `{ success: true }`.

### Assertion Helpers

```typescript
import {
  assertFetchCount,
  assertNotFetched,
  findFetchCalls,
  getFetchBody,
} from "@supabase-edge-toolkit/testing";

// Find calls matching a pattern
const calls = findFetchCalls(ctx.fetchLog, "/rest/v1/users");
const calls2 = findFetchCalls(ctx.fetchLog, /chat\/completions/);

// Assert exact call count (throws with full log on mismatch)
assertFetchCount(ctx.fetchLog, "/rest/v1/users", 2);

// Assert URL was never called
assertNotFetched(ctx.fetchLog, "/external-api");

// Get request body of first matching call
const body = getFetchBody(ctx.fetchLog, "/rest/v1/users");
```

### Environment Helpers

```typescript
import {
  restoreEnv,
  setupTestEnv,
  SUPABASE_TEST_ENV,
} from "@supabase-edge-toolkit/testing";

// Set Supabase test defaults + custom vars
const original = setupTestEnv({ MY_API_KEY: "test" });

// SUPABASE_TEST_ENV defaults:
// - SUPABASE_URL: "http://localhost:54321"
// - SUPABASE_ANON_KEY: "test-anon-key"
// - SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
// - SUPABASE_JWT_SECRET: "test-jwt-secret-for-unit-tests-only-32chars!"

// Restore original env
restoreEnv(original);
```

### URL Parsing Helpers

Lower-level PostgREST URL parsers (used internally, exported for advanced use):

```typescript
import {
  extractRpcFunctionFromUrl,
  extractTableFromUrl,
  parsePostgrestFilters,
  parsePostgrestOptions,
} from "@supabase-edge-toolkit/testing";

extractTableFromUrl("/rest/v1/users?id=eq.1"); // "users"
extractRpcFunctionFromUrl("/rest/v1/rpc/get_stats"); // "get_stats"
parsePostgrestFilters("http://x/rest/v1/users?role=eq.admin&name=ilike.alice");
// { role: "admin", name: "alice" }
```

## Custom Handlers

Add extra fetch handlers for external APIs your functions call:

```typescript
function createMyApiHandler(): FetchHandler {
  return (url: string, init?: RequestInit): Response | null => {
    if (!url.includes("my-api.com")) return null;
    return new Response(JSON.stringify({ result: "mocked" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const ctx = createTestContext({
  extraHandlers: [createMyApiHandler()],
});
```

## License

MIT

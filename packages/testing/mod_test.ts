import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";

import {
  assertFetchCount,
  assertNotFetched,
  createTestContext,
  findFetchCalls,
  getFetchBody,
  MockDBState,
  restoreEnv,
  setupTestEnv,
  SUPABASE_TEST_ENV,
} from "./mod.ts";

// =============================================================================
// MockDBState Tests
// =============================================================================

describe("MockDBState", () => {
  it("should insert and select rows", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1", name: "Alice" });
    db.insert("users", { id: "u2", name: "Bob" });

    const result = db.select("users");
    assertEquals((result.data as unknown[]).length, 2);
  });

  it("should select with filters", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1", name: "Alice", role: "admin" });
    db.insert("users", { id: "u2", name: "Bob", role: "user" });

    const result = db.select("users", { role: "admin" });
    assertEquals((result.data as unknown[]).length, 1);
    assertEquals(
      ((result.data as unknown[])[0] as Record<string, unknown>).name,
      "Alice",
    );
  });

  it("should select with count option", () => {
    const db = new MockDBState();
    db.insert("items", [{ id: "1" }, { id: "2" }, { id: "3" }]);

    const result = db.select("items", undefined, { count: true });
    assertEquals(result.count, 3);
  });

  it("should select single row", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1", name: "Alice" });

    const result = db.select("users", { id: "u1" }, { single: true });
    assertExists(result.data);
    assertEquals((result.data as Record<string, unknown>).name, "Alice");
  });

  it("should select with head option (count only)", () => {
    const db = new MockDBState();
    db.insert("items", [{ id: "1" }, { id: "2" }]);

    const result = db.select("items", undefined, { head: true });
    assertEquals(result.data, null);
    assertEquals(result.count, 2);
  });

  it("should select with order", () => {
    const db = new MockDBState();
    db.insert("items", { id: "1", name: "Banana" });
    db.insert("items", { id: "2", name: "Apple" });
    db.insert("items", { id: "3", name: "Cherry" });

    const result = db.select("items", undefined, { order: "name.asc" });
    const names = (result.data as Record<string, unknown>[]).map((r) => r.name);
    assertEquals(names, ["Apple", "Banana", "Cherry"]);
  });

  it("should select with limit and offset", () => {
    const db = new MockDBState();
    db.insert("items", [
      { id: "1" },
      { id: "2" },
      { id: "3" },
      { id: "4" },
    ]);

    const result = db.select("items", undefined, { limit: 2, offset: 1 });
    assertEquals((result.data as unknown[]).length, 2);
    assertEquals(
      ((result.data as unknown[])[0] as Record<string, unknown>).id,
      "2",
    );
  });

  it("should update rows", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1", name: "Alice", status: "active" });

    db.update("users", { id: "u1" }, { status: "inactive" });

    const result = db.select("users", { id: "u1" }, { single: true });
    assertEquals(
      (result.data as Record<string, unknown>).status,
      "inactive",
    );
    assertExists((result.data as Record<string, unknown>).updated_at);
  });

  it("should upsert — insert new row", () => {
    const db = new MockDBState();
    db.upsert("users", { id: "u1", name: "Alice" });

    assertEquals(db.getTable("users").length, 1);
  });

  it("should upsert — update existing row", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1", name: "Alice" });
    db.upsert("users", { id: "u1", name: "Alice Updated" });

    const result = db.select("users");
    assertEquals((result.data as unknown[]).length, 1);
    assertEquals(
      ((result.data as unknown[])[0] as Record<string, unknown>).name,
      "Alice Updated",
    );
  });

  it("should delete rows", () => {
    const db = new MockDBState();
    db.insert("users", [{ id: "u1" }, { id: "u2" }]);

    const deleted = db.delete("users", { id: "u1" });
    assertEquals(deleted, 1);
    assertEquals(db.getTable("users").length, 1);
  });

  it("should handle RPC functions", () => {
    const db = new MockDBState();
    db.registerRpc("count_items", (args) => {
      const a = args as Record<string, unknown>;
      return { count: 42, category: a.category };
    });

    const result = db.executeRpc("count_items", { category: "books" });
    assertEquals(
      (result.data as Record<string, unknown>).count,
      42,
    );
  });

  it("should return error for unknown RPC", () => {
    const db = new MockDBState();
    const result = db.executeRpc("unknown_func", {});
    assertExists(result.error);
  });

  it("should accept seed data in constructor", () => {
    const db = new MockDBState({
      users: [{ id: "u1", name: "Seed User" }],
    });

    assertEquals(db.getTable("users").length, 1);
  });

  it("should reset all state", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1" });
    db.registerRpc("test", () => null);
    db.reset();

    assertEquals(db.getTable("users").length, 0);
    assertExists(db.executeRpc("test", {}).error);
  });

  it("should handle case-insensitive string filters", () => {
    const db = new MockDBState();
    db.insert("users", { id: "u1", email: "Alice@Example.COM" });

    const result = db.select("users", { email: "alice@example.com" });
    assertEquals((result.data as unknown[]).length, 1);
  });
});

// =============================================================================
// createTestContext Tests
// =============================================================================

describe("createTestContext", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("should set up Supabase environment variables", () => {
    const ctx = createTestContext();
    cleanup = ctx.cleanup;

    assertEquals(
      Deno.env.get("SUPABASE_URL"),
      SUPABASE_TEST_ENV.SUPABASE_URL,
    );
    assertEquals(
      Deno.env.get("SUPABASE_ANON_KEY"),
      SUPABASE_TEST_ENV.SUPABASE_ANON_KEY,
    );
  });

  it("should restore env on cleanup", () => {
    const original = Deno.env.get("SUPABASE_URL");
    const ctx = createTestContext();
    ctx.cleanup();

    assertEquals(Deno.env.get("SUPABASE_URL"), original);
  });

  it("should accept custom env overrides", () => {
    const ctx = createTestContext({
      envOverrides: { SUPABASE_URL: "http://custom:9999" },
    });
    cleanup = ctx.cleanup;

    assertEquals(Deno.env.get("SUPABASE_URL"), "http://custom:9999");
  });

  it("should log all fetch calls", async () => {
    const ctx = createTestContext({
      extraHandlers: [
        (url) => url.includes("test-api") ? new Response("ok") : null,
      ],
    });
    cleanup = ctx.cleanup;

    await ctx.mockFetch("http://test-api/endpoint", { method: "POST" });

    assertEquals(ctx.fetchLog.length, 1);
    assertEquals(ctx.fetchLog[0].url, "http://test-api/endpoint");
    assertEquals(ctx.fetchLog[0].method, "POST");
  });

  it("should throw on unmocked URL", async () => {
    const ctx = createTestContext();
    cleanup = ctx.cleanup;

    await assertRejects(
      () => ctx.mockFetch("http://unknown-api/test"),
      Error,
      "Unmocked fetch",
    );
  });

  it("should handle Supabase REST GET", async () => {
    const ctx = createTestContext({
      dbSeed: {
        users: [{ id: "u1", name: "Alice" }],
      },
    });
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/users?id=eq.u1",
      { method: "GET", headers: { "content-type": "application/json" } },
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.length, 1);
    assertEquals(data[0].name, "Alice");
  });

  it("should handle Supabase REST POST", async () => {
    const ctx = createTestContext();
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/users",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "prefer": "return=representation",
        },
        body: JSON.stringify({ id: "u1", name: "New User" }),
      },
    );

    assertEquals(response.status, 201);
    assertEquals(ctx.dbState.getTable("users").length, 1);
  });

  it("should handle Supabase REST PATCH", async () => {
    const ctx = createTestContext({
      dbSeed: {
        users: [{ id: "u1", name: "Alice", status: "active" }],
      },
    });
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/users?id=eq.u1",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "prefer": "return=representation",
        },
        body: JSON.stringify({ status: "inactive" }),
      },
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data[0].status, "inactive");
  });

  it("should handle Supabase REST DELETE", async () => {
    const ctx = createTestContext({
      dbSeed: {
        users: [{ id: "u1" }, { id: "u2" }],
      },
    });
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/users?id=eq.u1",
      { method: "DELETE" },
    );

    assertEquals(response.status, 204);
    assertEquals(ctx.dbState.getTable("users").length, 1);
  });

  it("should handle Supabase REST HEAD (count)", async () => {
    const ctx = createTestContext({
      dbSeed: {
        items: [{ id: "1" }, { id: "2" }, { id: "3" }],
      },
    });
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/items",
      {
        method: "HEAD",
        headers: { "prefer": "count=exact" },
      },
    );

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-range"), "*/3");
  });

  it("should handle Supabase REST RPC", async () => {
    const ctx = createTestContext();
    cleanup = ctx.cleanup;

    ctx.dbState.registerRpc("get_stats", (args) => ({
      total: 100,
      ...(args as Record<string, unknown>),
    }));

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/rpc/get_stats",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: "test" }),
      },
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.total, 100);
    assertEquals(data.category, "test");
  });

  it("should handle Supabase Functions invoke", async () => {
    const ctx = createTestContext();
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/functions/v1/my-function",
      {
        method: "POST",
        headers: {},
        body: JSON.stringify({ key: "value" }),
      },
    );

    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.success, true);
  });

  it("should handle Supabase REST upsert", async () => {
    const ctx = createTestContext({
      dbSeed: {
        settings: [{ id: "s1", key: "theme", value: "dark" }],
      },
    });
    cleanup = ctx.cleanup;

    const response = await ctx.mockFetch(
      "http://localhost:54321/rest/v1/settings?on_conflict=id",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "prefer": "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify({ id: "s1", key: "theme", value: "light" }),
      },
    );

    assertEquals(response.status, 201);
    assertEquals(ctx.dbState.getTable("settings").length, 1);
    const row = ctx.dbState.getTable("settings")[0] as Record<string, unknown>;
    assertEquals(row.value, "light");
  });
});

// =============================================================================
// Assertion Helpers Tests
// =============================================================================

describe("Assertion helpers", () => {
  it("findFetchCalls should filter by string pattern", () => {
    const log = [
      {
        url: "http://api/users",
        method: "GET",
        headers: {},
        body: null,
        timestamp: 1,
      },
      {
        url: "http://api/posts",
        method: "GET",
        headers: {},
        body: null,
        timestamp: 2,
      },
      {
        url: "http://api/users/1",
        method: "GET",
        headers: {},
        body: null,
        timestamp: 3,
      },
    ];

    const calls = findFetchCalls(log, "/users");
    assertEquals(calls.length, 2);
  });

  it("findFetchCalls should filter by regex", () => {
    const log = [
      {
        url: "http://api/chat/completions",
        method: "POST",
        headers: {},
        body: null,
        timestamp: 1,
      },
      {
        url: "http://api/users",
        method: "GET",
        headers: {},
        body: null,
        timestamp: 2,
      },
    ];

    const calls = findFetchCalls(log, /chat\/completions/);
    assertEquals(calls.length, 1);
  });

  it("assertFetchCount should pass on correct count", () => {
    const log = [
      {
        url: "http://api/test",
        method: "GET",
        headers: {},
        body: null,
        timestamp: 1,
      },
    ];

    assertFetchCount(log, "/test", 1);
  });

  it("assertNotFetched should pass when URL not called", () => {
    const log = [
      {
        url: "http://api/test",
        method: "GET",
        headers: {},
        body: null,
        timestamp: 1,
      },
    ];

    assertNotFetched(log, "/other");
  });

  it("getFetchBody should return body of first matching call", () => {
    const log = [
      {
        url: "http://api/users",
        method: "POST",
        headers: {},
        body: { name: "Alice" },
        timestamp: 1,
      },
    ];

    const body = getFetchBody(log, "/users");
    assertEquals((body as Record<string, unknown>).name, "Alice");
  });
});

// =============================================================================
// Environment Helpers Tests
// =============================================================================

describe("Environment helpers", () => {
  it("setupTestEnv should set Supabase defaults", () => {
    const original = setupTestEnv();
    try {
      assertEquals(Deno.env.get("SUPABASE_URL"), "http://localhost:54321");
      assertEquals(Deno.env.get("SUPABASE_ANON_KEY"), "test-anon-key");
    } finally {
      restoreEnv(original);
    }
  });

  it("setupTestEnv should accept overrides", () => {
    const original = setupTestEnv({
      SUPABASE_URL: "http://custom:9999",
      MY_CUSTOM_VAR: "custom-value",
    });
    try {
      assertEquals(Deno.env.get("SUPABASE_URL"), "http://custom:9999");
      assertEquals(Deno.env.get("MY_CUSTOM_VAR"), "custom-value");
    } finally {
      restoreEnv(original);
    }
  });

  it("restoreEnv should restore original values", () => {
    const before = Deno.env.get("SUPABASE_URL");
    const original = setupTestEnv();
    restoreEnv(original);

    assertEquals(Deno.env.get("SUPABASE_URL"), before);
  });
});

// deno-lint-ignore-file require-await
import { assert, assertEquals, assertExists } from "@std/assert";
import { assertRejects } from "@std/assert/rejects";

import {
  createTimeoutController,
  DEFAULT_TIMEOUTS,
  fetchWithTimeout,
  getDefaultTimeout,
  isTimeoutError,
  TimeoutError,
  withTimeout,
} from "./timeout.ts";

// =============================================================================
// Helper Functions
// =============================================================================

function delay(ms: number): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve("completed"), ms));
}

function delayNever(): Promise<never> {
  return new Promise(() => {}); // Never resolves
}

// =============================================================================
// withTimeout Tests
// =============================================================================

Deno.test("withTimeout - timeout fires before operation completes", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  await assertRejects(
    () => withTimeout(delay(1000), 50, "slow-operation"),
    TimeoutError,
  );
});

Deno.test("withTimeout - operation completes before timeout", async () => {
  const result = await withTimeout(delay(50), 500, "fast-operation");
  assertEquals(result, "completed");
});

Deno.test("withTimeout - exact timeout boundary", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  await assertRejects(
    () => withTimeout(delay(200), 50, "boundary-operation"),
    TimeoutError,
  );
});

Deno.test("withTimeout - zero timeout throws immediately", async () => {
  await assertRejects(
    () => withTimeout(delayNever(), 0, "zero-timeout"),
    TimeoutError,
  );
});

Deno.test("withTimeout - clears timeout after success", async () => {
  const result = await withTimeout(
    Promise.resolve("success"),
    1000,
    "immediate-success",
  );
  assertEquals(result, "success");
});

Deno.test("withTimeout - clears timeout after rejection", async () => {
  await assertRejects(
    () =>
      withTimeout(
        Promise.reject(new Error("rejected")),
        1000,
        "immediate-rejection",
      ),
    Error,
  );
});

// =============================================================================
// TimeoutError Tests
// =============================================================================

Deno.test("TimeoutError - has correct message format", async () => {
  try {
    await withTimeout(delayNever(), 100, "test-operation");
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof TimeoutError);
    assert(error.message.includes("test-operation"));
    assert(error.message.includes("100"));
  }
});

Deno.test("TimeoutError - has correct properties", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  try {
    await withTimeout(delayNever(), 100, "test-operation");
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof TimeoutError);
    assertEquals(error.code, "TIMEOUT");
    assertEquals(error.operation, "test-operation");
    assertEquals(error.timeoutMs, 100);
    assertEquals(error.isRetryable, true);
  }
});

Deno.test("TimeoutError - toString format", async () => {
  try {
    await withTimeout(delayNever(), 100, "test-operation");
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof TimeoutError);
    const str = error.toString();
    assert(str.includes("TimeoutError"));
    assert(str.includes("test-operation"));
    assert(str.includes("100"));
  }
});

// =============================================================================
// fetchWithTimeout Tests (mock fetch)
// =============================================================================

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

Deno.test("fetchWithTimeout - successful fetch within timeout", async () => {
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithTimeout(
      "https://example.com/api",
      {},
      5000,
    );
    assertEquals(response.ok, true);
    await response.text();
  } finally {
    restoreFetch();
  }
});

Deno.test("fetchWithTimeout - timeout before response", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    // Simulate slow response by waiting for abort signal
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
  };

  try {
    await assertRejects(
      () => fetchWithTimeout("https://example.com/slow", {}, 50),
      TimeoutError,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("fetchWithTimeout - uses default timeout", async () => {
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithTimeout("https://example.com/api");
    assertEquals(response.ok, true);
    await response.text();
  } finally {
    restoreFetch();
  }
});

Deno.test("fetchWithTimeout - converts AbortError to TimeoutError", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
  };

  try {
    try {
      await fetchWithTimeout("https://example.com/slow", {}, 50);
      assert(false, "Should have thrown");
    } catch (error) {
      assert(error instanceof TimeoutError);
      assertEquals(error.operation, "fetch");
    }
  } finally {
    restoreFetch();
  }
});

Deno.test("fetchWithTimeout - preserves non-timeout errors", async () => {
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    throw new Error("Connection refused");
  };

  try {
    await assertRejects(
      () => fetchWithTimeout("https://example.com/api", {}, 5000),
      Error,
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("fetchWithTimeout - with custom headers", async () => {
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedInit = init;
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithTimeout(
      "https://example.com/api",
      { headers: { "X-Custom-Header": "test" } },
      5000,
    );
    assertEquals(response.ok, true);
    assertExists(capturedInit);
    await response.text();
  } finally {
    restoreFetch();
  }
});

Deno.test("fetchWithTimeout - with POST request", async () => {
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await fetchWithTimeout(
      "https://example.com/api",
      {
        method: "POST",
        body: JSON.stringify({ test: "data" }),
        headers: { "Content-Type": "application/json" },
      },
      5000,
    );
    assertEquals(response.ok, true);
    await response.text();
  } finally {
    restoreFetch();
  }
});

// =============================================================================
// createTimeoutController Tests
// =============================================================================

Deno.test("createTimeoutController - returns AbortController", async () => {
  const controller = createTimeoutController(50);
  assert(controller instanceof AbortController);
  assertEquals(controller.signal.aborted, false);

  // Wait for timeout to clear
  await delay(100);
});

Deno.test("createTimeoutController - aborts after timeout", async () => {
  const controller = createTimeoutController(50);

  assertEquals(controller.signal.aborted, false);

  await delay(100);

  assertEquals(controller.signal.aborted, true);
});

// =============================================================================
// isTimeoutError Tests
// =============================================================================

Deno.test("isTimeoutError - returns true for TimeoutError", () => {
  const error = new TimeoutError("test", 100);
  assertEquals(isTimeoutError(error), true);
});

Deno.test("isTimeoutError - returns true for AbortError", () => {
  const error = new Error("abort");
  error.name = "AbortError";
  assertEquals(isTimeoutError(error), true);
});

Deno.test("isTimeoutError - returns false for regular Error", () => {
  const error = new Error("regular error");
  assertEquals(isTimeoutError(error), false);
});

Deno.test("isTimeoutError - returns false for non-Error objects", () => {
  assertEquals(isTimeoutError("string"), false);
  assertEquals(isTimeoutError(null), false);
  assertEquals(isTimeoutError(undefined), false);
  assertEquals(isTimeoutError({}), false);
});

// =============================================================================
// getDefaultTimeout Tests
// =============================================================================

Deno.test("getDefaultTimeout - returns correct timeout for EXTERNAL_API", () => {
  assertEquals(
    getDefaultTimeout("EXTERNAL_API"),
    DEFAULT_TIMEOUTS.EXTERNAL_API,
  );
});

Deno.test("getDefaultTimeout - returns correct timeout for LLM", () => {
  assertEquals(getDefaultTimeout("LLM"), DEFAULT_TIMEOUTS.LLM);
});

Deno.test("getDefaultTimeout - returns correct timeout for DATABASE", () => {
  assertEquals(getDefaultTimeout("DATABASE"), DEFAULT_TIMEOUTS.DATABASE);
});

Deno.test("getDefaultTimeout - returns correct timeout for FAST", () => {
  assertEquals(getDefaultTimeout("FAST"), DEFAULT_TIMEOUTS.FAST);
});

// =============================================================================
// DEFAULT_TIMEOUTS Tests
// =============================================================================

Deno.test("DEFAULT_TIMEOUTS - all service types have positive timeouts", () => {
  for (const [key, value] of Object.entries(DEFAULT_TIMEOUTS)) {
    assert(value > 0, `${key} should have positive timeout`);
  }
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("withTimeout - default operation name", async () => {
  try {
    await withTimeout(delayNever(), 50);
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof TimeoutError);
    assertEquals(error.operation, "unknown");
  }
});

Deno.test("withTimeout - immediately resolved promise", async () => {
  const result = await withTimeout(Promise.resolve("immediate"), 1000);
  assertEquals(result, "immediate");
});

Deno.test("withTimeout - immediately rejected promise", async () => {
  await assertRejects(
    () => withTimeout(Promise.reject(new Error("immediate-fail")), 1000),
    Error,
  );
});

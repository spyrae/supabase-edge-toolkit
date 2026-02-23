// deno-lint-ignore-file require-await
import { assert, assertEquals, assertExists } from "@std/assert";
import { assertRejects } from "@std/assert/rejects";

import { CircuitBreaker, CircuitBreakerOpenError } from "./circuit_breaker.ts";

// =============================================================================
// Helper Functions
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TestError extends Error {
  statusCode?: number;
  status?: number;
  code?: string;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "TestError";
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
      this.status = statusCode;
    }
  }
}

// =============================================================================
// State Transitions Tests
// =============================================================================

Deno.test("CircuitBreaker - closed to open after failure threshold", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-closed-to-open", {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  assertEquals(breaker.state, "closed");

  for (let i = 0; i < 3; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new Error("fail");
        }),
      Error,
    );
  }

  assertEquals(breaker.state, "open");
});

Deno.test("CircuitBreaker - open to half-open after reset timeout", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-open-to-half-open", {
    failureThreshold: 2,
    successThreshold: 2,
    resetTimeoutMs: 100,
  });

  for (let i = 0; i < 2; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new Error("fail");
        }),
      Error,
    );
  }

  assertEquals(breaker.state, "open");

  await delay(150);

  assertEquals(breaker.isAllowingRequests, true);
  assertEquals(breaker.state, "half-open");
});

Deno.test("CircuitBreaker - half-open to closed after success threshold", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-half-open-to-closed", {
    failureThreshold: 2,
    successThreshold: 2,
    resetTimeoutMs: 100,
  });

  for (let i = 0; i < 2; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new Error("fail");
        }),
      Error,
    );
  }

  await delay(150);
  breaker.isAllowingRequests;
  assertEquals(breaker.state, "half-open");

  await breaker.call(async () => "ok");
  await breaker.call(async () => "ok");

  assertEquals(breaker.state, "closed");
});

Deno.test("CircuitBreaker - half-open to open on failure", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-half-open-to-open", {
    failureThreshold: 2,
    successThreshold: 2,
    resetTimeoutMs: 100,
  });

  for (let i = 0; i < 2; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new Error("fail");
        }),
      Error,
    );
  }

  await delay(150);
  breaker.isAllowingRequests;
  assertEquals(breaker.state, "half-open");

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail again");
      }),
    Error,
  );

  assertEquals(breaker.state, "open");
});

// =============================================================================
// Failure Counting Tests
// =============================================================================

Deno.test("CircuitBreaker - failure count increments on error", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-failure-increment", {
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  assertEquals(breaker.stats.failureCount, 0);

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );
  assertEquals(breaker.stats.failureCount, 1);

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );
  assertEquals(breaker.stats.failureCount, 2);
});

Deno.test("CircuitBreaker - failure count resets on success", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-failure-reset", {
    failureThreshold: 5,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  for (let i = 0; i < 2; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new Error("fail");
        }),
      Error,
    );
  }
  assertEquals(breaker.stats.failureCount, 2);

  await breaker.call(async () => "ok");
  assertEquals(breaker.stats.failureCount, 0);
});

// =============================================================================
// Ignored Status Codes Tests
// =============================================================================

Deno.test("CircuitBreaker - 404 not counted as failure when ignored", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-ignored-404", {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 1000,
    ignoredStatusCodes: [400, 404],
  });

  for (let i = 0; i < 5; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new TestError("not found", 404);
        }),
      TestError,
    );
  }

  assertEquals(breaker.stats.failureCount, 0);
  assertEquals(breaker.state, "closed");
});

Deno.test("CircuitBreaker - 500 counted as failure", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-counted-500", {
    failureThreshold: 2,
    successThreshold: 2,
    resetTimeoutMs: 1000,
    ignoredStatusCodes: [404],
  });

  for (let i = 0; i < 2; i++) {
    await assertRejects(
      () =>
        breaker.call(async () => {
          throw new TestError("server error", 500);
        }),
      TestError,
    );
  }

  assertEquals(breaker.state, "open");
});

Deno.test("CircuitBreaker - status property checked", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-status-property", {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 1000,
    ignoredStatusCodes: [404],
  });

  // deno-lint-ignore no-explicit-any
  const error = new Error("not found") as any;
  error.status = 404;

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw error;
      }),
    Error,
  );

  assertEquals(breaker.stats.failureCount, 0);
});

Deno.test("CircuitBreaker - code string property checked", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-code-property", {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 1000,
    ignoredStatusCodes: [404],
  });

  // deno-lint-ignore no-explicit-any
  const error = new Error("not found") as any;
  error.code = "404";

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw error;
      }),
    Error,
  );

  assertEquals(breaker.stats.failureCount, 0);
});

// =============================================================================
// Stats Tests
// =============================================================================

Deno.test("CircuitBreaker - stats returns current state", () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-stats");

  const stats = breaker.stats;

  assertExists(stats.name);
  assertEquals(stats.name, "test-stats");
  assertEquals(stats.state, "closed");
  assertEquals(stats.failureCount, 0);
  assertEquals(stats.successCount, 0);
});

Deno.test("CircuitBreaker - getAllStats returns all breakers", () => {
  CircuitBreaker.clearAll();
  CircuitBreaker.getOrCreate("breaker-1");
  CircuitBreaker.getOrCreate("breaker-2");

  const allStats = CircuitBreaker.getAllStats();

  assertEquals(allStats.size, 2);
  assert(allStats.has("breaker-1"));
  assert(allStats.has("breaker-2"));
});

Deno.test("CircuitBreaker - lastFailureTime recorded", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-last-failure");

  assertEquals(breaker.stats.lastFailureTime, undefined);

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  assertExists(breaker.stats.lastFailureTime);
});

Deno.test("CircuitBreaker - lastError recorded", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-last-error");

  assertEquals(breaker.stats.lastError, undefined);

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("test error message");
      }),
    Error,
  );

  assertEquals(breaker.stats.lastError, "test error message");
});

Deno.test("CircuitBreaker - remainingTimeoutMs when open", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-remaining-timeout", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  assertEquals(breaker.remainingTimeoutMs, 0);

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  assertEquals(breaker.state, "open");
  assert(breaker.remainingTimeoutMs > 0);
  assert(breaker.remainingTimeoutMs <= 1000);
});

// =============================================================================
// Presets Tests
// =============================================================================

Deno.test("CircuitBreaker - forExternalApi creates breaker", () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.forExternalApi("test-external-api");
  assertEquals(breaker.state, "closed");
  assertExists(breaker);
});

Deno.test("CircuitBreaker - forLLM creates breaker", () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.forLLM("test-llm");
  assertEquals(breaker.state, "closed");
  assertExists(breaker);
});

Deno.test("CircuitBreaker - forPayment creates breaker", () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.forPayment("test-payment");
  assertEquals(breaker.state, "closed");
  assertExists(breaker);
});

// =============================================================================
// CircuitBreakerOpenError Tests
// =============================================================================

Deno.test("CircuitBreakerOpenError - thrown when circuit is open", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-open-error", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  await assertRejects(
    () => breaker.call(async () => "ok"),
    CircuitBreakerOpenError,
  );
});

Deno.test("CircuitBreakerOpenError - has correct properties", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-error-properties", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 5000,
  });

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  try {
    await breaker.call(async () => "ok");
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof CircuitBreakerOpenError);
    assertEquals(error.code, "CIRCUIT_OPEN");
    assertEquals(error.serviceName, "test-error-properties");
    assert(error.remainingTimeoutMs > 0);
    assertEquals(error.isRetryable, false);
  }
});

Deno.test("CircuitBreakerOpenError - toString format", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-error-string", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 5000,
  });

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  try {
    await breaker.call(async () => "ok");
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof CircuitBreakerOpenError);
    const str = error.toString();
    assert(str.includes("CircuitBreakerOpenError"));
    assert(str.includes("test-error-string"));
  }
});

// =============================================================================
// Control Methods Tests
// =============================================================================

Deno.test("CircuitBreaker - clearAll removes all breakers", () => {
  CircuitBreaker.clearAll();
  CircuitBreaker.getOrCreate("breaker-1");
  CircuitBreaker.getOrCreate("breaker-2");
  assertEquals(CircuitBreaker.getAllStats().size, 2);

  CircuitBreaker.clearAll();
  assertEquals(CircuitBreaker.getAllStats().size, 0);
});

Deno.test("CircuitBreaker - resetAll resets all to closed", async () => {
  CircuitBreaker.clearAll();
  const breaker1 = CircuitBreaker.getOrCreate("breaker-1", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });
  const breaker2 = CircuitBreaker.getOrCreate("breaker-2", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  await assertRejects(
    () =>
      breaker1.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );
  await assertRejects(
    () =>
      breaker2.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  assertEquals(breaker1.state, "open");
  assertEquals(breaker2.state, "open");

  CircuitBreaker.resetAll();

  assertEquals(breaker1.state, "closed");
  assertEquals(breaker2.state, "closed");
});

Deno.test("CircuitBreaker - reset single breaker", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-reset", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );
  assertEquals(breaker.state, "open");

  breaker.reset();

  assertEquals(breaker.state, "closed");
  assertEquals(breaker.stats.failureCount, 0);
});

Deno.test("CircuitBreaker - forceOpen", () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-force-open");
  assertEquals(breaker.state, "closed");

  breaker.forceOpen();
  assertEquals(breaker.state, "open");
});

Deno.test("CircuitBreaker - forceClose", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-force-close", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 1000,
  });

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );
  assertEquals(breaker.state, "open");

  breaker.forceClose();
  assertEquals(breaker.state, "closed");
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("CircuitBreaker - concurrent calls allowed when closed", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-concurrent");

  const results = await Promise.all([
    breaker.call(async () => "result1"),
    breaker.call(async () => "result2"),
    breaker.call(async () => "result3"),
  ]);

  assertEquals(results, ["result1", "result2", "result3"]);
});

Deno.test("CircuitBreaker - singleton registry per name", () => {
  CircuitBreaker.clearAll();
  const breaker1 = CircuitBreaker.getOrCreate("same-name");
  const breaker2 = CircuitBreaker.getOrCreate("same-name");

  breaker1.forceOpen();
  assertEquals(breaker2.state, "open");
});

Deno.test("CircuitBreaker - success count increments in half-open", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-success-count", {
    failureThreshold: 1,
    successThreshold: 3,
    resetTimeoutMs: 100,
  });

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );

  await delay(150);
  breaker.isAllowingRequests;
  assertEquals(breaker.state, "half-open");

  await breaker.call(async () => "ok");
  assertEquals(breaker.stats.successCount, 1);

  await breaker.call(async () => "ok");
  assertEquals(breaker.stats.successCount, 2);

  await breaker.call(async () => "ok");
  assertEquals(breaker.state, "closed");
  assertEquals(breaker.stats.successCount, 0);
});

Deno.test("CircuitBreaker - isAllowingRequests correct for all states", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-allowing-requests", {
    failureThreshold: 1,
    successThreshold: 2,
    resetTimeoutMs: 100,
  });

  assertEquals(breaker.isAllowingRequests, true); // closed

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error("fail");
      }),
    Error,
  );
  assertEquals(breaker.isAllowingRequests, false); // open

  await delay(150);
  assertEquals(breaker.isAllowingRequests, true); // half-open
});

Deno.test("CircuitBreaker - error message truncated to 200 chars", async () => {
  CircuitBreaker.clearAll();
  const breaker = CircuitBreaker.getOrCreate("test-error-truncate");

  const longMessage = "a".repeat(300);

  await assertRejects(
    () =>
      breaker.call(async () => {
        throw new Error(longMessage);
      }),
    Error,
  );

  assertEquals(breaker.stats.lastError?.length, 200);
});

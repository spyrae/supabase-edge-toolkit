// deno-lint-ignore-file require-await
import { assert, assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert/rejects";

import {
  calculateRetryDelay,
  createRetryWrapper,
  isRetryableError,
  RETRY_CONFIGS,
  RetryError,
  withRetry,
} from "./retry.ts";

import type { RetryConfig } from "./types.ts";

// =============================================================================
// withRetry Tests
// =============================================================================

Deno.test("withRetry - success on first attempt", async () => {
  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });

  assertEquals(result, "ok");
  assertEquals(callCount, 1);
});

Deno.test("withRetry - success after 2 retries", async () => {
  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    if (callCount < 3) {
      const error = new Error("Temporary failure") as Error & {
        statusCode: number;
      };
      error.statusCode = 503;
      throw error;
    }
    return "success";
  }, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });

  assertEquals(result, "success");
  assertEquals(callCount, 3);
});

Deno.test("withRetry - all retries fail throws RetryError", async () => {
  let callCount = 0;
  await assertRejects(
    async () => {
      await withRetry(async () => {
        callCount++;
        const err = new Error("Persistent failure") as Error & {
          statusCode: number;
        };
        err.statusCode = 500;
        throw err;
      }, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    },
    RetryError,
    "Operation failed after 3 attempts",
  );

  assertEquals(callCount, 3);
});

Deno.test("withRetry - non-retryable error fails immediately", async () => {
  let callCount = 0;
  await assertRejects(
    async () => {
      await withRetry(async () => {
        callCount++;
        const err = new Error("Not found") as Error & { statusCode: number };
        err.statusCode = 404;
        throw err;
      }, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    },
    RetryError,
  );

  assertEquals(callCount, 1, "Should fail immediately on non-retryable error");
});

Deno.test("withRetry - onRetry callback called with correct context", async () => {
  const retryContexts: Array<{ attempt: number; maxAttempts: number }> = [];
  let callCount = 0;

  await assertRejects(
    async () => {
      await withRetry(
        async () => {
          callCount++;
          const err = new Error("Fail") as Error & { statusCode: number };
          err.statusCode = 503;
          throw err;
        },
        { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
        (ctx) => {
          retryContexts.push({
            attempt: ctx.attempt,
            maxAttempts: ctx.maxAttempts,
          });
        },
      );
    },
    RetryError,
  );

  assertEquals(
    retryContexts.length,
    2,
    "Should call onRetry twice (before retry 2 and 3)",
  );
  assertEquals(retryContexts[0].attempt, 1);
  assertEquals(retryContexts[1].attempt, 2);
});

Deno.test("withRetry - uses default config if not provided", async () => {
  const result = await withRetry(async () => "ok");
  assertEquals(result, "ok");
});

// =============================================================================
// calculateRetryDelay Tests
// =============================================================================

Deno.test("calculateRetryDelay - exponential growth without jitter", () => {
  const config: RetryConfig = {
    maxAttempts: 5,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitter: false,
  };

  assertEquals(calculateRetryDelay(1, config), 100);
  assertEquals(calculateRetryDelay(2, config), 200);
  assertEquals(calculateRetryDelay(3, config), 400);
});

Deno.test("calculateRetryDelay - jitter range", () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitter: true,
  };

  for (let i = 0; i < 10; i++) {
    const d = calculateRetryDelay(1, config);
    assert(d >= 500 && d <= 1500, `Delay ${d} should be in range [500, 1500]`);
  }
});

Deno.test("calculateRetryDelay - maxDelayMs cap enforced", () => {
  const config: RetryConfig = {
    maxAttempts: 10,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitter: false,
  };

  const d = calculateRetryDelay(10, config);
  assertEquals(d, 5000);
});

Deno.test("calculateRetryDelay - custom backoffMultiplier", () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    backoffMultiplier: 3,
    jitter: false,
  };

  assertEquals(calculateRetryDelay(1, config), 100);
  assertEquals(calculateRetryDelay(2, config), 300);
});

Deno.test("calculateRetryDelay - default multiplier is 2", () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    jitter: false,
  };

  assertEquals(calculateRetryDelay(2, config), 200);
});

// =============================================================================
// isRetryableError Tests
// =============================================================================

Deno.test("isRetryableError - 429 is retryable", () => {
  const error = new Error("Rate limited") as Error & { statusCode: number };
  error.statusCode = 429;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - 500 is retryable", () => {
  const error = new Error("Server error") as Error & { statusCode: number };
  error.statusCode = 500;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - 503 is retryable", () => {
  const error = new Error("Service unavailable") as Error & {
    statusCode: number;
  };
  error.statusCode = 503;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - 400 is not retryable", () => {
  const error = new Error("Bad request") as Error & { statusCode: number };
  error.statusCode = 400;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(!isRetryableError(error, config));
});

Deno.test("isRetryableError - 404 is not retryable", () => {
  const error = new Error("Not found") as Error & { statusCode: number };
  error.statusCode = 404;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(!isRetryableError(error, config));
});

Deno.test("isRetryableError - custom isRetryable property true", () => {
  const error = new Error("Custom retryable") as Error & {
    isRetryable: boolean;
  };
  error.isRetryable = true;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - custom isRetryable property false", () => {
  const error = new Error("Custom non-retryable") as Error & {
    isRetryable: boolean;
  };
  error.isRetryable = false;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(!isRetryableError(error, config));
});

Deno.test("isRetryableError - status property checked", () => {
  const error = new Error("Error") as Error & { status: number };
  error.status = 503;
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - TimeoutError name is retryable", () => {
  const error = new Error("Timeout");
  error.name = "TimeoutError";
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - message pattern matching timeout", () => {
  const error = new Error("Request timed out after 5000ms");
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - message pattern matching rate limit", () => {
  const error = new Error("Too many requests, please slow down");
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(isRetryableError(error, config));
});

Deno.test("isRetryableError - non-Error objects are not retryable", () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
  };
  assert(!isRetryableError("Just a string", config));
});

// =============================================================================
// RetryError Tests
// =============================================================================

Deno.test("RetryError - contains lastError and attempts count", () => {
  const original = new Error("Original error");
  const retryError = new RetryError("Failed after 3 attempts", 3, original);

  assertEquals(retryError.attempts, 3);
  assertEquals(retryError.lastError, original);
  assertEquals(retryError.code, "RETRY_EXHAUSTED");
  assertEquals(retryError.name, "RetryError");
});

Deno.test("RetryError - isRetryable is false", () => {
  const retryError = new RetryError("Failed", 3, new Error("Original"));
  assertEquals(retryError.isRetryable, false);
});

Deno.test("RetryError - toString includes attempts", () => {
  const retryError = new RetryError(
    "Operation failed",
    5,
    new Error("Original"),
  );
  const str = retryError.toString();
  assert(str.includes("RetryError"));
  assert(str.includes("Operation failed"));
  assert(str.includes("5 attempts"));
});

// =============================================================================
// createRetryWrapper Tests
// =============================================================================

Deno.test("createRetryWrapper - returns pre-configured function", async () => {
  const config: RetryConfig = {
    maxAttempts: 2,
    baseDelayMs: 10,
    maxDelayMs: 100,
    jitter: false,
  };
  const retry = createRetryWrapper(config);

  let callCount = 0;
  const result = await retry(async () => {
    callCount++;
    return "ok";
  });

  assertEquals(result, "ok");
  assertEquals(callCount, 1);
});

Deno.test("createRetryWrapper - pre-configured retries work", async () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    jitter: false,
  };
  const retry = createRetryWrapper(config);

  let callCount = 0;
  const result = await retry(async () => {
    callCount++;
    if (callCount < 2) {
      const err = new Error("Fail") as Error & { statusCode: number };
      err.statusCode = 503;
      throw err;
    }
    return "success";
  });

  assertEquals(result, "success");
  assertEquals(callCount, 2);
});

// =============================================================================
// RETRY_CONFIGS Tests
// =============================================================================

Deno.test("RETRY_CONFIGS - EXTERNAL_API valid", () => {
  const config = RETRY_CONFIGS.EXTERNAL_API;
  assert(config.maxAttempts > 0);
  assert(config.baseDelayMs > 0);
  assert(config.maxDelayMs >= config.baseDelayMs);
});

Deno.test("RETRY_CONFIGS - LLM valid", () => {
  const config = RETRY_CONFIGS.LLM;
  assert(config.maxAttempts > 0);
  assert(config.baseDelayMs > 0);
  assert(config.maxDelayMs >= config.baseDelayMs);
});

Deno.test("RETRY_CONFIGS - CRITICAL valid", () => {
  const config = RETRY_CONFIGS.CRITICAL;
  assert(config.maxAttempts > 0);
  assert(config.baseDelayMs > 0);
  assert(config.maxDelayMs >= config.baseDelayMs);
});

Deno.test("RETRY_CONFIGS - AGGRESSIVE valid", () => {
  const config = RETRY_CONFIGS.AGGRESSIVE;
  assert(config.maxAttempts > 0);
  assert(config.baseDelayMs > 0);
  assert(config.maxDelayMs >= config.baseDelayMs);
});

Deno.test("RETRY_CONFIGS - all configs have required fields", () => {
  for (const [name, config] of Object.entries(RETRY_CONFIGS)) {
    assert(config.maxAttempts !== undefined, `${name} missing maxAttempts`);
    assert(config.baseDelayMs !== undefined, `${name} missing baseDelayMs`);
    assert(config.maxDelayMs !== undefined, `${name} missing maxDelayMs`);
  }
});

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test("integration - retry with exponential backoff timing", async () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 50,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitter: false,
  };

  const startTime = Date.now();
  let callCount = 0;

  await assertRejects(
    async () => {
      await withRetry(async () => {
        callCount++;
        const err = new Error("Fail") as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }, config);
    },
    RetryError,
  );

  const elapsed = Date.now() - startTime;

  // Expected delays: 50 (after attempt 1) + 100 (after attempt 2) = 150ms minimum
  assert(elapsed >= 150, `Expected at least 150ms, got ${elapsed}ms`);
  assertEquals(callCount, 3);
});

Deno.test("integration - custom retryableErrorCodes", async () => {
  const config: RetryConfig = {
    maxAttempts: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    retryableErrorCodes: ["CUSTOM_TIMEOUT", "CUSTOM_RETRY"],
  };

  let callCount = 0;
  const result = await withRetry(async () => {
    callCount++;
    if (callCount < 2) {
      const err = new Error("Fail") as Error & { code: string };
      err.code = "CUSTOM_TIMEOUT";
      throw err;
    }
    return "ok";
  }, config);

  assertEquals(result, "ok");
  assertEquals(callCount, 2);
});

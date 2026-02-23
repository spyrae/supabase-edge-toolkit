import { assert, assertEquals, assertExists } from "@std/assert";
import {
  createLogger,
  generateRequestId,
  getRequestId,
  logRequestEnd,
  logRequestStart,
} from "./mod.ts";

// =============================================================================
// generateRequestId
// =============================================================================

Deno.test("generateRequestId - returns UUID format", () => {
  const id = generateRequestId();
  assertExists(id);
  assert(id.length > 0);
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      id,
    ),
  );
});

Deno.test("generateRequestId - returns unique IDs", () => {
  const id1 = generateRequestId();
  const id2 = generateRequestId();
  assert(id1 !== id2, "IDs should be unique");
});

// =============================================================================
// getRequestId
// =============================================================================

Deno.test("getRequestId - extracts x-request-id header", () => {
  const req = new Request("https://example.com", {
    headers: { "x-request-id": "custom-id-123" },
  });
  assertEquals(getRequestId(req), "custom-id-123");
});

Deno.test("getRequestId - extracts x-correlation-id header", () => {
  const req = new Request("https://example.com", {
    headers: { "x-correlation-id": "corr-456" },
  });
  assertEquals(getRequestId(req), "corr-456");
});

Deno.test("getRequestId - prefers x-request-id over x-correlation-id", () => {
  const req = new Request("https://example.com", {
    headers: {
      "x-request-id": "req-id",
      "x-correlation-id": "corr-id",
    },
  });
  assertEquals(getRequestId(req), "req-id");
});

Deno.test("getRequestId - generates UUID when no headers", () => {
  const req = new Request("https://example.com");
  const id = getRequestId(req);
  assertExists(id);
  assert(id.length > 0);
});

// =============================================================================
// createLogger
// =============================================================================

Deno.test("createLogger - returns logger with all methods", () => {
  const logger = createLogger("test-fn", "req-1");
  assertExists(logger.debug);
  assertExists(logger.info);
  assertExists(logger.warn);
  assertExists(logger.error);
  assertExists(logger.startTimer);
  assertExists(logger.child);
});

Deno.test("createLogger - info logs structured JSON", () => {
  const logs: string[] = [];
  const origLog = console.log;
  // deno-lint-ignore no-explicit-any
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("my-function", "req-123");
    logger.info("Test message", { key: "value" });

    assertEquals(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "info");
    assertEquals(entry.function_name, "my-function");
    assertEquals(entry.request_id, "req-123");
    assertEquals(entry.message, "Test message");
    assertEquals(entry.context.key, "value");
    assertExists(entry.timestamp);
  } finally {
    console.log = origLog;
  }
});

Deno.test("createLogger - error logs with error details", () => {
  const logs: string[] = [];
  const origError = console.error;
  // deno-lint-ignore no-explicit-any
  console.error = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    const err = new Error("Something failed");
    logger.error("Failed", err, { extra: "data" });

    assertEquals(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "error");
    assertEquals(entry.message, "Failed");
    assertEquals(entry.error.name, "Error");
    assertEquals(entry.error.message, "Something failed");
  } finally {
    console.error = origError;
  }
});

Deno.test("createLogger - warn logs to console.warn", () => {
  const logs: string[] = [];
  const origWarn = console.warn;
  // deno-lint-ignore no-explicit-any
  console.warn = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    logger.warn("Warning message");

    assertEquals(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "warn");
    assertEquals(entry.message, "Warning message");
  } finally {
    console.warn = origWarn;
  }
});

Deno.test("createLogger - child logger inherits context", () => {
  const logs: string[] = [];
  const origLog = console.log;
  // deno-lint-ignore no-explicit-any
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1", { base: "ctx" });
    const child = logger.child({ child_key: "child_val" });
    child.info("Child message");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context.base, "ctx");
    assertEquals(entry.context.child_key, "child_val");
  } finally {
    console.log = origLog;
  }
});

// =============================================================================
// startTimer
// =============================================================================

Deno.test("createLogger - startTimer tracks duration", async () => {
  const logs: string[] = [];
  const origLog = console.log;
  // deno-lint-ignore no-explicit-any
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    const timer = logger.startTimer("llm_call");

    await new Promise((r) => setTimeout(r, 10));
    timer.end({ tokens: 150 });

    const entry = JSON.parse(logs[0]);
    assert(entry.message.includes("llm_call"));
    assertExists(entry.duration_ms);
    assert(entry.duration_ms >= 0);
    assertEquals(entry.context.tokens, 150);
  } finally {
    console.log = origLog;
  }
});

Deno.test("createLogger - timer elapsed returns ms", async () => {
  const logger = createLogger("fn", "r1");
  const timer = logger.startTimer("op");
  await new Promise((r) => setTimeout(r, 10));
  const elapsed = timer.elapsed();
  assert(elapsed >= 0);
});

// =============================================================================
// logRequestStart / logRequestEnd
// =============================================================================

Deno.test("logRequestStart - logs method, path, query", () => {
  const logs: string[] = [];
  const origLog = console.log;
  // deno-lint-ignore no-explicit-any
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    const req = new Request("https://example.com/api/test?foo=bar", {
      method: "POST",
    });
    logRequestStart(logger, req);

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "Request received");
    assertEquals(entry.context.method, "POST");
    assertEquals(entry.context.path, "/api/test");
    assertEquals(entry.context.query.foo, "bar");
  } finally {
    console.log = origLog;
  }
});

Deno.test("logRequestEnd - 200 logs as info", () => {
  const logs: string[] = [];
  const origLog = console.log;
  // deno-lint-ignore no-explicit-any
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    logRequestEnd(logger, 200, 50);

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "info");
    assertEquals(entry.message, "Request completed");
    assertEquals(entry.context.status, 200);
    assertEquals(entry.context.duration_ms, 50);
  } finally {
    console.log = origLog;
  }
});

Deno.test("logRequestEnd - 400 logs as warn", () => {
  const logs: string[] = [];
  const origWarn = console.warn;
  // deno-lint-ignore no-explicit-any
  console.warn = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    logRequestEnd(logger, 400, 30);

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "warn");
    assertEquals(entry.message, "Request failed");
  } finally {
    console.warn = origWarn;
  }
});

Deno.test("logRequestEnd - 500 logs as error", () => {
  const logs: string[] = [];
  const origError = console.error;
  // deno-lint-ignore no-explicit-any
  console.error = (...args: any[]) => logs.push(args.join(" "));

  try {
    const logger = createLogger("fn", "r1");
    logRequestEnd(logger, 500, 100);

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "error");
    assertEquals(entry.message, "Request failed");
  } finally {
    console.error = origError;
  }
});

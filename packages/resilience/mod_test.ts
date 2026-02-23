// deno-lint-ignore-file require-await
/**
 * Tests for resilientFetch and createResilientFetch
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { assertRejects } from "@std/assert/rejects";

import {
  CIRCUIT_BREAKER_CONFIGS,
  CircuitBreaker,
  CircuitBreakerOpenError,
  createResilientFetch,
  resilientFetch,
  RETRY_CONFIGS,
} from "./mod.ts";

// =============================================================================
// Helpers
// =============================================================================

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function createMockFetch(
  responses: Array<Response | Error>,
): typeof globalThis.fetch {
  let callCount = 0;
  return async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const response = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
}

function createResponse(status: number, body = "ok"): Response {
  return new Response(body, { status });
}

function resetCircuitBreakers(): void {
  CircuitBreaker.clearAll();
}

// =============================================================================
// resilientFetch Basic Tests
// =============================================================================

Deno.test("resilientFetch - success without retries", async () => {
  globalThis.fetch = createMockFetch([createResponse(200, "success")]);

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "test-api",
      timeout: 5000,
      retry: false,
      circuitBreaker: false,
    });

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "success");
  } finally {
    restoreFetch();
  }
});

Deno.test("resilientFetch - retry on 5xx errors", async () => {
  let callCount = 0;
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount < 2) {
      return createResponse(503, "Service Unavailable");
    }
    return createResponse(200, "ok");
  };

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "test-api",
      timeout: 5000,
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
      circuitBreaker: false,
    });

    assertEquals(response.status, 200);
    assertEquals(callCount, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test("resilientFetch - circuit opens after failures", async () => {
  resetCircuitBreakers();

  globalThis.fetch = createMockFetch([
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(500),
  ]);

  const config = {
    serviceName: "failing-api",
    timeout: 5000,
    retry: false as const,
    circuitBreaker: {
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeoutMs: 100,
    },
  };

  try {
    for (let i = 0; i < 3; i++) {
      try {
        await resilientFetch("https://api.example.com/data", {}, config);
      } catch (_error) {
        // Expected
      }
    }

    await assertRejects(
      async () => {
        await resilientFetch("https://api.example.com/data", {}, config);
      },
      CircuitBreakerOpenError,
    );
  } finally {
    restoreFetch();
    resetCircuitBreakers();
  }
});

Deno.test("resilientFetch - 4xx errors do not count as circuit failures", async () => {
  resetCircuitBreakers();

  globalThis.fetch = createMockFetch([
    createResponse(404),
    createResponse(400),
    createResponse(403),
    createResponse(200),
  ]);

  const config = {
    serviceName: "test-4xx",
    timeout: 5000,
    retry: false as const,
    circuitBreaker: {
      failureThreshold: 2,
      successThreshold: 1,
      resetTimeoutMs: 100,
    },
  };

  try {
    const response1 = await resilientFetch(
      "https://api.example.com/data",
      {},
      config,
    );
    assertEquals(response1.status, 404);

    const response2 = await resilientFetch(
      "https://api.example.com/data",
      {},
      config,
    );
    assertEquals(response2.status, 400);

    const response3 = await resilientFetch(
      "https://api.example.com/data",
      {},
      config,
    );
    assertEquals(response3.status, 403);

    const response4 = await resilientFetch(
      "https://api.example.com/data",
      {},
      config,
    );
    assertEquals(response4.status, 200);
  } finally {
    restoreFetch();
    resetCircuitBreakers();
  }
});

// =============================================================================
// Combined Scenarios
// =============================================================================

Deno.test("combined - timeout triggers retry then success", async () => {
  let callCount = 0;
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount < 2) {
      const error = new Error("Request timeout");
      error.name = "TimeoutError";
      throw error;
    }
    return createResponse(200, "ok");
  };

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "test-timeout-retry",
      timeout: 50,
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
      circuitBreaker: false,
    });

    assertEquals(response.status, 200);
    assert(callCount >= 2, "Should have retried after timeout");
  } finally {
    restoreFetch();
  }
});

// =============================================================================
// Configuration Tests
// =============================================================================

Deno.test("config - disabled circuit breaker", async () => {
  globalThis.fetch = createMockFetch([
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(200),
  ]);

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "no-circuit",
      timeout: 5000,
      retry: { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 100 },
      circuitBreaker: false,
    });

    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

Deno.test("config - disabled retry", async () => {
  let callCount = 0;
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount < 2) {
      return createResponse(503);
    }
    return createResponse(200);
  };

  try {
    try {
      await resilientFetch("https://api.example.com/data", {}, {
        serviceName: "no-retry",
        timeout: 5000,
        retry: false,
        circuitBreaker: false,
      });
    } catch (_error) {
      assertEquals(callCount, 1, "Should not retry");
    }
  } finally {
    restoreFetch();
  }
});

Deno.test("config - uses default timeout if not specified", async () => {
  globalThis.fetch = createMockFetch([createResponse(200)]);

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "default-timeout",
    });

    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

Deno.test("config - uses custom timeout config object", async () => {
  globalThis.fetch = createMockFetch([createResponse(200)]);

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "custom-timeout",
      timeout: { timeoutMs: 3000 },
    });

    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

// =============================================================================
// createResilientFetch Tests
// =============================================================================

Deno.test("createResilientFetch - returns pre-configured function", async () => {
  globalThis.fetch = createMockFetch([createResponse(200, "ok")]);

  try {
    const apiCall = createResilientFetch("test-api", {
      timeout: 5000,
      retry: false,
      circuitBreaker: false,
    });

    const response = await apiCall("https://api.example.com/data");
    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

Deno.test("createResilientFetch - allows override config", async () => {
  globalThis.fetch = createMockFetch([createResponse(200, "ok")]);

  try {
    const apiCall = createResilientFetch("test-api", {
      timeout: 5000,
      retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
    });

    const response = await apiCall(
      "https://api.example.com/data",
      {},
      { retry: false },
    );

    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

Deno.test("createResilientFetch - serviceName is fixed", async () => {
  globalThis.fetch = createMockFetch([createResponse(200)]);

  try {
    const apiCall = createResilientFetch("fixed-service");
    const response = await apiCall("https://api.example.com/data");

    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("edge - empty config uses defaults", async () => {
  globalThis.fetch = createMockFetch([createResponse(200)]);

  try {
    const response = await resilientFetch("https://api.example.com/data");
    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

Deno.test("edge - URL object accepted", async () => {
  globalThis.fetch = createMockFetch([createResponse(200)]);

  try {
    const url = new URL("https://api.example.com/data");
    const response = await resilientFetch(url, {}, {
      circuitBreaker: false,
      retry: false,
    });

    assertEquals(response.status, 200);
  } finally {
    restoreFetch();
  }
});

Deno.test("edge - fetch init options passed through", async () => {
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedInit = init;
    return createResponse(200);
  };

  try {
    await resilientFetch("https://api.example.com/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "data" }),
    }, { circuitBreaker: false, retry: false });

    assertExists(capturedInit);
    assertEquals(capturedInit.method, "POST");
  } finally {
    restoreFetch();
  }
});

Deno.test("edge - network error triggers retry", async () => {
  let callCount = 0;
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount < 2) {
      throw new Error("Network error: connection refused");
    }
    return createResponse(200);
  };

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "network-error",
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
      circuitBreaker: false,
    });

    assertEquals(response.status, 200);
    assertEquals(callCount, 2);
  } finally {
    restoreFetch();
  }
});

// =============================================================================
// Integration with Real Configs
// =============================================================================

Deno.test("integration - RETRY_CONFIGS.EXTERNAL_API works", async () => {
  let callCount = 0;
  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    callCount++;
    if (callCount < 2) {
      return createResponse(503);
    }
    return createResponse(200);
  };

  try {
    const response = await resilientFetch("https://api.example.com/data", {}, {
      serviceName: "external-api-test",
      retry: RETRY_CONFIGS.EXTERNAL_API,
      circuitBreaker: false,
    });

    assertEquals(response.status, 200);
    assert(callCount >= 2);
  } finally {
    restoreFetch();
  }
});

Deno.test("integration - CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API works", async () => {
  resetCircuitBreakers();

  globalThis.fetch = createMockFetch([
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(500),
    createResponse(500),
  ]);

  const config = CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API;

  try {
    for (let i = 0; i < config.failureThreshold; i++) {
      try {
        await resilientFetch("https://api.example.com/data", {}, {
          serviceName: "circuit-test",
          retry: false,
          circuitBreaker: config,
        });
      } catch (_error) {
        // Expected
      }
    }

    await assertRejects(
      async () => {
        await resilientFetch("https://api.example.com/data", {}, {
          serviceName: "circuit-test",
          retry: false,
          circuitBreaker: config,
        });
      },
      CircuitBreakerOpenError,
    );
  } finally {
    restoreFetch();
    resetCircuitBreakers();
  }
});

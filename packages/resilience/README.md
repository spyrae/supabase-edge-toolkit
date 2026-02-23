# @supabase-edge-toolkit/resilience

Resilience toolkit for Supabase Edge Functions: timeout handling, circuit
breaker, and retry with exponential backoff.

## Installation

```typescript
import {
  CircuitBreaker,
  fetchWithTimeout,
  resilientFetch,
  withRetry,
  withTimeout,
} from "jsr:@supabase-edge-toolkit/resilience";
```

## Quick Start

```typescript
import { resilientFetch } from "@supabase-edge-toolkit/resilience";

const response = await resilientFetch("https://api.example.com/data", {
  method: "GET",
  headers: { "Authorization": "Bearer token" },
}, {
  serviceName: "my-api",
  timeout: 10000,
});
```

## API Reference

### Timeout

#### `withTimeout<T>(promise, timeoutMs, operation?)`

Wrap any async operation with a timeout.

```typescript
import { TimeoutError, withTimeout } from "@supabase-edge-toolkit/resilience";

try {
  const result = await withTimeout(
    externalApi.call(),
    10000,
    "external-api-call",
  );
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log(error.operation); // "external-api-call"
    console.log(error.timeoutMs); // 10000
    console.log(error.isRetryable); // true
  }
}
```

#### `fetchWithTimeout(url, options?, timeoutMs?)`

Fetch with automatic timeout via AbortController.

```typescript
const response = await fetchWithTimeout(
  "https://api.example.com/data",
  { method: "GET" },
  5000,
);
```

#### `createTimeoutController(timeoutMs)`

Create an AbortController that auto-aborts after timeout.

```typescript
const controller = createTimeoutController(5000);
const response = await fetch(url, { signal: controller.signal });
```

#### `isTimeoutError(error)`

Type guard for timeout errors (works with `TimeoutError` and `AbortError`).

#### `getDefaultTimeout(serviceType)`

Get default timeout for a service type: `EXTERNAL_API` (10s), `LLM` (60s),
`DATABASE` (5s), `FAST` (3s).

### Circuit Breaker

Protects against cascading failures by failing fast when a service is
unavailable.

```typescript
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "@supabase-edge-toolkit/resilience";

const breaker = CircuitBreaker.forExternalApi("my-service");

try {
  const result = await breaker.call(async () => {
    const response = await fetch("https://api.example.com/data");
    return response.json();
  });
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    // Circuit is open — fail fast
    console.log(error.serviceName);
    console.log(error.remainingTimeoutMs);
  }
}
```

#### States

| State         | Description                                 |
| ------------- | ------------------------------------------- |
| **closed**    | Normal operation, requests pass through     |
| **open**      | Failing fast, requests rejected immediately |
| **half-open** | Testing recovery with limited requests      |

#### Factory Methods

| Method                                      | Config                 |
| ------------------------------------------- | ---------------------- |
| `CircuitBreaker.getOrCreate(name, config?)` | Custom config          |
| `CircuitBreaker.forExternalApi(name)`       | 5 failures / 30s reset |
| `CircuitBreaker.forLLM(name)`               | 3 failures / 60s reset |
| `CircuitBreaker.forPayment(name)`           | 3 failures / 60s reset |

#### Instance Methods

| Method               | Description                                     |
| -------------------- | ----------------------------------------------- |
| `call(operation)`    | Execute with circuit breaker protection         |
| `state`              | Current state (`closed` / `open` / `half-open`) |
| `stats`              | Full stats snapshot                             |
| `isAllowingRequests` | Whether requests are allowed                    |
| `forceOpen()`        | Manually open circuit                           |
| `forceClose()`       | Manually close circuit                          |
| `reset()`            | Reset to initial state                          |

#### Static Methods

| Method          | Description                       |
| --------------- | --------------------------------- |
| `getAllStats()` | Stats for all registered breakers |
| `resetAll()`    | Reset all to closed               |
| `clearAll()`    | Remove all (for testing)          |

> **Note**: Circuit state persists within the same Deno isolate (module-level
> Map). For distributed circuit breaking, use external storage.

### Retry

Automatic retry with exponential backoff and jitter.

```typescript
import {
  RETRY_CONFIGS,
  RetryError,
  withRetry,
} from "@supabase-edge-toolkit/resilience";

try {
  const data = await withRetry(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        (error as any).statusCode = response.status;
        throw error;
      }
      return response.json();
    },
    RETRY_CONFIGS.EXTERNAL_API,
    (ctx) => console.log(`Retry ${ctx.attempt}/${ctx.maxAttempts}`),
  );
} catch (error) {
  if (error instanceof RetryError) {
    console.log(error.attempts); // total attempts made
    console.log(error.lastError); // the last error
  }
}
```

#### `withRetry<T>(operation, config?, onRetry?)`

Execute with automatic retry on transient failures.

#### `createRetryWrapper(config)`

Create a pre-configured retry function.

```typescript
const retryApi = createRetryWrapper(RETRY_CONFIGS.EXTERNAL_API);
const data = await retryApi(() => fetch(url).then((r) => r.json()));
```

#### `calculateRetryDelay(attempt, config)`

Calculate delay for a specific attempt.

#### `isRetryableError(error, config)`

Check if an error should trigger a retry. Checks:

- `statusCode` / `status` properties against `retryableStatusCodes`
- `code` property against `retryableErrorCodes`
- `isRetryable` boolean property
- Error name (`TimeoutError`, `AbortError`, `NetworkError`)
- Message patterns (timeout, rate limit, connection refused, etc.)

#### Preset Configs

| Config                       | Attempts | Base Delay | Max Delay | Jitter |
| ---------------------------- | -------- | ---------- | --------- | ------ |
| `RETRY_CONFIGS.EXTERNAL_API` | 3        | 1s         | 10s       | yes    |
| `RETRY_CONFIGS.LLM`          | 2        | 2s         | 30s       | yes    |
| `RETRY_CONFIGS.CRITICAL`     | 2        | 500ms      | 2s        | no     |
| `RETRY_CONFIGS.AGGRESSIVE`   | 5        | 500ms      | 15s       | yes    |

### Resilient Fetch

Combines timeout + circuit breaker + retry into a single fetch call.

```typescript
import {
  CIRCUIT_BREAKER_CONFIGS,
  createResilientFetch,
  resilientFetch,
  RETRY_CONFIGS,
} from "@supabase-edge-toolkit/resilience";

// One-off call
const response = await resilientFetch(url, {
  method: "GET",
  headers: { Authorization: apiKey },
}, {
  serviceName: "my-api",
  timeout: 10000,
  circuitBreaker: CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
  retry: RETRY_CONFIGS.EXTERNAL_API,
});

// Pre-configured for a service
const apiFetch = createResilientFetch("my-api", {
  timeout: 10000,
  circuitBreaker: CIRCUIT_BREAKER_CONFIGS.EXTERNAL_API,
  retry: RETRY_CONFIGS.EXTERNAL_API,
});

const response2 = await apiFetch("/v3/search", {
  headers: { Authorization: apiKey },
});
```

#### Disabling features

```typescript
// No circuit breaker
await resilientFetch(url, {}, { circuitBreaker: false });

// No retry
await resilientFetch(url, {}, { retry: false });

// Timeout only
await resilientFetch(url, {}, {
  serviceName: "simple",
  timeout: 5000,
  circuitBreaker: false,
  retry: false,
});
```

## Error Types

| Error                     | Code              | Retryable | When                          |
| ------------------------- | ----------------- | --------- | ----------------------------- |
| `TimeoutError`            | `TIMEOUT`         | yes       | Operation exceeded timeout    |
| `CircuitBreakerOpenError` | `CIRCUIT_OPEN`    | no        | Circuit is open, failing fast |
| `RetryError`              | `RETRY_EXHAUSTED` | no        | All retry attempts exhausted  |

## License

MIT

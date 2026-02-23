# @supa-edge-toolkit/logger

Structured JSON logger for Supabase Edge Functions, compatible with
Grafana/Loki.

## Installation

```typescript
import { createLogger, getRequestId } from "jsr:@supa-edge-toolkit/logger";
```

## Quick Start

```typescript
import {
  createLogger,
  getRequestId,
  logRequestEnd,
  logRequestStart,
} from "@supa-edge-toolkit/logger";

Deno.serve(async (req) => {
  const requestId = getRequestId(req);
  const logger = createLogger("my-function", requestId);
  const timer = logger.startTimer("request");

  logRequestStart(logger, req);

  try {
    // Your logic here
    logger.info("Processing", { step: "validate" });

    const result = { id: "123" };
    logRequestEnd(logger, 200, timer.elapsed());
    return new Response(JSON.stringify(result));
  } catch (error) {
    logger.error("Failed", error);
    logRequestEnd(logger, 500, timer.elapsed());
    return new Response("Error", { status: 500 });
  }
});
```

## API Reference

### `createLogger(functionName, requestId, baseContext?)`

Creates a logger instance bound to a specific function and request.

```typescript
const logger = createLogger("my-function", "req-123");
const loggerWithContext = createLogger("my-function", "req-123", {
  env: "prod",
});
```

#### Logger Methods

| Method                             | Description                                 |
| ---------------------------------- | ------------------------------------------- |
| `debug(message, context?)`         | Debug log (only in development)             |
| `info(message, context?)`          | Info log                                    |
| `warn(message, context?)`          | Warning log                                 |
| `error(message, error?, context?)` | Error log with optional Error object        |
| `startTimer(operation)`            | Start a timer, returns `Timer`              |
| `child(context)`                   | Create child logger with additional context |

### `startTimer(operation)`

Returns a `Timer` with:

- `end(context?)` — logs completion with duration
- `elapsed()` — returns elapsed ms without logging

```typescript
const timer = logger.startTimer("db_query");
const rows = await db.query("SELECT ...");
timer.end({ rows: rows.length }); // logs: "db_query completed" with duration_ms
```

### `child(context)`

Creates a child logger that inherits parent context:

```typescript
const logger = createLogger("fn", "req-1", { service: "api" });
const childLogger = logger.child({ operation: "create_user" });
childLogger.info("Starting"); // context: { service: "api", operation: "create_user" }
```

### Request Helpers

#### `getRequestId(req)`

Extracts request ID from `x-request-id` or `x-correlation-id` headers, falls
back to UUID.

#### `generateRequestId()`

Generates a new UUID v4 request ID.

#### `logRequestStart(logger, req, context?)`

Logs request received with method, path, query params, and user agent.

#### `logRequestEnd(logger, status, durationMs, context?)`

Logs request completion. Automatically selects log level based on status:

- 2xx/3xx: `info`
- 4xx: `warn`
- 5xx: `error`

## Log Output Format

All logs are JSON with consistent structure:

```json
{
  "timestamp": "2024-01-15T10:30:00.123Z",
  "level": "info",
  "function_name": "my-function",
  "request_id": "req-123",
  "message": "db_query completed",
  "context": { "rows": 42 },
  "duration_ms": 15
}
```

## Configuration

### `LOG_LEVEL` Environment Variable

Set minimum log level: `debug`, `info` (default), `warn`, `error`.

```bash
LOG_LEVEL=warn  # Only warn and error logs
```

### Development Mode

Debug logs are always shown when `DENO_DEPLOYMENT_ID` is not set (local
development). In production (Deno Deploy), debug logs follow `LOG_LEVEL`.

## License

MIT

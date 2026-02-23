# @supa-edge-toolkit/errors

Standardized error and success response handling for Supabase Edge Functions.
Zero dependencies.

## Installation

```typescript
import {
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  errorToResponse,
} from "jsr:@supa-edge-toolkit/errors";
```

## API

### Response Creators

#### `createErrorResponse(code, message, options?)`

Creates a standardized error `Response` with proper HTTP status, CORS headers,
and JSON body.

```typescript
return createErrorResponse(ErrorCodes.VALIDATION_ERROR, "Email is required");

// With details and request ID
return createErrorResponse(
  ErrorCodes.VALIDATION_MISSING_FIELD,
  "Missing required fields",
  { details: { fields: ["email"] }, requestId: "req-123" },
);
```

#### `createSuccessResponse(data, options?)`

Creates a standardized success `Response`.

```typescript
return createSuccessResponse({ user: { id: "123" } });
return createSuccessResponse({ id: "new" }, { status: 201 });
```

#### `createCorsResponse(options?)`

Creates a CORS preflight response (204).

```typescript
if (req.method === "OPTIONS") {
  return createCorsResponse();
}
```

### Error Helpers

| Helper                                             | Status | Description                       |
| -------------------------------------------------- | ------ | --------------------------------- |
| `validationError(message, fieldErrors?)`           | 400    | Validation with per-field details |
| `notFoundError(resource, id?)`                     | 404    | Resource not found                |
| `authError(message?, code?)`                       | 401    | Authentication failure            |
| `rateLimitError(message, retryAfter?, limitType?)` | 429    | Rate limiting                     |
| `internalError(requestId?, message?)`              | 500    | Internal error (masks details)    |
| `externalServiceError(serviceName)`                | 502    | External service unavailable      |
| `paymentRequiredError(message?)`                   | 402    | Payment/subscription required     |

### Exception Converter

#### `errorToResponse(error, requestId?)`

Converts any thrown error to a standardized `Response`. Handles:

- `Response` pass-through
- `AuthError` (duck-typed, from auth middleware)
- `ZodError` (duck-typed, from Zod validation)
- Timeout errors (by message or `TimeoutError` name)
- Rate limit errors (by message)
- Generic errors (returns 500 with masked details)

```typescript
try {
  const data = await fetchData();
  return createSuccessResponse(data);
} catch (error) {
  console.error("Error:", error);
  return errorToResponse(error, requestId);
}
```

### CORS Configuration

```typescript
import { corsHeaders, createCorsHeaders } from "@supa-edge-toolkit/errors";

// Default headers (origin: *, standard headers/methods)
const headers = corsHeaders;

// Custom configuration
const customHeaders = createCorsHeaders({
  origin: "https://myapp.com",
  allowHeaders: ["authorization", "content-type", "x-custom-header"],
  allowMethods: ["GET", "POST"],
});
```

### Error Codes

Organized by HTTP status category:

| Category   | Codes                                                                                                               | HTTP        |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ----------- |
| Validation | `VALIDATION_ERROR`, `VALIDATION_MISSING_FIELD`, `VALIDATION_INVALID_FORMAT`, `VALIDATION_OUT_OF_RANGE`              | 400         |
| Auth       | `AUTH_ERROR`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`, `AUTH_MISSING_TOKEN`, `AUTH_SESSION_EXPIRED`              | 401         |
| Payment    | `PAYMENT_REQUIRED`, `BUDGET_EXCEEDED`, `SUBSCRIPTION_REQUIRED`, `SUBSCRIPTION_EXPIRED`                              | 402         |
| Permission | `PERMISSION_DENIED`, `ACCESS_FORBIDDEN`, `RESOURCE_LOCKED`                                                          | 403         |
| Not Found  | `NOT_FOUND`, `USER_NOT_FOUND`, `RESOURCE_NOT_FOUND`                                                                 | 404         |
| Rate Limit | `RATE_LIMIT_EXCEEDED`, `RATE_LIMIT_RPM`, `RATE_LIMIT_TPM`, `RATE_LIMIT_DAILY`, `RATE_LIMIT_IP`                      | 429         |
| Server     | `INTERNAL_ERROR`, `DATABASE_ERROR`, `CONFIGURATION_ERROR`                                                           | 500         |
| External   | `EXTERNAL_SERVICE_ERROR`, `SERVICE_UNAVAILABLE`, `LLM_ERROR`, `LLM_TIMEOUT`, `LLM_RATE_LIMIT`, `LLM_CONTENT_FILTER` | 502/503     |
| Timeout    | `TIMEOUT_ERROR`, `REQUEST_TIMEOUT`, `UPSTREAM_TIMEOUT`                                                              | 504         |
| Network    | `NETWORK_ERROR`, `NO_INTERNET`, `CONNECTION_REFUSED`                                                                | 503         |
| Cache      | `CACHE_ERROR`, `CACHE_MISS`, `CACHE_EXPIRED`                                                                        | 500/404/410 |

### Utilities

- `isRetryable(code)` — checks if an error code represents a retryable condition
- `getDefaultRetryAfter(code)` — returns default retry-after seconds for rate
  limit codes
- `isErrorResponse(body)` — type guard for error response bodies
- `isSuccessResponse(body)` — type guard for success response bodies

### Response Format

All responses follow this format:

```json
// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "details": { "fields": { "email": "Required" } },
    "retryAfter": 60,
    "requestId": "req-123"
  }
}

// Success
{
  "success": true,
  "data": { "user": { "id": "123" } }
}
```

## License

MIT

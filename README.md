# supabase-edge-toolkit

Standard library for Supabase Edge Functions. Provides production-tested, reusable modules for error handling, validation, authentication, resilience, and logging.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@supabase-edge-toolkit/errors`](./packages/errors/) | 0.1.0 | Standardized error/success responses, CORS, error codes, exception converter |
| [`@supabase-edge-toolkit/validation`](./packages/validation/) | 0.1.0 | Schema validation with Zod, request/query/header helpers |
| `@supabase-edge-toolkit/auth` | _coming soon_ | JWT verification, auth middleware |
| `@supabase-edge-toolkit/resilience` | _coming soon_ | Retry, circuit breaker, timeout patterns |
| [`@supabase-edge-toolkit/logger`](./packages/logger/) | 0.1.0 | Structured JSON logging for edge functions |

## Quick Start

```typescript
import {
  ErrorCodes,
  createErrorResponse,
  createSuccessResponse,
  createCorsResponse,
  errorToResponse,
  validationError,
} from "jsr:@supabase-edge-toolkit/errors";

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return createCorsResponse();
  }

  try {
    const body = await req.json();

    // Validation
    if (!body.email) {
      return validationError("Missing required fields", {
        email: "Required",
      });
    }

    // Success
    return createSuccessResponse({ id: "123", email: body.email });
  } catch (error) {
    return errorToResponse(error);
  }
});
```

## Development

```bash
# Run all tests
deno task test

# Type check
deno task check

# Lint
deno task lint

# Format
deno task fmt
```

## License

MIT

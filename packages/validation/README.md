# @supa-edge-toolkit/validation

Request validation utilities for Supabase Edge Functions using
[Zod](https://zod.dev).

## Installation

```typescript
import {
  commonSchemas,
  validateRequest,
  z,
} from "jsr:@supa-edge-toolkit/validation";
```

## Quick Start

```typescript
import {
  commonSchemas,
  validateRequest,
  z,
} from "@supa-edge-toolkit/validation";
import {
  createCorsResponse,
  errorToResponse,
} from "@supa-edge-toolkit/errors";

const CreateUserSchema = z.object({
  email: commonSchemas.email,
  name: commonSchemas.requiredString("name", 100),
  age: commonSchemas.positiveInt("age"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return createCorsResponse();

  // Inline validation — no try/catch needed
  const result = await validateRequest(req, CreateUserSchema);
  if (result.error) return result.error;

  const { email, name, age } = result.data;
  // ... use validated data
});
```

## API Reference

### Request Validation

#### `validateRequest(req, schema, options?)`

Validates request JSON body against a Zod schema. Returns a `ValidationResult`
with either parsed data or an error `Response`.

```typescript
const result = await validateRequest(req, MySchema);
if (result.error) return result.error; // 400 Response with field details
const data = result.data; // Typed as z.infer<typeof MySchema>
```

#### `validateJson(req, schema, options?)`

Parses and validates JSON body, throwing on failure. Use with `errorToResponse`
in catch blocks.

```typescript
try {
  const data = await validateJson(req, MySchema);
} catch (error) {
  return errorToResponse(error, requestId);
}
```

#### `validate(data, schema, options?)`

Validates data synchronously (when you already have parsed data).

```typescript
const result = validate(someData, MySchema);
if (result.error) return result.error;
```

### Request Helpers

#### `validateQueryParams(req, schema, options?)`

Extracts and validates URL query parameters. Use `z.coerce` for type conversion.

```typescript
const params = validateQueryParams(
  req,
  z.object({
    page: z.coerce.number().default(1),
    search: z.string().optional(),
  }),
);
if (params.error) return params.error;
```

#### `validateAuthHeader(req, options?)`

Validates that a Bearer token is present in the Authorization header.

```typescript
const auth = validateAuthHeader(req);
if (auth.error) return auth.error;
const token = auth.token; // string
```

#### `validateMethod(req, allowedMethods, options?)`

Validates the HTTP method. Returns `null` if allowed, or a 405 `Response`.

```typescript
const methodError = validateMethod(req, ["POST", "PUT"]);
if (methodError) return methodError;
```

### Common Schema Builders

Pre-built Zod schemas for common validations:

| Schema                                                | Description                     |
| ----------------------------------------------------- | ------------------------------- |
| `commonSchemas.uuid(fieldName?)`                      | UUID string                     |
| `commonSchemas.email`                                 | Email string                    |
| `commonSchemas.requiredString(fieldName, maxLength?)` | Non-empty string                |
| `commonSchemas.positiveInt(fieldName?)`               | Positive integer                |
| `commonSchemas.nonNegativeInt(fieldName?)`            | Non-negative integer (0+)       |
| `commonSchemas.latitude`                              | Number -90 to 90                |
| `commonSchemas.longitude`                             | Number -180 to 180              |
| `commonSchemas.coordinates`                           | `{ lat, lng }` object           |
| `commonSchemas.pagination`                            | `{ page, limit }` with defaults |
| `commonSchemas.optionalPagination`                    | Optional pagination             |
| `commonSchemas.isoDate`                               | ISO 8601 datetime string        |
| `commonSchemas.dateString`                            | YYYY-MM-DD date string          |

### Error Conversion

#### `zodErrorToFieldErrors(error)`

Converts a `ZodError` into a flat `Record<string, string>` map of field errors.

```typescript
// { email: "Invalid email format", "user.name": "Required" }
```

### Options

All validation functions accept an options object:

```typescript
interface ValidateRequestOptions {
  requestId?: string; // Included in error response for tracing
  errorMessage?: string; // Custom error message (default: "Validation failed")
  strict?: boolean; // Reject extra fields (default: false)
}
```

### Re-exports

This package re-exports `z`, `ZodError`, and `ZodSchema` from Zod for
convenience:

```typescript
import { z, ZodError } from "@supa-edge-toolkit/validation";
```

## License

MIT

# @supabase-edge-toolkit/auth

JWT auth middleware for Supabase Edge Functions with cached CryptoKey and secure
test mode.

## Installation

```typescript
import {
  AuthError,
  verifyCronSecret,
  verifyServiceRole,
  verifyUserToken,
} from "jsr:@supabase-edge-toolkit/auth";
```

## Quick Start

```typescript
import { AuthError, verifyUserToken } from "@supabase-edge-toolkit/auth";

Deno.serve(async (req) => {
  try {
    const { userId, role } = await verifyUserToken(req);
    return new Response(JSON.stringify({ userId, role }));
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(
        JSON.stringify({ error: error.code, message: error.message }),
        { status: error.statusCode },
      );
    }
    throw error;
  }
});
```

## Environment Variables

| Variable              | Required | Description                         |
| --------------------- | -------- | ----------------------------------- |
| `SUPABASE_JWT_SECRET` | yes      | JWT secret for token verification   |
| `JWT_SECRET`          | fallback | Alternative name for the JWT secret |
| `CRON_SECRET`         | optional | Shared secret for cron job auth     |
| `ENVIRONMENT`         | optional | Set to `development` for test mode  |

## API Reference

### `verifyUserToken(req, options?)`

Verify user JWT and extract userId from the `sub` claim.

```typescript
const { userId, role, payload } = await verifyUserToken(req);
```

**Options:**

| Option          | Type    | Default | Description                               |
| --------------- | ------- | ------- | ----------------------------------------- |
| `allowTestMode` | boolean | false   | Enable test mode impersonation (dev only) |

### `verifyServiceRole(req)`

Verify that the request carries a valid `service_role` JWT. Use for internal
functions.

```typescript
await verifyServiceRole(req);
// Authorized as service_role
```

### `verifyCronSecret(req)`

Verify cron job requests. Checks `CRON_SECRET` first, falls back to
`service_role` JWT.

```typescript
await verifyCronSecret(req);
// Authorized as cron job
```

### `extractBearerToken(req)`

Extract the Bearer token string from the Authorization header.

```typescript
const token = extractBearerToken(req);
```

### `AuthError`

Error class thrown by all auth functions.

```typescript
try {
  await verifyUserToken(req);
} catch (error) {
  if (error instanceof AuthError) {
    console.log(error.code); // e.g. "INVALID_TOKEN"
    console.log(error.statusCode); // e.g. 401
    console.log(error.message); // Human-readable message
  }
}
```

### Error Codes

| Code                  | Status | When                                    |
| --------------------- | ------ | --------------------------------------- |
| `MISSING_AUTH_HEADER` | 401    | No Authorization header                 |
| `INVALID_AUTH_HEADER` | 401    | Not Bearer format                       |
| `INVALID_TOKEN`       | 401    | Bad signature or malformed JWT          |
| `TOKEN_EXPIRED`       | 401    | JWT has expired                         |
| `MISSING_SUB_CLAIM`   | 401    | JWT has no `sub` claim                  |
| `NOT_SERVICE_ROLE`    | 403    | JWT role is not `service_role`          |
| `MISSING_CRON_SECRET` | 403    | CRON_SECRET not set and no service_role |
| `INVALID_CRON_SECRET` | 403    | Wrong cron secret and no service_role   |
| `MISSING_JWT_SECRET`  | 500    | SUPABASE_JWT_SECRET not configured      |

## Test Mode

Secure user impersonation for development testing.

```typescript
// Only works when ENVIRONMENT === 'development'
const { userId } = await verifyUserToken(req, { allowTestMode: true });
```

**Requirements:**

1. `ENVIRONMENT` must be `development`
2. Request must have a valid `service_role` JWT
3. Request must include `X-Test-User-Id` header

```bash
# Example curl
curl -H "Authorization: Bearer <service_role_jwt>" \
     -H "X-Test-User-Id: user-to-impersonate" \
     https://localhost:54321/functions/v1/my-function
```

### Test Mode API

| Function                | Returns                 |
| ----------------------- | ----------------------- |
| `isTestModeAvailable()` | `boolean` — true if dev |
| `tryTestMode(req)`      | `AuthResult \| null`    |

## CryptoKey Caching

The JWT verification key is cached at module level (per Deno isolate). The cache
auto-invalidates when `SUPABASE_JWT_SECRET` changes. This avoids re-importing
the key on every request.

## License

MIT

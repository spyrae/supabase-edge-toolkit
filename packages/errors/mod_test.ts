import { assertEquals, assertExists } from "@std/assert";

import {
  authError,
  corsHeaders,
  createCorsHeaders,
  createCorsResponse,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  errorToResponse,
  getDefaultRetryAfter,
  internalError,
  isErrorResponse,
  isRetryable,
  isSuccessResponse,
  notFoundError,
  paymentRequiredError,
  rateLimitError,
  validationError,
} from "./mod.ts";

// =============================================================================
// createErrorResponse Tests
// =============================================================================

Deno.test("createErrorResponse - basic validation error", async () => {
  const response = createErrorResponse(
    ErrorCodes.VALIDATION_ERROR,
    "Email is required",
  );

  assertEquals(response.status, 400);
  const body = await response.json();

  assertEquals(body.success, false);
  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(body.error.message, "Email is required");
});

Deno.test("createErrorResponse - not found error", async () => {
  const response = createErrorResponse(ErrorCodes.NOT_FOUND, "User not found");

  assertEquals(response.status, 404);
  const body = await response.json();

  assertEquals(body.success, false);
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("createErrorResponse - rate limit with retry-after", async () => {
  const response = createErrorResponse(
    ErrorCodes.RATE_LIMIT_EXCEEDED,
    "Too many requests",
    { retryAfter: 60 },
  );

  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "60");

  const body = await response.json();
  assertEquals(body.error.retryAfter, 60);
});

Deno.test("createErrorResponse - with details", async () => {
  const response = createErrorResponse(
    ErrorCodes.VALIDATION_MISSING_FIELD,
    "Missing fields",
    { details: { fields: ["email", "name"] } },
  );

  const body = await response.json();
  assertEquals(body.error.details, { fields: ["email", "name"] });
});

Deno.test("createErrorResponse - includes CORS headers", () => {
  const response = createErrorResponse(ErrorCodes.INTERNAL_ERROR, "Error");

  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertExists(response.headers.get("Access-Control-Allow-Headers"));
});

Deno.test("createErrorResponse - with requestId", async () => {
  const response = createErrorResponse(
    ErrorCodes.INTERNAL_ERROR,
    "Error",
    { requestId: "req-abc" },
  );

  const body = await response.json();
  assertEquals(body.error.requestId, "req-abc");
});

// =============================================================================
// createSuccessResponse Tests
// =============================================================================

Deno.test("createSuccessResponse - basic response", async () => {
  const response = createSuccessResponse({ user: { id: "123" } });

  assertEquals(response.status, 200);
  const body = await response.json();

  assertEquals(body.success, true);
  assertEquals(body.data, { user: { id: "123" } });
});

Deno.test("createSuccessResponse - custom status", async () => {
  const response = createSuccessResponse({ id: "new-123" }, { status: 201 });
  assertEquals(response.status, 201);

  const body = await response.json();
  assertEquals(body.success, true);
});

// =============================================================================
// CORS Tests
// =============================================================================

Deno.test("corsHeaders - has required headers", () => {
  assertEquals(corsHeaders["Access-Control-Allow-Origin"], "*");
  assertExists(corsHeaders["Access-Control-Allow-Headers"]);
  assertExists(corsHeaders["Access-Control-Allow-Methods"]);
});

Deno.test("createCorsHeaders - default options", () => {
  const headers = createCorsHeaders();

  assertEquals(headers["Access-Control-Allow-Origin"], "*");
  assertEquals(
    headers["Access-Control-Allow-Methods"],
    "POST, GET, OPTIONS, PUT, DELETE",
  );
});

Deno.test("createCorsHeaders - custom origin", () => {
  const headers = createCorsHeaders({ origin: "https://example.com" });
  assertEquals(headers["Access-Control-Allow-Origin"], "https://example.com");
});

Deno.test("createCorsHeaders - custom headers and methods", () => {
  const headers = createCorsHeaders({
    allowHeaders: ["authorization", "content-type", "x-custom"],
    allowMethods: ["GET", "POST"],
  });

  assertEquals(
    headers["Access-Control-Allow-Headers"],
    "authorization, content-type, x-custom",
  );
  assertEquals(headers["Access-Control-Allow-Methods"], "GET, POST");
});

Deno.test("createCorsResponse - returns 204 with CORS headers", () => {
  const response = createCorsResponse();

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "POST, GET, OPTIONS, PUT, DELETE",
  );
});

Deno.test("createCorsResponse - with custom options", () => {
  const response = createCorsResponse({ origin: "https://app.example.com" });

  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://app.example.com",
  );
});

// =============================================================================
// Error Helper Tests
// =============================================================================

Deno.test("validationError - with field errors", async () => {
  const response = validationError("Invalid input", {
    email: "Invalid format",
    age: "Must be positive",
  });

  assertEquals(response.status, 400);
  const body = await response.json();

  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(body.error.details, {
    fields: {
      email: "Invalid format",
      age: "Must be positive",
    },
  });
});

Deno.test("validationError - without field errors", async () => {
  const response = validationError("Invalid input");

  const body = await response.json();
  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(body.error.details, undefined);
});

Deno.test("notFoundError - with id", async () => {
  const response = notFoundError("User", "user-123");

  assertEquals(response.status, 404);
  const body = await response.json();

  assertEquals(body.error.code, "NOT_FOUND");
  assertEquals(body.error.message, "User with id 'user-123' not found");
});

Deno.test("notFoundError - without id", async () => {
  const response = notFoundError("Resources");

  const body = await response.json();
  assertEquals(body.error.message, "Resources not found");
});

Deno.test("authError - default message", async () => {
  const response = authError();

  assertEquals(response.status, 401);
  const body = await response.json();

  assertEquals(body.error.code, "AUTH_ERROR");
  assertEquals(body.error.message, "Authentication required");
});

Deno.test("authError - custom code", async () => {
  const response = authError(
    "Token expired",
    ErrorCodes.AUTH_TOKEN_EXPIRED,
  );

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "AUTH_TOKEN_EXPIRED");
});

Deno.test("rateLimitError - with limit type", async () => {
  const response = rateLimitError("RPM limit exceeded", 30, "rpm");

  assertEquals(response.status, 429);
  const body = await response.json();

  assertEquals(body.error.code, "RATE_LIMIT_RPM");
  assertEquals(body.error.retryAfter, 30);
  assertEquals(body.error.details, { limitType: "rpm" });
});

Deno.test("internalError - masks error details", async () => {
  const response = internalError("req-123");

  assertEquals(response.status, 500);
  const body = await response.json();

  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertEquals(body.error.message, "An unexpected error occurred");
  assertEquals(body.error.requestId, "req-123");
});

Deno.test("paymentRequiredError - default message", async () => {
  const response = paymentRequiredError();

  assertEquals(response.status, 402);
  const body = await response.json();

  assertEquals(body.error.code, "PAYMENT_REQUIRED");
  assertEquals(
    body.error.message,
    "Payment required. Please upgrade your plan.",
  );
});

Deno.test("paymentRequiredError - custom message", async () => {
  const response = paymentRequiredError("Credits exhausted", "req-456");

  assertEquals(response.status, 402);
  const body = await response.json();

  assertEquals(body.error.code, "PAYMENT_REQUIRED");
  assertEquals(body.error.message, "Credits exhausted");
  assertEquals(body.error.requestId, "req-456");
});

// =============================================================================
// errorToResponse Tests
// =============================================================================

Deno.test("errorToResponse - handles timeout error", async () => {
  const error = new Error("Request timeout");
  const response = errorToResponse(error);

  assertEquals(response.status, 504);
  const body = await response.json();
  assertEquals(body.error.code, "TIMEOUT_ERROR");
});

Deno.test("errorToResponse - handles TimeoutError by name", async () => {
  const error = new DOMException("The operation timed out", "TimeoutError");
  const response = errorToResponse(error);

  assertEquals(response.status, 504);
  const body = await response.json();
  assertEquals(body.error.code, "TIMEOUT_ERROR");
});

Deno.test("errorToResponse - handles rate limit error", async () => {
  const error = new Error("Too many requests");
  const response = errorToResponse(error);

  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body.error.code, "RATE_LIMIT_EXCEEDED");
});

Deno.test("errorToResponse - handles generic error", async () => {
  const error = new Error("Something went wrong");
  const response = errorToResponse(error);

  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

Deno.test("errorToResponse - handles ZodError", async () => {
  const zodError = {
    name: "ZodError",
    errors: [
      { path: ["email"], message: "Invalid email format" },
      { path: ["age"], message: "Must be a number" },
    ],
  };

  const response = errorToResponse(zodError);

  assertEquals(response.status, 400);
  const body = await response.json();

  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(body.error.details, {
    fields: {
      email: "Invalid email format",
      age: "Must be a number",
    },
  });
});

Deno.test("errorToResponse - passes through Response", async () => {
  const originalResponse = new Response(JSON.stringify({ custom: true }), {
    status: 418,
  });

  const response = errorToResponse(originalResponse);

  assertEquals(response.status, 418);
  const body = await response.json();
  assertEquals(body.custom, true);
});

Deno.test("errorToResponse - handles AuthError", async () => {
  const error = Object.assign(new Error("Invalid JWT"), {
    name: "AuthError",
    code: "INVALID_TOKEN",
    statusCode: 401,
  });

  const response = errorToResponse(error);

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "AUTH_ERROR");
  assertEquals(body.error.message, "Invalid or expired token");
});

Deno.test("errorToResponse - handles unknown error type", async () => {
  const response = errorToResponse("string error");

  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

Deno.test("errorToResponse - with requestId", async () => {
  const error = new Error("Something failed");
  const response = errorToResponse(error, "req-trace-123");

  const body = await response.json();
  assertEquals(body.error.requestId, "req-trace-123");
});

// =============================================================================
// Type Guard Tests
// =============================================================================

Deno.test("isErrorResponse - returns true for error response", () => {
  const errorBody = {
    success: false,
    error: { code: "ERROR", message: "test" },
  };
  assertEquals(isErrorResponse(errorBody), true);
});

Deno.test("isErrorResponse - returns false for success response", () => {
  const successBody = { success: true, data: {} };
  assertEquals(isErrorResponse(successBody), false);
});

Deno.test("isErrorResponse - returns false for null", () => {
  assertEquals(isErrorResponse(null), false);
});

Deno.test("isSuccessResponse - returns true for success response", () => {
  const successBody = { success: true, data: { id: "123" } };
  assertEquals(isSuccessResponse(successBody), true);
});

Deno.test("isSuccessResponse - returns false for error response", () => {
  const errorBody = {
    success: false,
    error: { code: "ERROR", message: "test" },
  };
  assertEquals(isSuccessResponse(errorBody), false);
});

// =============================================================================
// Error Code Helper Tests
// =============================================================================

Deno.test("isRetryable - rate limit codes are retryable", () => {
  assertEquals(isRetryable(ErrorCodes.RATE_LIMIT_EXCEEDED), true);
  assertEquals(isRetryable(ErrorCodes.RATE_LIMIT_RPM), true);
  assertEquals(isRetryable(ErrorCodes.LLM_RATE_LIMIT), true);
});

Deno.test("isRetryable - timeout codes are retryable", () => {
  assertEquals(isRetryable(ErrorCodes.TIMEOUT_ERROR), true);
  assertEquals(isRetryable(ErrorCodes.REQUEST_TIMEOUT), true);
  assertEquals(isRetryable(ErrorCodes.UPSTREAM_TIMEOUT), true);
});

Deno.test("isRetryable - validation errors are not retryable", () => {
  assertEquals(isRetryable(ErrorCodes.VALIDATION_ERROR), false);
  assertEquals(isRetryable(ErrorCodes.NOT_FOUND), false);
  assertEquals(isRetryable(ErrorCodes.AUTH_ERROR), false);
});

Deno.test("getDefaultRetryAfter - returns values for rate limits", () => {
  assertEquals(getDefaultRetryAfter(ErrorCodes.RATE_LIMIT_RPM), 60);
  assertEquals(getDefaultRetryAfter(ErrorCodes.RATE_LIMIT_DAILY), 3600);
  assertEquals(getDefaultRetryAfter(ErrorCodes.LLM_RATE_LIMIT), 30);
});

Deno.test("getDefaultRetryAfter - returns null for non-rate-limit codes", () => {
  assertEquals(getDefaultRetryAfter(ErrorCodes.VALIDATION_ERROR), null);
  assertEquals(getDefaultRetryAfter(ErrorCodes.NOT_FOUND), null);
  assertEquals(getDefaultRetryAfter(ErrorCodes.INTERNAL_ERROR), null);
});

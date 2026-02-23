import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  commonSchemas,
  validate,
  validateAuthHeader,
  validateJson,
  validateMethod,
  validateQueryParams,
  validateRequest,
  z,
  ZodError,
  zodErrorToFieldErrors,
} from "./mod.ts";

// =============================================================================
// Test Helpers
// =============================================================================

function createRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  const {
    method = "POST",
    url = "https://example.com/api",
    headers = {},
    body,
  } = options;

  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  const init: RequestInit = {
    method,
    headers: finalHeaders,
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new Request(url, init);
}

// =============================================================================
// validateRequest Tests
// =============================================================================

Deno.test("validateRequest - valid schema returns success", async () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().positive(),
  });

  const req = createRequest({ body: { email: "test@example.com", age: 25 } });
  const result = await validateRequest(req, schema);

  assertEquals(result.success, true);
  assertEquals(result.data!.email, "test@example.com");
  assertEquals(result.data!.age, 25);
});

Deno.test("validateRequest - invalid JSON returns error", async () => {
  const schema = z.object({ email: z.string() });
  const req = new Request("https://example.com/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not valid json{",
  });

  const result = await validateRequest(req, schema);

  assertEquals(result.success, false);
  assertEquals(result.error!.status, 400);

  const body = await result.error!.json();
  assertEquals(body.success, false);
  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(
    body.error.details.fields.body,
    "Request body must be valid JSON",
  );
});

Deno.test("validateRequest - validation errors with field details", async () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().positive(),
  });

  const req = createRequest({ body: { email: "invalid-email", age: -5 } });
  const result = await validateRequest(req, schema);

  assertEquals(result.success, false);
  const body = await result.error!.json();

  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertExists(body.error.details.fields.email);
  assertExists(body.error.details.fields.age);
});

Deno.test("validateRequest - custom error message", async () => {
  const schema = z.object({ name: z.string() });
  const req = createRequest({ body: { name: 123 } });

  const result = await validateRequest(req, schema, {
    errorMessage: "Custom validation failed",
  });

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.message, "Custom validation failed");
});

Deno.test("validateRequest - with requestId", async () => {
  const schema = z.object({ name: z.string() });
  const req = createRequest({ body: { name: 123 } });

  const result = await validateRequest(req, schema, { requestId: "req-123" });

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.requestId, "req-123");
});

Deno.test("validateRequest - strict mode rejects extra fields", async () => {
  const schema = z.object({ email: z.string() });
  const req = createRequest({
    body: { email: "test@example.com", extra: "field" },
  });

  const result = await validateRequest(req, schema, { strict: true });

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.code, "VALIDATION_ERROR");
});

Deno.test("validateRequest - non-strict mode allows extra fields", async () => {
  const schema = z.object({ email: z.string() });
  const req = createRequest({
    body: { email: "test@example.com", extra: "field" },
  });

  const result = await validateRequest(req, schema, { strict: false });

  assertEquals(result.success, true);
  assertEquals(result.data!.email, "test@example.com");
});

// =============================================================================
// validateJson Tests
// =============================================================================

Deno.test("validateJson - valid JSON returns parsed data", async () => {
  const schema = z.object({ name: z.string(), count: z.number() });
  const req = createRequest({ body: { name: "test", count: 42 } });

  const data = await validateJson(req, schema);

  assertEquals(data.name, "test");
  assertEquals(data.count, 42);
});

Deno.test("validateJson - invalid JSON throws SyntaxError", async () => {
  const schema = z.object({ name: z.string() });
  const req = new Request("https://example.com/api", {
    method: "POST",
    body: "{invalid",
  });

  await assertRejects(
    async () => await validateJson(req, schema),
    SyntaxError,
  );
});

Deno.test("validateJson - validation failure throws ZodError", async () => {
  const schema = z.object({ email: z.string().email() });
  const req = createRequest({ body: { email: "not-an-email" } });

  await assertRejects(
    async () => await validateJson(req, schema),
    ZodError,
  );
});

Deno.test("validateJson - strict mode rejects extra fields", async () => {
  const schema = z.object({ name: z.string() });
  const req = createRequest({ body: { name: "test", extra: "value" } });

  await assertRejects(
    async () => await validateJson(req, schema, { strict: true }),
    ZodError,
  );
});

// =============================================================================
// validate Tests
// =============================================================================

Deno.test("validate - valid data returns success", () => {
  const schema = z.object({ id: z.string().uuid() });
  const data = { id: "550e8400-e29b-41d4-a716-446655440000" };

  const result = validate(data, schema);

  assertEquals(result.success, true);
  assertEquals(result.data!.id, data.id);
});

Deno.test("validate - invalid data returns error", async () => {
  const schema = z.object({ count: z.number().positive() });
  const data = { count: -10 };

  const result = validate(data, schema);

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.code, "VALIDATION_ERROR");
});

Deno.test("validate - with custom errorMessage", async () => {
  const schema = z.object({ value: z.number() });
  const data = { value: "not-a-number" };

  const result = validate(data, schema, {
    errorMessage: "Invalid data structure",
  });

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.message, "Invalid data structure");
});

Deno.test("validate - strict mode", () => {
  const schema = z.object({ name: z.string() });
  const data = { name: "test", extra: "field" };

  const result = validate(data, schema, { strict: true });

  assertEquals(result.success, false);
});

// =============================================================================
// zodErrorToFieldErrors Tests
// =============================================================================

Deno.test("zodErrorToFieldErrors - flat field errors", () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().positive(),
  });

  try {
    schema.parse({ email: "invalid", age: -5 });
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors = zodErrorToFieldErrors(error);

      assertExists(fieldErrors.email);
      assertExists(fieldErrors.age);
    }
  }
});

Deno.test("zodErrorToFieldErrors - nested paths", () => {
  const schema = z.object({
    user: z.object({
      email: z.string().email(),
    }),
  });

  try {
    schema.parse({ user: { email: "invalid" } });
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors = zodErrorToFieldErrors(error);

      assertExists(fieldErrors["user.email"]);
    }
  }
});

Deno.test("zodErrorToFieldErrors - root-level error", () => {
  const schema = z.string();

  try {
    schema.parse(123);
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors = zodErrorToFieldErrors(error);

      assertExists(fieldErrors.root);
    }
  }
});

Deno.test("zodErrorToFieldErrors - multiple errors on same field uses first", () => {
  const schema = z.object({
    password: z.string().min(8).regex(/[A-Z]/),
  });

  try {
    schema.parse({ password: "short" });
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors = zodErrorToFieldErrors(error);

      assertEquals(typeof fieldErrors.password, "string");
    }
  }
});

// =============================================================================
// validateQueryParams Tests
// =============================================================================

Deno.test("validateQueryParams - valid params", () => {
  const schema = z.object({
    page: z.coerce.number(),
    search: z.string(),
  });

  const req = createRequest({
    method: "GET",
    url: "https://example.com/api?page=2&search=test",
  });

  const result = validateQueryParams(req, schema);

  assertEquals(result.success, true);
  assertEquals(result.data!.page, 2);
  assertEquals(result.data!.search, "test");
});

Deno.test("validateQueryParams - with defaults", () => {
  const schema = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(20),
  });

  const req = createRequest({
    method: "GET",
    url: "https://example.com/api",
  });

  const result = validateQueryParams(req, schema);

  assertEquals(result.success, true);
  assertEquals(result.data!.page, 1);
  assertEquals(result.data!.limit, 20);
});

Deno.test("validateQueryParams - coercion from string", () => {
  const schema = z.object({
    count: z.coerce.number(),
    active: z.coerce.boolean(),
  });

  const req = createRequest({
    method: "GET",
    url: "https://example.com/api?count=42&active=true",
  });

  const result = validateQueryParams(req, schema);

  assertEquals(result.success, true);
  assertEquals(result.data!.count, 42);
  assertEquals(result.data!.active, true);
});

Deno.test("validateQueryParams - validation errors", async () => {
  const schema = z.object({
    page: z.coerce.number().positive(),
  });

  const req = createRequest({
    method: "GET",
    url: "https://example.com/api?page=-1",
  });

  const result = validateQueryParams(req, schema);

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.code, "VALIDATION_ERROR");
});

Deno.test("validateQueryParams - custom error message", async () => {
  const schema = z.object({ id: z.string().uuid() });
  const req = createRequest({
    method: "GET",
    url: "https://example.com/api?id=invalid",
  });

  const result = validateQueryParams(req, schema, {
    errorMessage: "Invalid URL parameters",
  });

  assertEquals(result.success, false);
  const body = await result.error!.json();
  assertEquals(body.error.message, "Invalid URL parameters");
});

// =============================================================================
// validateAuthHeader Tests
// =============================================================================

Deno.test("validateAuthHeader - missing header returns error", async () => {
  const req = createRequest({ headers: {} });
  const result = validateAuthHeader(req);

  assertEquals(result.token, undefined);
  assertExists(result.error);

  const body = await result.error!.json();
  assertEquals(body.error.code, "AUTH_ERROR");
  assertEquals(body.error.message, "Missing Authorization header");
});

Deno.test("validateAuthHeader - invalid format returns error", async () => {
  const req = createRequest({
    headers: { Authorization: "InvalidFormat token123" },
  });

  const result = validateAuthHeader(req);

  assertEquals(result.token, undefined);
  assertExists(result.error);

  const body = await result.error!.json();
  assertEquals(body.error.code, "AUTH_ERROR");
  assertEquals(
    body.error.message,
    "Invalid Authorization header format. Expected: Bearer <token>",
  );
});

Deno.test("validateAuthHeader - Bearer without space returns error", async () => {
  const req = createRequest({
    headers: { Authorization: "Bearer" },
  });

  const result = validateAuthHeader(req);

  assertEquals(result.token, undefined);
  assertExists(result.error);

  const body = await result.error!.json();
  assertEquals(body.error.code, "AUTH_ERROR");
  assertEquals(
    body.error.message,
    "Invalid Authorization header format. Expected: Bearer <token>",
  );
});

Deno.test("validateAuthHeader - valid Bearer token returns token", () => {
  const req = createRequest({
    headers: { Authorization: "Bearer my-secret-token-123" },
  });

  const result = validateAuthHeader(req);

  assertEquals(result.error, undefined);
  assertEquals(result.token, "my-secret-token-123");
});

Deno.test("validateAuthHeader - with requestId", async () => {
  const req = createRequest({ headers: {} });
  const result = validateAuthHeader(req, { requestId: "req-456" });

  assertExists(result.error);
  const body = await result.error!.json();
  assertEquals(body.error.requestId, "req-456");
});

// =============================================================================
// validateMethod Tests
// =============================================================================

Deno.test("validateMethod - allowed method returns null", () => {
  const req = createRequest({ method: "POST" });
  const error = validateMethod(req, ["POST", "PUT"]);

  assertEquals(error, null);
});

Deno.test("validateMethod - disallowed method returns 405 error", async () => {
  const req = createRequest({ method: "DELETE" });
  const error = validateMethod(req, ["GET", "POST"]);

  assertExists(error);
  assertEquals(error!.status, 405);

  const body = await error!.json();
  assertEquals(body.error.code, "VALIDATION_ERROR");
  assertEquals(
    body.error.message,
    "Method DELETE not allowed. Allowed: GET, POST",
  );
});

Deno.test("validateMethod - handles multiple allowed methods", () => {
  const req = createRequest({ method: "PUT" });
  const error = validateMethod(req, ["POST", "PUT", "PATCH"]);

  assertEquals(error, null);
});

Deno.test("validateMethod - with requestId", async () => {
  const req = createRequest({ method: "PATCH" });
  const error = validateMethod(req, ["GET"], { requestId: "req-789" });

  assertExists(error);
  const body = await error!.json();
  assertEquals(body.error.requestId, "req-789");
});

// =============================================================================
// commonSchemas Tests
// =============================================================================

Deno.test("commonSchemas.uuid - valid UUID passes", () => {
  const schema = commonSchemas.uuid("user_id");
  const result = schema.safeParse("550e8400-e29b-41d4-a716-446655440000");

  assertEquals(result.success, true);
});

Deno.test("commonSchemas.uuid - invalid UUID fails with custom message", () => {
  const schema = commonSchemas.uuid("user_id");
  const result = schema.safeParse("not-a-uuid");

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error.errors[0].message,
      "user_id must be a valid UUID",
    );
  }
});

Deno.test("commonSchemas.email - valid email passes", () => {
  const result = commonSchemas.email.safeParse("test@example.com");
  assertEquals(result.success, true);
});

Deno.test("commonSchemas.email - invalid email fails", () => {
  const result = commonSchemas.email.safeParse("not-an-email");
  assertEquals(result.success, false);
});

Deno.test("commonSchemas.requiredString - non-empty passes", () => {
  const schema = commonSchemas.requiredString("name");
  const result = schema.safeParse("John Doe");

  assertEquals(result.success, true);
});

Deno.test("commonSchemas.requiredString - empty string fails", () => {
  const schema = commonSchemas.requiredString("name");
  const result = schema.safeParse("");

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.errors[0].message, "name is required");
  }
});

Deno.test("commonSchemas.requiredString - with maxLength", () => {
  const schema = commonSchemas.requiredString("title", 10);

  assertEquals(schema.safeParse("short").success, true);
  assertEquals(schema.safeParse("this is way too long").success, false);
});

Deno.test("commonSchemas.positiveInt - positive integer passes", () => {
  const schema = commonSchemas.positiveInt("count");
  assertEquals(schema.safeParse(5).success, true);
});

Deno.test("commonSchemas.positiveInt - zero fails", () => {
  const schema = commonSchemas.positiveInt("count");
  assertEquals(schema.safeParse(0).success, false);
});

Deno.test("commonSchemas.positiveInt - negative fails", () => {
  const schema = commonSchemas.positiveInt("count");
  assertEquals(schema.safeParse(-5).success, false);
});

Deno.test("commonSchemas.nonNegativeInt - zero passes", () => {
  const schema = commonSchemas.nonNegativeInt("offset");
  assertEquals(schema.safeParse(0).success, true);
});

Deno.test("commonSchemas.nonNegativeInt - positive passes", () => {
  const schema = commonSchemas.nonNegativeInt("offset");
  assertEquals(schema.safeParse(10).success, true);
});

Deno.test("commonSchemas.nonNegativeInt - negative fails", () => {
  const schema = commonSchemas.nonNegativeInt("offset");
  assertEquals(schema.safeParse(-1).success, false);
});

Deno.test("commonSchemas.latitude - valid range passes", () => {
  assertEquals(commonSchemas.latitude.safeParse(0).success, true);
  assertEquals(commonSchemas.latitude.safeParse(45.5).success, true);
  assertEquals(commonSchemas.latitude.safeParse(-45.5).success, true);
  assertEquals(commonSchemas.latitude.safeParse(90).success, true);
  assertEquals(commonSchemas.latitude.safeParse(-90).success, true);
});

Deno.test("commonSchemas.latitude - out of range fails", () => {
  assertEquals(commonSchemas.latitude.safeParse(90.1).success, false);
  assertEquals(commonSchemas.latitude.safeParse(-90.1).success, false);
});

Deno.test("commonSchemas.longitude - valid range passes", () => {
  assertEquals(commonSchemas.longitude.safeParse(0).success, true);
  assertEquals(commonSchemas.longitude.safeParse(123.456).success, true);
  assertEquals(commonSchemas.longitude.safeParse(-123.456).success, true);
  assertEquals(commonSchemas.longitude.safeParse(180).success, true);
  assertEquals(commonSchemas.longitude.safeParse(-180).success, true);
});

Deno.test("commonSchemas.longitude - out of range fails", () => {
  assertEquals(commonSchemas.longitude.safeParse(180.1).success, false);
  assertEquals(commonSchemas.longitude.safeParse(-180.1).success, false);
});

Deno.test("commonSchemas.coordinates - valid coordinates pass", () => {
  const result = commonSchemas.coordinates.safeParse({
    lat: 45.5,
    lng: -122.6,
  });

  assertEquals(result.success, true);
});

Deno.test("commonSchemas.coordinates - invalid coordinates fail", () => {
  assertEquals(
    commonSchemas.coordinates.safeParse({ lat: 91, lng: 0 }).success,
    false,
  );
  assertEquals(
    commonSchemas.coordinates.safeParse({ lat: 0, lng: 181 }).success,
    false,
  );
});

Deno.test("commonSchemas.pagination - applies defaults", () => {
  const result = commonSchemas.pagination.safeParse({});

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.page, 1);
    assertEquals(result.data.limit, 20);
  }
});

Deno.test("commonSchemas.pagination - validates limits", () => {
  assertEquals(
    commonSchemas.pagination.safeParse({ page: 0 }).success,
    false,
  );
  assertEquals(
    commonSchemas.pagination.safeParse({ limit: 0 }).success,
    false,
  );
  assertEquals(
    commonSchemas.pagination.safeParse({ limit: 101 }).success,
    false,
  );
  assertEquals(
    commonSchemas.pagination.safeParse({ page: 5, limit: 50 }).success,
    true,
  );
});

Deno.test("commonSchemas.isoDate - valid ISO datetime passes", () => {
  assertEquals(
    commonSchemas.isoDate.safeParse("2024-01-15T10:30:00Z").success,
    true,
  );
  assertEquals(
    commonSchemas.isoDate.safeParse("2024-01-15T10:30:00.123Z").success,
    true,
  );
});

Deno.test("commonSchemas.isoDate - invalid datetime fails", () => {
  assertEquals(
    commonSchemas.isoDate.safeParse("2024-01-15").success,
    false,
  );
  assertEquals(
    commonSchemas.isoDate.safeParse("not-a-date").success,
    false,
  );
});

Deno.test("commonSchemas.dateString - valid YYYY-MM-DD passes", () => {
  assertEquals(
    commonSchemas.dateString.safeParse("2024-01-15").success,
    true,
  );
  assertEquals(
    commonSchemas.dateString.safeParse("2024-12-31").success,
    true,
  );
});

Deno.test("commonSchemas.dateString - invalid format fails", () => {
  assertEquals(
    commonSchemas.dateString.safeParse("01-15-2024").success,
    false,
  );
  assertEquals(
    commonSchemas.dateString.safeParse("2024/01/15").success,
    false,
  );
  assertEquals(
    commonSchemas.dateString.safeParse("2024-1-5").success,
    false,
  );
});

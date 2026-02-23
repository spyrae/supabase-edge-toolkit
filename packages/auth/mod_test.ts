import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { create, getNumericDate } from "djwt";

import {
  AuthError,
  verifyCronSecret,
  verifyServiceRole,
  verifyUserToken,
} from "./middleware.ts";
import { isTestModeAvailable, tryTestMode } from "./test_mode.ts";

// =============================================================================
// Test Helpers
// =============================================================================

const TEST_JWT_SECRET = "test-jwt-secret-for-unit-tests-only-32chars!";

async function createTestCryptoKey(): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(TEST_JWT_SECRET);
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createTestJWT(
  payload: Record<string, unknown>,
): Promise<string> {
  const key = await createTestCryptoKey();
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

function makeRequest(
  token?: string,
  headers?: Record<string, string>,
): Request {
  const h = new Headers(headers);
  if (token) {
    h.set("Authorization", `Bearer ${token}`);
  }
  return new Request("https://example.com/test", { headers: h });
}

// =============================================================================
// verifyUserToken Tests
// =============================================================================

describe("verifyUserToken", () => {
  let originalJwtSecret: string | undefined;

  beforeEach(() => {
    originalJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    Deno.env.set("SUPABASE_JWT_SECRET", TEST_JWT_SECRET);
  });

  afterEach(() => {
    if (originalJwtSecret) {
      Deno.env.set("SUPABASE_JWT_SECRET", originalJwtSecret);
    } else {
      Deno.env.delete("SUPABASE_JWT_SECRET");
    }
  });

  it("should reject request without Authorization header", async () => {
    const req = makeRequest();
    try {
      await verifyUserToken(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "MISSING_AUTH_HEADER");
      assertEquals((e as AuthError).statusCode, 401);
    }
  });

  it("should reject non-Bearer Authorization header", async () => {
    const req = new Request("https://example.com/test", {
      headers: { "Authorization": "Basic abc123" },
    });
    try {
      await verifyUserToken(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "INVALID_AUTH_HEADER");
    }
  });

  it("should reject forged JWT (wrong signature)", async () => {
    const wrongKeyData = new TextEncoder().encode(
      "wrong-secret-key-for-testing!!!!",
    );
    const wrongKey = await crypto.subtle.importKey(
      "raw",
      wrongKeyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const forgedToken = await create(
      { alg: "HS256", typ: "JWT" },
      { sub: "user-123", role: "authenticated", exp: getNumericDate(3600) },
      wrongKey,
    );

    const req = makeRequest(forgedToken);
    try {
      await verifyUserToken(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "INVALID_TOKEN");
    }
  });

  it("should reject expired JWT", async () => {
    const expiredToken = await createTestJWT({
      sub: "user-123",
      role: "authenticated",
      exp: getNumericDate(-3600), // 1 hour ago
    });

    const req = makeRequest(expiredToken);
    try {
      await verifyUserToken(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "TOKEN_EXPIRED");
    }
  });

  it("should reject JWT without sub claim", async () => {
    const noSubToken = await createTestJWT({
      role: "authenticated",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(noSubToken);
    try {
      await verifyUserToken(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "MISSING_SUB_CLAIM");
    }
  });

  it("should accept valid JWT and return AuthResult", async () => {
    const validToken = await createTestJWT({
      sub: "user-abc-123",
      role: "authenticated",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(validToken);
    const result = await verifyUserToken(req);

    assertEquals(result.userId, "user-abc-123");
    assertEquals(result.role, "authenticated");
    assertEquals(result.payload.sub, "user-abc-123");
  });
});

// =============================================================================
// verifyServiceRole Tests
// =============================================================================

describe("verifyServiceRole", () => {
  let originalJwtSecret: string | undefined;

  beforeEach(() => {
    originalJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    Deno.env.set("SUPABASE_JWT_SECRET", TEST_JWT_SECRET);
  });

  afterEach(() => {
    if (originalJwtSecret) {
      Deno.env.set("SUPABASE_JWT_SECRET", originalJwtSecret);
    } else {
      Deno.env.delete("SUPABASE_JWT_SECRET");
    }
  });

  it("should reject non-service_role JWT", async () => {
    const userToken = await createTestJWT({
      sub: "user-123",
      role: "authenticated",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(userToken);
    try {
      await verifyServiceRole(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "NOT_SERVICE_ROLE");
      assertEquals((e as AuthError).statusCode, 403);
    }
  });

  it("should accept valid service_role JWT with sub", async () => {
    const serviceToken = await createTestJWT({
      sub: "service",
      role: "service_role",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(serviceToken);
    const result = await verifyServiceRole(req);

    assertEquals(result.role, "service_role");
    assertEquals(result.userId, "service");
  });

  it("should accept service_role JWT without sub (real Supabase key)", async () => {
    const serviceToken = await createTestJWT({
      iss: "supabase",
      ref: "test-project",
      role: "service_role",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(serviceToken);
    const result = await verifyServiceRole(req);

    assertEquals(result.role, "service_role");
    assertEquals(result.userId, "service_role"); // fallback
  });
});

// =============================================================================
// verifyCronSecret Tests
// =============================================================================

describe("verifyCronSecret", () => {
  let originalJwtSecret: string | undefined;
  let originalCronSecret: string | undefined;

  beforeEach(() => {
    originalJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    originalCronSecret = Deno.env.get("CRON_SECRET");
    Deno.env.set("SUPABASE_JWT_SECRET", TEST_JWT_SECRET);
    Deno.env.set("CRON_SECRET", "test-cron-secret-123");
  });

  afterEach(() => {
    if (originalJwtSecret) {
      Deno.env.set("SUPABASE_JWT_SECRET", originalJwtSecret);
    } else {
      Deno.env.delete("SUPABASE_JWT_SECRET");
    }
    if (originalCronSecret) {
      Deno.env.set("CRON_SECRET", originalCronSecret);
    } else {
      Deno.env.delete("CRON_SECRET");
    }
  });

  it("should reject wrong cron secret", async () => {
    const req = makeRequest("wrong-cron-secret");
    try {
      await verifyCronSecret(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
      assertEquals((e as AuthError).code, "INVALID_CRON_SECRET");
      assertEquals((e as AuthError).statusCode, 403);
    }
  });

  it("should accept valid cron secret", async () => {
    const req = makeRequest("test-cron-secret-123");
    await verifyCronSecret(req);
  });

  it("should accept valid service_role JWT as fallback", async () => {
    const serviceToken = await createTestJWT({
      sub: "service",
      role: "service_role",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(serviceToken);
    await verifyCronSecret(req);
  });
});

// =============================================================================
// AuthError Tests
// =============================================================================

describe("AuthError", () => {
  it("should have correct properties", () => {
    const error = new AuthError("test message", "INVALID_TOKEN", 401);

    assertEquals(error.name, "AuthError");
    assertEquals(error.message, "test message");
    assertEquals(error.code, "INVALID_TOKEN");
    assertEquals(error.statusCode, 401);
  });

  it("should default statusCode to 401", () => {
    const error = new AuthError("test", "MISSING_AUTH_HEADER");
    assertEquals(error.statusCode, 401);
  });

  it("should accept custom statusCode", () => {
    const error = new AuthError("forbidden", "NOT_SERVICE_ROLE", 403);
    assertEquals(error.statusCode, 403);
  });

  it("should be instance of Error", () => {
    const error = new AuthError("test", "INVALID_TOKEN");
    assertEquals(error instanceof Error, true);
  });
});

// =============================================================================
// Test Mode Tests
// =============================================================================

describe("isTestModeAvailable", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = Deno.env.get("ENVIRONMENT");
  });

  afterEach(() => {
    if (originalEnv) {
      Deno.env.set("ENVIRONMENT", originalEnv);
    } else {
      Deno.env.delete("ENVIRONMENT");
    }
  });

  it("should return false in production", () => {
    Deno.env.set("ENVIRONMENT", "production");
    assertEquals(isTestModeAvailable(), false);
  });

  it("should return false when not set", () => {
    Deno.env.delete("ENVIRONMENT");
    assertEquals(isTestModeAvailable(), false);
  });

  it("should return true in development", () => {
    Deno.env.set("ENVIRONMENT", "development");
    assertEquals(isTestModeAvailable(), true);
  });
});

describe("tryTestMode", () => {
  let originalEnv: string | undefined;
  let originalJwtSecret: string | undefined;

  beforeEach(() => {
    originalEnv = Deno.env.get("ENVIRONMENT");
    originalJwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    Deno.env.set("SUPABASE_JWT_SECRET", TEST_JWT_SECRET);
  });

  afterEach(() => {
    if (originalEnv) {
      Deno.env.set("ENVIRONMENT", originalEnv);
    } else {
      Deno.env.delete("ENVIRONMENT");
    }
    if (originalJwtSecret) {
      Deno.env.set("SUPABASE_JWT_SECRET", originalJwtSecret);
    } else {
      Deno.env.delete("SUPABASE_JWT_SECRET");
    }
  });

  it("should return null in production", async () => {
    Deno.env.set("ENVIRONMENT", "production");
    const req = makeRequest("some-token", { "X-Test-User-Id": "user-123" });
    const result = await tryTestMode(req);
    assertEquals(result, null);
  });

  it("should return null without X-Test-User-Id header", async () => {
    Deno.env.set("ENVIRONMENT", "development");
    const req = makeRequest("some-token");
    const result = await tryTestMode(req);
    assertEquals(result, null);
  });

  it("should impersonate user in development with valid service_role JWT", async () => {
    Deno.env.set("ENVIRONMENT", "development");

    const serviceToken = await createTestJWT({
      sub: "service",
      role: "service_role",
      exp: getNumericDate(3600),
    });

    const req = makeRequest(serviceToken, { "X-Test-User-Id": "test-user-42" });
    const result = await tryTestMode(req);

    assertEquals(result !== null, true);
    assertEquals(result!.userId, "test-user-42");
    assertEquals(result!.role, "authenticated");
    assertEquals(result!.payload._testMode, true);
  });

  it("should throw AuthError with invalid JWT in development", async () => {
    Deno.env.set("ENVIRONMENT", "development");

    const req = makeRequest("invalid-token", {
      "X-Test-User-Id": "test-user-42",
    });

    try {
      await tryTestMode(req);
      throw new Error("Should have thrown");
    } catch (e) {
      assertEquals(e instanceof AuthError, true);
    }
  });
});

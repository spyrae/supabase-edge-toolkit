import { assert, assertEquals, assertExists } from "@std/assert";
import { assertRejects } from "@std/assert/rejects";
import { afterEach, describe, it } from "@std/testing/bdd";

import {
  compilePrompt,
  compileSystemPrompt,
  getLangfusePrompt,
} from "./mod.ts";
import type { LangfuseConfig, PromptData } from "./mod.ts";

// =============================================================================
// compilePrompt — text type
// =============================================================================

describe("compilePrompt (text)", () => {
  it("should replace variables", () => {
    const promptData: PromptData = {
      type: "text",
      prompt: "Hello {{name}}, welcome to {{city}}!",
    };
    const result = compilePrompt(promptData, { name: "John", city: "Paris" });
    assertEquals(result, "Hello John, welcome to Paris!");
  });

  it("should replace missing variables with empty string", () => {
    const promptData: PromptData = {
      type: "text",
      prompt: "Hello {{name}}, you are {{age}} years old.",
    };
    const result = compilePrompt(promptData, { name: "Alice" });
    assertEquals(result, "Hello Alice, you are  years old.");
  });

  it("should return text as-is when no variables", () => {
    const promptData: PromptData = {
      type: "text",
      prompt: "No variables here.",
    };
    const result = compilePrompt(promptData, {});
    assertEquals(result, "No variables here.");
  });
});

// =============================================================================
// compilePrompt — chat type
// =============================================================================

describe("compilePrompt (chat)", () => {
  it("should replace variables in all messages", () => {
    const promptData: PromptData = {
      type: "chat",
      prompt: [
        { role: "system", content: "You are a {{role}} assistant." },
        { role: "user", content: "Help me with {{topic}}." },
      ],
    };
    const result = compilePrompt(promptData, {
      role: "travel",
      topic: "hotels",
    });
    assert(Array.isArray(result));
    const messages = result as Array<{ role: string; content: string }>;
    assertEquals(messages[0].content, "You are a travel assistant.");
    assertEquals(messages[1].content, "Help me with hotels.");
  });

  it("should preserve message roles", () => {
    const promptData: PromptData = {
      type: "chat",
      prompt: [
        { role: "system", content: "System msg" },
        { role: "assistant", content: "Assistant msg" },
      ],
    };
    const result = compilePrompt(promptData, {}) as Array<{
      role: string;
      content: string;
    }>;
    assertEquals(result[0].role, "system");
    assertEquals(result[1].role, "assistant");
  });
});

// =============================================================================
// compileSystemPrompt
// =============================================================================

describe("compileSystemPrompt", () => {
  it("should extract system message from chat prompt", () => {
    const promptData: PromptData = {
      type: "chat",
      prompt: [
        { role: "system", content: "You are a {{role}}." },
        { role: "user", content: "Hello" },
      ],
    };
    const result = compileSystemPrompt(promptData, { role: "guide" });
    assertEquals(result, "You are a guide.");
  });

  it("should return text prompt directly", () => {
    const promptData: PromptData = {
      type: "text",
      prompt: "System: be helpful for {{user}}.",
    };
    const result = compileSystemPrompt(promptData, { user: "Alex" });
    assertEquals(result, "System: be helpful for Alex.");
  });

  it("should return empty string if no system message in chat", () => {
    const promptData: PromptData = {
      type: "chat",
      prompt: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    };
    const result = compileSystemPrompt(promptData, {});
    assertEquals(result, "");
  });
});

// =============================================================================
// getLangfusePrompt — with mocked fetch
// =============================================================================

describe("getLangfusePrompt", () => {
  const mockConfig: LangfuseConfig = {
    host: "https://langfuse.test.co",
    publicKey: "pk-test",
    secretKey: "sk-test",
  };

  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it("should fetch prompt successfully", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (
      _url: string | URL | Request,
      _init?: RequestInit,
    ) => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: "test-prompt",
            version: 3,
            type: "text",
            prompt: "Hello {{name}}",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    const result = await getLangfusePrompt("test-prompt", mockConfig);
    assertEquals(result.type, "text");
    assertEquals(result.prompt, "Hello {{name}}");
    assertExists(result.name);
    assertEquals(result.version, 3);
  });

  it("should throw on API error", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (
      _url: string | URL | Request,
      _init?: RequestInit,
    ) => {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    };

    await assertRejects(
      () => getLangfusePrompt("missing-prompt", mockConfig),
      Error,
      "Failed to fetch Langfuse prompt",
    );
  });

  it("should send correct Basic auth header", async () => {
    originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return Promise.resolve(
        new Response(
          JSON.stringify({ type: "text", prompt: "ok" }),
          { status: 200 },
        ),
      );
    };

    await getLangfusePrompt("p", mockConfig);
    assert(capturedHeaders["Authorization"]?.startsWith("Basic "));
    const encoded = capturedHeaders["Authorization"].replace("Basic ", "");
    const decoded = atob(encoded);
    assertEquals(decoded, "pk-test:sk-test");
  });

  it("should use 'production' label by default", async () => {
    originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (
      url: string | URL | Request,
      _init?: RequestInit,
    ) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({ type: "text", prompt: "ok" }),
          { status: 200 },
        ),
      );
    };

    await getLangfusePrompt("my-prompt", mockConfig);
    assert(capturedUrl.includes("label=production"));
    assert(capturedUrl.includes("my-prompt"));
  });

  it("should accept custom label", async () => {
    originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (
      url: string | URL | Request,
      _init?: RequestInit,
    ) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({ type: "text", prompt: "ok" }),
          { status: 200 },
        ),
      );
    };

    await getLangfusePrompt("my-prompt", mockConfig, { label: "staging" });
    assert(capturedUrl.includes("label=staging"));
  });

  it("should encode prompt name in URL", async () => {
    originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (
      url: string | URL | Request,
      _init?: RequestInit,
    ) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        new Response(
          JSON.stringify({ type: "text", prompt: "ok" }),
          { status: 200 },
        ),
      );
    };

    await getLangfusePrompt("my prompt/special", mockConfig);
    assert(capturedUrl.includes("my%20prompt%2Fspecial"));
  });
});

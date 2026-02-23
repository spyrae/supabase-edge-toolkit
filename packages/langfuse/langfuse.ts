/**
 * Lightweight Langfuse prompt client for Deno.
 *
 * Fetch and compile prompts from Langfuse with zero dependencies
 * (uses native `fetch`). Supports both chat and text prompt types
 * with `{{variable}}` interpolation.
 *
 * @example
 * ```typescript
 * import { getLangfusePrompt, compilePrompt } from "@supa-edge-toolkit/langfuse";
 *
 * const config = {
 *   host: Deno.env.get("LANGFUSE_URL")!,
 *   publicKey: Deno.env.get("LANGFUSE_PUBLIC_KEY")!,
 *   secretKey: Deno.env.get("LANGFUSE_SECRET_KEY")!,
 * };
 *
 * const promptData = await getLangfusePrompt("my-prompt", config);
 * const compiled = compilePrompt(promptData, { name: "Alice", city: "Paris" });
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/** Langfuse API connection configuration */
export interface LangfuseConfig {
  /** Langfuse instance URL (e.g. "https://cloud.langfuse.com") */
  host: string;
  /** Langfuse public key */
  publicKey: string;
  /** Langfuse secret key */
  secretKey: string;
}

/** Chat message for LLM calls */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Langfuse prompt data structure */
export interface PromptData {
  /** Prompt name */
  name?: string;
  /** Prompt version number */
  version?: number;
  /** Prompt type: "chat" for message array, "text" for single string */
  type: "chat" | "text";
  /** Prompt content — string for text type, ChatMessage[] for chat type */
  prompt: string | ChatMessage[];
  /** Optional LLM configuration */
  config?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
  };
}

/** Options for getLangfusePrompt */
export interface GetPromptOptions {
  /** Prompt label (default: "production") */
  label?: string;
  /** Fetch timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Fetch a prompt template from the Langfuse API.
 *
 * Uses Basic auth with the configured public/secret key pair.
 * Includes a 5-second timeout by default.
 *
 * @param name - Prompt name in Langfuse
 * @param config - Langfuse API configuration
 * @param options - Optional settings (label, timeout)
 * @returns Prompt data including type, content, and optional config
 * @throws {Error} If the API returns a non-2xx status
 *
 * @example
 * ```typescript
 * const prompt = await getLangfusePrompt("travel-assistant", config);
 * // prompt.type === "chat"
 * // prompt.prompt === [{ role: "system", content: "..." }, ...]
 * ```
 */
export async function getLangfusePrompt(
  name: string,
  config: LangfuseConfig,
  options?: GetPromptOptions,
): Promise<PromptData> {
  const label = options?.label ?? "production";
  const timeoutMs = options?.timeoutMs ?? 5000;
  const auth = btoa(`${config.publicKey}:${config.secretKey}`);
  const url = `${config.host}/api/public/v2/prompts/${
    encodeURIComponent(name)
  }?label=${label}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Langfuse prompt '${name}': ${response.status} ${errorText}`,
    );
  }

  return await response.json();
}

/**
 * Compile a prompt template by replacing `{{variable}}` placeholders.
 *
 * Supports both prompt types:
 * - **text**: Returns a string with variables replaced
 * - **chat**: Returns a ChatMessage[] with variables replaced in each message
 *
 * Missing variables are replaced with an empty string.
 *
 * @param promptData - Langfuse prompt data
 * @param variables - Key-value pairs to substitute
 * @returns Compiled prompt (string for text, ChatMessage[] for chat)
 *
 * @example
 * ```typescript
 * // Text prompt
 * const text = compilePrompt(
 *   { type: "text", prompt: "Hello {{name}}!" },
 *   { name: "Alice" },
 * );
 * // => "Hello Alice!"
 *
 * // Chat prompt
 * const messages = compilePrompt(
 *   { type: "chat", prompt: [{ role: "system", content: "You are a {{role}}." }] },
 *   { role: "guide" },
 * );
 * // => [{ role: "system", content: "You are a guide." }]
 * ```
 */
export function compilePrompt(
  promptData: PromptData,
  variables: Record<string, string>,
): string | ChatMessage[] {
  const replaceVariables = (content: string): string =>
    content.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || "");

  if (promptData.type === "chat") {
    const messages = promptData.prompt as ChatMessage[];
    return messages.map((msg) => ({
      role: msg.role,
      content: replaceVariables(msg.content),
    }));
  }

  return replaceVariables(promptData.prompt as string);
}

/**
 * Compile a prompt and extract only the system message.
 *
 * For **chat** prompts: returns the content of the first `system` role message.
 * For **text** prompts: returns the full compiled text.
 * Returns empty string if no system message is found.
 *
 * @param promptData - Langfuse prompt data
 * @param variables - Key-value pairs to substitute
 * @returns Compiled system prompt string
 */
export function compileSystemPrompt(
  promptData: PromptData,
  variables: Record<string, string>,
): string {
  const compiled = compilePrompt(promptData, variables);

  if (typeof compiled === "string") {
    return compiled;
  }

  const systemMsg = compiled.find((m) => m.role === "system");
  return systemMsg?.content || "";
}

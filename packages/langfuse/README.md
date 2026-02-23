# @supabase-edge-toolkit/langfuse

Lightweight Langfuse prompt client for Deno. Fetch prompts and compile templates
with `{{variable}}` interpolation. Zero dependencies.

## Installation

```typescript
import {
  compilePrompt,
  getLangfusePrompt,
} from "jsr:@supabase-edge-toolkit/langfuse";
```

## Quick Start

```typescript
import {
  compilePrompt,
  getLangfusePrompt,
} from "@supabase-edge-toolkit/langfuse";

const config = {
  host: Deno.env.get("LANGFUSE_URL")!,
  publicKey: Deno.env.get("LANGFUSE_PUBLIC_KEY")!,
  secretKey: Deno.env.get("LANGFUSE_SECRET_KEY")!,
};

// Fetch prompt from Langfuse
const promptData = await getLangfusePrompt("travel-assistant", config);

// Compile with variables
const messages = compilePrompt(promptData, {
  destination: "Paris",
  language: "English",
});
// => [{ role: "system", content: "You are a travel guide for Paris..." }, ...]
```

## API Reference

### `getLangfusePrompt(name, config, options?)`

Fetch a prompt template from the Langfuse REST API.

```typescript
const prompt = await getLangfusePrompt("my-prompt", config);
const prompt = await getLangfusePrompt("my-prompt", config, {
  label: "staging", // default: "production"
  timeoutMs: 10000, // default: 5000
});
```

**Parameters:**

| Param               | Type           | Description                          |
| ------------------- | -------------- | ------------------------------------ |
| `name`              | string         | Prompt name in Langfuse              |
| `config`            | LangfuseConfig | API connection settings              |
| `options.label`     | string         | Prompt label (default: "production") |
| `options.timeoutMs` | number         | Fetch timeout in ms (default: 5000)  |

**Throws** `Error` if the API returns a non-2xx status.

### `compilePrompt(promptData, variables)`

Replace `{{variable}}` placeholders in a prompt template.

```typescript
// Text prompt -> string
const text = compilePrompt(
  { type: "text", prompt: "Hello {{name}}!" },
  { name: "Alice" },
);
// => "Hello Alice!"

// Chat prompt -> ChatMessage[]
const messages = compilePrompt(
  {
    type: "chat",
    prompt: [
      { role: "system", content: "You are a {{role}}." },
      { role: "user", content: "Help with {{topic}}." },
    ],
  },
  { role: "guide", topic: "hotels" },
);
// => [{ role: "system", content: "You are a guide." }, ...]
```

Missing variables are replaced with an empty string.

### `compileSystemPrompt(promptData, variables)`

Compile and extract only the system message.

```typescript
const systemPrompt = compileSystemPrompt(promptData, variables);
// For chat: returns content of first "system" role message
// For text: returns the full compiled string
// No system message: returns ""
```

### Types

```typescript
interface LangfuseConfig {
  host: string; // e.g. "https://cloud.langfuse.com"
  publicKey: string; // pk-lf-...
  secretKey: string; // sk-lf-...
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PromptData {
  name?: string;
  version?: number;
  type: "chat" | "text";
  prompt: string | ChatMessage[];
  config?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
  };
}

interface GetPromptOptions {
  label?: string; // default: "production"
  timeoutMs?: number; // default: 5000
}
```

## Environment Variables

Typical setup for Supabase Edge Functions:

| Variable              | Description             |
| --------------------- | ----------------------- |
| `LANGFUSE_URL`        | Langfuse instance URL   |
| `LANGFUSE_PUBLIC_KEY` | Public key for API auth |
| `LANGFUSE_SECRET_KEY` | Secret key for API auth |

## Why Not the Official SDK?

The official `langfuse` npm package is Node.js-centric and heavy. This module
is:

- **138 lines** of code, zero dependencies
- Uses native `fetch` (works in Deno, Supabase Edge Functions, Cloudflare
  Workers)
- Focused on the most common use case: fetch prompt + compile variables

## License

MIT

/**
 * @module @supabase-edge-toolkit/langfuse
 *
 * Lightweight Langfuse prompt client for Deno — fetch prompts
 * and compile templates with {{variable}} interpolation.
 * Zero dependencies.
 */

export {
  compilePrompt,
  compileSystemPrompt,
  getLangfusePrompt,
} from "./langfuse.ts";

export type {
  ChatMessage,
  GetPromptOptions,
  LangfuseConfig,
  PromptData,
} from "./langfuse.ts";

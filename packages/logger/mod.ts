/**
 * @supabase-edge-toolkit/logger
 *
 * Structured JSON logger for Supabase Edge Functions.
 * Compatible with Grafana/Loki for log aggregation and analysis.
 *
 * @example
 * import { createLogger, getRequestId } from "@supabase-edge-toolkit/logger";
 *
 * Deno.serve(async (req) => {
 *   const requestId = getRequestId(req);
 *   const logger = createLogger("my-function", requestId);
 *
 *   logger.info("Processing request", { user_id: "123" });
 *
 *   const timer = logger.startTimer("db_query");
 *   // ... do work
 *   timer.end({ rows: 42 });
 *
 *   return new Response("OK");
 * });
 */

export {
  createLogger,
  generateRequestId,
  getRequestId,
  type LogEntry,
  type Logger,
  type LogLevel,
  logRequestEnd,
  logRequestStart,
  type Timer,
} from "./logger.ts";

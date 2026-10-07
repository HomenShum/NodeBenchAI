/**
 * mcpProxy.ts — Transparent MCP tool call proxy.
 *
 * Wraps any set of MCP tools to intercept every call, measure duration,
 * estimate cost, and log to the unified event collector.
 *
 * Usage:
 *   const proxiedTools = wrapToolsWithProxy(originalTools, { sessionId: "..." });
 *
 * The proxy is transparent — same tool names, same schemas, same results.
 * The only addition is observation: every call logged to the event collector.
 *
 * This is Path B in the integration layer — zero-code-change observation
 * for any MCP-compatible client (Claude Code, Cursor, Windsurf, OpenAI Agents).
 */

import { getToolErrorMessage, type McpTool } from "../types.js";
import { ingestEvent, initEventCollectorTables, type UnifiedEvent } from "./eventCollector.js";

interface ProxyConfig {
  sessionId?: string;
  userId?: string;
  companyId?: string;
  surface?: UnifiedEvent["surface"];
  onEvent?: (event: { toolName: string; durationMs: number; cost: number; isDuplicate: boolean }) => void;
}

/**
 * Wrap all tools with transparent profiling proxy.
 * Every tool call is intercepted, timed, and logged.
 */
export function wrapToolsWithProxy(tools: McpTool[], config: ProxyConfig = {}): McpTool[] {
  // Ensure tables exist
  try { initEventCollectorTables(); } catch { /* may already exist */ }

  const sessionId = config.sessionId ?? `proxy_${Date.now().toString(36)}`;
  let stepIndex = 0;

  return tools.map((tool) => ({
    ...tool,
    handler: async (args: Record<string, unknown>) => {
      const startMs = Date.now();
      stepIndex++;

      let result: unknown;
      let success = true;
      let error: string | undefined;

      try {
        result = await tool.handler(args);
        success = getToolErrorMessage(result) === null;
      } catch (err: any) {
        success = false;
        error = err?.message ?? "Unknown error";
        throw err; // Re-throw — proxy is transparent
      } finally {
        const durationMs = Date.now() - startMs;

        // Observation failures must not replace the tool's result or exception.
        let collectorAccepted = false;
        try {
          const { isDuplicate, estimatedCost } = ingestEvent({
            surface: config.surface ?? "mcp_direct",
            integrationPath: "mcp_proxy",
            sessionId,
            userId: config.userId,
            companyId: config.companyId,
            toolName: tool.name,
            toolInputSummary: summarizeArgs(args),
            toolOutputSummary: error === undefined ? summarizeResult(result) : `ERROR: ${error}`,
            latencyMs: durationMs,
            success,
            pathStepIndex: stepIndex,
          });
          collectorAccepted = true;

          // Callback for real-time notifications
          config.onEvent?.({
            toolName: tool.name,
            durationMs,
            cost: estimatedCost,
            isDuplicate,
          });
        } catch (observationError: unknown) {
          console.error(collectorAccepted
            ? "[profiler] Event accepted by collector; notification failed:"
            : "[profiler] Event not accepted by collector:", observationError);
        }
      }

      return result;
    },
  }));
}

// ── Summarization helpers ────────────────────────────────────────────

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "(no args)";

  // Show first 3 key-value pairs, truncated
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v.slice(0, 100) : JSON.stringify(v).slice(0, 100);
      return `${k}=${val}`;
    })
    .join(", ");
}

function summarizeResult(result: unknown): string {
  if (result == null) return "(null)";
  if (typeof result === "string") return result.slice(0, 200);
  const str = JSON.stringify(result);
  if (str.length <= 200) return str;
  return str.slice(0, 197) + "...";
}

/**
 * Create a profiling-aware tool dispatcher.
 * Use this instead of direct tool.handler() calls to get automatic logging.
 */
export function createProfiledDispatcher(tools: McpTool[], config: ProxyConfig = {}) {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  const proxied = wrapToolsWithProxy(tools, config);
  const proxiedMap = new Map(proxied.map(t => [t.name, t]));

  return {
    /** Call a tool by name with profiling. */
    async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      const tool = proxiedMap.get(toolName);
      if (!tool) throw new Error(`Tool not found: ${toolName}`);
      return tool.handler(args);
    },

    /** Get the original (unproxied) tool list. */
    originalTools: tools,

    /** Get the proxied tool list (for MCP server registration). */
    proxiedTools: proxied,

    /** Check if a tool exists. */
    has(toolName: string): boolean {
      return toolMap.has(toolName);
    },
  };
}

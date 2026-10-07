/**
 * Research MCP Communication Layer
 *
 * This module provides actions for communicating with the Research MCP server.
 *
 * Server endpoints (python-mcp-servers/research):
 * - GET  /health
 * - GET  /tools/list
 * - POST /tools/execute   (expects { tool_name, parameters, secret })
 *
 * Environment variables:
 * - RESEARCH_MCP_SERVER_URL (default: http://127.0.0.1:8002)
 * - RESEARCH_MCP_URL (alias)
 * - RESEARCH_API_KEY (required for /tools/execute; must match server MCP_SECRET)
 */

"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

const MAX_INLINE_RAW_CHARS = 120_000;
function truncateForDb(input: string): string {
  if (input.length <= MAX_INLINE_RAW_CHARS) return input;
  return input.slice(0, MAX_INLINE_RAW_CHARS) + `\n\n<!-- TRUNCATED: ${input.length} chars -->\n`;
}

function getResearchMetricToolName(args: { endpoint: string; method: "GET" | "POST"; body?: any }) {
  if (args.endpoint === "/tools/execute") {
    const toolName = args.body?.tool_name;
    if (typeof toolName === "string" && toolName.length > 0) return `research.tool.${toolName}`;
  }
  return `research.mcp.${args.method}.${args.endpoint}`;
}

export const callResearchMcp = internalAction({
  args: {
    endpoint: v.string(),
    method: v.union(v.literal("GET"), v.literal("POST")),
    params: v.optional(v.any()),
    body: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const baseUrl =
      process.env.RESEARCH_MCP_SERVER_URL || process.env.RESEARCH_MCP_URL || "http://127.0.0.1:8002";
    const url = new URL(args.endpoint, baseUrl);
    const metricToolName = getResearchMetricToolName({ endpoint: args.endpoint, method: args.method, body: args.body });
    const startedAt = Date.now();

    try {
      if (args.method === "GET" && args.params) {
        for (const [key, value] of Object.entries(args.params)) {
          if (value !== undefined && value !== null) {
            url.searchParams.append(key, String(value));
          }
        }
      }

      const response = await fetch(url.toString(), {
        method: args.method,
        headers: { "Content-Type": "application/json" },
        ...(args.method === "POST" && args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Research MCP request failed: ${response.status} ${response.statusText}\n${text}`);
      }

      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep text
      }

      try {
        const raw = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
          sourceType: "api_response",
          sourceUrl: url.toString(),
          rawContent: truncateForDb(raw),
          extractedData: {
            tool: "researchMcp",
            endpoint: args.endpoint,
            method: args.method,
            params: args.params ?? null,
            body: args.body ?? null,
            response: parsed,
          },
          fetchedAt: Date.now(),
        });
      } catch (artifactErr) {
        console.warn("[researchMcpActions] Failed to persist sourceArtifact", artifactErr);
      }

      const latencyMs = Math.max(0, Date.now() - startedAt);
      try {
        await ctx.runMutation(internal.domains.agents.orchestrator.toolHealth.recordToolSuccess, {
          toolName: metricToolName,
          latencyMs,
        });
      } catch (telemetryErr) {
        console.warn("[researchMcpActions] Failed to record tool success telemetry", telemetryErr);
      }

      return parsed;
    } catch (error: any) {
      const latencyMs = Math.max(0, Date.now() - startedAt);
      try {
        await ctx.runMutation(internal.domains.agents.orchestrator.toolHealth.recordToolFailure, {
          toolName: metricToolName,
          latencyMs,
          error: error?.message || "Unknown error",
        });
      } catch (telemetryErr) {
        console.warn("[researchMcpActions] Failed to record tool failure telemetry", telemetryErr);
      }
      throw error;
    }
  },
});

export const researchHealth = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.actions.researchMcpActions.callResearchMcp, {
      endpoint: "/health",
      method: "GET",
    });
  },
});

export const researchListTools = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.actions.researchMcpActions.callResearchMcp, {
      endpoint: "/tools/list",
      method: "GET",
    });
  },
});

export const researchExecuteTool = internalAction({
  args: {
    toolName: v.string(),
    parameters: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    const secret = process.env.RESEARCH_API_KEY || process.env.MCP_SECRET || "";
    if (!secret) {
      throw new Error("Missing RESEARCH_API_KEY (or MCP_SECRET fallback) for Research tool execution");
    }

    return await ctx.runAction(internal.actions.researchMcpActions.callResearchMcp, {
      endpoint: "/tools/execute",
      method: "POST",
      body: {
        tool_name: args.toolName,
        parameters: args.parameters ?? {},
        secret,
      },
    });
  },
});

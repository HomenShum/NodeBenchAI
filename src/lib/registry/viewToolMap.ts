/**
 * viewToolMap - maps routed views to contextually relevant WebMCP tools.
 *
 * Keys must be registered MainView ids. Historical no-route keys were removed
 * so browser agents do not discover tools for product surfaces that are no
 * longer renderable.
 */

import type { MainView } from "./viewRegistry";

export interface ViewToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * MCP Gateway function name for server-side execution (maps to ALLOWLIST key).
   * If set, OpenClaw and server-side agents can call this tool via the gateway.
   * If absent, the tool is frontend-only.
   */
  gatewayFn?: string;
  /** "query" | "mutation" - defaults to "query" */
  fnType?: "query" | "mutation";
  /** Transform tool args into Convex function args. If absent, args pass through. */
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
}

export type ViewToolMap = Partial<Record<MainView, ViewToolDefinition[]>>;

export const VIEW_TOOL_MAP: ViewToolMap = {
  "control-plane": [
    {
      name: "nb_open_receipts",
      description: "Jump into the live receipts feed from the home surface.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nb_open_delegation",
      description: "Open the delegation surface to review scoped authority and approval gates.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nb_get_feed_items",
      description: "Get public research feed items surfaced on Home.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          sort: { type: "string", enum: ["hot", "new", "top"] },
        },
      },
      gatewayFn: "getPublicForYouFeed",
      mapArgs: (args) => ({ limit: Number(args.limit ?? 20) }),
    },
  ],

  research: [
    {
      name: "nb_search_research",
      description: "Search across research signals, briefings, and intelligence reports.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      gatewayFn: "hybridSearch",
      mapArgs: (args) => ({ query: String(args.query ?? ""), topK: Number(args.limit ?? 10) }),
    },
    {
      name: "nb_get_signals",
      description: "Get the latest research signals with trend data and source attribution.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } } },
      gatewayFn: "getSignalTimeseries",
    },
    {
      name: "nb_get_funding_brief",
      description: "Get funding intelligence through the active research surface.",
      inputSchema: { type: "object", properties: {} },
      gatewayFn: "getDealFlow",
    },
    {
      name: "nb_switch_research_tab",
      description: "Switch the research hub tab.",
      inputSchema: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            enum: ["overview", "signals", "briefing", "deals", "changes", "changelog"],
          },
        },
        required: ["tab"],
      },
    },
  ],

  "reports-home": [
    {
      name: "nb_search_reports",
      description: "Search saved reports and public packets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      gatewayFn: "hybridSearch",
      mapArgs: (args) => ({ query: String(args.query ?? ""), topK: Number(args.limit ?? 10) }),
    },
  ],

  "chat-home": [
    {
      name: "nb_search_from_chat",
      description: "Run a grounded search from the chat surface.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      gatewayFn: "hybridSearch",
      mapArgs: (args) => ({ query: String(args.query ?? ""), topK: Number(args.limit ?? 10) }),
    },
  ],

  receipts: [
    {
      name: "nb_filter_receipts",
      description: "Filter action receipts by channel, policy, approval state, or direction.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          approvalState: {
            type: "string",
            enum: ["all", "not_required", "pending", "approved", "denied"],
          },
        },
      },
    },
    {
      name: "nb_review_pending_approvals",
      description: "Review approval-gated receipts waiting for a human decision.",
      inputSchema: { type: "object", properties: {} },
    },
  ],

  delegation: [
    {
      name: "nb_list_escalated_actions",
      description: "List escalated actions that triggered policy review or human approval.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
    {
      name: "nb_open_approval_queue",
      description: "Open the approval queue for held actions.",
      inputSchema: { type: "object", properties: {} },
    },
  ],

  agents: [
    {
      name: "nb_list_agents",
      description: "List available AI agent templates and active conversations.",
      inputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: ["all", "active", "templates"] } },
      },
    },
    {
      name: "nb_start_agent",
      description: "Start a new agent conversation with an optional initial message.",
      inputSchema: {
        type: "object",
        properties: {
          templateId: { type: "string" },
          message: { type: "string" },
        },
        required: ["message"],
      },
    },
  ],

  "mcp-ledger": [
    {
      name: "nb_filter_tool_activity",
      description: "Filter the MCP ledger by tool name, date, or status.",
      inputSchema: {
        type: "object",
        properties: {
          toolName: { type: "string" },
          status: { type: "string", enum: ["all", "allowed", "blocked", "failed", "running"] },
        },
      },
    },
    {
      name: "nb_review_shared_context",
      description: "Inspect shared-context peers, packets, and handoffs.",
      inputSchema: { type: "object", properties: {} },
    },
  ],

  "benchmark-comparison": [
    {
      name: "nb_get_leaderboard",
      description: "Get model evaluation leaderboard data for the internal benchmark surface.",
      inputSchema: { type: "object", properties: { metric: { type: "string" } } },
    },
    {
      name: "nb_list_scenarios",
      description: "List available eval scenarios with descriptions and difficulty.",
      inputSchema: { type: "object", properties: { category: { type: "string" } } },
    },
  ],

  dogfood: [
    {
      name: "nb_get_qa_results",
      description: "Get the latest QA pipeline results, scores, issues, and governance violations.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nb_view_screenshots",
      description: "Get captured route screenshots for visual QA.",
      inputSchema: { type: "object", properties: { route: { type: "string" } } },
    },
  ],
};

/** Get tools for a specific view, returns empty array if none defined */
export function getViewTools(viewId: MainView): ViewToolDefinition[] {
  return VIEW_TOOL_MAP[viewId] ?? [];
}

/** Count total tools across all views */
export function getTotalViewTools(): number {
  return Object.values(VIEW_TOOL_MAP).reduce((sum, tools) => sum + (tools?.length ?? 0), 0);
}

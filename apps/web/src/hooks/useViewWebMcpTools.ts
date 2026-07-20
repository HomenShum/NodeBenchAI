/**
 * useViewWebMcpTools - per-view WebMCP tool registration.
 *
 * Registers contextually relevant tools when a view is mounted, and
 * unregisters them when the view changes. Matches WebMCP's per-page
 * tool exposure model: agents only see tools relevant to the current page.
 *
 * Tools with a `gatewayFn` are routed to real Convex endpoints.
 * Tools without a gateway mapping return a structured stub with instructions.
 *
 * Example: navigating to Research registers research search, signal, and
 * funding-brief tools. Leaving Research removes them.
 */

import { useEffect, useRef } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { MainView } from "@/lib/registry/viewRegistry";
import { getViewTools, type ViewToolDefinition } from "@/lib/registry/viewToolMap";

// ---------------------------------------------------------------------------
// Typed route dispatch - maps gateway function names to Convex API refs
// ---------------------------------------------------------------------------

type ConvexRoute = {
  type: "query" | "mutation";
  ref: any; // Typed Convex FunctionReference
};

/**
 * Maps ALLOWLIST function names to typed Convex API references.
 * Only includes public queries callable from the browser client.
 * Auth-required operations (Group B/C) use the MCP Gateway HTTP endpoint.
 */
const GATEWAY_ROUTES: Record<string, ConvexRoute> = {
  // Group A: Public queries
  getPublicForYouFeed: { type: "query", ref: api.domains.research.forYouFeed.getPublicForYouFeed },
  getSignalTimeseries: { type: "query", ref: api.domains.research.signalTimeseries.getSignalTimeseries },
  getDealFlow: { type: "query", ref: api.domains.research.dealFlowQueries.getDealFlow },
  getTrendingRepos: { type: "query", ref: api.domains.research.githubExplorer.getTrendingRepos },
  getLatestDashboardSnapshot: { type: "query", ref: api.domains.research.dashboardQueries.getLatestDashboardSnapshot },
  // hybridSearch - research search (public)
  hybridSearch: { type: "query", ref: api.domains.research.hybridSearch.hybridSearch },
};

// ---------------------------------------------------------------------------
// Execute a tool definition against its real Convex endpoint
// ---------------------------------------------------------------------------

async function executeTool(
  convex: ReturnType<typeof useConvex>,
  def: ViewToolDefinition,
  currentView: MainView,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const gatewayFn = def.gatewayFn;
  if (!gatewayFn) {
    // No backend endpoint - return structured stub
    return {
      success: true,
      tool: def.name,
      view: currentView,
      note: `${def.name} is a frontend-only tool with no backend endpoint. Interact with the UI directly.`,
    };
  }

  const route = GATEWAY_ROUTES[gatewayFn];
  if (!route) {
    // Gateway function not in the browser-callable route map.
    // This happens for auth-required operations (Group B/C).
    return {
      success: true,
      tool: def.name,
      view: currentView,
      note: `${def.name} requires server-side auth (gateway: ${gatewayFn}). Use the MCP server's invoke_view_tool for authenticated operations.`,
    };
  }

  // Map args if the tool definition provides a transformer
  const mappedArgs = def.mapArgs ? def.mapArgs(args) : args;

  if (route.type === "query") {
    const result = await convex.query(route.ref, mappedArgs);
    return { success: true, tool: def.name, view: currentView, result };
  } else {
    const result = await convex.mutation(route.ref, mappedArgs);
    return { success: true, tool: def.name, view: currentView, result };
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useViewWebMcpTools(currentView: MainView, enabled: boolean) {
  const convex = useConvex();
  const previousViewRef = useRef<MainView | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.modelContext?.provideContext) return;

    // Only re-register if view actually changed
    if (previousViewRef.current === currentView) return;
    previousViewRef.current = currentView;

    const toolDefs = getViewTools(currentView);
    if (toolDefs.length === 0) return;

    // Build executable tools from definitions
    const tools = toolDefs.map((def) => ({
      name: def.name,
      description: `[${currentView}] ${def.description}`,
      inputSchema: def.inputSchema,
      execute: async (args: any) => {
        try {
          return await executeTool(convex, def, currentView, args ?? {});
        } catch (e: any) {
          return { success: false, tool: def.name, error: e.message };
        }
      },
    }));

    try {
      navigator.modelContext.provideContext({ tools });
    } catch {
      // WebMCP not available
    }
  }, [currentView, enabled, convex]);
}

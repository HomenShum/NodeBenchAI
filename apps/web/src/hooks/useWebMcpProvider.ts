/**
 * useWebMcpProvider — Registers NodeBench tools via navigator.modelContext.
 *
 * Exposes NodeBench capabilities as WebMCP tools that browser agents can
 * discover and invoke. Inspired by Moltbook's feed-based discovery and
 * WebMCP's per-page tool registration pattern.
 *
 * Tools (12 total):
 *   Content:
 *   - nodebench_search: search documents and knowledge
 *   - nodebench_create_document: create a new document
 *   - nodebench_get_digest: get the latest morning digest
 *   - nodebench_ask_agent: send a question to the agent
 *
 *   Agent Traversability (Phase 1):
 *   - nodebench_get_app_state: current view, capabilities, auth status
 *   - nodebench_list_views: full view manifest (27 views with capabilities)
 *   - nodebench_navigate: navigate to a view, returns target capabilities
 *   - nodebench_get_screen_context: current screen metadata and active scopes
 *
 *   DOM Introspection (Phase 2):
 *   - nodebench_query_elements: all data-agent-* annotated elements on page
 *
 *   Feed Traversal (Phase 3):
 *   - nodebench_traverse_feed: Moltbook-style hot/new/top/rising feeds
 *
 *   Discovery:
 *   - nodebench_get_capabilities: meta-tool listing all available tools
 *   - nodebench_search_views: search views by query
 *
 * Uses the W3C WebMCP draft API: navigator.modelContext.provideContext()
 */

import { useEffect, useRef } from "react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { MainView } from "@/lib/registry/viewRegistry";
import {
  type ViewCapability,
  getViewCapability,
  getAllViewCapabilities,
  searchViewCapabilities,
} from "@/lib/registry/viewCapabilityRegistry";

declare global {
  interface Navigator {
    modelContext?: {
      provideContext: (opts: {
        tools: Array<{
          name: string;
          description: string;
          inputSchema?: Record<string, unknown>;
          execute: (args: any, context: any) => Promise<any>;
        }>;
      }) => void;
    };
  }
}

interface WebMcpProviderOptions {
  enabled: boolean;
  /** Current view for state API */
  currentView?: MainView;
  /** Current URL path */
  currentPath?: string;
  /** Is user authenticated? */
  isAuthenticated?: boolean;
  /** Is agent panel open? */
  agentPanelOpen?: boolean;
  /** Callback to navigate to a view */
  onNavigate?: (view: MainView) => void;
}

type ScreenScopeSummary = {
  id: string;
  label: string;
  role: string;
  visible: boolean;
};

function isDomElementVisible(element: Element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

function getScreenRoot() {
  return document.querySelector<HTMLElement>("[data-screen-id]") ?? document.querySelector<HTMLElement>("[data-main-content]");
}

function getElementLabel(element: HTMLElement) {
  return (
    element.getAttribute("data-agent-label") ??
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.getAttribute("placeholder") ??
    element.innerText?.replace(/\s+/g, " ").trim() ??
    element.textContent?.replace(/\s+/g, " ").trim() ??
    element.tagName.toLowerCase()
  );
}

function getActiveScopes(): ScreenScopeSummary[] {
  const roots = [
    ...document.querySelectorAll<HTMLElement>("[role='dialog'], [aria-modal='true'], [aria-label='AI Chat Panel'], [aria-label='Agent Interface']"),
  ].filter(isDomElementVisible);

  return roots.map((root, index) => ({
    id:
      root.getAttribute("data-agent-id") ??
      root.getAttribute("data-screen-id") ??
      root.getAttribute("aria-label") ??
      `scope-${index + 1}`,
    label: getElementLabel(root),
    role: root.getAttribute("role") ?? "dialog",
    visible: true,
  }));
}

function getScreenContext() {
  const screenRoot = getScreenRoot();
  const activeScopes = getActiveScopes();

  return {
    appId: document.querySelector("[data-app-id]")?.getAttribute("data-app-id") ?? "nodebench-ai",
    screenId:
      screenRoot?.getAttribute("data-screen-id") ??
      screenRoot?.getAttribute("data-current-view") ??
      null,
    screenTitle:
      screenRoot?.getAttribute("data-screen-title") ??
      screenRoot?.getAttribute("data-agent-label") ??
      screenRoot?.getAttribute("aria-label") ??
      document.title,
    screenPath: screenRoot?.getAttribute("data-screen-path") ?? window.location.pathname,
    routeView: screenRoot?.getAttribute("data-route-view") ?? null,
    loadState: screenRoot?.getAttribute("data-screen-state") ?? "ready",
    activeScopes,
    webmcpEnabled: Boolean(navigator.modelContext),
    chromeDevtoolsCompatible:
      document.querySelector("[data-mcp-compat]")?.getAttribute("data-mcp-compat")?.includes("chrome-devtools-mcp") ?? false,
  };
}

function queryAnnotatedElements(args: { filter?: string; scope?: string; visibleOnly?: boolean }) {
  const activeScopes = getActiveScopes();
  const explicitScope = args.scope
    ? document.querySelector<HTMLElement>(
        `[data-agent-id="${args.scope}"], [data-screen-id="${args.scope}"], [aria-label="${args.scope}"]`,
      )
    : null;
  const activeScopeRoot = explicitScope ?? (activeScopes.length > 0
    ? document.querySelector<HTMLElement>(
        `[data-agent-id="${activeScopes[activeScopes.length - 1]?.id}"], [aria-label="${activeScopes[activeScopes.length - 1]?.label}"]`,
      )
    : null);
  const searchRoot = activeScopeRoot ?? getScreenRoot() ?? document.body;
  const elements = searchRoot.querySelectorAll<HTMLElement>("[data-agent-id]");

  return [...elements]
    .filter((el) => {
      const agentId = el.getAttribute("data-agent-id") ?? "";
      if (args.filter && !agentId.includes(args.filter)) return false;
      if (args.visibleOnly === false) return true;
      return isDomElementVisible(el);
    })
    .map((el) => ({
      agentId: el.getAttribute("data-agent-id") ?? "",
      action: el.getAttribute("data-agent-action"),
      label: el.getAttribute("data-agent-label") ?? getElementLabel(el),
      target: el.getAttribute("data-agent-target"),
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      visible: isDomElementVisible(el),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      screenId: getScreenRoot()?.getAttribute("data-screen-id") ?? null,
      scopeId:
        activeScopeRoot?.getAttribute("data-agent-id") ??
        activeScopeRoot?.getAttribute("aria-label") ??
        getScreenRoot()?.getAttribute("data-screen-id") ??
        null,
    }));
}

export function useWebMcpProvider(enabledOrOptions: boolean | WebMcpProviderOptions) {
  // Support both legacy boolean and new options object
  const opts: WebMcpProviderOptions = typeof enabledOrOptions === "boolean"
    ? { enabled: enabledOrOptions }
    : enabledOrOptions;

  const {
    enabled,
    currentView = "research",
    currentPath = "/",
    isAuthenticated = false,
    agentPanelOpen = false,
    onNavigate,
  } = opts;

  const convex = useConvex();
  const cleanupRef = useRef<(() => void) | null>(null);
  // Stable ref for values that change frequently but shouldn't re-register all tools
  const stateRef = useRef({ currentView, currentPath, isAuthenticated, agentPanelOpen, onNavigate });
  stateRef.current = { currentView, currentPath, isAuthenticated, agentPanelOpen, onNavigate };

  useEffect(() => {
    if (!enabled || !navigator.modelContext?.provideContext) {
      return;
    }

    // --- Helper to build a compact view summary ---
    const summarizeView = (v: ViewCapability) => ({
      viewId: v.viewId,
      title: v.title,
      description: v.description,
      paths: v.paths,
      actions: v.actions.map((a) => a.name),
      dataEndpoints: v.dataEndpoints.map((d) => d.name),
      tags: v.tags,
      requiresAuth: v.requiresAuth,
    });

    const tools = [
      // ---------------------------------------------------------------
      // Content tools (existing)
      // ---------------------------------------------------------------
      {
        name: "nodebench_search",
        description:
          "Search NodeBench documents, research dossiers, and knowledge base. Returns relevant results with titles, snippets, and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default: 10)" },
          },
          required: ["query"],
        },
        execute: async (args: { query: string; limit?: number }) => {
          try {
            const results = await convex.query(
              api.domains.research.hybridSearch.hybridSearch,
              { query: args.query, topK: args.limit ?? 10 }
            );
            return { success: true, results };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
      {
        name: "nodebench_create_document",
        description:
          "Create a new document in NodeBench. Supports markdown content with optional metadata tags.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Document title" },
            content: { type: "string", description: "Document content (markdown)" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags for categorization",
            },
          },
          required: ["title", "content"],
        },
        execute: async (args: {
          title: string;
          content: string;
          tags?: string[];
        }) => {
          try {
            const id = await convex.mutation(
              api.domains.documents.documentMutations.createDocument,
              {
                title: args.title,
                content: args.content,
                tags: args.tags ?? [],
              }
            );
            return { success: true, documentId: id };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
      {
        name: "nodebench_get_digest",
        description:
          "Retrieve the latest morning digest — a curated summary of research signals, trending topics, and actionable insights.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          try {
            const digest = await convex.query(
              api.domains.research.forYouFeed.getPublicForYouFeed,
              {}
            );
            return { success: true, digest };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },
      {
        name: "nodebench_ask_agent",
        description:
          "Send a question to the NodeBench AI agent. Returns a structured response with reasoning and sources.",
        inputSchema: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question to ask the agent",
            },
          },
          required: ["question"],
        },
        execute: async (args: { question: string }) => {
          try {
            const result = await convex.query(
              api.domains.research.hybridSearch.hybridSearch,
              { query: args.question, topK: 5 }
            );
            return {
              success: true,
              answer: `Found ${Array.isArray(result) ? result.length : 0} relevant results for your question.`,
              sources: result,
            };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },

      // ---------------------------------------------------------------
      // Agent Traversability — Phase 1: State & Navigation
      // ---------------------------------------------------------------
      {
        name: "nodebench_get_app_state",
        description:
          "Get the current application state — which view is active, its capabilities (data endpoints, actions, tools), authentication status, and whether the agent panel is open. Call this first to orient yourself.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          const s = stateRef.current;
          const cap = getViewCapability(s.currentView);
          return {
            success: true,
            state: {
              currentView: s.currentView,
              currentPath: s.currentPath,
              isAuthenticated: s.isAuthenticated,
              agentPanelOpen: s.agentPanelOpen,
              viewCapabilities: summarizeView(cap),
              screenContext: typeof document !== "undefined" ? getScreenContext() : null,
            },
          };
        },
      },
      {
        name: "nodebench_get_screen_context",
        description:
          "Get the current screen's DOM contract for browser agents: stable screen id, title, path, load state, and any active dialog or panel scopes. Use this before interacting so WebMCP and Chrome DevTools MCP can target the right surface.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          return {
            success: true,
            screen: typeof document !== "undefined" ? getScreenContext() : null,
          };
        },
      },
      {
        name: "nodebench_list_views",
        description:
          "List all available views with their capabilities — titles, descriptions, actions, data endpoints, and tags. Use this to discover what the app offers before navigating. Returns a manifest of all 27+ views.",
        inputSchema: {
          type: "object",
          properties: {
            includeAuthOnly: {
              type: "boolean",
              description: "Include views that require authentication (default: false)",
            },
          },
        },
        execute: async (args: { includeAuthOnly?: boolean }) => {
          const all = getAllViewCapabilities();
          const filtered = args.includeAuthOnly
            ? all
            : all.filter((v) => !v.requiresAuth || stateRef.current.isAuthenticated);
          return {
            success: true,
            views: filtered.map(summarizeView),
            totalViews: filtered.length,
          };
        },
      },
      {
        name: "nodebench_navigate",
        description:
          "Navigate to a specific view. Returns the target view's full capabilities so you know what data and actions will be available. Use nodebench_list_views first to discover valid view IDs.",
        inputSchema: {
          type: "object",
          properties: {
            view: {
              type: "string",
              description: "Target view ID (e.g. 'research', 'funding', 'agents', 'documents')",
            },
            reason: {
              type: "string",
              description: "Why you're navigating (shown to user)",
            },
          },
          required: ["view"],
        },
        execute: async (args: { view: string; reason?: string }) => {
          try {
            const cap = getViewCapability(args.view as MainView);
            if (!cap) {
              return { success: false, error: `Unknown view: ${args.view}. Use nodebench_list_views to see valid IDs.` };
            }
            // Trigger navigation if callback available
            stateRef.current.onNavigate?.(args.view as MainView);
            return {
              success: true,
              navigatedTo: args.view,
              capabilities: summarizeView(cap),
            };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },

      // ---------------------------------------------------------------
      // Phase 2: DOM Introspection
      // ---------------------------------------------------------------
      {
        name: "nodebench_query_elements",
        description:
          "Query all agent-annotated interactive elements on the current page. Returns elements with their data-agent-id, action type, label, and target. Use this to understand what you can interact with on the current view.",
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description: "Optional filter — only return elements whose ID contains this substring",
            },
            scope: {
              type: "string",
              description: "Optional scope selector by data-agent-id, data-screen-id, or aria-label. If omitted, the active dialog/panel scope is preferred.",
            },
            visibleOnly: {
              type: "boolean",
              description: "Return only visible elements (default: true)",
            },
          },
        },
        execute: async (args: { filter?: string; scope?: string; visibleOnly?: boolean }) => {
          try {
            const results = queryAnnotatedElements(args);

            return {
              success: true,
              elements: results,
              count: results.length,
              currentView: stateRef.current.currentView,
              screenContext: getScreenContext(),
            };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },

      // ---------------------------------------------------------------
      // Phase 3: Feed Traversal (Moltbook pattern)
      // ---------------------------------------------------------------
      {
        name: "nodebench_traverse_feed",
        description:
          "Traverse content feeds with Moltbook-style sorting (hot, new, top, rising). Supports pagination via cursor. Available feed types: research, signals, documents, agents, funding, activity.",
        inputSchema: {
          type: "object",
          properties: {
            feedType: {
              type: "string",
              enum: ["research", "signals", "documents", "agents", "funding", "activity"],
              description: "Which feed to traverse",
            },
            sort: {
              type: "string",
              enum: ["hot", "new", "top", "rising"],
              description: "Sort order (default: hot)",
            },
            limit: {
              type: "number",
              description: "Number of items to return (default: 10, max: 50)",
            },
          },
          required: ["feedType"],
        },
        execute: async (args: { feedType: string; sort?: string; limit?: number }) => {
          try {
            const feedType = args.feedType as "research" | "signals" | "documents" | "agents" | "funding" | "activity";
            const sort = (args.sort ?? "hot") as "hot" | "new" | "top" | "rising";
            const limit = Math.min(args.limit ?? 10, 50);

            const result = await convex.query(
              api.domains.agents.agentFeedTraversal.traverseFeed,
              { feedType, sort, limit },
            );

            return {
              success: true,
              feedType: result.feedType,
              sort: result.sort,
              items: result.items,
              count: result.items.length,
              total: result.total,
              hasMore: result.hasMore,
            };
          } catch (e: any) {
            return { success: false, error: e.message };
          }
        },
      },

      // ---------------------------------------------------------------
      // Discovery: Meta-tool
      // ---------------------------------------------------------------
      {
        name: "nodebench_get_capabilities",
        description:
          "Meta-tool: lists all available WebMCP tools with their descriptions. Call this first to understand what you can do with NodeBench.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        execute: async () => {
          return {
            success: true,
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
            })),
            totalTools: tools.length,
            version: "2.0.0",
          };
        },
      },
      {
        name: "nodebench_search_views",
        description:
          "Search for views by keyword — matches against titles, descriptions, tags, and tool categories. Use this to find the right view for a task.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (e.g. 'funding', 'code review', 'calendar')",
            },
          },
          required: ["query"],
        },
        execute: async (args: { query: string }) => {
          const matches = searchViewCapabilities(args.query);
          return {
            success: true,
            matches: matches.map(summarizeView),
            count: matches.length,
          };
        },
      },
    ];

    try {
      navigator.modelContext.provideContext({ tools });
    } catch {
      // WebMCP not supported or errored — fail silently
    }

    return () => {
      cleanupRef.current?.();
    };
  }, [enabled, convex]);
}

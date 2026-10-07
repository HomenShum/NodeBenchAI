/**
 * View Capability Registry
 *
 * Agent-readable metadata for routed views. The manifest is derived from
 * VIEW_REGISTRY so stale product surfaces cannot stay advertised after their
 * routes are removed or internalized.
 */

import {
  VIEW_REGISTRY,
  type CockpitSurfaceId,
  type MainView,
  type RouteGroup,
  type ViewRegistryEntry,
} from "@/lib/registry/viewRegistry";

export interface ViewDataEndpoint {
  /** Human-readable name */
  name: string;
  /** Convex query path, when the surface has a stable backend contract */
  convexQuery: string;
  /** What this endpoint returns */
  description: string;
}

export interface ViewAction {
  /** Action identifier */
  name: string;
  /** What this action does */
  description: string;
  /** Optional JSON Schema for inputs */
  inputSchema?: Record<string, unknown>;
}

export interface ViewCapability {
  viewId: MainView;
  /** Display title */
  title: string;
  /** Agent-friendly description of what this view is for */
  description: string;
  /** URL path(s), primary path first */
  paths: string[];
  /** Data queries this view loads */
  dataEndpoints: ViewDataEndpoint[];
  /** Actions a user or agent can take */
  actions: ViewAction[];
  /** Related MCP tool categories from TOOLSET_MAP */
  relatedToolCategories: string[];
  /** Search tags for discovery */
  tags: string[];
  /** Does this view require authentication? */
  requiresAuth: boolean;
}

type CapabilityOverride = Partial<Omit<ViewCapability, "viewId" | "title" | "paths">> & {
  title?: string;
  paths?: string[];
};

const SURFACE_TOOL_CATEGORIES: Record<CockpitSurfaceId, string[]> = {
  ask: ["platform", "research", "verification"],
  workspace: ["research", "documents", "verification"],
  packets: ["research", "documents", "verification"],
  history: ["memory", "verification"],
  connect: ["platform", "memory"],
  trace: ["verification", "flywheel", "platform"],
};

const GROUP_TAGS: Record<RouteGroup, string[]> = {
  core: ["core"],
  nested: ["nested"],
  internal: ["internal"],
  legacy: ["legacy"],
};

const uniqueStrings = (values: Array<string | undefined | null>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

function defaultCapability(entry: ViewRegistryEntry): ViewCapability {
  const surfaceId = entry.surfaceId ?? "ask";
  return {
    viewId: entry.id,
    title: entry.title,
    description: entry.subtitle ?? entry.title,
    paths: uniqueStrings([entry.path, ...(entry.aliases ?? [])]),
    dataEndpoints: [],
    actions: [],
    relatedToolCategories: SURFACE_TOOL_CATEGORIES[surfaceId],
    tags: uniqueStrings([entry.id, entry.group, surfaceId, ...GROUP_TAGS[entry.group]]),
    requiresAuth: entry.group === "internal",
  };
}

const CAPABILITY_OVERRIDES: Partial<Record<MainView, CapabilityOverride>> = {
  "control-plane": {
    description:
      "Home surface for asking questions, uploading evidence, previewing reports, and launching live chat runs.",
    actions: [
      { name: "openReceipts", description: "Open the action receipt stream" },
      { name: "openDelegation", description: "Open the passport and approval surface" },
      { name: "startChat", description: "Launch the live chat surface" },
    ],
    relatedToolCategories: ["platform", "research", "verification"],
    tags: ["home", "control-plane", "landing", "trust", "reports"],
    requiresAuth: false,
  },
  research: {
    description:
      "Research hub with overview, signals, briefing, deals, changes, and changelog tabs.",
    dataEndpoints: [
      {
        name: "forYouFeed",
        convexQuery: "domains.research.forYouFeed.getPublicForYouFeed",
        description: "Ranked feed of research signals and content",
      },
      {
        name: "morningDigest",
        convexQuery: "domains.research.morningDigest.getLatestDigest",
        description: "Latest curated morning briefing",
      },
    ],
    actions: [
      {
        name: "switchTab",
        description: "Switch between research hub tabs",
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
      {
        name: "searchResearch",
        description: "Search across research content",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
    relatedToolCategories: ["research", "recon", "learning"],
    tags: ["research", "signals", "briefing", "deals", "changelog"],
    requiresAuth: false,
  },
  "chat-home": {
    description:
      "Live assistant surface for search-grounded research, follow-up questions, and report generation.",
    actions: [
      {
        name: "sendMessage",
        description: "Send a message to the live chat run",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
      },
    ],
    relatedToolCategories: ["research", "documents", "verification"],
    tags: ["chat", "assistant", "search", "reports"],
    requiresAuth: false,
  },
  "reports-home": {
    description: "Saved report library with public packets, report details, and workspace handoff paths.",
    dataEndpoints: [
      {
        name: "reports",
        convexQuery: "domains.product.home.getPublicReports",
        description: "Public report cards and freshness metadata",
      },
    ],
    actions: [
      { name: "openReport", description: "Open a saved report or report detail route" },
      { name: "openWorkspace", description: "Open the separate workspace surface for a report" },
    ],
    relatedToolCategories: ["research", "documents", "verification"],
    tags: ["reports", "packets", "workspace", "library"],
    requiresAuth: false,
  },
  "report-detail": {
    description: "Canonical report detail route with entity, source, and follow-up context.",
    relatedToolCategories: ["research", "documents", "verification"],
    tags: ["report", "detail", "sources", "entity"],
    requiresAuth: false,
  },
  "report-detail-workspace": {
    description: "Workspace-scoped report route for notebook, source, card, chat, and map work.",
    relatedToolCategories: ["documents", "research", "verification"],
    tags: ["workspace", "report", "notebook", "sources"],
    requiresAuth: false,
  },
  "nudges-home": {
    title: "Inbox",
    description: "Inbox surface for follow-ups, nudges, saved context, and recent activity.",
    relatedToolCategories: ["memory", "verification"],
    tags: ["inbox", "nudges", "memory", "activity"],
    requiresAuth: false,
  },
  "me-home": {
    description: "Account, profile, preferences, and personal workspace entrypoints.",
    relatedToolCategories: ["platform", "memory"],
    tags: ["me", "profile", "settings", "account"],
    requiresAuth: false,
  },
  "mcp-ledger": {
    description:
      "MCP tool call ledger and local sync inspector for policy decisions, paired devices, shared history, and shared-context packets.",
    dataEndpoints: [
      {
        name: "toolCalls",
        convexQuery: "domains.mcp.mcpToolLedger.listToolCalls",
        description: "Recent MCP tool call audit trail",
      },
      {
        name: "policyAndUsage",
        convexQuery: "domains.mcp.mcpToolLedger.getPolicyAndUsage",
        description: "Current policy snapshot and tier usage",
      },
    ],
    actions: [
      { name: "filterByTool", description: "Filter by tool name" },
      { name: "generatePairingCode", description: "Create a consented pairing code for local MCP sync" },
      { name: "inspectSharedContext", description: "Review peers, packets, and shared task handoffs" },
    ],
    relatedToolCategories: ["verification", "flywheel", "platform"],
    tags: ["mcp", "ledger", "audit", "sync-bridge", "shared-context", "tool-activity"],
    requiresAuth: true,
  },
  receipts: {
    description:
      "Receipt stream for denied, approval-gated, and reversible agent actions with evidence and tamper checks.",
    dataEndpoints: [
      {
        name: "receipts",
        convexQuery: "domains.agents.receipts.actionReceipts.list",
        description: "Newest-first action receipt stream",
      },
    ],
    actions: [
      { name: "filterReceipts", description: "Filter receipts by policy action, approval state, or session key" },
      { name: "reviewPendingApprovals", description: "Review approval-gated actions waiting for a decision" },
    ],
    tags: ["receipts", "audit", "approval", "trust", "evidence"],
    requiresAuth: false,
  },
  delegation: {
    description: "Delegation and approval surface for scoped tools, denied actions, and human approval gates.",
    actions: [
      { name: "reviewScopes", description: "Inspect delegated scopes and approval gates" },
      { name: "reviewDeniedActions", description: "Inspect denied tools and escalation boundaries" },
    ],
    tags: ["delegation", "passport", "approvals", "permissions"],
    requiresAuth: false,
  },
  "execution-trace": {
    description:
      "Traceable record of inspect, research, edit, verify, export, and approval steps for a workflow.",
    dataEndpoints: [
      {
        name: "taskSessions",
        convexQuery: "domains.taskManager.queries.getTaskSessions",
        description: "Saved task runs and sessions adaptable into execution traces",
      },
    ],
    actions: [
      { name: "switchDisclosureLevel", description: "Switch between outcome, why, and full trace views" },
      { name: "inspectDecisionTrail", description: "Inspect decisions, evidence, and verification records" },
    ],
    tags: ["execution-trace", "workflow", "audit", "verification"],
    requiresAuth: false,
  },
  agents: {
    description: "AI assistants, autonomous operations, and run governance for internal operator workflows.",
    dataEndpoints: [
      {
        name: "autonomousControlTower",
        convexQuery: "domains.operations.autonomousControlTower.getAutonomousControlTowerSnapshot",
        description: "Autonomous operations snapshot and attention queue",
      },
    ],
    actions: [
      { name: "runMaintenanceNow", description: "Trigger an autonomous maintenance pass" },
      { name: "reviewAttentionQueue", description: "Inspect issues requiring operator intervention" },
    ],
    relatedToolCategories: ["verification", "flywheel", "platform"],
    tags: ["agents", "operations", "maintenance", "control-tower"],
    requiresAuth: false,
  },
  entity: {
    description: "Deep profile for a company, person, or topic with signals, sources, and timeline context.",
    dataEndpoints: [
      {
        name: "entityProfile",
        convexQuery: "domains.research.entities.getEntityProfile",
        description: "Full entity profile with signals and timeline",
      },
    ],
    actions: [
      { name: "browseRelated", description: "Browse related entities" },
      { name: "viewTimeline", description: "View the entity signal timeline" },
    ],
    relatedToolCategories: ["research", "recon", "verification"],
    tags: ["entity", "profile", "company", "person", "sources"],
    requiresAuth: false,
  },
  "entity-pulse": {
    description: "Daily change digest for a single entity with fresh signals and linked source context.",
    dataEndpoints: [
      {
        name: "entityPulse",
        convexQuery: "domains.product.home.getPulsePreview",
        description: "Latest per-entity pulse preview and freshness metadata",
      },
    ],
    actions: [
      { name: "openLinkedReport", description: "Open the linked canonical report" },
      { name: "openEntityProfile", description: "Open the entity profile for the pulse subject" },
    ],
    relatedToolCategories: ["research", "verification"],
    tags: ["entity-pulse", "daily-brief", "signals", "report"],
    requiresAuth: false,
  },
  "benchmark-comparison": {
    description: "Internal proof surface for the benchmark ladder and capability comparisons.",
    actions: [
      { name: "reviewBenchmark", description: "Inspect benchmark ladder evidence" },
      { name: "compareBaselines", description: "Compare structured output against baseline approaches" },
    ],
    relatedToolCategories: ["eval", "verification", "quality_gate"],
    tags: ["benchmarks", "eval", "quality", "internal"],
    requiresAuth: false,
  },
  dogfood: {
    description: "Internal dogfood gallery with Gemini QA evidence and release readiness signals.",
    actions: [
      { name: "reviewQaResults", description: "Review QA scores, screenshots, and governance issues" },
    ],
    relatedToolCategories: ["verification", "quality_gate", "flywheel"],
    tags: ["dogfood", "qa", "screenshots", "release"],
    requiresAuth: false,
  },
};

export const VIEW_CAPABILITIES: Record<MainView, ViewCapability> = Object.fromEntries(
  VIEW_REGISTRY.map((entry) => {
    const base = defaultCapability(entry);
    const override = CAPABILITY_OVERRIDES[entry.id] ?? {};
    return [
      entry.id,
      {
        ...base,
        ...override,
        paths: override.paths ?? base.paths,
        dataEndpoints: override.dataEndpoints ?? base.dataEndpoints,
        actions: override.actions ?? base.actions,
        relatedToolCategories: uniqueStrings([
          ...base.relatedToolCategories,
          ...(override.relatedToolCategories ?? []),
        ]),
        tags: uniqueStrings([...base.tags, ...(override.tags ?? [])]),
        requiresAuth: override.requiresAuth ?? base.requiresAuth,
      },
    ];
  }),
) as Record<MainView, ViewCapability>;

/** Get capability for a specific view */
export function getViewCapability(viewId: MainView): ViewCapability {
  return VIEW_CAPABILITIES[viewId];
}

/** Get all view capabilities as an array */
export function getAllViewCapabilities(): ViewCapability[] {
  return VIEW_REGISTRY.map((entry) => VIEW_CAPABILITIES[entry.id]);
}

/** Find views matching a search query (tag, title, or description) */
export function searchViewCapabilities(query: string): ViewCapability[] {
  const q = query.toLowerCase();
  return getAllViewCapabilities().filter(
    (v) =>
      v.title.toLowerCase().includes(q) ||
      v.description.toLowerCase().includes(q) ||
      v.tags.some((t) => t.includes(q)) ||
      v.relatedToolCategories.some((c) => c.includes(q)),
  );
}

/** Find views by MCP tool category */
export function getViewsByToolCategory(category: string): ViewCapability[] {
  return getAllViewCapabilities().filter((v) =>
    v.relatedToolCategories.includes(category),
  );
}

/** Serialize the registry as agent-consumable JSON */
export function getRegistryAsJSON(): string {
  return JSON.stringify(getAllViewCapabilities(), null, 2);
}

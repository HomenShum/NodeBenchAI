/**
 * View Capability Registry — Machine-readable manifest of what each view offers.
 *
 * Inspired by WebMCP's per-page tool exposure and Moltbook's structured
 * content discovery API. Agents query this registry to understand what
 * data, actions, and tools are available on each view before navigating.
 *
 * Pure data — no side effects, no hooks, no React imports.
 */

import type { MainView } from "@/lib/registry/viewRegistry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewDataEndpoint {
  /** Human-readable name */
  name: string;
  /** Convex query path (e.g. "domains.research.forYouFeed.getPublicForYouFeed") */
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
  /** URL path(s) — primary path first */
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

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const VIEW_CAPABILITIES: Record<MainView, ViewCapability> = {
  "control-plane": {
    viewId: "control-plane",
    title: "Home",
    description:
      "Front door for the product. Start with a question, upload evidence, review quick previews, and launch a live chat run.",
    paths: ["/", "/control-plane", "/home", "/landing"],
    dataEndpoints: [],
    actions: [
      { name: "openReceipts", description: "Open the action receipt stream" },
      { name: "openDelegation", description: "Open the passport and approval surface" },
      { name: "openInvestigation", description: "Open the investigation surface" },
    ],
    relatedToolCategories: ["platform", "verification", "learning"],
    tags: ["deeptrace", "control-plane", "landing", "trust", "receipts"],
    requiresAuth: false,
  },

  receipts: {
    viewId: "receipts",
    title: "Action Receipts",
    description:
      "Receipt stream for denied, approval-gated, and reversible agent actions with evidence, approvals, and tamper checks.",
    paths: ["/receipts", "/action-receipts", "/control-plane/receipts"],
    dataEndpoints: [
      {
        name: "receipts",
        convexQuery: "domains.agents.receipts.actionReceipts.list",
        description: "Newest-first action receipt stream with optional filters",
      },
      {
        name: "receiptStats",
        convexQuery: "domains.agents.receipts.actionReceipts.stats",
        description: "Aggregate counts for allowed, escalated, denied, and violations",
      },
    ],
    actions: [
      {
        name: "filterReceipts",
        description: "Filter receipts by policy action, approval state, or session key",
        inputSchema: {
          type: "object",
          properties: {
            policyAction: { type: "string" },
            approvalState: { type: "string" },
            sessionKey: { type: "string" },
          },
        },
      },
      {
        name: "verifyReceiptHash",
        description: "Verify receipt integrity by recomputing its content hash",
        inputSchema: { type: "object", properties: { receiptId: { type: "string" } }, required: ["receiptId"] },
      },
    ],
    relatedToolCategories: ["verification", "flywheel", "platform"],
    tags: ["receipts", "audit", "approval", "trust", "evidence"],
    requiresAuth: false,
  },

  delegation: {
    viewId: "delegation",
    title: "Passport",
    description:
      "Delegation and approval surface for scoped tools, denied actions, and human approval gates before an agent acts.",
    paths: ["/delegation", "/delegate", "/passport", "/control-plane/delegation", "/control-plane/passport"],
    dataEndpoints: [],
    actions: [
      { name: "reviewScopes", description: "Inspect delegated scopes and approval gates" },
      { name: "reviewDeniedActions", description: "Inspect denied tools and escalation boundaries" },
    ],
    relatedToolCategories: ["verification", "platform"],
    tags: ["delegation", "passport", "approvals", "permissions", "scope"],
    requiresAuth: false,
  },

  research: {
    viewId: "research",
    title: "Research Hub",
    description:
      "Research hub with tabbed navigation for overview, signals, briefing, deals, changes, and changelog. The primary intelligence surface after the NodeBench landing page.",
    paths: ["/research", "/hub", "/onboarding", "/research/overview", "/research/signals", "/research/briefing", "/research/deals", "/research/changes", "/research/changelog"],
    dataEndpoints: [
      { name: "forYouFeed", convexQuery: "domains.research.forYouFeed.getPublicForYouFeed", description: "Ranked feed of research signals and content" },
      { name: "morningDigest", convexQuery: "domains.research.morningDigest.getLatestDigest", description: "Latest curated morning briefing" },
    ],
    actions: [
      { name: "switchTab", description: "Switch between research hub tabs (overview, signals, briefing, deals, changes, changelog)", inputSchema: { type: "object", properties: { tab: { type: "string", enum: ["overview", "signals", "briefing", "deals", "changes", "changelog"] } }, required: ["tab"] } },
      { name: "search", description: "Search across all research content", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    ],
    relatedToolCategories: ["research", "recon", "learning"],
    tags: ["home", "research", "signals", "briefing", "overview"],
    requiresAuth: false,
  },

  "product-direction": {
    viewId: "product-direction",
    title: "Product Direction",
    description:
      "Evidence-bounded company direction memo that separates verified facts from inference, scores adjacency, and recommends what to build next.",
    paths: ["/product-direction", "/strategy", "/strategy/product-direction", "/research/product-direction"],
    dataEndpoints: [],
    actions: [
      { name: "reviewExecutiveAnswer", description: "Review the one-page recommendation and truth boundary" },
      { name: "inspectCredibilityFilter", description: "Inspect high, medium, and low credibility product directions" },
      { name: "exportMemoJson", description: "Export the structured memo contract as JSON" },
    ],
    relatedToolCategories: ["research", "verification", "learning"],
    tags: ["strategy", "product-direction", "memo", "credibility", "evidence"],
    requiresAuth: false,
  },

  "execution-trace": {
    viewId: "execution-trace",
    title: "Execution Trace",
    description:
      "Traceable record of inspect, research, edit, verify, export, and approval steps for a workflow, with progressive disclosure from outcome to full trace.",
    paths: ["/execution-trace", "/workflow-trace", "/trace/execution"],
    dataEndpoints: [
      {
        name: "taskSessions",
        convexQuery: "domains.taskManager.queries.getTaskSessions",
        description: "Saved task runs and sessions that can be adapted into execution traces",
      },
    ],
    actions: [
      { name: "switchDisclosureLevel", description: "Switch between outcome, why, and full trace views" },
      { name: "inspectDecisionTrail", description: "Inspect decisions, evidence, and verification records for a run" },
      { name: "compareArtifactDiffs", description: "Compare before and after artifacts or workflow outputs" },
    ],
    relatedToolCategories: ["verification", "flywheel", "learning"],
    tags: ["execution-trace", "workflow", "audit", "verification", "receipts"],
    requiresAuth: false,
  },

  "world-monitor": {
    viewId: "world-monitor",
    title: "World Monitor",
    description:
      "Open-source event map for world developments, clustered by geography and topic, with routing into company-impact and causal-chain analysis.",
    paths: ["/research/world-monitor", "/world-monitor"],
    dataEndpoints: [
      {
        name: "mapSnapshot",
        convexQuery: "domains.monitoring.worldMonitor.getMapSnapshot",
        description: "Aggregated event counts by severity, geography, and topic",
      },
      {
        name: "eventCluster",
        convexQuery: "domains.monitoring.worldMonitor.getEventCluster",
        description: "Filtered event cluster for topic, geography, or entity drilldown",
      },
    ],
    actions: [
      {
        name: "filterEvents",
        description: "Filter the world event cluster by topic or country",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            countryCode: { type: "string" },
          },
        },
      },
      {
        name: "openEventImpactTrace",
        description: "Jump from an event cluster into related company or causal-chain analysis",
      },
    ],
    relatedToolCategories: ["research", "recon", "verification"],
    tags: ["world-monitor", "geopolitics", "events", "map", "causal-analysis"],
    requiresAuth: false,
  },

  watchlists: {
    viewId: "watchlists",
    title: "Watchlists",
    description:
      "Persistent company, sector, geography, and theme monitors with alert thresholds, event rollups, and mission refresh handoffs.",
    paths: ["/research/watchlists", "/watchlists"],
    dataEndpoints: [
      {
        name: "watchlistDigest",
        convexQuery: "domains.monitoring.worldMonitor.getWatchlistDigest",
        description: "Active watchlists with alert counts and latest matching events",
      },
    ],
    actions: [
      { name: "reviewWatchlist", description: "Inspect a watchlist's latest matching events and threshold status" },
      { name: "refreshWatchlistMission", description: "Launch or review the watchlist refresh workflow" },
    ],
    relatedToolCategories: ["research", "verification", "learning"],
    tags: ["watchlists", "monitoring", "alerts", "deeptrace", "missions"],
    requiresAuth: false,
  },

  "for-you-feed": {
    viewId: "for-you-feed",
    title: "For You",
    description:
      "Personalized feed of research signals, articles, and insights ranked by relevance. Moltbook-style hot/new/top discovery.",
    paths: ["/for-you", "/feed"],
    dataEndpoints: [
      { name: "forYouFeed", convexQuery: "domains.research.forYouFeed.getPublicForYouFeed", description: "ML-ranked personalized content feed" },
    ],
    actions: [
      { name: "engageItem", description: "Record engagement (click, bookmark, share) on a feed item", inputSchema: { type: "object", properties: { itemId: { type: "string" }, action: { type: "string", enum: ["click", "bookmark", "share"] } }, required: ["itemId", "action"] } },
      { name: "filterByTag", description: "Filter feed by tag", inputSchema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] } },
    ],
    relatedToolCategories: ["research", "recon"],
    tags: ["feed", "personalized", "discovery", "signals"],
    requiresAuth: false,
  },

  documents: {
    viewId: "documents",
    title: "Files",
    description:
      "Private file and notes surface for browsing, searching, and organizing saved documents and uploads.",
    paths: ["/workspace", "/documents", "/docs"],
    dataEndpoints: [
      { name: "documents", convexQuery: "domains.documents.documentQueries.listDocuments", description: "User's document collection" },
    ],
    actions: [
      { name: "createDocument", description: "Create a new document", inputSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "content"] } },
      { name: "searchDocuments", description: "Search documents by content", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    ],
    relatedToolCategories: ["learning", "boilerplate"],
    tags: ["documents", "workspace", "notes", "writing"],
    requiresAuth: true,
  },

  agents: {
    viewId: "agents",
    title: "Assistants",
    description:
      "AI assistant hub — browse agent templates, start conversations, view agent status and history.",
    paths: ["/agents"],
    dataEndpoints: [
      { name: "agentTemplates", convexQuery: "domains.agents.agentTemplates.listTemplates", description: "Available agent templates" },
      { name: "activeAgents", convexQuery: "domains.agents.agentThreads.getActiveThreads", description: "Currently running agent threads" },
    ],
    actions: [
      { name: "startAgent", description: "Start a new agent conversation", inputSchema: { type: "object", properties: { templateId: { type: "string" }, message: { type: "string" } }, required: ["message"] } },
      { name: "viewAgentHistory", description: "View conversation history for an agent thread" },
    ],
    relatedToolCategories: ["eval", "flywheel", "verification"],
    tags: ["agents", "assistants", "ai", "chat", "conversation"],
    requiresAuth: false,
  },

  calendar: {
    viewId: "calendar",
    title: "Calendar",
    description:
      "Calendar view with event management, agenda, and scheduling. Integrates with research briefings.",
    paths: ["/calendar"],
    dataEndpoints: [
      { name: "events", convexQuery: "domains.calendar.calendarQueries.getEvents", description: "Calendar events for current date range" },
    ],
    actions: [
      { name: "createEvent", description: "Create a new calendar event", inputSchema: { type: "object", properties: { title: { type: "string" }, date: { type: "string" }, description: { type: "string" } }, required: ["title", "date"] } },
      { name: "navigateDate", description: "Navigate to a specific date", inputSchema: { type: "object", properties: { date: { type: "string" } }, required: ["date"] } },
    ],
    relatedToolCategories: ["learning"],
    tags: ["calendar", "events", "scheduling", "agenda"],
    requiresAuth: true,
  },

  signals: {
    viewId: "signals",
    title: "Signals",
    description:
      "Public signals log — real-time stream of research signals, market moves, and intelligence updates.",
    paths: ["/signals"],
    dataEndpoints: [
      { name: "signals", convexQuery: "domains.research.publicSignals.getSignals", description: "Stream of research signals" },
    ],
    actions: [
      { name: "filterSignals", description: "Filter signals by category or date", inputSchema: { type: "object", properties: { category: { type: "string" }, dateRange: { type: "object" } } } },
    ],
    relatedToolCategories: ["research", "recon"],
    tags: ["signals", "intelligence", "real-time", "stream"],
    requiresAuth: false,
  },

  funding: {
    viewId: "funding",
    title: "Funding",
    description:
      "Funding brief — deal flow, investment rounds, sector analysis, and funding intelligence.",
    paths: ["/funding", "/funding-brief"],
    dataEndpoints: [
      { name: "fundingBrief", convexQuery: "domains.research.fundingBrief.getFundingBrief", description: "Latest funding rounds and deal data" },
    ],
    actions: [
      { name: "filterByStage", description: "Filter deals by funding stage", inputSchema: { type: "object", properties: { stage: { type: "string", enum: ["seed", "series-a", "series-b", "series-c", "growth", "ipo"] } }, required: ["stage"] } },
      { name: "filterBySector", description: "Filter deals by sector", inputSchema: { type: "object", properties: { sector: { type: "string" } }, required: ["sector"] } },
    ],
    relatedToolCategories: ["research", "recon"],
    tags: ["funding", "deals", "investment", "venture", "startups"],
    requiresAuth: false,
  },

  benchmarks: {
    viewId: "benchmarks",
    title: "Benchmarks",
    description:
      "Workbench for model evaluation — leaderboard, scenario catalog, eval runs, and capability deep dives.",
    paths: ["/internal/benchmarks", "/benchmarks", "/eval"],
    dataEndpoints: [
      { name: "leaderboard", convexQuery: "domains.eval.leaderboard.getLeaderboard", description: "Model evaluation leaderboard" },
      { name: "scenarios", convexQuery: "domains.eval.scenarios.listScenarios", description: "Eval scenario catalog" },
    ],
    actions: [
      { name: "runEval", description: "Run an evaluation scenario", inputSchema: { type: "object", properties: { scenarioId: { type: "string" } }, required: ["scenarioId"] } },
      { name: "compareModels", description: "Compare two models on a benchmark" },
    ],
    relatedToolCategories: ["eval", "verification", "quality_gate"],
    tags: ["benchmarks", "evaluation", "leaderboard", "models", "testing"],
    requiresAuth: false,
  },

  "github-explorer": {
    viewId: "github-explorer",
    title: "GitHub",
    description:
      "GitHub repository explorer — browse repos, PRs, issues, and code changes.",
    paths: ["/github", "/github-explorer"],
    dataEndpoints: [
      { name: "repos", convexQuery: "domains.github.repos.listRepos", description: "Tracked GitHub repositories" },
    ],
    actions: [
      { name: "searchCode", description: "Search code across repositories", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "viewPR", description: "View pull request details", inputSchema: { type: "object", properties: { prUrl: { type: "string" } }, required: ["prUrl"] } },
    ],
    relatedToolCategories: ["git_workflow", "security"],
    tags: ["github", "code", "repositories", "pull-requests"],
    requiresAuth: true,
  },

  entity: {
    viewId: "entity",
    title: "Entity Profile",
    description:
      "Deep profile for a specific entity (company, person, topic) — aggregated signals, timeline, and related content.",
    paths: ["/entity/:name"],
    dataEndpoints: [
      { name: "entityProfile", convexQuery: "domains.research.entities.getEntityProfile", description: "Full entity profile with signals and timeline" },
    ],
    actions: [
      { name: "browseRelated", description: "Browse related entities" },
      { name: "viewTimeline", description: "View entity signal timeline" },
    ],
    relatedToolCategories: ["research", "recon"],
    tags: ["entity", "profile", "company", "person", "deep-dive"],
    requiresAuth: false,
  },

  "entity-pulse": {
    viewId: "entity-pulse",
    title: "Entity Pulse",
    description:
      "Daily change digest for a single entity, with fresh signals, linked sources, and tap-through paths into the canonical report or notebook.",
    paths: ["/entity/:name/pulse", "/entity-pulse/:name"],
    dataEndpoints: [
      {
        name: "entityPulse",
        convexQuery: "domains.product.home.getPulsePreview",
        description: "Latest per-entity pulse preview and freshness metadata",
      },
    ],
    actions: [
      { name: "openLinkedReport", description: "Open the canonical report or notebook linked from the pulse item" },
      { name: "reviewPulseSources", description: "Inspect the sources and evidence behind a pulse item" },
    ],
    relatedToolCategories: ["research", "verification", "learning"],
    tags: ["entity-pulse", "pulse", "digest", "signals", "entity"],
    requiresAuth: false,
  },

  pricing: {
    viewId: "pricing",
    title: "Pricing",
    description:
      "Founder-facing pricing page with Free, Pro, Team, and Enterprise tiers, comparison table, and FAQ.",
    paths: ["/pricing"],
    dataEndpoints: [],
    actions: [
      { name: "reviewPlanDifferences", description: "Compare tier capabilities and upgrade paths" },
      { name: "openPricingFaq", description: "Expand pricing FAQ items for onboarding and plan questions" },
    ],
    relatedToolCategories: ["platform", "learning"],
    tags: ["pricing", "plans", "billing", "faq"],
    requiresAuth: false,
  },

  changelog: {
    viewId: "changelog",
    title: "Changelog",
    description:
      "Release history and shipped changes, intended for operators and users reviewing recent updates.",
    paths: ["/changelog"],
    dataEndpoints: [],
    actions: [
      { name: "reviewReleaseHistory", description: "Inspect recent shipped changes and release notes" },
    ],
    relatedToolCategories: ["learning", "platform"],
    tags: ["changelog", "release-notes", "shipping", "history"],
    requiresAuth: false,
  },

  legal: {
    viewId: "legal",
    title: "Legal",
    description:
      "Terms, privacy, and policy surface for reviewing the legal baseline of the product.",
    paths: ["/legal"],
    dataEndpoints: [],
    actions: [
      { name: "reviewPolicies", description: "Read terms of service and privacy policy details" },
    ],
    relatedToolCategories: ["platform"],
    tags: ["legal", "privacy", "terms", "policy"],
    requiresAuth: false,
  },

  about: {
    viewId: "about",
    title: "About NodeBench AI",
    description:
      "Mission, product framing, and company background for the NodeBench platform.",
    paths: ["/about"],
    dataEndpoints: [],
    actions: [
      { name: "reviewCompanyStory", description: "Read the mission, background, and positioning narrative" },
    ],
    relatedToolCategories: ["learning"],
    tags: ["about", "mission", "company", "product"],
    requiresAuth: false,
  },

  "chat-home": {
    viewId: "chat-home",
    title: "Chat",
    description:
      "Primary mobile chat surface for asks, active threads, and live progress across interactive and background runs.",
    paths: ["/chat"],
    dataEndpoints: [
      {
        name: "threads",
        convexQuery: "domains.product.chat.listThreads",
        description: "Recent and active chat threads with summary metadata",
      },
    ],
    actions: [
      { name: "startThread", description: "Start a new ask from the Chat home composer" },
      { name: "openThread", description: "Open a thread to conversation, steps, artifacts, and files" },
    ],
    relatedToolCategories: ["research", "verification", "learning"],
    tags: ["chat", "threads", "artifacts", "steps", "mobile"],
    requiresAuth: false,
  },

  "reports-home": {
    viewId: "reports-home",
    title: "Reports",
    description:
      "Saved business outputs, live notebooks, and report retrieval surface for company, people, market, job, and note work.",
    paths: ["/reports"],
    dataEndpoints: [
      {
        name: "reports",
        convexQuery: "domains.product.reports.listReports",
        description: "Saved reports and notebooks for the current owner context",
      },
    ],
    actions: [
      { name: "filterReports", description: "Filter saved work by report type, favorites, or recency" },
      { name: "openNotebook", description: "Open the live notebook or snapshot history for a report" },
    ],
    relatedToolCategories: ["research", "learning", "verification"],
    tags: ["reports", "notebooks", "saved-work", "archive"],
    requiresAuth: false,
  },

  "report-detail": {
    viewId: "report-detail",
    title: "Report",
    description:
      "Read-only report detail view used for shared links, direct opens, and public/signed-in handoff routing.",
    paths: ["/report/:id"],
    dataEndpoints: [
      {
        name: "publicReport",
        convexQuery: "domains.product.shares.getSharedReport",
        description: "Shared report payload and read-only metadata",
      },
    ],
    actions: [
      { name: "shareReport", description: "Open share or export actions for the current report" },
      { name: "openCanonicalNotebook", description: "Jump from the read-only report to the canonical notebook when allowed" },
    ],
    relatedToolCategories: ["research", "verification"],
    tags: ["report", "share", "public-view", "read-only"],
    requiresAuth: false,
  },

  "report-detail-workspace": {
    viewId: "report-detail-workspace",
    title: "Report Workspace",
    description:
      "Recursive report workspace for graph-backed company, person, source, and notebook exploration from a saved report.",
    paths: ["/reports/:reportId/graph"],
    dataEndpoints: [
      {
        name: "reportWorkspace",
        convexQuery: "domains.product.entities.getEntityWorkspace",
        description: "Canonical entity workspace with graph edges, claims, sources, and notebook state",
      },
    ],
    actions: [
      { name: "promoteEntityRoot", description: "Re-root the workspace graph around a selected entity" },
      { name: "openRelationshipEvidence", description: "Inspect evidence explaining a graph edge or claim" },
      { name: "openWorkspaceNotebook", description: "Open the report notebook for editable synthesis" },
    ],
    relatedToolCategories: ["research", "verification", "knowledge"],
    tags: ["report-workspace", "graph", "notebook", "entities", "evidence"],
    requiresAuth: false,
  },

  "pulse-home": {
    viewId: "pulse-home",
    title: "Pulse",
    description:
      "Global daily pulse digest with editorialized cross-entity updates and freshness metadata.",
    paths: ["/pulse"],
    dataEndpoints: [
      {
        name: "pulsePreview",
        convexQuery: "domains.product.home.getPulsePreview",
        description: "Daily pulse preview with freshness and top signal items",
      },
    ],
    actions: [
      { name: "openPulseThread", description: "Open the canonical pulse thread in chat or report context" },
      { name: "reviewPulseHistory", description: "Inspect recent pulse items and freshness state" },
    ],
    relatedToolCategories: ["research", "verification", "learning"],
    tags: ["pulse", "daily-digest", "signals", "home"],
    requiresAuth: false,
  },

  "nudges-home": {
    viewId: "nudges-home",
    title: "Inbox",
    description:
      "Inbox for action-required items, updates, approvals, connector warnings, and other push-style events.",
    paths: ["/inbox", "/nudges"],
    dataEndpoints: [
      {
        name: "nudges",
        convexQuery: "domains.product.nudges.listNudges",
        description: "Inbox items grouped into action-required and update buckets",
      },
    ],
    actions: [
      { name: "openInboxItem", description: "Open the destination linked from an inbox item" },
      { name: "markInboxRead", description: "Update read state for an inbox item or bucket" },
    ],
    relatedToolCategories: ["verification", "learning", "platform"],
    tags: ["inbox", "nudges", "notifications", "approvals", "updates"],
    requiresAuth: false,
  },

  "me-home": {
    viewId: "me-home",
    title: "Me",
    description:
      "Personal settings area for global file vault, profile, connectors, plan, and privacy controls.",
    paths: ["/me"],
    dataEndpoints: [
      {
        name: "meSnapshot",
        convexQuery: "domains.product.me.getMeSnapshot",
        description: "Profile, file, and account snapshot for the current owner context",
      },
    ],
    actions: [
      { name: "openFiles", description: "Browse the global file vault stored under Me" },
      { name: "manageConnectors", description: "Review account, plan, and connector settings" },
    ],
    relatedToolCategories: ["platform", "learning"],
    tags: ["me", "files", "profile", "settings", "connectors"],
    requiresAuth: false,
  },

  "me-wiki-landing": {
    viewId: "me-wiki-landing",
    title: "My Wiki",
    description:
      "Personal synthesis index grouped by topic, company, person, product, event, location, job, and contradiction pages.",
    paths: ["/me/wiki"],
    dataEndpoints: [
      {
        name: "wikiPages",
        convexQuery: "domains.product.meWiki.listPages",
        description: "Owner-scoped generated wiki pages and freshness metadata",
      },
    ],
    actions: [
      { name: "openWikiPage", description: "Open a generated wiki page with evidence and notes" },
      { name: "filterWikiPages", description: "Filter wiki pages by type, freshness, or source coverage" },
    ],
    relatedToolCategories: ["knowledge", "learning", "research"],
    tags: ["me", "wiki", "synthesis", "personal-knowledge"],
    requiresAuth: false,
  },

  "me-wiki-page-detail": {
    viewId: "me-wiki-page-detail",
    title: "Wiki Page",
    description:
      "Detailed personal wiki page with AI-maintained synthesis, source evidence, and editable notes.",
    paths: ["/me/wiki/:pageType/:slug"],
    dataEndpoints: [
      {
        name: "wikiPage",
        convexQuery: "domains.product.meWiki.getPage",
        description: "AI synthesis, evidence references, source reports, and user notes for one wiki page",
      },
    ],
    actions: [
      { name: "refreshWikiPage", description: "Refresh the generated synthesis from linked reports and sources" },
      { name: "openSourceReport", description: "Open the report that contributed evidence to this page" },
      { name: "editWikiNotes", description: "Edit the user-authored notes on the wiki page" },
    ],
    relatedToolCategories: ["knowledge", "research", "verification"],
    tags: ["wiki-page", "evidence", "notes", "synthesis"],
    requiresAuth: false,
  },

  "conference-capture": {
    viewId: "conference-capture",
    title: "Conference Capture",
    description:
      "Fast capture surface for event notes, voice, entities, and structured CRM-style packets during conferences or meetings.",
    paths: ["/capture", "/conference", "/event-capture"],
    dataEndpoints: [],
    actions: [
      { name: "captureNotes", description: "Save quick event notes, entities, and follow-up context" },
      { name: "openCapturedPacket", description: "Open the packet or report created from a conference capture" },
    ],
    relatedToolCategories: ["learning", "research"],
    tags: ["capture", "conference", "event", "notes", "crm"],
    requiresAuth: false,
  },

  "entity-compare": {
    viewId: "entity-compare",
    title: "Compare",
    description:
      "Side-by-side entity diligence surface with role-specific framing and comparison summaries.",
    paths: ["/compare", "/entity-compare", "/compare-entities"],
    dataEndpoints: [],
    actions: [
      { name: "compareEntities", description: "Review side-by-side findings, deltas, and recommendation framing" },
    ],
    relatedToolCategories: ["research", "verification"],
    tags: ["compare", "entity-compare", "diligence", "side-by-side"],
    requiresAuth: false,
  },

  "benchmark-comparison": {
    viewId: "benchmark-comparison",
    title: "Benchmarks",
    description:
      "Benchmark ladder and comparative evaluation surface showing NodeBench output against baselines and judges.",
    paths: ["/benchmarks", "/benchmark", "/eval"],
    dataEndpoints: [],
    actions: [
      { name: "reviewBenchmarkRuns", description: "Inspect benchmark comparisons, judges, and report cards" },
    ],
    relatedToolCategories: ["eval", "verification", "learning"],
    tags: ["benchmarks", "evaluation", "comparison", "judging"],
    requiresAuth: false,
  },

  "role-lens-output": {
    viewId: "role-lens-output",
    title: "Role Lens",
    description:
      "Persona-specific framing of the same packet for founders, investors, bankers, operators, and other roles.",
    paths: ["/lens", "/role-lens", "/persona"],
    dataEndpoints: [],
    actions: [
      { name: "switchRoleLens", description: "Switch between persona framings for the same underlying report" },
    ],
    relatedToolCategories: ["research", "learning"],
    tags: ["role-lens", "persona", "framing", "reports"],
    requiresAuth: false,
  },

  "homes-hub-session": {
    viewId: "homes-hub-session",
    title: "Homes Hub",
    description:
      "Session revisit surface for reopening, refreshing, and recompiling saved research packets without a full sign-in flow.",
    paths: ["/homes", "/homes-hub", "/sessions"],
    dataEndpoints: [],
    actions: [
      { name: "reopenSession", description: "Reopen a saved session and continue from prior context" },
      { name: "refreshPacket", description: "Refresh or recompile a saved packet from a previous session" },
    ],
    relatedToolCategories: ["learning", "research"],
    tags: ["homes", "sessions", "reopen", "refresh", "packets"],
    requiresAuth: false,
  },

  dogfood: {
    viewId: "dogfood",
    title: "Quality Review",
    description:
      "UI quality review dashboard — automated QA scores, screenshot analysis, governance violations, and design system compliance.",
    paths: ["/dogfood", "/quality-review"],
    dataEndpoints: [
      { name: "qaResults", convexQuery: "domains.dogfood.qaResults.getLatestResults", description: "Latest QA pipeline results and scores" },
    ],
    actions: [
      { name: "runQA", description: "Trigger a new QA analysis run" },
      { name: "viewScreenshots", description: "View captured route screenshots" },
    ],
    relatedToolCategories: ["verification", "quality_gate", "visual_qa"],
    tags: ["quality", "review", "dogfood", "qa", "design-system"],
    requiresAuth: true,
  },

  activity: {
    viewId: "activity",
    title: "Activity",
    description:
      "Public activity feed — recent actions, agent activity, and system events across the platform.",
    paths: ["/activity", "/public-activity"],
    dataEndpoints: [
      { name: "activity", convexQuery: "domains.agents.publicActivity.getPublicActivity", description: "Public activity stream" },
    ],
    actions: [
      { name: "filterActivity", description: "Filter activity by type", inputSchema: { type: "object", properties: { type: { type: "string", enum: ["agent", "user", "system"] } } } },
    ],
    relatedToolCategories: ["flywheel"],
    tags: ["activity", "feed", "events", "stream"],
    requiresAuth: false,
  },

  spreadsheets: {
    viewId: "spreadsheets",
    title: "Spreadsheets",
    description: "Spreadsheet editor with formula support, cell formatting, and data import/export.",
    paths: ["/spreadsheets"],
    dataEndpoints: [
      { name: "spreadsheets", convexQuery: "domains.spreadsheets.queries.listSpreadsheets", description: "User's spreadsheet collection" },
    ],
    actions: [
      { name: "createSpreadsheet", description: "Create a new spreadsheet" },
      { name: "openSpreadsheet", description: "Open a specific spreadsheet", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    ],
    relatedToolCategories: ["data_viz"],
    tags: ["spreadsheets", "data", "tables", "formulas"],
    requiresAuth: true,
  },

  roadmap: {
    viewId: "roadmap",
    title: "Roadmap",
    description: "Interactive product roadmap with milestones, phases, and timeline visualization.",
    paths: ["/roadmap"],
    dataEndpoints: [],
    actions: [
      { name: "navigatePhase", description: "Jump to a specific roadmap phase" },
    ],
    relatedToolCategories: ["flywheel"],
    tags: ["roadmap", "timeline", "milestones", "planning"],
    requiresAuth: false,
  },

  timeline: {
    viewId: "timeline",
    title: "Timeline",
    description: "Chronological timeline of events, milestones, and project progress.",
    paths: ["/timeline"],
    dataEndpoints: [],
    actions: [
      { name: "scrollToDate", description: "Scroll timeline to specific date" },
    ],
    relatedToolCategories: ["flywheel"],
    tags: ["timeline", "chronological", "history"],
    requiresAuth: false,
  },

  public: {
    viewId: "public",
    title: "Shared with You",
    description: "Documents and content shared publicly or with the current user.",
    paths: ["/public", "/shared"],
    dataEndpoints: [
      { name: "publicDocs", convexQuery: "domains.documents.documentQueries.getPublicDocuments", description: "Publicly shared documents" },
    ],
    actions: [],
    relatedToolCategories: ["learning"],
    tags: ["shared", "public", "collaboration"],
    requiresAuth: false,
  },

  showcase: {
    viewId: "showcase",
    title: "Showcase",
    description: "Feature showcase and demo gallery — explore NodeBench capabilities interactively.",
    paths: ["/showcase", "/demo"],
    dataEndpoints: [],
    actions: [],
    relatedToolCategories: ["boilerplate"],
    tags: ["showcase", "demo", "features", "gallery"],
    requiresAuth: false,
  },

  footnotes: {
    viewId: "footnotes",
    title: "Sources",
    description: "Citation library — all referenced sources with metadata and verification status.",
    paths: ["/footnotes", "/sources"],
    dataEndpoints: [
      { name: "citations", convexQuery: "domains.research.citations.getCitations", description: "Citation library with verification metadata" },
    ],
    actions: [
      { name: "searchSources", description: "Search sources", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    ],
    relatedToolCategories: ["research"],
    tags: ["sources", "citations", "references", "bibliography"],
    requiresAuth: false,
  },

  "analytics-hitl": {
    viewId: "analytics-hitl",
    title: "Review Queue",
    description: "Human-in-the-loop analytics — review and approve AI-generated content, flag issues, provide feedback.",
    paths: ["/internal/analytics/hitl", "/analytics/hitl", "/analytics/review-queue", "/review-queue"],
    dataEndpoints: [
      { name: "reviewQueue", convexQuery: "domains.analytics.hitl.getReviewQueue", description: "Items pending human review" },
    ],
    actions: [
      { name: "approveItem", description: "Approve a review item" },
      { name: "flagItem", description: "Flag an item for re-review" },
    ],
    relatedToolCategories: ["quality_gate", "verification"],
    tags: ["analytics", "review", "hitl", "quality"],
    requiresAuth: true,
  },

  "analytics-components": {
    viewId: "analytics-components",
    title: "Performance Analytics",
    description: "Component-level performance metrics — render times, bundle sizes, interaction latency.",
    paths: ["/internal/analytics/components", "/analytics/components"],
    dataEndpoints: [
      { name: "componentMetrics", convexQuery: "domains.analytics.components.getMetrics", description: "Component performance data" },
    ],
    actions: [],
    relatedToolCategories: ["verification"],
    tags: ["analytics", "performance", "metrics", "components"],
    requiresAuth: true,
  },

  "analytics-recommendations": {
    viewId: "analytics-recommendations",
    title: "Feedback",
    description: "Recommendation feedback dashboard — track how users engage with AI suggestions.",
    paths: ["/internal/analytics/recommendations", "/analytics/recommendations"],
    dataEndpoints: [
      { name: "feedbackData", convexQuery: "domains.analytics.recommendations.getFeedback", description: "Recommendation engagement data" },
    ],
    actions: [],
    relatedToolCategories: ["verification"],
    tags: ["analytics", "feedback", "recommendations"],
    requiresAuth: true,
  },

  "cost-dashboard": {
    viewId: "cost-dashboard",
    title: "Usage & Costs",
    description: "API usage and cost tracking — token consumption, model costs, budget alerts.",
    paths: ["/internal/cost", "/cost", "/dashboard/cost"],
    dataEndpoints: [
      { name: "costData", convexQuery: "domains.analytics.costs.getCostSummary", description: "API usage and cost breakdown" },
    ],
    actions: [
      { name: "setAlert", description: "Set a cost alert threshold" },
    ],
    relatedToolCategories: ["verification"],
    tags: ["costs", "usage", "budget", "tokens", "api"],
    requiresAuth: true,
  },

  "industry-updates": {
    viewId: "industry-updates",
    title: "Industry News",
    description: "Curated industry updates and news — AI/ML developments, market trends, research papers.",
    paths: ["/industry", "/dashboard/industry"],
    dataEndpoints: [
      { name: "industryUpdates", convexQuery: "domains.research.industry.getUpdates", description: "Curated industry news items" },
    ],
    actions: [
      { name: "filterByTopic", description: "Filter news by topic" },
    ],
    relatedToolCategories: ["research", "rss"],
    tags: ["industry", "news", "trends", "market", "updates"],
    requiresAuth: false,
  },

  "document-recommendations": {
    viewId: "document-recommendations",
    title: "Suggestions",
    description: "AI-powered document recommendations based on reading history and interests.",
    paths: ["/recommendations", "/discover"],
    dataEndpoints: [
      { name: "recommendations", convexQuery: "domains.documents.recommendations.getRecommendations", description: "Personalized document suggestions" },
    ],
    actions: [
      { name: "dismiss", description: "Dismiss a recommendation" },
      { name: "save", description: "Save a recommended document" },
    ],
    relatedToolCategories: ["learning"],
    tags: ["recommendations", "suggestions", "discover", "personalized"],
    requiresAuth: true,
  },

  "agent-marketplace": {
    viewId: "agent-marketplace",
    title: "Agent Templates",
    description: "Browse and install agent templates — pre-built AI assistants for specific tasks.",
    paths: ["/marketplace", "/agent-marketplace"],
    dataEndpoints: [
      { name: "templates", convexQuery: "domains.agents.marketplace.getTemplates", description: "Available agent templates" },
    ],
    actions: [
      { name: "installTemplate", description: "Install an agent template", inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] } },
    ],
    relatedToolCategories: ["eval"],
    tags: ["agents", "marketplace", "templates", "install"],
    requiresAuth: true,
  },

  "pr-suggestions": {
    viewId: "pr-suggestions",
    title: "PR Suggestions",
    description: "AI-generated pull request suggestions — code review, improvements, and refactoring ideas.",
    paths: ["/pr-suggestions", "/prs"],
    dataEndpoints: [
      { name: "prSuggestions", convexQuery: "domains.github.prSuggestions.getSuggestions", description: "PR improvement suggestions" },
    ],
    actions: [
      { name: "applySuggestion", description: "Apply a PR suggestion" },
    ],
    relatedToolCategories: ["git_workflow"],
    tags: ["pull-requests", "code-review", "suggestions", "github"],
    requiresAuth: true,
  },

  "linkedin-posts": {
    viewId: "linkedin-posts",
    title: "LinkedIn Posts",
    description: "LinkedIn post archive — browse, search, and analyze published posts and engagement metrics.",
    paths: ["/linkedin"],
    dataEndpoints: [
      { name: "posts", convexQuery: "domains.social.linkedin.getPosts", description: "LinkedIn post archive" },
    ],
    actions: [
      { name: "searchPosts", description: "Search posts by content" },
    ],
    relatedToolCategories: ["content", "seo"],
    tags: ["linkedin", "social", "posts", "content"],
    requiresAuth: true,
  },

  "mcp-ledger": {
    viewId: "mcp-ledger",
    title: "Tool Activity",
    description:
      "MCP tool call ledger and local account sync inspector for durable receipts, paired devices, shared history, and outbound bridge activity.",
    paths: ["/internal/mcp-ledger", "/mcp-ledger", "/mcp/ledger", "/activity-log"],
    dataEndpoints: [
      { name: "toolCalls", convexQuery: "domains.mcp.ledger.getToolCalls", description: "MCP tool call audit trail" },
    ],
    actions: [
      { name: "filterByTool", description: "Filter by tool name" },
      { name: "filterByDate", description: "Filter by date range" },
      { name: "generatePairingCode", description: "Create a user-consented pairing code for a local NodeBench MCP runtime" },
      { name: "reviewSharedHistory", description: "Inspect synced receipts, artifacts, outcomes, and approval events across paired devices" },
      { name: "inspectSharedContextPeers", description: "Review registered peers, packet freshness, and shared task handoffs" },
    ],
    relatedToolCategories: ["flywheel", "verification"],
    tags: ["mcp", "tools", "audit", "ledger", "activity", "sync-bridge", "devices", "shared-history", "shared-context", "peers", "packets"],
    requiresAuth: true,
  },

  "engine-demo": {
    viewId: "engine-demo",
    title: "Engine API",
    description: "Headless engine demo surface for testing engine calls, request flow, and API responses.",
    paths: ["/internal/engine", "/engine", "/engine-demo"],
    dataEndpoints: [
      { name: "engineDemo", convexQuery: "domains.engine.demo.getDemoState", description: "Engine demo state and example responses" },
    ],
    actions: [
      { name: "runEngineDemo", description: "Execute a demo engine request" },
    ],
    relatedToolCategories: ["platform", "verification"],
    tags: ["engine", "api", "demo", "headless"],
    requiresAuth: false,
  },

  observability: {
    viewId: "observability",
    title: "System Health",
    description: "Observability dashboard with component health, self-healing history, and service-level signals.",
    paths: ["/internal/observability", "/observability", "/health", "/system-health"],
    dataEndpoints: [
      { name: "systemHealth", convexQuery: "domains.observability.healthMonitor.getSystemHealth", description: "Current component health and alert state" },
      { name: "healingActions", convexQuery: "domains.observability.selfHealer.getRecentHealingActions", description: "Recent autonomous healing actions" },
    ],
    actions: [
      { name: "reviewActiveAlerts", description: "Inspect active alerts and degraded components" },
      { name: "inspectHealingHistory", description: "Review recent automated repair attempts" },
    ],
    relatedToolCategories: ["verification", "flywheel", "platform"],
    tags: ["observability", "health", "alerts", "slo", "self-healing"],
    requiresAuth: false,
  },

  investigation: {
    viewId: "investigation",
    title: "Investigation",
    description:
      "Trace from action to evidence to approval across a single run, escalation, or operator review.",
    paths: ["/investigation", "/investigate", "/enterprise-demo"],
    dataEndpoints: [],
    actions: [
      { name: "replayRun", description: "Replay a run from evidence to final decision" },
      { name: "inspectEvidence", description: "Inspect supporting evidence, approvals, and trace steps" },
    ],
    relatedToolCategories: ["verification", "flywheel", "research"],
    tags: ["investigation", "trace", "evidence", "replay", "approval"],
    requiresAuth: false,
  },

  oracle: {
    viewId: "oracle",
    title: "System",
    description:
      "Operational health, benchmarks, spend, and quality reviews for agents and infrastructure.",
    paths: ["/oracle", "/career", "/trajectory"],
    dataEndpoints: [],
    actions: [
      { name: "reviewMemory", description: "Review long-running memory and operational context" },
      { name: "inspectTelemetry", description: "Inspect strategy loop telemetry and progress" },
    ],
    relatedToolCategories: ["platform", "learning", "flywheel"],
    tags: ["oracle", "memory", "telemetry", "strategy", "operations"],
    requiresAuth: false,
  },

  "dev-dashboard": {
    viewId: "dev-dashboard",
    title: "Dev Dashboard",
    description:
      "Internal development dashboard for repo evolution, domain milestones, and engineering progress tracking.",
    paths: ["/internal/dev-dashboard", "/dev-dashboard", "/dev", "/evolution"],
    dataEndpoints: [],
    actions: [
      { name: "reviewMilestones", description: "Inspect repo milestones and delivery progress" },
      { name: "inspectEvolution", description: "Inspect domain branch evolution and timeline context" },
    ],
    relatedToolCategories: ["platform", "verification"],
    tags: ["dev-dashboard", "engineering", "milestones", "timeline", "internal"],
    requiresAuth: false,
  },

  "mission-control": {
    viewId: "mission-control",
    title: "Mission Control",
    description:
      "Active missions, task execution, judge queue, and validation checks. Manage the planner-worker-judge-merge pipeline for multi-step agent workflows.",
    paths: ["/internal/mission-control", "/mission-control", "/missions"],
    dataEndpoints: [
      { method: "query", name: "missions:missionOrchestrator:getMission" },
      { method: "query", name: "missions:missionOrchestrator:getTasksForMission" },
      { method: "query", name: "missions:missionOrchestrator:getPendingSniffChecks" },
    ],
    actions: [
      { name: "reviewMissions", description: "View active missions and their execution status" },
      { name: "inspectJudgeQueue", description: "Review pending validation checks and judge verdicts" },
      { name: "viewPreExecutionGates", description: "Inspect boolean gate results for mission tasks" },
    ],
    relatedToolCategories: ["mission", "verification", "eval"],
    tags: ["mission-control", "missions", "judge", "sniff-check", "gate", "internal"],
    requiresAuth: false,
  },

  "evolution": {
    viewId: "evolution",
    title: "Evolution",
    description:
      "Self-evolution dashboard showing rubric change proposals, health metrics, and evolution verification results.",
    paths: ["/internal/evolution"],
    dataEndpoints: [],
    actions: [
      { name: "reviewEvolutionCycles", description: "Inspect recent self-evolution proposals and outcomes" },
      { name: "checkHealthMetrics", description: "View the 10 boolean health metrics for the agent system" },
    ],
    relatedToolCategories: ["eval", "verification"],
    tags: ["evolution", "self-improvement", "rubric", "health", "internal"],
    requiresAuth: false,
  },

  postmortem: {
    viewId: "postmortem",
    title: "Postmortem",
    description:
      "Compare predictions against reality, score forecasts, and update priors based on outcome evidence.",
    paths: ["/postmortem", "/forecast-review", "/scorecard"],
    dataEndpoints: [],
    actions: [
      { name: "reviewForecasts", description: "Compare forecast predictions against actual outcomes" },
      { name: "updatePriors", description: "Update belief priors based on postmortem evidence" },
    ],
    relatedToolCategories: ["eval", "verification", "learning"],
    tags: ["postmortem", "forecast", "scorecard", "priors", "outcomes"],
    requiresAuth: false,
  },

  "api-keys": {
    viewId: "api-keys",
    title: "API Keys",
    description:
      "Manage MCP API keys — create, revoke, and monitor usage of API credentials for external integrations.",
    paths: ["/internal/api-keys", "/api-keys"],
    dataEndpoints: [],
    actions: [
      { name: "createKey", description: "Generate a new API key" },
      { name: "revokeKey", description: "Revoke an existing API key" },
    ],
    relatedToolCategories: ["platform", "security"],
    tags: ["api-keys", "credentials", "security", "integrations"],
    requiresAuth: true,
  },

  developers: {
    viewId: "developers",
    title: "Developers",
    description:
      "Developer portal — CLI, MCP, API documentation, integration guides, and SDK references for building on NodeBench.",
    paths: ["/developers", "/cli", "/mcp", "/install", "/docs/api"],
    dataEndpoints: [],
    actions: [
      { name: "browseEndpoints", description: "Browse available API endpoints and schemas" },
      { name: "testEndpoint", description: "Send a test request to an API endpoint" },
    ],
    relatedToolCategories: ["platform", "boilerplate"],
    tags: ["developers", "cli", "mcp", "api", "documentation", "sdk", "integration"],
    requiresAuth: false,
  },

  "financial-operator": {
    viewId: "financial-operator",
    title: "Financial Operator",
    description:
      "Typed-card financial operator console for extracting filings, validating assumptions, sandboxing calculations, and approving outputs.",
    paths: ["/finance-demo", "/financial-operator", "/finops"],
    dataEndpoints: [],
    actions: [
      { name: "extractFinancialInputs", description: "Extract structured assumptions from filings or pasted finance notes" },
      { name: "runSandboxCalculation", description: "Run a gated financial calculation with inspectable inputs and outputs" },
      { name: "approveOperatorOutput", description: "Approve a generated memo, model output, or export artifact" },
    ],
    relatedToolCategories: ["financial", "verification", "documents"],
    tags: ["financial-operator", "finance", "sandbox", "approval", "typed-cards"],
    requiresAuth: false,
  },

  "agent-telemetry": {
    viewId: "agent-telemetry",
    title: "Agent Telemetry",
    description:
      "Full agent telemetry: every action, tool call breakdown, per-tool cost and latency, error log, and session summary.",
    paths: ["/agent-telemetry", "/telemetry", "/agent-actions"],
    dataEndpoints: [],
    actions: [
      { name: "sortToolBreakdown", description: "Sort tool call table by calls, cost, latency, or errors" },
      { name: "expandAction", description: "Expand a recent action to see input/output details" },
      { name: "filterErrors", description: "View error log with severity filtering" },
    ],
    relatedToolCategories: ["platform", "verification", "eval", "flywheel"],
    tags: ["telemetry", "agent-actions", "tool-calls", "cost", "latency", "errors", "monitoring"],
    requiresAuth: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get capability for a specific view */
export function getViewCapability(viewId: MainView): ViewCapability {
  return VIEW_CAPABILITIES[viewId];
}

/** Get all view capabilities as an array */
export function getAllViewCapabilities(): ViewCapability[] {
  return Object.values(VIEW_CAPABILITIES);
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

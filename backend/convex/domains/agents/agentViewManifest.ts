// @generated from src/lib/registry/viewCapabilityRegistry.ts by scripts/generateViewManifest.mjs
// Do not edit manually — run: node scripts/generateViewManifest.mjs
import { v } from "convex/values";
import { query } from "../../_generated/server";

interface ManifestEntry {
  viewId: string;
  title: string;
  description: string;
  paths: string[];
  actions: string[];
  dataEndpoints: string[];
  tags: string[];
  requiresAuth: boolean;
}

const VIEW_MANIFEST: ManifestEntry[] = [
  { viewId: "control-plane", title: "DeepTrace", description: "Landing surface for the agent trust control plane. Start from receipts, delegation, investigation, and the packaged operator flows.", paths: ["/","/control-plane","/home","/landing"], actions: ["openReceipts","openDelegation","openInvestigation"], dataEndpoints: [], tags: ["deeptrace","control-plane","landing","trust","receipts"], requiresAuth: false },
  { viewId: "receipts", title: "Action Receipts", description: "Owner-scoped receipt stream for denied, approval-gated, and reversible agent actions with evidence, approvals, and tamper checks.", paths: ["/receipts","/action-receipts","/control-plane/receipts"], actions: ["filterReceipts","verifyReceiptHash"], dataEndpoints: ["receipts","receiptStats"], tags: ["receipts","audit","approval","trust","evidence"], requiresAuth: true },
  { viewId: "delegation", title: "Passport", description: "Delegation and approval surface for scoped tools, denied actions, and human approval gates before an agent acts.", paths: ["/delegation","/delegate","/passport","/control-plane/delegation","/control-plane/passport"], actions: ["reviewScopes","reviewDeniedActions"], dataEndpoints: [], tags: ["delegation","passport","approvals","permissions","scope"], requiresAuth: false },
  { viewId: "research", title: "Research Hub", description: "Research hub with tabbed navigation for overview, signals, briefing, deals, changes, and changelog. The primary intelligence surface after the DeepTrace landing page.", paths: ["/research","/hub","/onboarding","/research/overview","/research/signals","/research/briefing","/research/deals","/research/changes","/research/changelog"], actions: ["switchTab","search"], dataEndpoints: ["forYouFeed","morningDigest"], tags: ["home","research","signals","briefing","overview"], requiresAuth: false },
  { viewId: "for-you-feed", title: "For You", description: "Personalized feed of research signals, articles, and insights ranked by relevance. Moltbook-style hot/new/top discovery.", paths: ["/for-you","/feed"], actions: ["engageItem","filterByTag"], dataEndpoints: ["forYouFeed"], tags: ["feed","personalized","discovery","signals"], requiresAuth: false },
  { viewId: "documents", title: "Workspace", description: "Document management hub — create, browse, search, and organize documents. Supports markdown with tagging.", paths: ["/workspace","/documents","/docs"], actions: ["createDocument","searchDocuments"], dataEndpoints: ["documents"], tags: ["title","content"], requiresAuth: true },
  { viewId: "agents", title: "Assistants", description: "AI assistant hub — browse agent templates, start conversations, view agent status and history.", paths: ["/agents"], actions: ["startAgent","viewAgentHistory"], dataEndpoints: ["agentTemplates","activeAgents"], tags: ["agents","assistants","ai","chat","conversation"], requiresAuth: false },
  { viewId: "calendar", title: "Calendar", description: "Calendar view with event management, agenda, and scheduling. Integrates with research briefings.", paths: ["/calendar"], actions: ["createEvent","navigateDate"], dataEndpoints: ["events"], tags: ["calendar","events","scheduling","agenda"], requiresAuth: true },
  { viewId: "signals", title: "Signals", description: "Public signals log — real-time stream of research signals, market moves, and intelligence updates.", paths: ["/signals"], actions: ["filterSignals"], dataEndpoints: ["signals"], tags: ["signals","intelligence","real-time","stream"], requiresAuth: false },
  { viewId: "funding", title: "Funding", description: "Funding brief — deal flow, investment rounds, sector analysis, and funding intelligence.", paths: ["/funding","/funding-brief"], actions: ["filterByStage","filterBySector"], dataEndpoints: ["fundingBrief"], tags: ["funding","deals","investment","venture","startups"], requiresAuth: false },
  { viewId: "benchmarks", title: "Benchmarks", description: "Workbench for model evaluation — leaderboard, scenario catalog, eval runs, and capability deep dives.", paths: ["/internal/benchmarks","/benchmarks","/eval"], actions: ["runEval","compareModels"], dataEndpoints: ["leaderboard","scenarios"], tags: ["benchmarks","evaluation","leaderboard","models","testing"], requiresAuth: false },
  { viewId: "github-explorer", title: "GitHub", description: "GitHub repository explorer — browse repos, PRs, issues, and code changes.", paths: ["/github","/github-explorer"], actions: ["searchCode","viewPR"], dataEndpoints: ["repos"], tags: ["github","code","repositories","pull-requests"], requiresAuth: true },
  { viewId: "entity", title: "Entity Profile", description: "Deep profile for a specific entity (company, person, topic) — aggregated signals, timeline, and related content.", paths: ["/entity/:name"], actions: ["browseRelated","viewTimeline"], dataEndpoints: ["entityProfile"], tags: ["entity","profile","company","person","deep-dive"], requiresAuth: false },
  { viewId: "dogfood", title: "Quality Review", description: "UI quality review dashboard — automated QA scores, screenshot analysis, governance violations, and design system compliance.", paths: ["/dogfood","/quality-review"], actions: ["runQA","viewScreenshots"], dataEndpoints: ["qaResults"], tags: ["quality","review","dogfood","qa","design-system"], requiresAuth: true },
  { viewId: "activity", title: "Activity", description: "Public activity feed — recent actions, agent activity, and system events across the platform.", paths: ["/activity","/public-activity"], actions: ["filterActivity"], dataEndpoints: ["activity"], tags: ["activity","feed","events","stream"], requiresAuth: false },
  { viewId: "spreadsheets", title: "Spreadsheets", description: "Spreadsheet editor with formula support, cell formatting, and data import/export.", paths: ["/spreadsheets"], actions: ["createSpreadsheet","openSpreadsheet"], dataEndpoints: ["spreadsheets"], tags: ["spreadsheets","data","tables","formulas"], requiresAuth: true },
  { viewId: "roadmap", title: "Roadmap", description: "Interactive product roadmap with milestones, phases, and timeline visualization.", paths: ["/roadmap"], actions: ["navigatePhase"], dataEndpoints: [], tags: ["roadmap","timeline","milestones","planning"], requiresAuth: false },
  { viewId: "timeline", title: "Timeline", description: "Chronological timeline of events, milestones, and project progress.", paths: ["/timeline"], actions: ["scrollToDate"], dataEndpoints: [], tags: ["timeline","chronological","history"], requiresAuth: false },
  { viewId: "public", title: "Shared with You", description: "Documents and content shared publicly or with the current user.", paths: ["/public","/shared"], actions: [], dataEndpoints: ["publicDocs"], tags: ["shared","public","collaboration"], requiresAuth: false },
  { viewId: "showcase", title: "Showcase", description: "Feature showcase and demo gallery — explore NodeBench capabilities interactively.", paths: ["/showcase","/demo"], actions: [], dataEndpoints: [], tags: ["showcase","demo","features","gallery"], requiresAuth: false },
  { viewId: "footnotes", title: "Sources", description: "Citation library — all referenced sources with metadata and verification status.", paths: ["/footnotes","/sources"], actions: ["searchSources"], dataEndpoints: ["citations"], tags: ["sources","citations","references","bibliography"], requiresAuth: false },
  { viewId: "analytics-hitl", title: "Review Queue", description: "Human-in-the-loop analytics — review and approve AI-generated content, flag issues, provide feedback.", paths: ["/internal/analytics/hitl","/analytics/hitl","/analytics/review-queue","/review-queue"], actions: ["approveItem","flagItem"], dataEndpoints: ["reviewQueue"], tags: ["analytics","review","hitl","quality"], requiresAuth: true },
  { viewId: "analytics-components", title: "Performance Analytics", description: "Component-level performance metrics — render times, bundle sizes, interaction latency.", paths: ["/internal/analytics/components","/analytics/components"], actions: [], dataEndpoints: ["componentMetrics"], tags: ["analytics","performance","metrics","components"], requiresAuth: true },
  { viewId: "analytics-recommendations", title: "Feedback", description: "Recommendation feedback dashboard — track how users engage with AI suggestions.", paths: ["/internal/analytics/recommendations","/analytics/recommendations"], actions: [], dataEndpoints: ["feedbackData"], tags: ["analytics","feedback","recommendations"], requiresAuth: true },
  { viewId: "cost-dashboard", title: "Usage & Costs", description: "API usage and cost tracking — token consumption, model costs, budget alerts.", paths: ["/internal/cost","/cost","/dashboard/cost"], actions: ["setAlert"], dataEndpoints: ["costData"], tags: ["costs","usage","budget","tokens","api"], requiresAuth: true },
  { viewId: "industry-updates", title: "Industry News", description: "Curated industry updates and news — AI/ML developments, market trends, research papers.", paths: ["/industry","/dashboard/industry"], actions: ["filterByTopic"], dataEndpoints: ["industryUpdates"], tags: ["industry","news","trends","market","updates"], requiresAuth: false },
  { viewId: "document-recommendations", title: "Suggestions", description: "AI-powered document recommendations based on reading history and interests.", paths: ["/recommendations","/discover"], actions: ["dismiss","save"], dataEndpoints: ["recommendations"], tags: ["recommendations","suggestions","discover","personalized"], requiresAuth: true },
  { viewId: "agent-marketplace", title: "Agent Templates", description: "Browse and install agent templates — pre-built AI assistants for specific tasks.", paths: ["/marketplace","/agent-marketplace"], actions: ["installTemplate"], dataEndpoints: ["templates"], tags: ["agents","marketplace","templates","install"], requiresAuth: true },
  { viewId: "pr-suggestions", title: "PR Suggestions", description: "AI-generated pull request suggestions — code review, improvements, and refactoring ideas.", paths: ["/pr-suggestions","/prs"], actions: ["applySuggestion"], dataEndpoints: ["prSuggestions"], tags: ["pull-requests","code-review","suggestions","github"], requiresAuth: true },
  { viewId: "linkedin-posts", title: "LinkedIn Posts", description: "LinkedIn post archive — browse, search, and analyze published posts and engagement metrics.", paths: ["/linkedin"], actions: ["searchPosts"], dataEndpoints: ["posts"], tags: ["linkedin","social","posts","content"], requiresAuth: true },
  { viewId: "mcp-ledger", title: "Tool Activity", description: "MCP tool call ledger — audit trail of all MCP tool invocations with inputs, outputs, and timing.", paths: ["/internal/mcp-ledger","/mcp-ledger","/mcp/ledger","/activity-log"], actions: ["filterByTool","filterByDate"], dataEndpoints: ["toolCalls"], tags: ["mcp","tools","audit","ledger","activity"], requiresAuth: true },
  { viewId: "engine-demo", title: "Engine API", description: "Headless engine demo surface for testing engine calls, request flow, and API responses.", paths: ["/internal/engine","/engine","/engine-demo"], actions: ["runEngineDemo"], dataEndpoints: ["engineDemo"], tags: ["engine","api","demo","headless"], requiresAuth: false },
  { viewId: "observability", title: "System Health", description: "Observability dashboard with component health, self-healing history, and service-level signals.", paths: ["/internal/observability","/observability","/health","/system-health"], actions: ["reviewActiveAlerts","inspectHealingHistory"], dataEndpoints: ["systemHealth","healingActions"], tags: ["observability","health","alerts","slo","self-healing"], requiresAuth: false },
  { viewId: "investigation", title: "Investigation", description: "Trace from action to evidence to approval across a single run, escalation, or operator review.", paths: ["/investigation","/investigate","/enterprise-demo"], actions: ["replayRun","inspectEvidence"], dataEndpoints: [], tags: ["investigation","trace","evidence","replay","approval"], requiresAuth: false },
  { viewId: "oracle", title: "The Oracle", description: "Operational memory and telemetry surface for long-running AI work, strategy loops, and builder oversight.", paths: ["/oracle","/career","/trajectory"], actions: ["reviewMemory","inspectTelemetry"], dataEndpoints: [], tags: ["oracle","memory","telemetry","strategy","operations"], requiresAuth: false },
  { viewId: "dev-dashboard", title: "Dev Dashboard", description: "Internal development dashboard for repo evolution, domain milestones, and engineering progress tracking.", paths: ["/internal/dev-dashboard","/dev-dashboard","/dev","/evolution"], actions: ["reviewMilestones","inspectEvolution"], dataEndpoints: [], tags: ["dev-dashboard","engineering","milestones","timeline","internal"], requiresAuth: false },
];

export const getViewManifest = query({
  args: {
    includeAuthOnly: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    if (args.includeAuthOnly) {
      return { views: VIEW_MANIFEST, totalViews: VIEW_MANIFEST.length };
    }
    const publicViews = VIEW_MANIFEST.filter((v) => !v.requiresAuth);
    return { views: publicViews, totalViews: publicViews.length };
  },
});

export const getViewCapabilities = query({
  args: {
    viewId: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const entry = VIEW_MANIFEST.find((v) => v.viewId === args.viewId);
    if (!entry) {
      return { error: `Unknown view: ${args.viewId}`, availableViews: VIEW_MANIFEST.map((v) => v.viewId) };
    }
    return entry;
  },
});

export const searchViews = query({
  args: {
    query: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const q = args.query.toLowerCase();
    const matches = VIEW_MANIFEST.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.tags.some((t) => t.includes(q)),
    );
    return { matches, count: matches.length };
  },
});

/**
 * dogfoodSuite.ts — All 13 dogfood scenarios with prompts, expected tool chains,
 * telemetry targets, and assertion criteria.
 *
 * 6 AI App scenarios + 7 MCP scenarios.
 * Matches DOGFOOD_RUNBOOK_V1.md exactly.
 */

import type { DogfoodRole, CostBand } from "./dogfoodTelemetry";

/* ─── Scenario shape ─────────────────────────────────────────────────────── */

export interface DogfoodScenario {
  id: string;
  surface: "ai_app" | "mcp" | "engine_api";
  title: string;
  prompt: string;
  userRole: DogfoodRole;
  expectedLens: string;
  expectedToolChain: string[];
  telemetryTargets: {
    toolCalls: [number, number];
    reads: [number, number];
    writes: [number, number];
    webEnrichments: [number, number];
    tokens: [number, number];
    latencyMs: [number, number];
    costBand: CostBand;
  };
  expectedAssertions: string[];
  priority: "p0" | "p1" | "p2";
}

/* ─── AI App Scenarios (6) ───────────────────────────────────────────────── */

const AI_APP_SCENARIOS: DogfoodScenario[] = [
  {
    id: "app-01-founder-weekly-reset",
    surface: "ai_app",
    title: "Founder Weekly Reset",
    prompt: `Use everything from my recent NodeBench work this week to generate my founder weekly reset.
I want:
- what company we are actually building
- what changed since the last meaningful session
- the single biggest contradiction
- the next 3 moves
- one reusable Artifact Packet
- one memo I could send to a teammate or investor
Please include competitor and positioning implications if they materially changed.`,
    userRole: "founder",
    expectedLens: "founder",
    expectedToolChain: [
      "check_mcp_setup", "discover_tools", "load_toolset", "founder_deep_context_gather",
      "extract_variables", "build_claim_graph", "generate_countermodels", "run_deep_sim",
      "rank_interventions", "render_decision_memo", "founder_packet_validate",
      "track_action", "record_event", "record_state_diff", "flag_important_change", "track_milestone",
    ],
    telemetryTargets: {
      toolCalls: [12, 16], reads: [8, 15], writes: [4, 7],
      webEnrichments: [1, 3], tokens: [18_000, 45_000], latencyMs: [8_000, 35_000], costBand: "medium",
    },
    expectedAssertions: [
      "canonical truth says local-first operating-memory and entity-context layer",
      "contradiction flags too many surfaces before habit proof and public narrative mismatch",
      "next 3 moves include: unify public message, publish preset story, dogfood 3 must-win loops",
    ],
    priority: "p0",
  },
  {
    id: "app-02-pre-delegation-packet",
    surface: "ai_app",
    title: "Pre-Delegation Packet for Claude Code",
    prompt: `Create a pre-delegation packet for Claude Code to improve NodeBench after Phase 12.
Focus on: no-bandage fixes, weekly founder reset, packet lineage, important-change review, suppressing noisy outputs, keeping the app from drifting into generic shell language.
Output: scoped objective, before/after state, constraints, success criteria, exact files/surfaces likely affected, agent-ready instructions.`,
    userRole: "founder",
    expectedLens: "founder",
    expectedToolChain: [
      "discover_tools", "load_toolset", "founder_packet_diff", "founder_deep_context_gather",
      "extract_variables", "rank_interventions", "render_decision_memo",
      "founder_packet_validate", "track_action", "record_event", "record_state_diff", "get_session_journal",
    ],
    telemetryTargets: {
      toolCalls: [9, 13], reads: [6, 10], writes: [3, 5],
      webEnrichments: [0, 1], tokens: [10_000, 28_000], latencyMs: [6_000, 20_000], costBand: "medium",
    },
    expectedAssertions: [
      "packet specifies objective: tighten anticipatory outputs after Phase 12",
      "constraints include: do not expand generic shell behavior",
      "affected surfaces list: AI app result workspace, local mirror, packet panel, session delta, export paths",
      "success metric: fewer repeated questions, higher packet reuse, lower false-alert rate",
    ],
    priority: "p1",
  },
  {
    id: "app-03-important-change-review",
    surface: "ai_app",
    title: "Important-Change Review",
    prompt: `Show me only the important changes since my last meaningful NodeBench session.
I want: strategy changes, positioning changes, product architecture changes, competitor or market changes that actually matter, anything that should trigger a packet refresh or a new memo.
Suppress low-signal noise.`,
    userRole: "founder",
    expectedLens: "founder",
    expectedToolChain: [
      "discover_tools", "load_toolset", "get_daily_log", "get_weekly_summary",
      "get_important_changes", "get_event_ledger", "get_causal_chain",
      "get_state_diff_history", "get_trajectory_summary", "flag_important_change", "record_event",
    ],
    telemetryTargets: {
      toolCalls: [8, 12], reads: [8, 14], writes: [1, 3],
      webEnrichments: [0, 1], tokens: [6_000, 18_000], latencyMs: [4_000, 15_000], costBand: "light",
    },
    expectedAssertions: [
      "surfaces Phase 10 causal memory completed",
      "surfaces NodeBench AI App now search-first with 8-section result workspace",
      "surfaces public-facing narrative still lags internal thesis",
      "flags package/public docs mismatch as important",
    ],
    priority: "p0",
  },
  {
    id: "app-04-competitor-supermemory",
    surface: "ai_app",
    title: "Competitor Intelligence Brief: Supermemory",
    prompt: `Analyze Supermemory as a competitor or adjacent layer for NodeBench.
Tell me: what category they really own, what distribution advantages they have, what not to compete with directly, what we should absorb from their playbook, what NodeBench should own above their layer.
Produce a one-page competitor brief and a founder action packet.`,
    userRole: "researcher",
    expectedLens: "founder",
    expectedToolChain: [
      "discover_tools", "load_toolset", "run_recon", "log_recon_finding", "assess_risk",
      "extract_variables", "build_claim_graph", "generate_countermodels", "run_deep_sim",
      "rank_interventions", "render_decision_memo", "record_learning",
      "search_all_knowledge", "track_action", "record_event", "flag_important_change",
    ],
    telemetryTargets: {
      toolCalls: [12, 18], reads: [6, 10], writes: [4, 6],
      webEnrichments: [4, 8], tokens: [20_000, 60_000], latencyMs: [12_000, 45_000], costBand: "heavy",
    },
    expectedAssertions: [
      "identifies Supermemory as universal memory/context infrastructure with MCP + MemoryBench",
      "concludes NodeBench should not fight there directly",
      "recommends absorbing: plugin distribution, MCP-native onboarding, benchmark rigor, provider abstraction",
      "recommends owning: causal memory, before/after state, packets/artifacts, role overlays, trajectory",
    ],
    priority: "p1",
  },
  {
    id: "app-05-banker-anthropic",
    surface: "ai_app",
    title: "Banker/CEO Company Search: Anthropic",
    prompt: `Analyze Anthropic for a banker or CEO lens.
I want: company snapshot, what changed recently, strategic position, business quality and risk, why it matters now, 3 next questions to ask, exportable banker memo.`,
    userRole: "banker",
    expectedLens: "banker",
    expectedToolChain: [
      "discover_tools", "load_toolset", "run_recon", "log_recon_finding", "assess_risk",
      "extract_variables", "build_claim_graph", "rank_interventions",
      "render_decision_memo", "track_action", "record_event", "record_state_diff",
    ],
    telemetryTargets: {
      toolCalls: [10, 15], reads: [5, 8], writes: [3, 4],
      webEnrichments: [3, 6], tokens: [15_000, 40_000], latencyMs: [10_000, 30_000], costBand: "medium",
    },
    expectedAssertions: [
      "surfaces current Anthropic valuation around $61B-$380B range",
      "surfaces revenue/ARR estimates",
      "surfaces enterprise and code-focused adoption as strategic moat",
      "produces exportable banker memo with risks and next questions",
    ],
    priority: "p0",
  },
  {
    id: "app-06-student-shopify",
    surface: "ai_app",
    title: "Student Strategy Search: Shopify AI Commerce",
    prompt: `Help me understand Shopify's current AI commerce strategy and why it matters.
Give me: plain-language summary, what changed recently, strategic upside, risks and governance angles, 3 comparables, a study brief I could export.`,
    userRole: "student",
    expectedLens: "student",
    expectedToolChain: [
      "discover_tools", "load_toolset", "run_recon", "log_recon_finding",
      "extract_variables", "build_claim_graph", "render_decision_memo",
      "record_learning", "track_action", "record_event",
    ],
    telemetryTargets: {
      toolCalls: [8, 12], reads: [4, 8], writes: [2, 4],
      webEnrichments: [3, 5], tokens: [12_000, 30_000], latencyMs: [8_000, 25_000], costBand: "medium",
    },
    expectedAssertions: [
      "surfaces Shopify revenue growth and free cash flow",
      "produces simplified citation-friendly study brief",
      "includes 3 comparables",
      "uses plain language appropriate for student lens",
    ],
    priority: "p1",
  },
];

/* ─── MCP Scenarios (7) ──────────────────────────────────────────────────── */

const MCP_SCENARIOS: DogfoodScenario[] = [
  {
    id: "mcp-01-setup-sanity",
    surface: "mcp",
    title: "Setup Sanity + Preset Confirmation",
    prompt: "Before doing anything else, confirm the NodeBench MCP installation, available presets, and the best preset for a founder working on NodeBench itself. Then tell me which toolsets to load and why.",
    userRole: "founder",
    expectedLens: "founder",
    expectedToolChain: [
      "check_mcp_setup", "list_available_toolsets", "discover_tools", "get_tool_quick_ref",
    ],
    telemetryTargets: {
      toolCalls: [4, 4], reads: [4, 4], writes: [0, 0],
      webEnrichments: [0, 0], tokens: [2_000, 6_000], latencyMs: [2_000, 8_000], costBand: "light",
    },
    expectedAssertions: [
      "setup is healthy",
      "starter preset is default",
      "founder preset recommended for weekly reset",
      "banker preset recommended for company search / diligence",
    ],
    priority: "p1",
  },
  {
    id: "mcp-02-founder-weekly-reset",
    surface: "mcp",
    title: "Founder Preset Weekly Reset",
    prompt: "Load the founder preset and produce a weekly founder reset for NodeBench using the latest internal context. Resolve what company this is, what changed, the main contradiction, the next 3 moves, and validate the packet.",
    userRole: "founder",
    expectedLens: "founder",
    expectedToolChain: [
      "load_toolset", "founder_deep_context_gather", "extract_variables", "build_claim_graph",
      "generate_countermodels", "run_deep_sim", "rank_interventions", "render_decision_memo",
      "founder_packet_validate", "track_action", "track_milestone", "get_session_journal",
      "record_event", "record_state_diff",
    ],
    telemetryTargets: {
      toolCalls: [13, 15], reads: [8, 12], writes: [4, 6],
      webEnrichments: [0, 2], tokens: [15_000, 40_000], latencyMs: [8_000, 30_000], costBand: "medium",
    },
    expectedAssertions: [
      "produces one canonical founder packet",
      "produces one validated weekly memo",
      "records milestone",
      "creates state diff",
      "truth aligns to founder-first packet loop, not generic shell",
    ],
    priority: "p0",
  },
  {
    id: "mcp-03-operator-causal-replay",
    surface: "mcp",
    title: "Operator Preset Causal-Memory Replay",
    prompt: "Load the operator preset and reconstruct the causal chain for our latest NodeBench product evolution. Show pathing, before/after state, important changes, and trajectory summary for this week.",
    userRole: "operator",
    expectedLens: "operator",
    expectedToolChain: [
      "load_toolset", "get_event_ledger", "get_causal_chain", "get_path_replay",
      "get_state_diff_history", "get_trajectory_summary", "get_weekly_summary",
      "record_event", "record_path_step", "record_state_diff", "flag_important_change",
    ],
    telemetryTargets: {
      toolCalls: [10, 11], reads: [7, 10], writes: [3, 5],
      webEnrichments: [0, 0], tokens: [6_000, 16_000], latencyMs: [4_000, 15_000], costBand: "light",
    },
    expectedAssertions: [
      "produces timeline of product shifts",
      "shows before/after diffs",
      "highlights contradiction escalation or resolution",
      "produces trajectory summary",
      "identifies which changes altered packet truth",
    ],
    priority: "p1",
  },
  {
    id: "mcp-04-banker-company-search",
    surface: "mcp",
    title: "Banker Preset Blank-State Company Search",
    prompt: "Load the banker preset. Search Anthropic from blank state and produce a banker-quality memo: company snapshot, quality, risks, what changed recently, and 3 next diligence questions.",
    userRole: "banker",
    expectedLens: "banker",
    expectedToolChain: [
      "load_toolset", "run_recon", "log_recon_finding", "assess_risk",
      "extract_variables", "build_claim_graph", "rank_interventions",
      "render_decision_memo", "track_action", "record_event",
    ],
    telemetryTargets: {
      toolCalls: [9, 12], reads: [5, 8], writes: [3, 4],
      webEnrichments: [3, 6], tokens: [15_000, 35_000], latencyMs: [10_000, 30_000], costBand: "medium",
    },
    expectedAssertions: [
      "produces banker memo packet",
      "includes risks section",
      "includes comparables / next questions",
      "event + action logged",
      "picks up current public Anthropic data",
    ],
    priority: "p0",
  },
  {
    id: "mcp-05-researcher-competitor",
    surface: "mcp",
    title: "Researcher Preset Competitor Brief",
    prompt: "Load the researcher preset. Produce a competitor intelligence brief on Supermemory and explain what NodeBench should absorb versus avoid. Then save the key learnings.",
    userRole: "researcher",
    expectedLens: "researcher",
    expectedToolChain: [
      "load_toolset", "run_recon", "log_recon_finding", "assess_risk",
      "extract_variables", "build_claim_graph", "generate_countermodels", "run_deep_sim",
      "rank_interventions", "render_decision_memo", "record_learning",
      "search_all_knowledge", "record_event",
    ],
    telemetryTargets: {
      toolCalls: [12, 14], reads: [6, 10], writes: [4, 6],
      webEnrichments: [4, 8], tokens: [20_000, 50_000], latencyMs: [12_000, 40_000], costBand: "heavy",
    },
    expectedAssertions: [
      "produces one competitor brief",
      "produces one recommendation packet",
      "saves learnings for reuse",
      "concludes absorb the playbook not the category",
    ],
    priority: "p1",
  },
  {
    id: "mcp-06-public-doc-drift",
    surface: "mcp",
    title: "Public-Doc Drift Detection",
    prompt: "Compare our current internal NodeBench positioning and preset hierarchy against the public homepage and public package docs. Flag any narrative drift, stale counts, or onboarding mismatch. Generate a fix packet.",
    userRole: "founder",
    expectedLens: "founder",
    expectedToolChain: [
      "discover_tools", "load_toolset", "founder_deep_context_gather", "founder_packet_diff",
      "extract_variables", "build_claim_graph", "rank_interventions",
      "render_decision_memo", "record_event", "record_state_diff", "flag_important_change",
    ],
    telemetryTargets: {
      toolCalls: [9, 11], reads: [6, 8], writes: [3, 5],
      webEnrichments: [1, 3], tokens: [8_000, 22_000], latencyMs: [6_000, 20_000], costBand: "medium",
    },
    expectedAssertions: [
      "flags homepage title/messaging mismatch",
      "flags package docs mismatch",
      "flags onboarding confusion between AI app, local mirror, and MCP CLI",
    ],
    priority: "p0",
  },
  {
    id: "mcp-07-engine-api-trace",
    surface: "engine_api",
    title: "Engine API Trace Run",
    prompt: "Start the MCP engine API. Create a session for founder preset. Execute the weekly reset flow through the engine. Fetch the trace and report. Store the conformance result in NodeBench causal memory.",
    userRole: "operator",
    expectedLens: "operator",
    expectedToolChain: [
      "POST /api/sessions", "POST /api/tools/:name",
      "GET /api/sessions/:id/trace", "GET /api/sessions/:id/report",
      "record_event", "track_milestone", "record_state_diff",
    ],
    telemetryTargets: {
      toolCalls: [6, 10], reads: [4, 6], writes: [3, 4],
      webEnrichments: [0, 0], tokens: [5_000, 15_000], latencyMs: [5_000, 20_000], costBand: "light",
    },
    expectedAssertions: [
      "produces reproducible session trace",
      "produces conformance report",
      "records milestone in causal memory",
      "creates state diff from prior run",
    ],
    priority: "p1",
  },
];

/* ─── Full Suite ─────────────────────────────────────────────────────────── */

export const DOGFOOD_SUITE: DogfoodScenario[] = [...AI_APP_SCENARIOS, ...MCP_SCENARIOS];

/** The first 3 high-leverage runs to execute */
export const PRIORITY_FIRST_3: DogfoodScenario[] = DOGFOOD_SUITE.filter(
  (s) => s.priority === "p0",
).slice(0, 3);

/** All P0 scenarios */
export const P0_SCENARIOS: DogfoodScenario[] = DOGFOOD_SUITE.filter((s) => s.priority === "p0");

/* ─── Batch Estimates ────────────────────────────────────────────────────── */

export const BATCH_ESTIMATES = {
  totalScenarios: 13,
  toolCalls: { low: 114, high: 170 },
  localReads: { low: 78, high: 121 },
  localWrites: { low: 37, high: 60 },
  webEnrichments: { low: 15, high: 36 },
  tokenBand: { low: 170_000, high: 430_000 },
  wallClockMinutes: { low: 8, high: 35 },
  cloudCostCheap: { low: 1.00, high: 8.00 },
  cloudCostPremium: { low: 8.00, high: 30.00 },
} as const;

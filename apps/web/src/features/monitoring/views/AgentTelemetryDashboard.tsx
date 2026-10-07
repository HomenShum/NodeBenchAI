/**
 * AgentTelemetryDashboard — Full agent telemetry: actions, tools, costs, latency, errors.
 *
 * The ONE view that answers: "show me everything the agent did, what tools it used,
 * how much it cost, and how it performed."
 *
 * Dark-mode first. All demo data hardcoded for a realistic 4h23m session with 847 actions
 * across 42 tool types including Deep Sim, trajectory, mission, and MCP tools.
 *
 * Uses SurfacePrimitives as the unified design language.
 */

import { memo, useCallback, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Hammer,
  Layers,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";
import {
  SurfaceBadge,
  SurfaceCard,
  SurfaceGrid,
  SurfacePageHeader,
  SurfaceScroll,
  SurfaceSection,
  SurfaceStat,
} from "@/shared/ui/SurfacePrimitives";
import { ContextInspector, createDemoContextBundle } from "@/features/telemetry/ContextInspector";
import { EvalScorecard, createDemoEvalData } from "@/features/telemetry/EvalScorecard";
import { ToolCoverageProof } from "@/features/telemetry/ToolCoverageProof";
import { ContextualGraph } from "@/features/telemetry/ContextualGraph";
import { LiveDataBanner } from "@/features/telemetry/LiveDataBanner";
import { PipelineRollupPanel } from "@/features/monitoring/components/PipelineRollupPanel";
import { JudgeHeatmap, createDemoJudgeHeatmapData } from "@/features/telemetry/JudgeHeatmap";
import { CostWaterfall } from "@/features/telemetry/CostWaterfall";
import { FailureClusters, createDemoFailureClusters } from "@/features/telemetry/FailureClusters";
import {
  useLiveEvalScorecard,
  useLiveTraceAggregates,
  useLiveContextBundle,
} from "@/features/telemetry/useLiveTelemetry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolBreakdown {
  toolName: string;
  category: string;
  calls: number;
  avgMs: number;
  totalCostUsd: number;
  errors: number;
  successRate: number;
}

interface ActionEntry {
  id: string;
  timestamp: string;
  toolName: string;
  entity: string;
  latencyMs: number;
  status: "success" | "slow" | "error";
  inputSummary: string;
  outputSummary: string;
}

interface ErrorEntry {
  id: string;
  timestamp: string;
  toolName: string;
  message: string;
  severity: "warning" | "error" | "fatal";
}

type SortKey = "toolName" | "calls" | "avgMs" | "totalCostUsd" | "errors" | "successRate";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Demo data generation
// ---------------------------------------------------------------------------

function generateToolBreakdowns(): ToolBreakdown[] {
  const tools: ToolBreakdown[] = [
    // Deep Sim tools (7)
    { toolName: "build_claim_graph", category: "deep-sim", calls: 23, avgMs: 2100, totalCostUsd: 0.45, errors: 1, successRate: 95.7 },
    { toolName: "extract_variables", category: "deep-sim", calls: 19, avgMs: 1800, totalCostUsd: 0.38, errors: 0, successRate: 100 },
    { toolName: "run_deep_sim", category: "deep-sim", calls: 14, avgMs: 45000, totalCostUsd: 0.92, errors: 2, successRate: 85.7 },
    { toolName: "score_interventions", category: "deep-sim", calls: 11, avgMs: 3200, totalCostUsd: 0.22, errors: 0, successRate: 100 },
    { toolName: "generate_scenarios", category: "deep-sim", calls: 16, avgMs: 8400, totalCostUsd: 0.51, errors: 1, successRate: 93.8 },
    { toolName: "build_decision_memo", category: "deep-sim", calls: 8, avgMs: 12200, totalCostUsd: 0.34, errors: 0, successRate: 100 },
    { toolName: "compare_counter_models", category: "deep-sim", calls: 12, avgMs: 6800, totalCostUsd: 0.29, errors: 0, successRate: 100 },

    // Trajectory tools (6)
    { toolName: "compute_trajectory_score", category: "trajectory", calls: 34, avgMs: 420, totalCostUsd: 0.04, errors: 0, successRate: 100 },
    { toolName: "update_trust_graph", category: "trajectory", calls: 28, avgMs: 380, totalCostUsd: 0.03, errors: 0, successRate: 100 },
    { toolName: "get_trajectory_sparkline", category: "trajectory", calls: 41, avgMs: 180, totalCostUsd: 0.02, errors: 0, successRate: 100 },
    { toolName: "log_trajectory_event", category: "trajectory", calls: 67, avgMs: 90, totalCostUsd: 0.01, errors: 0, successRate: 100 },
    { toolName: "get_trajectory_summary", category: "trajectory", calls: 22, avgMs: 310, totalCostUsd: 0.03, errors: 0, successRate: 100 },
    { toolName: "decay_stale_scores", category: "trajectory", calls: 6, avgMs: 1200, totalCostUsd: 0.02, errors: 0, successRate: 100 },

    // Mission tools (5)
    { toolName: "create_mission", category: "missions", calls: 4, avgMs: 2800, totalCostUsd: 0.08, errors: 0, successRate: 100 },
    { toolName: "execute_mission_task", category: "missions", calls: 38, avgMs: 5400, totalCostUsd: 0.62, errors: 3, successRate: 92.1 },
    { toolName: "judge_task_output", category: "missions", calls: 35, avgMs: 3100, totalCostUsd: 0.28, errors: 1, successRate: 97.1 },
    { toolName: "sniff_check", category: "missions", calls: 42, avgMs: 220, totalCostUsd: 0.01, errors: 0, successRate: 100 },
    { toolName: "close_mission", category: "missions", calls: 3, avgMs: 1400, totalCostUsd: 0.02, errors: 0, successRate: 100 },

    // Research & intelligence (5)
    { toolName: "web_search", category: "research", calls: 56, avgMs: 2400, totalCostUsd: 0.11, errors: 2, successRate: 96.4 },
    { toolName: "fetch_url", category: "research", calls: 48, avgMs: 1900, totalCostUsd: 0.05, errors: 4, successRate: 91.7 },
    { toolName: "extract_structured_data", category: "research", calls: 31, avgMs: 3800, totalCostUsd: 0.19, errors: 1, successRate: 96.8 },
    { toolName: "build_research_brief", category: "research", calls: 9, avgMs: 14200, totalCostUsd: 0.31, errors: 0, successRate: 100 },
    { toolName: "detect_regime_shift", category: "research", calls: 7, avgMs: 910, totalCostUsd: 0.01, errors: 0, successRate: 100 },

    // Verification & eval (4)
    { toolName: "start_verification_cycle", category: "verification", calls: 12, avgMs: 1100, totalCostUsd: 0.02, errors: 0, successRate: 100 },
    { toolName: "log_test_result", category: "verification", calls: 89, avgMs: 45, totalCostUsd: 0.01, errors: 0, successRate: 100 },
    { toolName: "check_contract_compliance", category: "verification", calls: 6, avgMs: 2200, totalCostUsd: 0.04, errors: 0, successRate: 100 },
    { toolName: "critter_checkpoint", category: "verification", calls: 15, avgMs: 680, totalCostUsd: 0.02, errors: 0, successRate: 100 },

    // Agent orchestration (4)
    { toolName: "orchestrate_swarm", category: "agents", calls: 3, avgMs: 18000, totalCostUsd: 0.14, errors: 0, successRate: 100 },
    { toolName: "delegate_subtask", category: "agents", calls: 17, avgMs: 420, totalCostUsd: 0.02, errors: 0, successRate: 100 },
    { toolName: "passport_gate_check", category: "agents", calls: 24, avgMs: 110, totalCostUsd: 0.01, errors: 0, successRate: 100 },
    { toolName: "self_evolve_prompt", category: "agents", calls: 5, avgMs: 7600, totalCostUsd: 0.18, errors: 1, successRate: 80.0 },

    // Session & memory (3)
    { toolName: "save_session_note", category: "session", calls: 18, avgMs: 65, totalCostUsd: 0.00, errors: 0, successRate: 100 },
    { toolName: "load_session_notes", category: "session", calls: 11, avgMs: 120, totalCostUsd: 0.00, errors: 0, successRate: 100 },
    { toolName: "refresh_task_context", category: "session", calls: 8, avgMs: 340, totalCostUsd: 0.01, errors: 0, successRate: 100 },

    // MCP bridge (3)
    { toolName: "discover_tools", category: "mcp", calls: 14, avgMs: 280, totalCostUsd: 0.01, errors: 0, successRate: 100 },
    { toolName: "get_tool_quick_ref", category: "mcp", calls: 9, avgMs: 190, totalCostUsd: 0.00, errors: 0, successRate: 100 },
    { toolName: "get_workflow_chain", category: "mcp", calls: 7, avgMs: 250, totalCostUsd: 0.01, errors: 0, successRate: 100 },

    // Git & code (2)
    { toolName: "generate_pr_report", category: "git", calls: 2, avgMs: 22000, totalCostUsd: 0.08, errors: 0, successRate: 100 },
    { toolName: "git_diff_summary", category: "git", calls: 11, avgMs: 1400, totalCostUsd: 0.02, errors: 0, successRate: 100 },

    // Proof & replay (2)
    { toolName: "register_replay_manifest", category: "proof", calls: 6, avgMs: 1660, totalCostUsd: 0.01, errors: 0, successRate: 100 },
    { toolName: "export_proof_bundle", category: "proof", calls: 4, avgMs: 2400, totalCostUsd: 0.02, errors: 0, successRate: 100 },
  ];

  return tools;
}

const ENTITY_POOL = [
  "entity/acme-ai", "entity/openai", "entity/anthropic", "entity/stripe",
  "entity/vercel", "entity/figma", "entity/linear", "entity/notion",
  "mission/deep-trace-001", "mission/eval-sweep-042", "session/main",
];

function generateActionFeed(tools: ToolBreakdown[]): ActionEntry[] {
  const now = Date.now();
  const actions: ActionEntry[] = [];
  let id = 1;

  for (let i = 0; i < 60; i++) {
    const tool = tools[i % tools.length];
    const msAgo = i * 42000 + Math.floor(Math.random() * 10000);
    const ts = new Date(now - msAgo);
    const latency = tool.avgMs + Math.floor((Math.random() - 0.5) * tool.avgMs * 0.4);
    const isError = tool.errors > 0 && Math.random() < 0.08;
    const isSlow = !isError && latency > 5000;

    actions.push({
      id: `act-${id++}`,
      timestamp: ts.toISOString(),
      toolName: tool.toolName,
      entity: ENTITY_POOL[i % ENTITY_POOL.length],
      latencyMs: latency,
      status: isError ? "error" : isSlow ? "slow" : "success",
      inputSummary: `{ "target": "${ENTITY_POOL[i % ENTITY_POOL.length]}", "depth": ${Math.ceil(Math.random() * 3)} }`,
      outputSummary: isError
        ? `Error: timeout after ${Math.floor(latency / 1000)}s`
        : `Completed with ${Math.ceil(Math.random() * 12)} results in ${latency}ms`,
    });
  }

  return actions;
}

function generateErrorLog(): ErrorEntry[] {
  const now = Date.now();
  return [
    { id: "err-1", timestamp: new Date(now - 18 * 60000).toISOString(), toolName: "run_deep_sim", message: "Timeout after 30s — entity/acme-ai scenario matrix exceeded budget", severity: "error" },
    { id: "err-2", timestamp: new Date(now - 45 * 60000).toISOString(), toolName: "fetch_url", message: "ECONNREFUSED on https://api.crunchbase.com/v4 — retry 2/3 succeeded", severity: "warning" },
    { id: "err-3", timestamp: new Date(now - 72 * 60000).toISOString(), toolName: "execute_mission_task", message: "Judge rejected output: confidence 0.41 below threshold 0.60", severity: "warning" },
    { id: "err-4", timestamp: new Date(now - 98 * 60000).toISOString(), toolName: "build_claim_graph", message: "Gateway unreachable for 4.2s — fallback to cached graph", severity: "warning" },
    { id: "err-5", timestamp: new Date(now - 134 * 60000).toISOString(), toolName: "run_deep_sim", message: "OOM on scenario branch #7 — killed after 2.1GB resident", severity: "fatal" },
    { id: "err-6", timestamp: new Date(now - 156 * 60000).toISOString(), toolName: "fetch_url", message: "SSL certificate expired for target domain — skipped", severity: "error" },
    { id: "err-7", timestamp: new Date(now - 189 * 60000).toISOString(), toolName: "self_evolve_prompt", message: "Mutation rejected by consistency index — delta exceeded safe threshold", severity: "warning" },
    { id: "err-8", timestamp: new Date(now - 210 * 60000).toISOString(), toolName: "execute_mission_task", message: "Sniff check failed: hallucination score 0.72 exceeded 0.50 limit", severity: "error" },
    { id: "err-9", timestamp: new Date(now - 238 * 60000).toISOString(), toolName: "fetch_url", message: "Rate limited by GitHub API — 403 with retry-after 60s", severity: "warning" },
    { id: "err-10", timestamp: new Date(now - 250 * 60000).toISOString(), toolName: "generate_scenarios", message: "Branch pruning removed all viable paths — restarted with wider bounds", severity: "warning" },
    { id: "err-11", timestamp: new Date(now - 255 * 60000).toISOString(), toolName: "execute_mission_task", message: "Task exceeded token budget (32k) — truncated context window", severity: "warning" },
    { id: "err-12", timestamp: new Date(now - 260 * 60000).toISOString(), toolName: "fetch_url", message: "DNS resolution failed for archive.org — transient network error", severity: "warning" },
  ];
}

function generateCostSparkline(): number[] {
  // 24 data points representing hourly cost over the last 24h
  return [
    0.02, 0.01, 0.01, 0.00, 0.00, 0.00, 0.01, 0.03,
    0.08, 0.14, 0.19, 0.22, 0.18, 0.15, 0.21, 0.25,
    0.19, 0.12, 0.16, 0.23, 0.28, 0.21, 0.14, 0.08,
  ];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatCost(usd: number): string {
  if (usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function statusToTone(status: "success" | "slow" | "error"): "positive" | "warning" | "danger" {
  switch (status) {
    case "success": return "positive";
    case "slow": return "warning";
    case "error": return "danger";
  }
}

function statusIcon(status: "success" | "slow" | "error"): string {
  switch (status) {
    case "success": return "\u2713";
    case "slow": return "\u23F1";
    case "error": return "\u2717";
  }
}

function severityClasses(severity: "warning" | "error" | "fatal"): string {
  switch (severity) {
    case "warning": return "text-amber-400";
    case "error": return "text-rose-400";
    case "fatal": return "text-rose-300 font-semibold";
  }
}

function categoryColor(category: string): string {
  const map: Record<string, string> = {
    "deep-sim": "bg-violet-500/15 text-violet-300 border-violet-500/25",
    trajectory: "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
    missions: "bg-orange-500/15 text-orange-300 border-orange-500/25",
    research: "bg-blue-500/15 text-blue-300 border-blue-500/25",
    verification: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    agents: "bg-pink-500/15 text-pink-300 border-pink-500/25",
    session: "bg-slate-500/15 text-slate-300 border-slate-500/25",
    mcp: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
    git: "bg-teal-500/15 text-teal-300 border-teal-500/25",
    proof: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  };
  return map[category] ?? "bg-slate-500/15 text-slate-300 border-slate-500/25";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CostSparkline = memo(function CostSparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 0.01);
  return (
    <div
      className="flex items-end gap-[2px] h-16"
      role="img"
      aria-label={`Cost over time sparkline. Peak: ${formatCost(max)}`}
      data-agent-chart="cost-sparkline"
    >
      {data.map((v, i) => {
        const pct = Math.max(4, (v / max) * 100);
        const isHigh = v / max > 0.8;
        const isMid = v / max > 0.5;
        return (
          <div
            key={i}
            className={cn(
              "flex-1 min-w-[6px] rounded-t-sm transition-all",
              isHigh ? "bg-rose-500/80" : isMid ? "bg-amber-500/60" : "bg-emerald-500/50",
            )}
            style={{ height: `${pct}%` }}
            title={`Hour ${i}: ${formatCost(v)}`}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
});

const ExpandableActionRow = memo(function ExpandableActionRow({ action }: { action: ActionEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border-b border-edge/50 last:border-b-0"
      data-agent-action={action.id}
    >
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${action.toolName} at ${formatTimestamp(action.timestamp)}, ${formatMs(action.latencyMs)}, ${action.status}`}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-content-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-content-muted shrink-0" />
        )}
        <span className="text-xs text-content-muted tabular-nums w-12 shrink-0">
          {formatTimestamp(action.timestamp)}
        </span>
        <span className="text-sm font-mono text-content truncate flex-1">
          {action.toolName}
        </span>
        <span className="text-xs text-content-muted truncate max-w-[180px] hidden sm:block">
          {action.entity}
        </span>
        <span className="text-xs tabular-nums text-content-muted w-16 text-right shrink-0">
          {formatMs(action.latencyMs)}
        </span>
        <SurfaceBadge tone={statusToTone(action.status)} className="w-10 justify-center shrink-0">
          {statusIcon(action.status)}
        </SurfaceBadge>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-12 space-y-2 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
          <div>
            <span className="text-content-muted font-medium">Input: </span>
            <code className="text-content/80 bg-white/[0.03] px-1.5 py-0.5 rounded text-[11px]">
              {action.inputSummary}
            </code>
          </div>
          <div>
            <span className="text-content-muted font-medium">Output: </span>
            <code className="text-content/80 bg-white/[0.03] px-1.5 py-0.5 rounded text-[11px]">
              {action.outputSummary}
            </code>
          </div>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function AgentTelemetryDashboardInner() {
  const revealed = useRevealOnMount();

  // Live data hooks — fall back to demo data when server unreachable
  const liveEval = useLiveEvalScorecard();
  const liveTrace = useLiveTraceAggregates();
  const liveContext = useLiveContextBundle();

  const isAnyLive = liveEval.isLive || liveTrace.isLive || liveContext.isLive;

  // Use live data if available, otherwise demo
  const tools = liveTrace.isLive && liveTrace.tools.length > 0
    ? liveTrace.tools
    : generateToolBreakdowns();
  const actions = liveTrace.isLive && liveTrace.actions.length > 0
    ? liveTrace.actions
    : generateActionFeed(tools as ToolBreakdown[]);
  const errors = liveTrace.isLive && liveTrace.errors.length > 0
    ? liveTrace.errors
    : generateErrorLog();
  const sparkline = useMemo(() => generateCostSparkline(), []);

  const [sortKey, setSortKey] = useState<SortKey>("calls");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const [visibleActions, setVisibleActions] = useState(20);

  // Aggregates
  const totalActions = useMemo(() => tools.reduce((s, t) => s + t.calls, 0), [tools]);
  const totalCost = useMemo(() => tools.reduce((s, t) => s + t.totalCostUsd, 0), [tools]);
  const totalErrors = useMemo(() => tools.reduce((s, t) => s + t.errors, 0), [tools]);
  const avgLatency = useMemo(() => {
    const weighted = tools.reduce((s, t) => s + t.avgMs * t.calls, 0);
    return totalActions > 0 ? weighted / totalActions : 0;
  }, [tools, totalActions]);

  // Sort
  const sortedTools = useMemo(() => {
    const sorted = [...tools].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [tools, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  const SortIcon = sortDir === "asc" ? ArrowUpAZ : ArrowDownAZ;

  const SortableHeader = useCallback(
    ({ label, colKey, className }: { label: string; colKey: SortKey; className?: string }) => (
      <button
        className={cn(
          "flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-content-muted hover:text-content transition-colors",
          className,
        )}
        onClick={() => handleSort(colKey)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {sortKey === colKey && <SortIcon className="h-3 w-3" />}
      </button>
    ),
    [handleSort, sortKey, SortIcon],
  );

  return (
    <SurfaceScroll
      maxWidth="xl"
      className={cn(
        "transition-opacity duration-500",
        revealed ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        data-agent-surface="agent-telemetry"
        role="main"
        aria-label="Agent Activity Dashboard"
        className="flex flex-col gap-6"
      >
        {/* Live/Demo data indicator — the visual proof */}
        <LiveDataBanner
          isLive={isAnyLive}
          isLoading={liveEval.isLoading}
          lastFetched={liveTrace.lastFetched ?? liveEval.lastFetched}
          onRefresh={() => {
            liveEval.refresh();
          }}
          label={isAnyLive ? "Live Telemetry" : undefined}
        />

        {/* Header */}
        <SurfacePageHeader
          title="Agent Activity"
          subtitle="Full action log, tool call breakdown, costs, latency, and error tracking"
          badge={
            <SurfaceBadge tone={isAnyLive ? "positive" : "warning"}>
              <span className={`h-1.5 w-1.5 rounded-full ${isAnyLive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"} mr-1`} aria-hidden="true" />
              {isAnyLive ? "Live session" : "Demo mode"}
            </SurfaceBadge>
          }
          actions={
            <div className="flex items-center gap-2 text-xs text-content-muted tabular-nums">
              <span>Duration: {liveTrace.isLive ? liveTrace.sessionDuration : "4h 23m"}</span>
              <span>|</span>
              <span>{totalErrors} errors</span>
            </div>
          }
        />

        {/* Pipeline rollup hero — structuring pass telemetry + verdicts + LLM.
            Sits right under the page header so operators see pipeline health
            before drilling into tool-level breakdowns. Live data from Convex;
            renders a "No runs yet" label when the tables are empty. */}
        <PipelineRollupPanel limit={200} />

        {/* Summary stat cards */}
        <SurfaceGrid cols={4} data-agent-section="summary-metrics">
          <SurfaceCard aria-label={`Total Actions: ${totalActions.toLocaleString()}`} data-agent-action="metric-total-actions">
            <div className="flex items-center gap-2 mb-2 text-content-muted">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <SurfaceStat
              value={totalActions.toLocaleString()}
              label="Total Actions"
              sublabel={`${(totalActions / (4 * 60 + 23)).toFixed(1)}/min avg`}
            />
          </SurfaceCard>
          <SurfaceCard aria-label={`Tools Used: ${tools.length}`} data-agent-action="metric-tools-used">
            <div className="flex items-center gap-2 mb-2 text-content-muted">
              <Hammer className="h-3.5 w-3.5" />
            </div>
            <SurfaceStat
              value={String(tools.length)}
              label="Tools Used"
              sublabel={`${new Set(tools.map((t) => t.category)).size} categories`}
            />
          </SurfaceCard>
          <SurfaceCard aria-label={`Total Cost: ${formatCost(totalCost)}`} data-agent-action="metric-total-cost">
            <div className="flex items-center gap-2 mb-2 text-content-muted">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            <SurfaceStat
              value={formatCost(totalCost)}
              label="Total Cost"
              sublabel={`${formatCost(totalCost / totalActions)}/action avg`}
            />
          </SurfaceCard>
          <SurfaceCard aria-label={`Avg Latency: ${formatMs(avgLatency)}`} data-agent-action="metric-avg-latency">
            <div className="flex items-center gap-2 mb-2 text-content-muted">
              <Clock className="h-3.5 w-3.5" />
            </div>
            <SurfaceStat
              value={formatMs(avgLatency)}
              label="Avg Latency"
              sublabel={`${formatMs(Math.min(...tools.map((t) => t.avgMs)))} min / ${formatMs(Math.max(...tools.map((t) => t.avgMs)))} max`}
            />
          </SurfaceCard>
        </SurfaceGrid>

        {/* Tool call breakdown table */}
        <SurfaceSection
          title="Tool Call Breakdown"
          action={<span className="text-xs text-content-muted tabular-nums">{tools.length} tools</span>}
          data-agent-id="tool-breakdown"
        >
          <SurfaceCard className="!p-0" data-agent-action="tool-breakdown-table">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table" aria-label="Tool call statistics">
                <thead>
                  <tr className="border-b border-edge/50">
                    <th className="text-left px-4 py-2.5">
                      <SortableHeader label="Tool" colKey="toolName" />
                    </th>
                    <th className="text-right px-3 py-2.5 hidden sm:table-cell">
                      <span className="text-xs font-semibold uppercase tracking-wider text-content-muted">Category</span>
                    </th>
                    <th className="text-right px-3 py-2.5">
                      <SortableHeader label="Calls" colKey="calls" className="justify-end" />
                    </th>
                    <th className="text-right px-3 py-2.5">
                      <SortableHeader label="Avg ms" colKey="avgMs" className="justify-end" />
                    </th>
                    <th className="text-right px-3 py-2.5">
                      <SortableHeader label="Cost" colKey="totalCostUsd" className="justify-end" />
                    </th>
                    <th className="text-right px-3 py-2.5">
                      <SortableHeader label="Errors" colKey="errors" className="justify-end" />
                    </th>
                    <th className="text-right px-4 py-2.5 hidden md:table-cell">
                      <SortableHeader label="Success" colKey="successRate" className="justify-end" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTools.map((tool) => (
                    <tr
                      key={tool.toolName}
                      className="border-b border-edge/30 last:border-b-0 hover:bg-white/[0.015] transition-colors"
                      data-agent-tool={tool.toolName}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-content">{tool.toolName}</td>
                      <td className="px-3 py-2 text-right hidden sm:table-cell">
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", categoryColor(tool.category))}>
                          {tool.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-content/80">{tool.calls}</td>
                      <td className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        tool.avgMs > 10000 ? "text-rose-400 font-medium" : tool.avgMs > 5000 ? "text-amber-400" : "text-content/80",
                      )}>
                        {formatMs(tool.avgMs)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-content/80">{formatCost(tool.totalCostUsd)}</td>
                      <td className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        tool.errors > 0 ? "text-rose-400 font-medium" : "text-content/40",
                      )}>
                        {tool.errors}
                      </td>
                      <td className={cn(
                        "px-4 py-2 text-right tabular-nums hidden md:table-cell",
                        tool.successRate < 90 ? "text-rose-400" : tool.successRate < 95 ? "text-amber-400" : "text-emerald-400",
                      )}>
                        {tool.successRate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>
        </SurfaceSection>

        {/* Recent actions feed */}
        <SurfaceSection
          title="Recent Actions"
          action={
            <span className="text-xs text-content-muted tabular-nums">
              Showing {Math.min(visibleActions, actions.length)} of {actions.length}
            </span>
          }
          data-agent-id="recent-actions"
        >
          <SurfaceCard className="overflow-hidden !p-0" data-agent-action="recent-actions-list">
            <div className="max-h-[480px] overflow-y-auto" aria-label="Recent agent actions">
              {actions.slice(0, visibleActions).map((action) => (
                <ExpandableActionRow key={action.id} action={action} />
              ))}
            </div>
            {visibleActions < actions.length && (
              <div className="px-4 py-2.5 border-t border-edge/50">
                <button
                  className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                  onClick={() => setVisibleActions((v) => v + 20)}
                  aria-label="Show more actions"
                >
                  Show more ({actions.length - visibleActions} remaining)
                </button>
              </div>
            )}
          </SurfaceCard>
        </SurfaceSection>

        {/* Cost over time */}
        <SurfaceSection title="Cost Over Time" data-agent-id="cost-over-time">
          <SurfaceCard data-agent-action="cost-sparkline-card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-content-muted">
                <DollarSign className="h-4 w-4" />
              </div>
              <span className="text-xs text-content-muted">Last 24 hours (hourly)</span>
            </div>
            <CostSparkline data={sparkline} />
            <div className="flex items-center justify-between mt-2 text-[10px] text-content-muted tabular-nums">
              <span>-24h</span>
              <span>-12h</span>
              <span>Now</span>
            </div>
          </SurfaceCard>
        </SurfaceSection>

        {/* Error log */}
        <SurfaceSection
          title="Error Log"
          action={<SurfaceBadge tone="danger">{errors.length}</SurfaceBadge>}
          data-agent-id="error-log"
        >
          <SurfaceCard className="overflow-hidden !p-0" data-agent-action="error-log-card">
            <button
              className="w-full flex items-center justify-between px-4 py-3 border-b border-edge/50 hover:bg-white/[0.015] transition-colors"
              onClick={() => setErrorsExpanded(!errorsExpanded)}
              aria-expanded={errorsExpanded}
              aria-label="Toggle error log"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400" />
                <span className="text-sm font-semibold text-content">Errors &amp; Warnings</span>
              </div>
              {errorsExpanded ? (
                <ChevronDown className="h-4 w-4 text-content-muted" />
              ) : (
                <ChevronRight className="h-4 w-4 text-content-muted" />
              )}
            </button>
            {errorsExpanded && (
              <div className="divide-y divide-edge/30 animate-in fade-in slide-in-from-top-1 duration-150">
                {errors.map((err) => (
                  <div
                    key={err.id}
                    className="flex items-start gap-3 px-4 py-2.5"
                    data-agent-error={err.id}
                  >
                    <span className="text-xs text-content-muted tabular-nums w-12 shrink-0 pt-0.5">
                      {formatTimestamp(err.timestamp)}
                    </span>
                    <span className="text-xs font-mono text-content/70 w-40 shrink-0 truncate pt-0.5">
                      {err.toolName}
                    </span>
                    <span className={cn("text-xs flex-1", severityClasses(err.severity))}>
                      {err.severity === "fatal" && (
                        <SurfaceBadge tone="danger" className="mr-1 text-[9px] uppercase font-bold">fatal</SurfaceBadge>
                      )}
                      {err.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </SurfaceSection>

        {/* Context Injection Inspector — LIVE DATA */}
        <SurfaceSection
          title="Context Injection State"
          action={
            liveContext.isLive ? (
              <SurfaceBadge tone="positive">live</SurfaceBadge>
            ) : (
              <SurfaceBadge tone="warning">demo</SurfaceBadge>
            )
          }
          data-agent-id="context-inspector"
        >
          <ContextInspector
            data={liveContext.data ?? createDemoContextBundle()}
            onRefresh={liveContext.refresh}
            isRefreshing={liveContext.isRefreshing}
          />
        </SurfaceSection>

        {/* Eval Scorecard — LIVE DATA */}
        <SurfaceSection
          title="Eval Scorecard"
          action={
            liveEval.isLive ? (
              <SurfaceBadge tone="positive">live · {liveEval.data?.history.length ?? 0} runs</SurfaceBadge>
            ) : (
              <SurfaceBadge tone="warning">demo</SurfaceBadge>
            )
          }
          data-agent-id="eval-scorecard"
        >
          <EvalScorecard data={liveEval.data ?? createDemoEvalData()} />
        </SurfaceSection>

        {/* Judge Heatmap — NEW: scenario × criteria grid */}
        <SurfaceSection
          title="Judge Heatmap"
          data-agent-id="judge-heatmap"
        >
          <JudgeHeatmap data={createDemoJudgeHeatmapData()} />
        </SurfaceSection>

        {/* Cost Waterfall — NEW: where spend goes */}
        <SurfaceSection
          title="Cost Waterfall"
          data-agent-id="cost-waterfall"
        >
          <CostWaterfall tools={tools} totalCost={totalCost} />
        </SurfaceSection>

        {/* Failure Clusters — NEW: grouped failures with root causes */}
        <SurfaceSection
          title="Failure Clusters"
          data-agent-id="failure-clusters"
        >
          <FailureClusters clusters={createDemoFailureClusters()} />
        </SurfaceSection>

        {/* Progressive Discovery */}
        <SurfaceSection
          title="Progressive Discovery"
          data-agent-id="progressive-discovery"
        >
          <ToolCoverageProof />
        </SurfaceSection>

        {/* Tool Graph */}
        <SurfaceSection
          title="Tool Graph"
          data-agent-id="tool-graph"
        >
          <ContextualGraph />
        </SurfaceSection>
      </div>
    </SurfaceScroll>
  );
}

export const AgentTelemetryDashboard = memo(AgentTelemetryDashboardInner);
export default AgentTelemetryDashboard;

/**
 * DisclosureTrace - UI Component for Progressive Disclosure Visualization
 *
 * Displays real-time disclosure events from the tool execution gateway.
 * Shows skill searches, tool expansions, policy confirmations, and budget usage.
 */

import React, { useState } from "react";
import {
  Search,
  BookOpen,
  Wrench,
  Check,
  X,
  AlertTriangle,
  Clock,
  Zap,
  ChevronDown,
  ChevronRight,
  Shield,
  Database,
  ListOrdered,
  CheckCircle2,
  XCircle,
  Minimize2,
  Brain,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES (matching disclosureEvents.ts + Section 5.3 enhancements)
// ═══════════════════════════════════════════════════════════════════════════

export type DisclosureEvent =
  | { t: number; kind: "skill.search"; query: string; topK: number; results: { name: string; score?: number }[] }
  | { t: number; kind: "skill.describe"; name: string; bytes?: number; tokensAdded?: number; hash?: string }
  | { t: number; kind: "skill.cache_hit"; name: string; hash: string }
  | { t: number; kind: "skill.fallback"; query: string; reason: string }
  | { t: number; kind: "tool.search"; query: string; topK: number; results: { toolName: string; server?: string; score?: number }[] }
  | { t: number; kind: "tool.describe"; toolNames: string[]; tokensAdded?: number }
  | { t: number; kind: "tool.invoke"; toolName: string; server?: string; ok: boolean; latencyMs?: number; error?: string }
  | { t: number; kind: "resource.load"; uri: string; owner: "skill" | "tool"; tokensAdded?: number }
  | { t: number; kind: "policy.confirm_requested"; toolName: string; draftId: string; riskTier: string }
  | { t: number; kind: "policy.confirm_granted"; draftId: string }
  | { t: number; kind: "policy.confirm_denied"; draftId: string; reason: string }
  | { t: number; kind: "budget.warning"; currentTokens: number; budgetLimit: number; expansionCost: number }
  | { t: number; kind: "budget.exceeded"; currentTokens: number; budgetLimit: number }
  | { t: number; kind: "enforcement.blocked"; rule: string; toolName?: string; reason: string }
  // Section 5.3 enhancements: Tool ordering, invariants, compaction, memory
  | { t: number; kind: "tool.ordering"; sequence: string[]; memoryFirstCompliant: boolean; violation?: string }
  | { t: number; kind: "invariant.check"; invariantId: "A" | "C" | "D"; status: "pass" | "fail" | "skip"; details?: string }
  | { t: number; kind: "context.compaction"; beforeTokens: number; afterTokens: number; reduction: number; factsKept: number }
  | { t: number; kind: "memory.update"; entityId: string; action: "create" | "update" | "skip"; factsAdded: number; reason?: string }
  | { t: number; kind: "memory.query"; entityName: string; found: boolean; qualityTier?: string; ageInDays?: number; isStale?: boolean }
  // Reasoning tool events - transparent step-by-step thinking
  | { t: number; kind: "reasoning.start"; toolName: "reasoningTool"; promptPreview: string; maxTokens: number }
  | { t: number; kind: "reasoning.thinking"; step: number; thought: string; tokensUsed?: number }
  | { t: number; kind: "reasoning.complete"; reasoningTokens: number; outputTokens: number; totalTokens: number; cost: number; durationMs: number }
  // TRACE (Tool-Routed Architecture for Controlled Execution) events
  | { t: number; kind: "trace.gather_info"; toolName: string; description: string; metadataSummary?: string }
  | { t: number; kind: "trace.execute_data_op"; toolName: string; description: string; rowCount?: number; charCount?: number }
  | { t: number; kind: "trace.execute_output"; toolName: string; description: string; outputType?: string }
  | { t: number; kind: "trace.finalize"; totalSteps: number; durationMs: number; selfCorrections: number }
  | { t: number; kind: "trace.self_correction"; intendedState: string; actualState: string; correctionDescription?: string };

export interface DisclosureSummary {
  skillSearchCalls: number;
  skillsActivated: string[];
  toolsInvoked: string[];
  toolsExpanded: string[];
  totalTokensAdded: number;
  confirmationsRequested: number;
  confirmationsGranted: number;
  blockedAttempts: number;
  usedSkillFirst: boolean;
  // Section 5.3 enhancements
  memoryFirstCompliant: boolean;
  toolOrderingViolations: string[];
  invariantStatus: {
    A: "pass" | "fail" | "skip"; // Message ID isolation
    C: "pass" | "fail" | "skip"; // Memory deduplication
    D: "pass" | "fail" | "skip"; // Capability version check
  };
  compactionEvents: number;
  tokensSavedByCompaction: number;
  memoryUpdates: { entityId: string; action: "create" | "update" | "skip"; factsAdded: number }[];
  memoryQueries: { entityName: string; found: boolean; qualityTier?: string; isStale?: boolean }[];
  // Reasoning metrics
  reasoningInvocations: number;
  reasoningThinkingSteps: number;
  reasoningTokens: number;
  reasoningCost: number;
  avgReasoningDuration: number;
}

interface DisclosureTraceProps {
  events: DisclosureEvent[];
  summary?: DisclosureSummary;
  budgetLimit?: number;
  isExpanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getEventIcon(kind: DisclosureEvent["kind"]) {
  switch (kind) {
    case "skill.search":
      return <Search className="w-3.5 h-3.5 text-blue-400" />;
    case "skill.describe":
      return <BookOpen className="w-3.5 h-3.5 text-indigo-400" />;
    case "skill.cache_hit":
      return <Zap className="w-3.5 h-3.5 text-yellow-400" />;
    case "skill.fallback":
      return <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />;
    case "tool.search":
      return <Search className="w-3.5 h-3.5 text-purple-400" />;
    case "tool.describe":
      return <Wrench className="w-3.5 h-3.5 text-cyan-400" />;
    case "tool.invoke":
      return <Wrench className="w-3.5 h-3.5 text-indigo-400" />;
    case "resource.load":
      return <Database className="w-3.5 h-3.5 text-pink-400" />;
    case "policy.confirm_requested":
      return <Shield className="w-3.5 h-3.5 text-amber-400" />;
    case "policy.confirm_granted":
      return <Check className="w-3.5 h-3.5 text-green-400" />;
    case "policy.confirm_denied":
      return <X className="w-3.5 h-3.5 text-red-400" />;
    case "budget.warning":
      return <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />;
    case "budget.exceeded":
      return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
    case "enforcement.blocked":
      return <X className="w-3.5 h-3.5 text-red-400" />;
    // Section 5.3 enhancements
    case "tool.ordering":
      return <ListOrdered className="w-3.5 h-3.5 text-blue-400" />;
    case "invariant.check":
      return <Shield className="w-3.5 h-3.5 text-violet-400" />;
    case "context.compaction":
      return <Minimize2 className="w-3.5 h-3.5 text-indigo-400" />;
    case "memory.update":
      return <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />;
    case "memory.query":
      return <Brain className="w-3.5 h-3.5 text-purple-400" />;
    // Reasoning tool events
    case "reasoning.start":
      return <Brain className="w-3.5 h-3.5 text-cyan-400" />;
    case "reasoning.thinking":
      return <Brain className="w-3.5 h-3.5 text-cyan-500 motion-safe:animate-pulse" />;
    case "reasoning.complete":
      return <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />;
    // TRACE events
    case "trace.gather_info":
      return <Search className="w-3.5 h-3.5 text-blue-400" />;
    case "trace.execute_data_op":
      return <Database className="w-3.5 h-3.5 text-indigo-400" />;
    case "trace.execute_output":
      return <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />;
    case "trace.finalize":
      return <Shield className="w-3.5 h-3.5 text-amber-400" />;
    case "trace.self_correction":
      return <RefreshCw className="w-3.5 h-3.5 text-amber-400" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-content-muted" />;
  }
}

function getEventLabel(event: DisclosureEvent): string {
  switch (event.kind) {
    case "skill.search":
      return `skill.search "${event.query}"`;
    case "skill.describe":
      return `skill.describe ${event.name}`;
    case "skill.cache_hit":
      return `cache hit: ${event.name}`;
    case "skill.fallback":
      return `fallback: ${event.reason}`;
    case "tool.search":
      return `tool.search "${event.query}"`;
    case "tool.describe":
      return `tool.describe ${event.toolNames.join(", ")}`;
    case "tool.invoke":
      return `tool.invoke ${event.toolName}`;
    case "resource.load":
      return `resource.load ${event.uri}`;
    case "policy.confirm_requested":
      return `confirm requested: ${event.toolName} (${event.riskTier})`;
    case "policy.confirm_granted":
      return `confirmed`;
    case "policy.confirm_denied":
      return `denied: ${event.reason}`;
    case "budget.warning":
      return `budget warning: ${event.currentTokens}/${event.budgetLimit}`;
    case "budget.exceeded":
      return `BUDGET EXCEEDED`;
    case "enforcement.blocked":
      return `blocked: ${event.reason}`;
    // Section 5.3 enhancements
    case "tool.ordering":
      return event.memoryFirstCompliant
        ? `tool ordering: memory-first ✓`
        : `tool ordering: VIOLATION`;
    case "invariant.check":
      return `invariant ${event.invariantId}: ${event.status.toUpperCase()}`;
    case "context.compaction":
      return `context compaction: ${event.reduction}% reduction`;
    case "memory.update":
      return `memory.${event.action}: ${event.entityId}`;
    case "memory.query":
      return `memory.query: ${event.entityName}`;
    // Reasoning tool events
    case "reasoning.start":
      return `reasoning: starting (max ${event.maxTokens} tokens)`;
    case "reasoning.thinking":
      return `reasoning: step ${event.step}`;
    case "reasoning.complete":
      return `reasoning: complete (${event.durationMs}ms)`;
    // TRACE events
    case "trace.gather_info":
      return `trace.gather: ${event.toolName}`;
    case "trace.execute_data_op":
      return `trace.data_op: ${event.toolName}`;
    case "trace.execute_output":
      return `trace.output: ${event.toolName}`;
    case "trace.finalize":
      return `trace.finalize: ${event.totalSteps} steps, ${event.durationMs}ms`;
    case "trace.self_correction":
      return `trace.correction: ${event.correctionDescription || 'mismatch detected'}`;
    default:
      return "unknown event";
  }
}

function getEventDetail(event: DisclosureEvent): string | null {
  switch (event.kind) {
    case "skill.search":
      if (event.results.length > 0) {
        const top = event.results[0];
        return `→ ${event.results.length} matches, top: ${top.name}${top.score ? ` (${top.score.toFixed(2)})` : ""}`;
      }
      return "→ no matches";
    case "skill.describe":
      return `→ +${event.tokensAdded ?? 0} tokens`;
    case "tool.search":
      if (event.results.length > 0) {
        return `→ ${event.results.length} matches`;
      }
      return "→ no matches";
    case "tool.describe":
      return `→ +${event.tokensAdded ?? 0} tokens (schema loaded)`;
    case "tool.invoke":
      if (event.ok) {
        return event.latencyMs ? `→ success (${event.latencyMs}ms)` : "→ success";
      }
      return `→ error: ${event.error ?? "unknown"}`;
    // Section 5.3 enhancements
    case "tool.ordering":
      if (event.violation) {
        return `→ ${event.violation}`;
      }
      return `→ sequence: ${event.sequence.slice(0, 5).join(" → ")}${event.sequence.length > 5 ? "..." : ""}`;
    case "invariant.check":
      return event.details ? `→ ${event.details}` : null;
    case "context.compaction":
      return `→ ${event.beforeTokens.toLocaleString()} → ${event.afterTokens.toLocaleString()} tokens, ${event.factsKept} facts kept`;
    case "memory.update":
      if (event.action === "skip") {
        return `→ skipped: ${event.reason ?? "already updated"}`;
      }
      return `→ +${event.factsAdded} facts`;
    case "memory.query":
      if (!event.found) {
        return "→ not found, will trigger enrichment";
      }
      return `→ ${event.qualityTier ?? "unknown"} tier, ${event.ageInDays ?? "?"}d old${event.isStale ? " (outdated)" : ""}`;
    // Reasoning tool events
    case "reasoning.start":
      return `→ prompt: ${event.promptPreview}`;
    case "reasoning.thinking":
      return `→ ${event.thought}${event.tokensUsed ? ` (${event.tokensUsed} tokens)` : ""}`;
    case "reasoning.complete":
      return `→ reasoning: ${event.reasoningTokens.toLocaleString()} tokens, output: ${event.outputTokens.toLocaleString()} tokens, cost: $${event.cost.toFixed(6)}`;
    case "trace.gather_info":
      return event.metadataSummary ? `→ ${event.metadataSummary}` : `→ ${event.description}`;
    case "trace.execute_data_op":
      return `→ ${event.description}${event.rowCount ? ` (${event.rowCount} rows)` : ''}${event.charCount ? ` (${event.charCount.toLocaleString()} chars)` : ''}`;
    case "trace.execute_output":
      return `→ ${event.description}${event.outputType ? ` [${event.outputType}]` : ''}`;
    case "trace.finalize":
      return `→ ${event.totalSteps} deterministic steps, ${event.selfCorrections} self-correction(s)`;
    case "trace.self_correction":
      return `→ Expected: ${event.intendedState} | Actual: ${event.actualState}`;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function DisclosureTrace({
  events,
  summary,
  budgetLimit = 10000,
  isExpanded = true,
  onToggle,
  className,
}: DisclosureTraceProps) {
  const [expanded, setExpanded] = useState(isExpanded);

  const toggleExpanded = () => {
    setExpanded(!expanded);
    onToggle?.();
  };

  if (events.length === 0 && !summary) {
    return null;
  }

  // Compute quick stats from events if no summary provided
  const stats: DisclosureSummary = summary ?? {
    skillSearchCalls: events.filter((e) => e.kind === "skill.search").length,
    skillsActivated: Array.from(
      new Set(
        events
          .filter((e): e is Extract<DisclosureEvent, { kind: "skill.describe" }> => e.kind === "skill.describe")
          .map((e) => e.name)
      )
    ),
    toolsInvoked: Array.from(
      new Set(
        events
          .filter((e): e is Extract<DisclosureEvent, { kind: "tool.invoke" }> => e.kind === "tool.invoke")
          .map((e) => e.toolName)
      )
    ),
    toolsExpanded: Array.from(
      new Set(
        events
          .filter((e): e is Extract<DisclosureEvent, { kind: "tool.describe" }> => e.kind === "tool.describe")
          .flatMap((e) => e.toolNames)
      )
    ),
    totalTokensAdded: events
      .filter((e): e is { t: number; kind: string; tokensAdded?: number } & DisclosureEvent => "tokensAdded" in e)
      .reduce((sum, e) => sum + (e.tokensAdded ?? 0), 0),
    confirmationsRequested: events.filter((e) => e.kind === "policy.confirm_requested").length,
    confirmationsGranted: events.filter((e) => e.kind === "policy.confirm_granted").length,
    blockedAttempts: events.filter((e) => e.kind === "enforcement.blocked").length,
    usedSkillFirst: (() => {
      const firstSkill = events.find((e) => e.kind === "skill.search")?.t ?? Infinity;
      const firstTool = events.find((e) => e.kind === "tool.invoke")?.t ?? Infinity;
      return firstSkill < firstTool;
    })(),
    // Section 5.3 enhanced stats
    memoryFirstCompliant: (() => {
      const orderingEvent = events.find((e): e is Extract<DisclosureEvent, { kind: "tool.ordering" }> => e.kind === "tool.ordering");
      return orderingEvent?.memoryFirstCompliant ?? true;
    })(),
    toolOrderingViolations: events
      .filter((e): e is Extract<DisclosureEvent, { kind: "tool.ordering" }> => e.kind === "tool.ordering" && !e.memoryFirstCompliant)
      .map((e) => e.violation ?? "unknown violation"),
    invariantStatus: (() => {
      const invariantEvents = events.filter((e): e is Extract<DisclosureEvent, { kind: "invariant.check" }> => e.kind === "invariant.check");
      const getStatus = (id: "A" | "C" | "D") => invariantEvents.find(e => e.invariantId === id)?.status ?? "skip";
      return { A: getStatus("A"), C: getStatus("C"), D: getStatus("D") };
    })(),
    compactionEvents: events.filter((e) => e.kind === "context.compaction").length,
    tokensSavedByCompaction: events
      .filter((e): e is Extract<DisclosureEvent, { kind: "context.compaction" }> => e.kind === "context.compaction")
      .reduce((sum, e) => sum + (e.beforeTokens - e.afterTokens), 0),
    memoryUpdates: events
      .filter((e): e is Extract<DisclosureEvent, { kind: "memory.update" }> => e.kind === "memory.update")
      .map((e) => ({ entityId: e.entityId, action: e.action, factsAdded: e.factsAdded })),
    memoryQueries: events
      .filter((e): e is Extract<DisclosureEvent, { kind: "memory.query" }> => e.kind === "memory.query")
      .map((e) => ({ entityName: e.entityName, found: e.found, qualityTier: e.qualityTier, isStale: e.isStale })),
    // Reasoning metrics
    reasoningInvocations: events.filter(e => e.kind === "reasoning.start").length,
    reasoningThinkingSteps: events.filter(e => e.kind === "reasoning.thinking").length,
    reasoningTokens: events
      .filter((e): e is Extract<DisclosureEvent, { kind: "reasoning.complete" }> => e.kind === "reasoning.complete")
      .reduce((sum, e) => sum + e.reasoningTokens, 0),
    reasoningCost: events
      .filter((e): e is Extract<DisclosureEvent, { kind: "reasoning.complete" }> => e.kind === "reasoning.complete")
      .reduce((sum, e) => sum + e.cost, 0),
    avgReasoningDuration: (() => {
      const completes = events.filter((e): e is Extract<DisclosureEvent, { kind: "reasoning.complete" }> => e.kind === "reasoning.complete");
      return completes.length > 0 ? completes.reduce((sum, e) => sum + e.durationMs, 0) / completes.length : 0;
    })(),
  };

  const budgetUtilization = Math.min((stats.totalTokensAdded / budgetLimit) * 100, 100);

  return (
    <div
      className={cn(
        "border border-[var(--border-secondary)] rounded-lg bg-surface-secondary",
        className
      )}
    >
      {/* Header */}
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between p-3 hover:bg-surface-secondary transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-content-secondary" />
          ) : (
            <ChevronRight className="w-4 h-4 text-content-secondary" />
          )}
          <Search className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-content">
            Disclosure Trace
          </span>
        </div>

        {/* Quick Stats Badge */}
        <div className="flex items-center gap-3 text-xs text-content-secondary">
          <span className="flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            {stats.skillsActivated.length}
          </span>
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {stats.toolsExpanded.length}
          </span>
          <span
            className={cn(
              "px-2 py-0.5 rounded text-xs font-medium",
              budgetUtilization > 80
                ? "bg-red-500/20 text-red-400"
                : budgetUtilization > 50
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-indigo-500/20 text-indigo-400"
            )}
          >
            {stats.totalTokensAdded.toLocaleString()} / {(budgetLimit / 1000).toFixed(0)}K
          </span>
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-[var(--border-secondary)]">
          {/* Event List */}
          <div className="max-h-64 overflow-y-auto">
            {events.map((event, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-2 px-3 py-1.5 text-xs",
                  idx % 2 === 0 ? "bg-surface-secondary" : "bg-surface-secondary"
                )}
              >
                <span className="text-content-muted font-mono w-16 flex-shrink-0">
                  {formatTime(event.t)}
                </span>
                <span className="flex-shrink-0">{getEventIcon(event.kind)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-content truncate">
                    {getEventLabel(event)}
                  </div>
                  {getEventDetail(event) && (
                    <div className="text-content-secondary truncate">
                      {getEventDetail(event)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Summary Footer */}
          <div className="border-t border-[var(--border-secondary)] p-3 space-y-2">
            {/* Row 1: Basic stats */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                <span className="text-content-secondary">
                  Skills: <span className="text-content font-medium">{stats.skillsActivated.length}</span>
                </span>
                <span className="text-content-secondary">
                  Tools: <span className="text-content font-medium">{stats.toolsExpanded.length}</span>
                </span>
                {stats.confirmationsRequested > 0 && (
                  <span className="text-content-secondary">
                    Confirmations:{" "}
                    <span className="text-indigo-400 font-medium">
                      {stats.confirmationsGranted}/{stats.confirmationsRequested}
                    </span>
                  </span>
                )}
                {stats.blockedAttempts > 0 && (
                  <span className="text-red-400">
                    Blocked: {stats.blockedAttempts}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {stats.usedSkillFirst && (
                  <span className="flex items-center gap-1 text-indigo-400">
                    <Check className="w-3 h-3" />
                    Skill-first
                  </span>
                )}
                {!stats.usedSkillFirst && stats.toolsInvoked.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="w-3 h-3" />
                    No skill search
                  </span>
                )}
              </div>
            </div>

            {/* Row 2: Section 5.3 Enhanced Stats - Memory & Ordering */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                {/* Memory-first compliance */}
                {stats.memoryFirstCompliant ? (
                  <span className="flex items-center gap-1 text-indigo-400">
                    <CheckCircle2 className="w-3 h-3" />
                    Memory-first
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-400">
                    <XCircle className="w-3 h-3" />
                    Memory-first violated
                  </span>
                )}

                {/* Memory queries */}
                {stats.memoryQueries.length > 0 && (
                  <span className="text-content-secondary">
                    Memory:{" "}
                    <span className="text-purple-400 font-medium">
                      {stats.memoryQueries.filter(q => q.found).length}/{stats.memoryQueries.length} found
                    </span>
                    {stats.memoryQueries.some(q => q.isStale) && (
                      <span className="ml-1 text-amber-400">(stale)</span>
                    )}
                  </span>
                )}

                {/* Compaction */}
                {stats.compactionEvents > 0 && (
                  <span className="text-content-secondary">
                    Compaction:{" "}
                    <span className="text-indigo-400 font-medium">
                      -{stats.tokensSavedByCompaction.toLocaleString()} tokens
                    </span>
                  </span>
                )}
              </div>

              {/* Invariants */}
              <div className="flex items-center gap-2">
                {(stats.invariantStatus.A !== "skip" || stats.invariantStatus.C !== "skip" || stats.invariantStatus.D !== "skip") && (
                  <span className="flex items-center gap-1 text-content-secondary">
                    Invariants:
                    <span className={cn(
                      "px-1 rounded text-xs font-mono",
                      stats.invariantStatus.A === "pass" ? "bg-indigo-500/20 text-indigo-400" :
                      stats.invariantStatus.A === "fail" ? "bg-red-500/20 text-red-400" :
                      "bg-surface-secondary text-content-muted"
                    )}>A</span>
                    <span className={cn(
                      "px-1 rounded text-xs font-mono",
                      stats.invariantStatus.C === "pass" ? "bg-indigo-500/20 text-indigo-400" :
                      stats.invariantStatus.C === "fail" ? "bg-red-500/20 text-red-400" :
                      "bg-surface-secondary text-content-muted"
                    )}>C</span>
                    <span className={cn(
                      "px-1 rounded text-xs font-mono",
                      stats.invariantStatus.D === "pass" ? "bg-indigo-500/20 text-indigo-400" :
                      stats.invariantStatus.D === "fail" ? "bg-red-500/20 text-red-400" :
                      "bg-surface-secondary text-content-muted"
                    )}>D</span>
                  </span>
                )}
              </div>
            </div>

            {/* Row 3: Memory updates */}
            {stats.memoryUpdates.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <RefreshCw className="w-3 h-3 text-indigo-400" />
                <span className="text-content-secondary">Updates:</span>
                <div className="flex flex-wrap gap-1">
                  {stats.memoryUpdates.slice(0, 5).map((u, i) => (
                    <span
                      key={i}
                      className={cn(
                        "px-1.5 py-0.5 rounded text-xs",
                        u.action === "create" ? "bg-indigo-500/20 text-indigo-400" :
                        u.action === "update" ? "bg-violet-500/20 text-violet-400" :
                        "bg-surface-secondary text-content-muted"
                      )}
                    >
                      {u.entityId} (+{u.factsAdded})
                    </span>
                  ))}
                  {stats.memoryUpdates.length > 5 && (
                    <span className="text-content-muted">+{stats.memoryUpdates.length - 5} more</span>
                  )}
                </div>
              </div>
            )}

            {/* Row 4: Reasoning metrics */}
            {stats.reasoningInvocations > 0 && (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-cyan-400">
                    <Brain className="w-3 h-3" />
                    Reasoning
                  </span>
                  <span className="text-content-secondary">
                    Calls: <span className="text-cyan-400 font-medium">{stats.reasoningInvocations}</span>
                  </span>
                  <span className="text-content-secondary">
                    Steps: <span className="text-cyan-400 font-medium">{stats.reasoningThinkingSteps}</span>
                  </span>
                  <span className="text-content-secondary">
                    Tokens: <span className="text-cyan-400 font-medium">{stats.reasoningTokens.toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-content-secondary">
                    Cost: <span className="text-cyan-400 font-medium">${stats.reasoningCost.toFixed(6)}</span>
                  </span>
                  <span className="text-content-secondary">
                    Avg: <span className="text-cyan-400 font-medium">{Math.round(stats.avgReasoningDuration)}ms</span>
                  </span>
                </div>
              </div>
            )}

            {/* Tool ordering violations warning */}
            {stats.toolOrderingViolations.length > 0 && (
              <div className="flex items-start gap-2 text-xs p-2 bg-red-500/10 rounded border border-red-500/20">
                <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-red-400 font-medium">Tool Ordering Violations:</span>
                  <ul className="text-red-300 mt-0.5 list-disc list-inside">
                    {stats.toolOrderingViolations.slice(0, 3).map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Budget Bar */}
            <div className="mt-2">
              <div className="h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    budgetUtilization > 80
                      ? "bg-red-500"
                      : budgetUtilization > 50
                        ? "bg-amber-500"
                        : "bg-indigo-500"
                  )}
                  style={{ width: `${budgetUtilization}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PENDING CONFIRMATION CARD
// ═══════════════════════════════════════════════════════════════════════════

interface PendingConfirmationProps {
  draftId: string;
  toolName: string;
  riskTier: "write" | "destructive";
  actionSummary: string;
  expiresAt: number;
  onConfirm: () => void;
  onDeny: () => void;
}

export function PendingConfirmation({
  draftId,
  toolName,
  riskTier,
  actionSummary,
  expiresAt,
  onConfirm,
  onDeny,
}: PendingConfirmationProps) {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, expiresAt - Date.now()));

  React.useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, expiresAt - Date.now());
      setTimeLeft(remaining);
      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  const isExpired = timeLeft === 0;

  return (
    <div
      className={cn(
        "border rounded-lg p-4",
        riskTier === "destructive"
          ? "border-red-500/50 bg-red-500/10"
          : "border-amber-500/50 bg-amber-500/10"
      )}
    >
      <div className="flex items-start gap-3">
        <Shield
          className={cn(
            "w-5 h-5 mt-0.5",
            riskTier === "destructive" ? "text-red-400" : "text-amber-400"
          )}
        />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-content">
              Confirmation Required
            </h4>
            {!isExpired && (
              <span className="text-xs text-content-secondary">
                Expires in {minutes}:{seconds.toString().padStart(2, "0")}
              </span>
            )}
          </div>

          <p className="text-sm text-content-secondary mt-1">
            {actionSummary}
          </p>

          <div className="flex items-center gap-2 mt-1">
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded font-medium",
                riskTier === "destructive"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-amber-500/20 text-amber-400"
              )}
            >
              {riskTier}
            </span>
            <span className="text-xs text-content-muted">{toolName}</span>
          </div>

          {isExpired ? (
            <p className="text-sm text-red-400 mt-3">This action has expired.</p>
          ) : (
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={onConfirm}
                className="px-3 py-1.5 text-sm font-medium bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white rounded transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={onDeny}
                className="px-3 py-1.5 text-sm font-medium bg-surface-secondary hover:bg-surface-secondary text-content rounded border border-[var(--border-secondary)] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DisclosureTrace;

/**
 * SearchTrace — Interactive execution trace visualization.
 *
 * Shows the step-by-step trajectory of a search query:
 * classify → context_bundle → tool_call(s) → judge → assemble
 *
 * Dev side: full trace with timing, tool names, status
 * User side: simplified "How we got this answer" citation trail
 */

import { memo, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Search,
  Shield,
  XCircle,
  Zap,
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────────────────────────── */

export interface TraceStep {
  step: string;
  tool?: string;
  durationMs: number;
  status: "ok" | "error" | "skip" | "adapting";
  detail?: string;
  traceId?: string;
  isRunning?: boolean;
}

interface SearchTraceProps {
  trace: TraceStep[];
  latencyMs: number;
  classification: string;
  judgeVerdict?: { verdict: string; score: number; failingCriteria?: string[] };
  sourceRefs?: Array<{ type?: string; href?: string; status?: string }>;
  /** "dev" shows full trace details, "user" shows simplified citation trail */
  mode?: "dev" | "user";
}

/* ─── Step icon map ────────────────────────────────────────────────────────── */

function StepIcon({ step, status }: { step: string; status: string }) {
  const color =
    status === "error" ? "text-rose-400"
    : status === "skip" ? "text-zinc-500"
    : "text-emerald-400";

  if (step === "classify_query") return <Search className={`h-3.5 w-3.5 ${color}`} />;
  if (step === "build_context_bundle") return <Cpu className={`h-3.5 w-3.5 ${color}`} />;
  if (step === "step_start") return <Zap className={`h-3.5 w-3.5 ${color}`} />;
  if (step === "step_done") return <CheckCircle2 className={`h-3.5 w-3.5 ${color}`} />;
  if (step === "tool_call") return <Zap className={`h-3.5 w-3.5 ${color}`} />;
  if (step === "judge") return <Shield className={`h-3.5 w-3.5 ${color}`} />;
  if (step === "assemble_response") return <CheckCircle2 className={`h-3.5 w-3.5 ${color}`} />;
  return <Activity className={`h-3.5 w-3.5 ${color}`} />;
}

/* ─── Step label ───────────────────────────────────────────────────────────── */

function stepLabel(step: TraceStep, mode: "dev" | "user"): string {
  if (mode === "user") {
    if (step.step === "classify_query") return "Understood your question";
    if (step.step === "build_context_bundle") return "Loaded your context";
    if (step.step === "tool_call") {
      const toolMap: Record<string, string> = {
        web_search: "Searched the web",
        linkup_search: "Deep web intelligence",
        run_recon: "Deep reconnaissance",
        enrich_entity: "Enriched entity profile",
        founder_local_gather: "Gathered local context",
        founder_local_weekly_reset: "Weekly intelligence reset",
        founder_local_synthesize: "Synthesized intelligence",
        simulate_decision_paths: "Financial scenario modeling",
        build_claim_graph: "Mapped claims",
        extract_variables: "Extracted key variables",
        rank_interventions: "Ranked next actions",
      };
      return toolMap[step.tool ?? ""] ?? `Analyzed ${step.tool?.replace(/_/g, " ") ?? "data"}`;
    }
    if (step.step === "step_start") return `Started ${step.tool?.replace(/_/g, " ") ?? "tool"}`;
    if (step.step === "step_done") return `Finished ${step.tool?.replace(/_/g, " ") ?? "tool"}`;
    if (step.step === "judge") return "Quality checked";
    if (step.step === "assemble_response") return "Built your result";
    if (step.step === "agent_plan") return "Planned research strategy";
    if (step.step === "agent_execute") return "Executed research";
    if (step.step === "agent_synthesize") return "Synthesized findings";
    if (step.step === "parallel_dispatch") return "Parallel research";
    return step.step.replace(/_/g, " ");
  }
  // Dev mode
  if (step.tool) return `${step.step} → ${step.tool}`;
  return step.step;
}

/* ─── Duration bar ─────────────────────────────────────────────────────────── */

function DurationBar({ durationMs, maxMs }: { durationMs: number; maxMs: number }) {
  const pct = maxMs > 0 ? Math.min(100, (durationMs / maxMs) * 100) : 0;
  return (
    <div className="h-1.5 w-16 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full bg-[#d97757]/60 transition-all duration-300"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );
}

function traceGroupId(step: TraceStep): string {
  if (step.step === "classify_query") return "query";
  if (step.step === "build_context_bundle") return "context";
  if (step.step === "tool_call" || step.step === "llm_extract") return "exploration";
  if (step.step === "judge") return "verification";
  if (step.step === "assemble_response") return "answer";
  return "other";
}

function traceGroupLabel(groupId: string): string {
  if (groupId === "query") return "You asked";
  if (groupId === "context") return "We loaded context";
  if (groupId === "exploration") return "We explored evidence";
  if (groupId === "verification") return "We checked the work";
  if (groupId === "answer") return "We assembled the answer";
  return "Other steps";
}

/* ─── Main Component ───────────────────────────────────────────────────────── */

export const SearchTrace = memo(function SearchTrace({
  trace,
  latencyMs,
  classification,
  judgeVerdict,
  sourceRefs,
  mode = "user",
}: SearchTraceProps) {
  const [expanded, setExpanded] = useState(mode === "dev");
  const maxDuration = Math.max(...trace.map(t => t.durationMs), 1);
  const totalSteps = trace.length;
  const okSteps = trace.filter(t => t.status === "ok").length;
  const errorSteps = trace.filter(t => t.status === "error").length;
  const groupedTrace = useMemo(() => {
    const groups = new Map<string, TraceStep[]>();
    trace.forEach((step) => {
      const groupId = traceGroupId(step);
      const existing = groups.get(groupId) ?? [];
      existing.push(step);
      groups.set(groupId, existing);
    });
    return Array.from(groups.entries()).map(([groupId, steps]) => ({
      groupId,
      label: traceGroupLabel(groupId),
      steps,
      durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    }));
  }, [trace]);
  const provenanceState = useMemo(() => {
    const citedSources = (sourceRefs ?? []).filter((source) => source.status !== "discarded");
    const citedWebSources = citedSources.filter((source) => source.type === "web" && source.href);
    const citedLocalSources = citedSources.filter((source) => source.type !== "web" || !source.href);
    if (citedWebSources.length > 0) {
      return {
        label: citedLocalSources.length > 0 ? "Mixed evidence" : "Live web evidence",
        detail: citedLocalSources.length > 0 ? `${citedWebSources.length} web` : `${citedWebSources.length} cited`,
        tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
      };
    }
    if (citedSources.length > 0) {
      return {
        label: "Local evidence",
        detail: `${citedSources.length} retained`,
        tone: "border-white/[0.08] bg-white/[0.03] text-content-muted",
      };
    }
    return null;
  }, [sourceRefs]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* ── Summary bar ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
        >
        <Activity className="h-4 w-4 text-[#d97757]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted flex-1">
          {mode === "dev" ? "Execution Trace" : "How we got this answer"}
        </span>
        {mode === "user" && provenanceState ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${provenanceState.tone}`}
            title={`${provenanceState.label} · ${provenanceState.detail}`}
          >
            <span>{provenanceState.label}</span>
            <span className="opacity-80">· {provenanceState.detail}</span>
          </span>
        ) : null}
        <div className="flex items-center gap-2.5 text-[10px] text-content-muted">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {latencyMs > 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : latencyMs > 0 ? `${latencyMs}ms` : "< 1s"}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {totalSteps} steps
          </span>
          {okSteps === totalSteps ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              all ok
            </span>
          ) : errorSteps > 0 ? (
            <span className="flex items-center gap-1 text-rose-400">
              <XCircle className="h-3 w-3" />
              {errorSteps} errors
            </span>
          ) : null}
          {/* Judge verdict hidden from users — internal eval score, not user-facing */}
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-content-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* ── Expanded trace ───────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="space-y-3">
            {groupedTrace.map((group) => (
              <div
                key={group.groupId}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-content-muted">
                      {group.label}
                    </div>
                    <div className="mt-1 text-xs text-content-muted">
                      {group.steps.length} step{group.steps.length === 1 ? "" : "s"} · {group.durationMs}ms
                    </div>
                  </div>
                  {mode === "user" ? (
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] text-content-muted">
                      {group.groupId}
                    </span>
                  ) : null}
                </div>

                <div className="relative space-y-0">
                  {group.steps.map((step, i) => (
                    <div key={step.traceId ?? `${group.groupId}-${i}`} className="relative flex items-start gap-3 py-1.5">
                      {i < group.steps.length - 1 && (
                        <div className="absolute left-[7px] top-[18px] w-px h-[calc(100%-4px)] bg-white/[0.08]" />
                      )}
                      <div className="relative z-10 mt-0.5">
                        <StepIcon step={step.step} status={step.status} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-content truncate">
                            {stepLabel(step, mode)}
                          </span>
                          <DurationBar durationMs={step.durationMs} maxMs={maxDuration} />
                          <span className="text-[10px] tabular-nums text-content-muted shrink-0">
                            {step.durationMs}ms
                          </span>
                        </div>
                        {step.detail && (
                          <p className={`mt-0.5 text-[10px] ${mode === "dev" ? "font-mono text-content-muted/70 truncate" : "text-content-muted"}`}>
                            {step.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Judge verdict (dev mode) */}
          {mode === "dev" && judgeVerdict && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 text-[10px]">
                <Shield className="h-3.5 w-3.5 text-[#d97757]" />
                <span className="font-semibold uppercase tracking-[0.15em] text-content-muted">Judge</span>
                <span className={`rounded-full px-2 py-0.5 font-bold ${
                  judgeVerdict.verdict === "pass"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-rose-500/15 text-rose-400"
                }`}>
                  {judgeVerdict.verdict} ({judgeVerdict.score}%)
                </span>
                {judgeVerdict.failingCriteria && judgeVerdict.failingCriteria.length > 0 && (
                  <span className="text-rose-400/70">
                    Failing: {judgeVerdict.failingCriteria.join(", ")}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Classification badge — only in dev mode, hide empty/unknown */}
          {mode === "dev" && classification && classification !== "unknown" && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-content-muted">
              <span className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono">
                {classification.replace(/_/g, " ")}
              </span>
              <span>query type</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

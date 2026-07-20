/**
 * LiveSearchTelemetry — Mission-control feed showing each tool call
 * as it happens during autonomous search. Each tool gets a real-time
 * card with: tool name, model, provider, tokens, latency, output preview.
 *
 * Cards stack vertically and fade in as events arrive via SSE.
 */

import { memo, useEffect, useRef } from "react";
import {
  Search,
  Brain,
  Tag,
  ShieldCheck,
  AlertTriangle,
  GitCompare,
  DollarSign,
  FileText,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Zap,
} from "lucide-react";
import type { ToolStage } from "@/hooks/useStreamingSearch";

// ── Tool icons + colors ──────────────────────────────────────────────

const TOOL_CONFIG: Record<string, { icon: typeof Search; color: string; label: string }> = {
  classify: { icon: Tag, color: "text-blue-400", label: "Classify Query" },
  replay_check: { icon: Zap, color: "text-amber-400", label: "Replay Check" },
  web_search: { icon: Search, color: "text-cyan-400", label: "Web Search" },
  entity_extract: { icon: Brain, color: "text-purple-400", label: "Entity Analysis" },
  signal_classify: { icon: Tag, color: "text-emerald-400", label: "Signal Taxonomy" },
  evidence_verify: { icon: ShieldCheck, color: "text-green-400", label: "Evidence Verify" },
  risk_extract: { icon: AlertTriangle, color: "text-rose-400", label: "Risk Detection" },
  comparable_find: { icon: GitCompare, color: "text-orange-400", label: "Find Comparables" },
  dcf_model: { icon: DollarSign, color: "text-yellow-400", label: "DCF Valuation" },
  sec_edgar: { icon: FileText, color: "text-indigo-400", label: "SEC Filings" },
  next_action_plan: { icon: ArrowRight, color: "text-[#d97757]", label: "Next Actions" },
};

const DEFAULT_CONFIG = { icon: Zap, color: "text-content-muted", label: "Tool" };

// ── Tool card ────────────────────────────────────────────────────────

function ToolCard({ stage }: { stage: ToolStage }) {
  const config = TOOL_CONFIG[stage.tool] ?? DEFAULT_CONFIG;
  const Icon = config.icon;
  const isRunning = stage.status === "running";
  const elapsed = isRunning ? Date.now() - stage.startedAt : (stage.durationMs ?? 0);

  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
      role="listitem"
    >
      <div className="flex items-start gap-3">
        {/* Status icon */}
        <div className="mt-0.5">
          {isRunning ? (
            <Loader2 className={`h-4 w-4 animate-spin ${config.color}`} />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className={`h-3.5 w-3.5 ${config.color}`} />
            <span className="text-[12px] font-medium text-content">{config.label}</span>
            {stage.provider && (
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-content-muted">
                {stage.provider}
              </span>
            )}
            {stage.model && (
              <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-content-muted/60">
                {stage.model}
              </span>
            )}
          </div>

          {/* Metrics row */}
          <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-content-muted">
            <span className={isRunning ? "text-amber-400 tabular-nums" : "tabular-nums"}>
              {isRunning ? `${Math.round(elapsed / 100) / 10}s...` : `${(elapsed / 1000).toFixed(1)}s`}
            </span>
            {stage.tokensIn !== undefined && (
              <span>{stage.tokensIn.toLocaleString()} in</span>
            )}
            {stage.tokensOut !== undefined && (
              <span>{stage.tokensOut.toLocaleString()} out</span>
            )}
            {stage.reason && (
              <span className="text-content-muted/40">{stage.reason}</span>
            )}
          </div>

          {/* Preview data */}
          {stage.preview && typeof stage.preview === "object" && Object.keys(stage.preview).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(stage.preview as Record<string, unknown>).map(([key, value]) => {
                if (value === undefined || value === null || value === false) return null;
                const display = Array.isArray(value)
                  ? value.length > 0
                    ? `${value.length} items`
                    : null
                  : typeof value === "object"
                    ? JSON.stringify(value).slice(0, 60)
                    : String(value).slice(0, 80);
                if (!display) return null;
                return (
                  <span key={key} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-content-muted">
                    <span className="text-content-muted/40">{key.replace(/([A-Z])/g, " $1").trim()}: </span>
                    {display}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Step counter */}
        <div className="shrink-0 text-right">
          <span className="text-[10px] tabular-nums text-content-muted/40">
            {stage.step}/{stage.totalPlanned || "?"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

interface LiveSearchTelemetryProps {
  stages: ToolStage[];
  query: string;
  lens: string;
  isStreaming: boolean;
  error?: string | null;
}

export const LiveSearchTelemetry = memo(function LiveSearchTelemetry({
  stages,
  query,
  lens,
  isStreaming,
  error,
}: LiveSearchTelemetryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest card
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [stages.length]);

  const doneCount = stages.filter((s) => s.status === "done").length;
  const total = stages[0]?.totalPlanned || stages.length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
              Live Research
            </div>
            <div className="mt-0.5 text-[12px] text-content">
              {query.slice(0, 60)}{query.length > 60 ? "..." : ""}
              <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase text-content-muted">{lens}</span>
            </div>
          </div>
          {isStreaming && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-[10px] text-emerald-400">{doneCount}/{total} tools</span>
            </div>
          )}
          {!isStreaming && !error && (
            <span className="text-[10px] text-emerald-400">{doneCount} tools completed</span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-[#d97757] transition-all duration-500"
            style={{ width: `${total > 0 ? (doneCount / total) * 100 : 0}%` }}
          />
        </div>

        {/* ── Partial entity header — appears <1s when classify completes ── */}
        {(() => {
          const classifyDone = stages.find((s) => s.tool === "classify" && s.status === "done");
          const searchDone = stages.find((s) => (s.tool === "web_search" || s.tool === "search") && s.status === "done");
          const analyzeDone = stages.find((s) => (s.tool === "entity_extract" || s.tool === "analyze") && s.status === "done");
          const classifyPreview = (typeof classifyDone?.preview === "object" ? classifyDone.preview : undefined) as Record<string, any> | undefined;
          const searchPreview = (typeof searchDone?.preview === "object" ? searchDone.preview : undefined) as Record<string, any> | undefined;
          const analyzePreview = (typeof analyzeDone?.preview === "object" ? analyzeDone.preview : undefined) as Record<string, any> | undefined;
          const entity = classifyPreview?.entity as string | undefined;
          const classification = classifyPreview?.classification as string | undefined;
          const sourceCount = searchPreview?.sourceCount as number | undefined;
          const confidence = analyzePreview?.confidence as number | undefined;
          const signalCount = analyzePreview?.signalCount as number | undefined;
          const riskCount = analyzePreview?.riskCount as number | undefined;
          const keyMetrics = analyzePreview?.keyMetrics as Array<{ label: string; value: string }> | undefined;

          if (!entity) return null;

          return (
            <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 animate-in fade-in duration-300">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-content">{entity}</h3>
                {classification && (
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-content-muted">{classification.replace(/_/g, " ")}</span>
                )}
                {confidence !== undefined && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${confidence >= 75 ? "bg-emerald-500/15 text-emerald-300" : confidence >= 50 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300"}`}>
                    {confidence}%
                  </span>
                )}
                {sourceCount !== undefined && (
                  <span className="text-[10px] text-content-muted">{sourceCount} sources</span>
                )}
              </div>
              {/* Key metrics appear when analyze completes */}
              {keyMetrics && keyMetrics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                  {keyMetrics.map((m) => (
                    <span key={m.label} className="text-content-muted">
                      <span className="text-content-muted/50">{m.label}: </span>
                      <span className="font-medium text-content">{m.value}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* Signals + risks appear when analyze completes */}
              {(signalCount !== undefined || riskCount !== undefined) && (
                <div className="mt-1.5 flex gap-3 text-[10px]">
                  {signalCount !== undefined && <span className="text-emerald-400">{signalCount} signals</span>}
                  {riskCount !== undefined && riskCount > 0 && <span className="text-rose-400">{riskCount} risks</span>}
                </div>
              )}
            </div>
          );
        })()}

        {/* Tool cards */}
        <div role="list" className="mt-3 space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {stages.map((stage) => (
            <ToolCard key={`${stage.tool}-${stage.step}`} stage={stage} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-3 text-[12px] text-rose-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
});

export default LiveSearchTelemetry;

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMotionConfig } from '@/lib/motion';
import {
  Activity,
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Film,
  Flag,
  MessageSquareWarning,
  Play,
  Search,
  Sparkles,
  TimerReset,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSearchParams } from "react-router-dom";
import { DialogOverlay } from "@/shared/components/DialogOverlay";
import { LazySyntaxHighlighter } from "@/features/agents/components/FastAgentPanel/LazySyntaxHighlighter";
import { cn } from "@/lib/utils";
import {
  generateTelemetryInspectorMockRuns,
  type InspectorRun,
  type InspectorRunStatus,
  type InspectorStepStatus,
  type InspectorStepType,
  type InspectorTraceStep,
} from "../data/telemetryInspectorMockData";
import { type InspectorTab, useTelemetryInspectorStore } from "../store/useTelemetryInspectorStore";
import {
  buildTelemetryInspectorRunsFromEvalArtifact,
  hydrateTelemetryInspectorRunsWithReplay,
  type EnterpriseEvalArtifact,
} from "../lib/telemetryInspectorArtifacts";

const STATUS_META: Record<
  InspectorRunStatus | InspectorStepStatus,
  { label: string; badgeClassName: string; iconClassName: string }
> = {
  success: {
    label: "Success",
    badgeClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    iconClassName: "text-emerald-400",
  },
  warning: {
    label: "Warning",
    badgeClassName: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    iconClassName: "text-amber-400",
  },
  error: {
    label: "Error",
    badgeClassName: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300",
    iconClassName: "text-rose-600 dark:text-rose-300",
  },
  running: {
    label: "Running",
    badgeClassName: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    iconClassName: "text-sky-300",
  },
  pending: {
    label: "Pending",
    badgeClassName: "border-sky-500/20 bg-sky-500/10 text-sky-300",
    iconClassName: "text-sky-300",
  },
};

const STEP_TYPE_META: Record<InspectorStepType, { label: string; icon: typeof Bot }> = {
  llm_inference: { label: "LLM inference", icon: Bot },
  tool_call: { label: "Tool call", icon: Wrench },
  anomaly_detection: { label: "Anomaly detection", icon: Activity },
  human_gate: { label: "Human/QA gate", icon: MessageSquareWarning },
  proof_pack: { label: "Proof pack", icon: Flag },
  replay: { label: "Replay", icon: TimerReset },
};

const TAB_ORDER: Array<{ id: InspectorTab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "trace", label: "Trace Details", icon: Activity },
  { id: "metrics", label: "Metrics", icon: Wand2 },
  { id: "evidence", label: "Visual Evidence", icon: Camera },
];

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function relativeStartedAt(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "just now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusIcon(status: InspectorRunStatus | InspectorStepStatus) {
  if (status === "success") return <CheckCircle2 className={cn("h-4 w-4", STATUS_META[status].iconClassName)} />;
  if (status === "error") return <AlertTriangle className={cn("h-4 w-4", STATUS_META[status].iconClassName)} />;
  return <Activity className={cn("h-4 w-4", STATUS_META[status].iconClassName)} />;
}

function findFrameById(run: InspectorRun, frameId: string | null | undefined) {
  if (!frameId) return null;
  return run.evidenceFrames.find((frame) => frame.id === frameId) ?? null;
}

function stepBorderClass(selected: boolean, status: InspectorStepStatus) {
  if (selected) return "border-primary/60 ring-1 ring-primary/30";
  if (status === "error") return "border-rose-500/20";
  if (status === "warning") return "border-amber-500/20";
  if (status === "pending") return "border-sky-500/20";
  return "border-edge";
}

function MetricPill({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-edge bg-[#111111] px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-content-muted">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-content-muted">{hint}</div>
    </div>
  );
}

function JsonBlock({ label, payload }: { label: string; payload: Record<string, unknown> }) {
  const jsonStr = JSON.stringify(payload, null, 2);

  function copyToClipboard() {
    void navigator.clipboard.writeText(jsonStr);
  }

  return (
    <div className="rounded-xl border border-edge bg-[#0B0F19]">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">{label}</div>
        <button type="button" onClick={copyToClipboard} className="text-content-muted hover:text-white" aria-label={`Copy ${label} JSON`}>
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-72 overflow-auto px-3 py-3">
        <JsonTreeNode label={label.toLowerCase()} value={payload} depth={0} />
      </div>
    </div>
  );
}

function formatJsonPrimitive(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function JsonTreeNode({
  label,
  value,
  depth,
}: {
  label: string;
  value: unknown;
  depth: number;
}) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;
  const isExpandable = isArray || isObject;
  const childEntries = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item] as const)
    : isObject
      ? Object.entries(value as Record<string, unknown>)
      : [];
  const [expanded, setExpanded] = useState(depth < 1);

  if (!isExpandable) {
    return (
      <div className="flex items-start gap-2 py-1 font-mono text-[12px] leading-6" style={{ paddingLeft: `${depth * 14}px` }}>
        <span className="shrink-0 text-sky-300">{label}:</span>
        <span className="break-all text-content-secondary">{formatJsonPrimitive(value)}</span>
      </div>
    );
  }

  const descriptor = isArray ? `[${childEntries.length}]` : `{${childEntries.length}}`;

  return (
    <div className="py-1" style={{ paddingLeft: `${depth * 14}px` }}>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex items-center gap-2 text-left font-mono text-[12px] leading-6"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-content-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-content-muted" />
        )}
        <span className="text-sky-300">{label}</span>
        <span className="text-content-muted">{descriptor}</span>
      </button>
      {expanded ? (
        <div className="mt-1">
          {childEntries.map(([childKey, childValue]) => (
            <JsonTreeNode key={`${label}-${childKey}`} label={childKey} value={childValue} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FeedbackModal({ run, step }: { run: InspectorRun | null; step: InspectorTraceStep | null }) {
  const feedbackOpen = useTelemetryInspectorStore((state) => state.feedbackOpen);
  const feedbackDraft = useTelemetryInspectorStore((state) => state.feedbackDraft);
  const setFeedbackDraft = useTelemetryInspectorStore((state) => state.setFeedbackDraft);
  const closeFeedback = useTelemetryInspectorStore((state) => state.closeFeedback);
  const resetFeedback = useTelemetryInspectorStore((state) => state.resetFeedback);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!feedbackDraft.trim()) return;

    const payload = {
      route: typeof window !== "undefined" ? window.location.pathname + window.location.hash : "/benchmarks",
      runId: run?.id ?? null,
      stepId: step?.id ?? null,
      viewport:
        typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }
          : null,
      timestamp: new Date().toISOString(),
      // SECURITY: Do not send full userAgent to external webhooks — it leaks
      // OS version, browser version, and system details to third parties.
      userAgent: "nodebench-client",
      feedback: feedbackDraft.trim(),
    };

    setSubmitting(true);
    try {
      const webhookUrl = import.meta.env.VITE_UI_FEEDBACK_WEBHOOK_URL;
      // SECURITY: Validate webhook URL before fetching — only allow HTTPS to
      // prevent SSRF against internal networks, localhost, or non-TLS endpoints.
      const isValidWebhookUrl = (() => {
        if (!webhookUrl || typeof webhookUrl !== "string") return false;
        try {
          const u = new URL(webhookUrl);
          return u.protocol === "https:";
        } catch { return false; }
      })();
      if (isValidWebhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        console.info("[TelemetryInspector] UI feedback", payload);
      }

      window.dispatchEvent(new CustomEvent("nodebench:telemetry-inspector-feedback", { detail: payload }));
      resetFeedback();
    } catch (error) {
      console.error("[TelemetryInspector] Failed to submit UI feedback", error);
      closeFeedback();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogOverlay
      isOpen={feedbackOpen}
      onClose={closeFeedback}
      ariaLabel="Report UI issue"
      contentClassName="w-full max-w-lg rounded-2xl border border-edge bg-[#0A0A0A] shadow-2xl"
    >
      <div className="border-b border-edge px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">Report UI issue</div>
            <div className="mt-1 text-xs text-content-muted">
              Capture the current run, viewport, and your note for the quality review loop.
            </div>
          </div>
          <button
            type="button"
            onClick={closeFeedback}
            className="rounded-lg border border-edge p-2 text-content-muted hover:text-white"
            aria-label="Close issue reporter"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-edge bg-[#111111] px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-content-muted">Run</div>
            <div className="mt-2 font-mono text-sm text-white">{run?.id ?? "none selected"}</div>
          </div>
          <div className="rounded-xl border border-edge bg-[#111111] px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-content-muted">Step</div>
            <div className="mt-2 font-mono text-sm text-white">{step?.id ?? "none selected"}</div>
          </div>
        </div>
        <div className="rounded-xl border border-edge bg-[#111111] px-3 py-3 text-xs text-content-muted">
          {typeof window !== "undefined"
            ? `Viewport ${window.innerWidth} × ${window.innerHeight} · DPR ${window.devicePixelRatio}`
            : "Viewport unavailable"}
        </div>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            What broke or felt off?
          </span>
          <textarea
            value={feedbackDraft}
            onChange={(event) => setFeedbackDraft(event.target.value)}
            placeholder="Example: the JSON block clips on smaller laptop widths, and the warning state blends into the background."
            className="mt-2 min-h-[140px] w-full rounded-xl border border-edge bg-[#111111] px-3 py-3 text-sm text-white outline-none transition focus:border-primary/40"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-edge px-5 py-4">
        <button
          type="button"
          onClick={closeFeedback}
          className="rounded-lg border border-edge px-3 py-2 text-sm text-content-muted hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!feedbackDraft.trim() || submitting}
          onClick={submit}
          className="rounded-lg border border-primary/30 bg-primary/15 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Submit issue"}
        </button>
      </div>
    </DialogOverlay>
  );
}

function RunExplorer({ runs, loading }: { runs: InspectorRun[]; loading: boolean }) {
  const selectedRunId = useTelemetryInspectorStore((state) => state.selectedRunId);
  const searchQuery = useTelemetryInspectorStore((state) => state.searchQuery);
  const statusFilter = useTelemetryInspectorStore((state) => state.statusFilter);
  const setSearchQuery = useTelemetryInspectorStore((state) => state.setSearchQuery);
  const setStatusFilter = useTelemetryInspectorStore((state) => state.setStatusFilter);
  const selectRun = useTelemetryInspectorStore((state) => state.selectRun);
  const [draftQuery, setDraftQuery] = useState(searchQuery);

  useEffect(() => {
    setDraftQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(draftQuery);
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [draftQuery, setSearchQuery]);

  return (
    <div className="flex h-full flex-col bg-[#0B0B0B]">
      <div className="border-b border-edge px-4 py-4">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
          <Search className="h-3.5 w-3.5" />
          Run Explorer
        </div>
        <div className="mt-3 rounded-xl border border-edge bg-[#111111] px-3 py-2">
          <div className="flex items-center gap-2 text-content-muted">
            <Search className="h-4 w-4" />
            <input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder="Search runs, datasets, or goals"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-content-muted"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["all", "success", "warning", "error", "running"] as const).map((status) => {
            const active = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                  active
                    ? "border-primary/40 bg-primary/15 text-white"
                    : "border-edge bg-[#111111] text-content-muted hover:text-white",
                )}
              >
                {status}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading
          ? Array.from({ length: 4 }, (_, index) => (
              <div
                key={`run-skeleton-${index}`}
                className="mb-2 rounded-2xl border border-edge bg-[#0F0F0F] px-3 py-3"
              >
                <div className="h-3 w-28 rounded bg-white/10" />
                <div className="mt-3 h-4 w-3/4 rounded bg-white/10" />
                <div className="mt-2 h-3 w-full rounded bg-white/5" />
                <div className="mt-4 h-3 w-1/2 rounded bg-white/5" />
              </div>
            ))
          : null}
        {runs.map((run) => {
          const selected = run.id === selectedRunId;
          const status = STATUS_META[run.status];
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => selectRun(run.id, run.steps[0]?.id ?? null)}
              className={cn(
                "mb-2 w-full rounded-2xl border px-3 py-3 text-left transition",
                selected
                  ? "border-primary/40 bg-[#111111]"
                  : "border-edge bg-[#0F0F0F] hover:border-edge hover:bg-[#111111]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] text-content-muted">{run.id}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{run.title}</div>
                </div>
                <div className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]", status.badgeClassName)}>
                  {statusIcon(run.status)}
                  {status.label}
                </div>
              </div>
              <div className="mt-2 text-xs leading-5 text-content-muted line-clamp-2">{run.goal}</div>
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-content-muted">
                <span>{formatDuration(run.totalLatencyMs)}</span>
                <span>{formatTokens(run.totalTokens)} tokens</span>
                <span>{relativeStartedAt(run.startedAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverviewTab({ run, step }: { run: InspectorRun; step: InspectorTraceStep | null }) {
  const evidenceCount = run.evidenceFrames.length;
  const toolCount = run.steps.filter((candidate) => candidate.type === "tool_call").length;
  const anomalyCount = run.steps.filter((candidate) => candidate.type === "anomaly_detection").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
      <div className="rounded-2xl border border-edge bg-[#111111] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Operator summary</div>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-content-secondary">{run.summary}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MetricPill label="Confidence" value={`${Math.round(run.confidence * 100)}%`} hint="Model + evidence confidence" />
          <MetricPill label="Tool steps" value={String(toolCount)} hint="Tool calls in the visible chain" />
          <MetricPill label="Evidence" value={String(evidenceCount)} hint="Screenshots aligned to steps" />
        </div>
      </div>
      <div className="rounded-2xl border border-edge bg-[#111111] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Current focal step</div>
        {step ? (
          <>
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-white">
              {statusIcon(step.status)}
              {step.title}
            </div>
            <div className="mt-2 text-xs leading-6 text-content-muted">{step.subtitle}</div>
            <div className="mt-3 space-y-2 text-xs text-content-secondary">
              <div>Duration: {formatDuration(step.durationMs)}</div>
              <div>Tokens: {formatTokens(step.tokenUsage.total)}</div>
              <div>Cost: {formatCost(step.costUsd)}</div>
              <div>{STEP_TYPE_META[step.type].label}</div>
            </div>
          </>
        ) : (
          <div className="mt-3 text-sm text-content-muted">Pick a step to inspect the current focus.</div>
        )}
        <div className="mt-4 rounded-xl border border-edge bg-[#0B0F19] px-3 py-3 text-xs text-content-muted">
          {anomalyCount > 0
            ? `${anomalyCount} anomaly-detection step${anomalyCount === 1 ? "" : "s"} is present in this run.`
            : "No anomaly-detection steps are present in this run."}
        </div>
      </div>
    </div>
  );
}

function TraceDetailsTab({
  run,
  selectedStepId,
}: {
  run: InspectorRun;
  selectedStepId: string | null;
}) {
  const { instant, transition } = useMotionConfig();
  const selectStep = useTelemetryInspectorStore((state) => state.selectStep);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedSteps((current) => {
      if (!selectedStepId) return current;
      if (current[selectedStepId]) return current;
      return { ...current, [selectedStepId]: true };
    });
  }, [selectedStepId]);

  function toggle(stepId: string) {
    setExpandedSteps((current) => ({ ...current, [stepId]: !current[stepId] }));
  }

  return (
    <div className="space-y-4">
      {run.steps.map((step, index) => {
        const expanded = expandedSteps[step.id] ?? step.id === selectedStepId;
        const selected = step.id === selectedStepId;
        const typeMeta = STEP_TYPE_META[step.type];
        const TypeIcon = typeMeta.icon;
        const status = STATUS_META[step.status];
        const frame = findFrameById(run, step.evidenceFrameIds[0]);

        return (
          <div key={step.id} className="relative">
            {index < run.steps.length - 1 ? (
              <div className="absolute left-[22px] top-14 bottom-[-18px] w-px bg-white/10" />
            ) : null}
            <div className="flex gap-4">
              <div className={cn("mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-[#111111]", stepBorderClass(selected, step.status))}>
                <TypeIcon className="h-4 w-4 text-white" />
              </div>
              <div className={cn("min-w-0 flex-1 rounded-2xl border bg-[#111111] transition", stepBorderClass(selected, step.status))}>
                <button
                  type="button"
                  onClick={() => {
                    selectStep(step.id);
                    toggle(step.id);
                  }}
                  className="w-full px-4 py-4 text-left"
                  aria-expanded={expanded}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]", status.badgeClassName)}>
                          {statusIcon(step.status)}
                          {status.label}
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.2em] text-content-muted">{typeMeta.label}</div>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white">{step.title}</div>
                      <div className="mt-1 text-xs leading-6 text-content-muted">{step.subtitle}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-content-muted">
                      <span>{formatDuration(step.durationMs)}</span>
                      <span>{formatTokens(step.tokenUsage.total)} tkn</span>
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {expanded ? (
                    <motion.div
                      key="details"
                      initial={{ height: instant ? "auto" : 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={transition({ duration: 0.2, ease: "easeOut" })}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-edge px-4 py-4">
                        <div className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
                              Rationale
                            </div>
                            <p className="mt-2 text-sm leading-7 text-content-secondary">{step.rationale}</p>
                            {step.warnings?.length ? (
                              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
                                {step.warnings.map((warning) => (
                                  <div key={warning}>{warning}</div>
                                ))}
                              </div>
                            ) : null}
                            {frame ? (
                              <button
                                type="button"
                                onClick={() => selectStep(step.id)}
                                className="mt-4 overflow-hidden rounded-2xl border border-edge bg-[#0A0A0A] text-left"
                              >
                                <img src={frame.imageUrl} alt={frame.caption} className="aspect-video w-full object-cover" />
                                <div className="border-t border-edge px-3 py-2">
                                  <div className="text-xs font-medium text-white">{frame.label}</div>
                                  <div className="mt-1 text-[11px] text-content-muted">{frame.caption}</div>
                                </div>
                              </button>
                            ) : null}
                          </div>
                          <div className="space-y-3">
                            <JsonBlock label="Input" payload={step.request} />
                            <JsonBlock label="Output" payload={step.response} />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricsTab({ run }: { run: InspectorRun }) {
  const chartData = run.steps.map((step) => ({
    shortName: step.title.split(" ").slice(0, 3).join(" "),
    latencyMs: step.durationMs,
    tokens: step.tokenUsage.total,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-edge bg-[#111111] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Latency bottlenecks</div>
        <div className="mt-4 h-72">
          {/* TODO: Migrate chart stroke/fill colors to CSS custom properties (e.g. --chart-grid, --chart-axis)
              when a charting design system is established. Recharts requires inline style strings. */}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke="hsl(0 0% 100% / 0.08)" vertical={false} />
              <XAxis
                dataKey="shortName"
                stroke="hsl(0 0% 100% / 0.45)"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={56}
              />
              <YAxis stroke="hsl(0 0% 100% / 0.45)" tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: "hsl(0 0% 100% / 0.04)" }}
                contentStyle={{ background: "#0A0A0A", border: "1px solid hsl(0 0% 100% / 0.12)", borderRadius: 14 }}
              />
              <Bar dataKey="latencyMs" fill="#60A5FA" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-[#111111] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Token burn per step</div>
        <div className="mt-4 h-72">
          {/* TODO: Migrate chart stroke/fill colors to CSS custom properties when a charting design system is established. */}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke="hsl(0 0% 100% / 0.08)" vertical={false} />
              <XAxis
                dataKey="shortName"
                stroke="hsl(0 0% 100% / 0.45)"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={56}
              />
              <YAxis stroke="hsl(0 0% 100% / 0.45)" tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: "hsl(0 0% 100% / 0.04)" }}
                contentStyle={{ background: "#0A0A0A", border: "1px solid hsl(0 0% 100% / 0.12)", borderRadius: 14 }}
              />
              <Bar dataKey="tokens" fill="#34D399" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function EvidenceTab({ run, selectedStepId }: { run: InspectorRun; selectedStepId: string | null }) {
  const selectStep = useTelemetryInspectorStore((state) => state.selectStep);
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.25fr,0.95fr]">
      <div className="rounded-2xl border border-edge bg-[#111111] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Published evidence reel</div>
            <div className="mt-2 text-sm text-content-secondary">
              Click a screenshot frame to seek the published reel to the same moment while keeping the matching trace step selected.
            </div>
          </div>
          {run.videoUrl ? (
            <a
              href={run.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-edge bg-[#0B0B0B] px-3 py-1.5 text-xs font-medium text-white hover:border-primary/30"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open video
            </a>
          ) : null}
        </div>
        {run.videoUrl ? (
          <video ref={videoRef} className="mt-4 aspect-video w-full rounded-2xl border border-edge bg-black" controls preload="metadata" src={run.videoUrl} />
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-edge bg-[#0A0A0A] px-4 py-8 text-sm text-content-muted">
            No published video is attached to this run yet.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-edge bg-[#111111] p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Synced screenshot filmstrip</div>
        <div className="mt-3 space-y-3">
          {run.evidenceFrames.map((frame) => {
            const selected = frame.stepId === selectedStepId;
            return (
              <button
                key={frame.id}
                type="button"
                onClick={() => {
                  selectStep(frame.stepId);
                  if (videoRef.current) {
                    videoRef.current.currentTime = frame.timestampMs / 1000;
                  }
                }}
                className={cn(
                  "w-full overflow-hidden rounded-2xl border text-left transition",
                  selected ? "border-primary/50 bg-[#0B0F19]" : "border-edge bg-[#0B0B0B] hover:border-edge",
                )}
              >
                <img src={frame.imageUrl} alt={frame.caption} className="aspect-video w-full object-cover" />
                <div className="border-t border-edge px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white">{frame.label}</div>
                    <div className="text-[11px] text-content-muted">{formatDuration(frame.timestampMs)}</div>
                  </div>
                  <div className="mt-1 text-xs leading-6 text-content-muted">{frame.caption}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function tabIcon(tab: InspectorTab) {
  return TAB_ORDER.find((item) => item.id === tab)?.icon ?? Activity;
}

function activeStepForRun(run: InspectorRun | null, stepId: string | null) {
  if (!run) return null;
  return run.steps.find((step) => step.id === stepId) ?? run.steps[0] ?? null;
}

export function TelemetryInspector() {
  const fallbackRuns = useMemo(() => generateTelemetryInspectorMockRuns(), []);
  const [runs, setRuns] = useState<InspectorRun[]>(import.meta.env.MODE === "test" ? fallbackRuns : []);
  const [dataSource, setDataSource] = useState<"artifact" | "mock">("mock");
  const [loading, setLoading] = useState(import.meta.env.MODE !== "test");
  const [layoutDirection, setLayoutDirection] = useState<"horizontal" | "vertical">(() =>
    typeof window !== "undefined" && window.innerWidth < 1024 ? "vertical" : "horizontal",
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRunId = useTelemetryInspectorStore((state) => state.selectedRunId);
  const selectedStepId = useTelemetryInspectorStore((state) => state.selectedStepId);
  const activeTab = useTelemetryInspectorStore((state) => state.activeTab);
  const searchQuery = useTelemetryInspectorStore((state) => state.searchQuery);
  const statusFilter = useTelemetryInspectorStore((state) => state.statusFilter);
  const hydrateSelection = useTelemetryInspectorStore((state) => state.hydrateSelection);
  const selectRun = useTelemetryInspectorStore((state) => state.selectRun);
  const selectStep = useTelemetryInspectorStore((state) => state.selectStep);
  const setActiveTab = useTelemetryInspectorStore((state) => state.setActiveTab);
  const openFeedback = useTelemetryInspectorStore((state) => state.openFeedback);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const onResize = () => {
      setLayoutDirection(window.innerWidth < 1024 ? "vertical" : "horizontal");
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      setRuns(fallbackRuns);
      setDataSource("mock");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadArtifactRuns() {
      try {
        const response = await fetch("/benchmarks/enterprise-investigation-eval-latest.json", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const artifact = (await response.json()) as EnterpriseEvalArtifact;
        const baseRuns = buildTelemetryInspectorRunsFromEvalArtifact(artifact);
        const replayHydratedRuns = await hydrateTelemetryInspectorRunsWithReplay(baseRuns, fetch);

        if (!cancelled && replayHydratedRuns.length > 0) {
          setRuns(replayHydratedRuns);
          setDataSource("artifact");
        }
      } catch {
        if (!cancelled) {
          setRuns(fallbackRuns);
          setDataSource("mock");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadArtifactRuns();

    return () => {
      cancelled = true;
    };
  }, [fallbackRuns]);

  const filteredRuns = useMemo(() => {
    const lowered = searchQuery.trim().toLowerCase();
    return runs.filter((run) => {
      const matchesStatus = statusFilter === "all" || run.status === statusFilter;
      const matchesSearch =
        lowered.length === 0 ||
        [run.id, run.title, run.goal, run.dataset, ...run.tags].some((value) => value.toLowerCase().includes(lowered));
      return matchesStatus && matchesSearch;
    });
  }, [runs, searchQuery, statusFilter]);

  useEffect(() => {
    hydrateSelection(filteredRuns);
  }, [filteredRuns, hydrateSelection]);

  useEffect(() => {
    const runParam = searchParams.get("run");
    const tabParam = searchParams.get("tab");

    if (tabParam && TAB_ORDER.some((tab) => tab.id === tabParam) && activeTab !== tabParam) {
      setActiveTab(tabParam as InspectorTab);
    }

    if (!runParam || filteredRuns.length === 0) {
      return;
    }

    const matchingRun = filteredRuns.find((run) => run.id === runParam);
    if (matchingRun && matchingRun.id !== selectedRunId) {
      selectRun(matchingRun.id, matchingRun.steps[0]?.id ?? null);
    }
  }, [activeTab, filteredRuns, searchParams, selectRun, selectedRunId, setActiveTab]);

  const activeRun = filteredRuns.find((run) => run.id === selectedRunId) ?? filteredRuns[0] ?? null;
  const activeStep = activeStepForRun(activeRun, selectedStepId);

  useEffect(() => {
    if (activeRun && !activeStep && activeRun.steps[0]) {
      selectStep(activeRun.steps[0].id);
    }
  }, [activeRun, activeStep, selectStep]);

  useEffect(() => {
    const currentRun = searchParams.get("run") ?? "";
    const currentTab = searchParams.get("tab") ?? "";
    const nextRun = activeRun?.id ?? "";
    const nextTab = activeTab;

    if (currentRun === nextRun && currentTab === nextTab) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (nextRun) {
      nextParams.set("run", nextRun);
    } else {
      nextParams.delete("run");
    }
    nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeRun?.id, activeTab, searchParams, setSearchParams]);

  const ActiveTabIcon = tabIcon(activeTab);

  return (
    <section
      id="telemetry-inspector"
      className="relative rounded-[28px] border border-edge bg-[#070707] p-3 sm:p-4"
      data-testid="telemetry-inspector"
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            <Eye className="h-3.5 w-3.5" />
            Telemetry & Evidence Chain Inspector
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            Deep trace inspection for long-running agent work
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-content-secondary">
            This surface now prefers the latest enterprise investigation eval artifact and replay metadata, then falls back to realistic mock runs if the public artifact is unavailable. You can inspect step-by-step traces, latency and token burn, raw payloads, and synced visual evidence in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium",
              dataSource === "artifact"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/20 bg-amber-500/10 text-amber-200",
            )}
          >
            {dataSource === "artifact" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {dataSource === "artifact" ? "Using live eval artifact" : "Mock fallback active"}
          </div>
          <a
            href="#telemetry-inspector"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("telemetry-inspector")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="inline-flex items-center gap-2 rounded-full border border-edge bg-[#111111] px-3 py-2 text-xs font-medium text-white hover:border-primary/30"
          >
            <Film className="h-3.5 w-3.5" />
            Focus inspector
          </a>
          <button
            type="button"
            onClick={openFeedback}
            className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3 py-2 text-xs font-medium text-white hover:bg-primary/20"
          >
            <MessageSquareWarning className="h-3.5 w-3.5" />
            Report UI issue
          </button>
        </div>
      </div>

      {dataSource === "mock" ? (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/12 px-4 py-3 text-sm text-amber-100">
          <div className="font-semibold">Demo data active</div>
          <div className="mt-1 text-amber-50/80">
            The published enterprise eval artifact was not found, so the inspector is showing mock runs to keep the surface usable.
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[24px] border border-edge bg-[#050505] h-[780px] xl:h-[860px]">
        {loading ? (
          <div className="flex h-full animate-pulse">
            <div className="w-[30%] border-r border-edge bg-[#0B0B0B] p-4">
              <div className="mb-4 h-4 w-24 rounded bg-white/5" />
              <div className="mb-3 h-10 rounded-xl bg-white/5" />
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-2xl bg-white/5" />
                ))}
              </div>
            </div>
            <div className="flex-1 bg-[#090909] p-5">
              <div className="mb-4 h-6 w-64 rounded bg-white/5" />
              <div className="mb-6 h-4 w-96 rounded bg-white/5" />
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-white/5" />
                ))}
              </div>
              <div className="mt-6 h-64 rounded-2xl bg-white/5" />
            </div>
          </div>
        ) : (
        <PanelGroup direction={layoutDirection} autoSaveId="benchmarks-telemetry-inspector">
          <Panel defaultSize={layoutDirection === "vertical" ? 36 : 30} minSize={layoutDirection === "vertical" ? 24 : 22}>
            <RunExplorer runs={filteredRuns} loading={loading} />
          </Panel>
          <PanelResizeHandle
            className={cn(
              "relative bg-white/10 after:absolute after:bg-white/0 hover:after:bg-primary/35",
              layoutDirection === "vertical"
                ? "h-px after:inset-x-0 after:top-1/2 after:h-[3px] after:-translate-y-1/2"
                : "w-px after:inset-y-0 after:left-1/2 after:w-[3px] after:-translate-x-1/2",
            )}
          />
          <Panel defaultSize={layoutDirection === "vertical" ? 64 : 70} minSize={40}>
            <div className="flex h-full flex-col bg-[#090909]">
              {activeRun ? (
                <>
                  <div className="border-b border-edge px-5 py-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]", STATUS_META[activeRun.status].badgeClassName)}>
                            {statusIcon(activeRun.status)}
                            {STATUS_META[activeRun.status].label}
                          </div>
                          <div className="rounded-full border border-edge px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-content-muted">
                            {activeRun.dataset}
                          </div>
                        </div>
                        <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white">{activeRun.title}</h3>
                        <p className="mt-2 max-w-4xl text-sm leading-7 text-content-secondary">{activeRun.goal}</p>
                      </div>
                      <div className="rounded-2xl border border-edge bg-[#111111] px-4 py-3 text-right">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">Overall verdict</div>
                        <div className="mt-2 text-sm font-semibold text-white">{activeRun.verdict}</div>
                        <div className="mt-1 text-xs text-content-muted">{relativeStartedAt(activeRun.startedAt)}</div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <MetricPill label="Tokens used" value={formatTokens(activeRun.totalTokens)} hint="Total across visible steps" />
                      <MetricPill label="Latency" value={formatDuration(activeRun.totalLatencyMs)} hint="End-to-end observed time" />
                      <MetricPill label="Evidence frames" value={String(activeRun.evidenceFrames.length)} hint="Synced screenshots and clips" />
                      <MetricPill label="Estimated cost" value={formatCost(activeRun.totalCostUsd)} hint="Approximate per-run spend" />
                    </div>
                  </div>

                  <div className="border-b border-edge px-5">
                    <div className="flex flex-wrap gap-2 py-3">
                      {TAB_ORDER.map((tab) => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition",
                              active ? "border-primary/40 bg-primary/15 text-white" : "border-edge bg-[#111111] text-content-muted hover:text-white",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 py-5">
                    <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
                      <ActiveTabIcon className="h-3.5 w-3.5" />
                      {TAB_ORDER.find((tab) => tab.id === activeTab)?.label}
                    </div>

                    {activeTab === "overview" ? <OverviewTab run={activeRun} step={activeStep} /> : null}
                    {activeTab === "trace" ? <TraceDetailsTab run={activeRun} selectedStepId={activeStep?.id ?? null} /> : null}
                    {activeTab === "metrics" ? <MetricsTab run={activeRun} /> : null}
                    {activeTab === "evidence" ? <EvidenceTab run={activeRun} selectedStepId={activeStep?.id ?? null} /> : null}
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-content-muted">
                  No runs match the current filters.
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={openFeedback}
          className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/90 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_40px_hsl(0_0%_0%/0.38)] hover:bg-primary"
        >
          <MessageSquareWarning className="h-4 w-4" />
          Report UI Issue
        </button>
      </div>

      <FeedbackModal run={activeRun} step={activeStep} />
    </section>
  );
}

export default TelemetryInspector;

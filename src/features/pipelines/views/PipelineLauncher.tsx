/**
 * PipelineLauncher
 *
 * User-facing launcher for server-side research runs. The backend still uses
 * the pi-ai pipeline workflow, but this surface intentionally describes the
 * experience as saved research that keeps running after the user leaves.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Play, Loader2, Layers, Calendar } from "lucide-react";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";

const PIPELINE_KINDS = [
  { value: "research", label: "Research report", advanced: false },
  { value: "code_gen", label: "Code starter", advanced: false },
  { value: "design_gen", label: "Design brief", advanced: false },
  { value: "research_then_code", label: "Research, then code", advanced: true },
  { value: "research_then_design", label: "Research, then design", advanced: true },
  { value: "code_then_design", label: "Code, then design", advanced: true },
] as const;

type PipelineKindValue = (typeof PIPELINE_KINDS)[number]["value"];
type PipelineLauncherProps = {
  variant?: "default" | "compact";
};

const COMPOSED_KINDS = new Set<PipelineKindValue>([
  "research_then_code",
  "research_then_design",
  "code_then_design",
]);

const MODEL_PRESETS = [
  { value: "gpt-4o-mini", label: "Fast default" },
  { value: "openai:gpt-4o", label: "Deeper read" },
  { value: "anthropic:claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { value: "google:gemini-3-flash", label: "Gemini 3 Flash" },
];

const PLACEHOLDER_BY_KIND: Record<string, string> = {
  research: "Example: Research Orbital Labs and tell me if I should follow up.",
  code_gen: "Example: Create a small TypeScript helper and include a test.",
  design_gen: "Example: Make a clean mobile-first landing page for a research tool.",
  research_then_code: "Example: Compare two libraries, then scaffold a starter with the better fit.",
  research_then_design: "Example: Research strong SaaS examples, then design the hero and CTA.",
  code_then_design: "Example: Scaffold a small React board, then polish the design.",
};

export const PipelineLauncher: React.FC<PipelineLauncherProps> = ({
  variant = "default",
}) => {
  const isCompact = variant === "compact";
  const [pipelineKind, setPipelineKind] = useState<PipelineKindValue>("research");
  const [spec, setSpec] = useState("");
  const [title, setTitle] = useState("");
  const [modelId, setModelId] = useState("gpt-4o-mini");
  const [linkupDepth, setLinkupDepth] = useState<"standard" | "deep">("standard");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  const startPipelineRun = useMutation(
    api.domains.pipelines.pipelineWorkflow.startPipelineRun,
  );
  const startComposedPipelineRun = useMutation(
    api.domains.pipelines.pipelineWorkflow.startComposedPipelineRun,
  );
  const createSchedule = useMutation(
    api.domains.pipelines.pipelineSchedule.createSchedule,
  );

  const loggedInUser = useQuery(
    (api as any)?.domains?.auth?.auth?.loggedInUser ?? "skip",
  );
  const anonymousSessionId = useMemo(() => getAnonymousProductSessionId(), []);
  const ownerKey = loggedInUser?._id
    ? `user:${loggedInUser._id}`
    : anonymousSessionId
      ? `session:${anonymousSessionId}`
      : undefined;
  const ownerLabel = loggedInUser?._id
    ? "Reports, sources, and notes are saved to your workspace."
    : "This browser can reopen the report later. Sign in to keep it across devices.";

  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleCadence, setScheduleCadence] = useState<
    "once" | "hourly" | "daily" | "weekly"
  >("daily");

  const isComposed = COMPOSED_KINDS.has(pipelineKind);
  const showLinkupDepth =
    pipelineKind === "research" ||
    pipelineKind === "research_then_code" ||
    pipelineKind === "research_then_design";
  const visibleKinds = useMemo(
    () =>
      isCompact || advancedOpen
        ? PIPELINE_KINDS
        : PIPELINE_KINDS.filter((kind) => !kind.advanced),
    [advancedOpen, isCompact],
  );

  useEffect(() => {
    if (!advancedOpen && !isCompact && isComposed) {
      setPipelineKind("research");
    }
  }, [advancedOpen, isCompact, isComposed]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!spec.trim()) {
      setFeedback({ kind: "error", message: "Tell NodeBench what to research first." });
      return;
    }
    if (scheduleMode && isComposed) {
      setFeedback({
        kind: "error",
        message: "Automatic refresh is available for single-step research right now.",
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      if (scheduleMode) {
        await createSchedule({
          ownerKey,
          pipelineKind: pipelineKind as "research" | "code_gen" | "design_gen",
          spec: spec.trim(),
          title: title.trim() || undefined,
          modelId,
          cadence: scheduleCadence,
          nextRunAt: Date.now(),
          options: showLinkupDepth ? { linkupDepth } : undefined,
        });
        setFeedback({
          kind: "ok",
          message: "Automatic refresh saved. It will run on the selected cadence and appear below.",
        });
        setSpec("");
        setTitle("");
        setSubmitting(false);
        return;
      }
      if (isComposed) {
        await startComposedPipelineRun({
          composition: pipelineKind as
            | "research_then_code"
            | "research_then_design"
            | "code_then_design",
          spec: spec.trim(),
          title: title.trim() || undefined,
          modelId,
          ownerKey,
          forceFresh: true,
          linkupDepth: showLinkupDepth ? linkupDepth : undefined,
        });
      } else {
        await startPipelineRun({
          pipelineKind: pipelineKind as "research" | "code_gen" | "design_gen",
          spec: spec.trim(),
          title: title.trim() || undefined,
          modelId,
          ownerKey,
          forceFresh: true,
          linkupDepth: showLinkupDepth ? linkupDepth : undefined,
        });
      }
      setFeedback({
        kind: "ok",
        message: "Research started. Safe to leave this page; progress and the final report will appear below.",
      });
      setSpec("");
      setTitle("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFeedback({ kind: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      data-testid="pipeline-launcher"
      data-pipeline-launcher-variant={variant}
      aria-label="Start research"
      className={`nb-surface-card space-y-3 ${isCompact ? "p-3 pipeline-launcher-compact" : "p-4"}`}
    >
      <header className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-emerald-500/15 flex items-center justify-center">
          <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-content">Start research</h3>
          {isCompact ? (
            <p className="text-[11px] text-content-muted">
              Tell NodeBench what to find. It keeps running if you leave.
            </p>
          ) : (
            <p className="text-[11px] text-content-muted">
              Ask a question, start the run, then come back to sources, status, and exports.
            </p>
          )}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-3" data-testid="pipeline-launcher-form">
        {isCompact ? (
          <details className="pipeline-launcher-advanced">
            <summary>Options: {PIPELINE_KINDS.find((k) => k.value === pipelineKind)?.label ?? "Research"} - {linkupDepth === "deep" ? "Deep refresh" : "Standard sources"}</summary>
            <div className="pipeline-launcher-advanced-body">
              <label className="flex flex-col gap-1 text-xs text-content-muted">
                <span>Output type</span>
                <select
                  data-testid="pipeline-launcher-kind"
                  className="bg-surface border border-edge rounded-md text-xs px-2 py-1.5 text-content"
                  value={pipelineKind}
                  onChange={(e) => setPipelineKind(e.target.value as PipelineKindValue)}
                  disabled={submitting}
                >
                  {visibleKinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              {showLinkupDepth ? (
                <div className="flex items-center gap-2 text-[11px] text-content-muted flex-wrap">
                  <span>Search depth</span>
                  <button
                    type="button"
                    data-testid="pipeline-launcher-depth-standard"
                    onClick={() => setLinkupDepth("standard")}
                    className={`px-2 py-0.5 rounded-full border ${
                      linkupDepth === "standard"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                        : "border-edge"
                    }`}
                    disabled={submitting}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    data-testid="pipeline-launcher-depth-deep"
                    onClick={() => setLinkupDepth("deep")}
                    className={`px-2 py-0.5 rounded-full border ${
                      linkupDepth === "deep"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                        : "border-edge"
                    }`}
                    disabled={submitting}
                  >
                    Deep
                  </button>
                </div>
              ) : null}
            </div>
          </details>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs text-content-muted">
              <span>Output type</span>
              <select
                data-testid="pipeline-launcher-kind"
                className="bg-surface border border-edge rounded-md text-xs px-2 py-1.5 text-content"
                value={pipelineKind}
                onChange={(e) => setPipelineKind(e.target.value as PipelineKindValue)}
                disabled={submitting}
              >
                {visibleKinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {advancedOpen ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-content-muted">
                <span>Model</span>
                <select
                  data-testid="pipeline-launcher-model"
                  className="bg-surface border border-edge rounded-md text-xs px-2 py-1.5 text-content"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  disabled={submitting}
                >
                  {MODEL_PRESETS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-content-muted md:col-span-1">
                <span>Title (optional)</span>
                <input
                  data-testid="pipeline-launcher-title"
                  type="text"
                  placeholder="Auto-derived if blank"
                  className="bg-surface border border-edge rounded-md text-xs px-2 py-1.5 text-content"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={submitting}
                  maxLength={120}
                />
              </label>
            </>
            ) : null}
          </div>
        )}

        {!isCompact ? (
          <details
            className="pipeline-launcher-advanced"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>Advanced controls</summary>
            <div className="pipeline-launcher-advanced-body">
              {showLinkupDepth ? (
                <div className="flex items-center gap-2 text-[11px] text-content-muted flex-wrap">
                  <span>Search depth</span>
                  <button
                    type="button"
                    data-testid="pipeline-launcher-depth-standard"
                    onClick={() => setLinkupDepth("standard")}
                    className={`px-2 py-0.5 rounded-full border ${
                      linkupDepth === "standard"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                        : "border-edge"
                    }`}
                    disabled={submitting}
                  >
                    Standard sources
                  </button>
                  <button
                    type="button"
                    data-testid="pipeline-launcher-depth-deep"
                    onClick={() => setLinkupDepth("deep")}
                    className={`px-2 py-0.5 rounded-full border ${
                      linkupDepth === "deep"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                        : "border-edge"
                    }`}
                    disabled={submitting}
                  >
                    Deep refresh
                  </button>
                </div>
              ) : null}
              {isComposed ? (
                <div className="flex items-center gap-1.5 text-[11px] text-content-muted">
                  <Layers className="w-3 h-3" />
                  <span>Multi-step run: research and generation are saved as separate rows.</span>
                </div>
              ) : null}
              <div className="flex items-center gap-3 flex-wrap text-[11px] text-content-muted">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="pipeline-launcher-schedule-toggle"
                    checked={scheduleMode}
                    onChange={(e) => setScheduleMode(e.target.checked)}
                    disabled={submitting || isComposed}
                    className="h-3 w-3"
                  />
                  <Calendar className="w-3 h-3" />
                  <span>Refresh automatically</span>
                </label>
                {scheduleMode ? (
                  <select
                    data-testid="pipeline-launcher-schedule-cadence"
                    className="bg-surface border border-edge rounded-md text-xs px-2 py-0.5 text-content"
                    value={scheduleCadence}
                    onChange={(e) =>
                      setScheduleCadence(
                        e.target.value as "once" | "hourly" | "daily" | "weekly",
                      )
                    }
                    disabled={submitting}
                  >
                    <option value="once">Once</option>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                ) : null}
              </div>
            </div>
          </details>
        ) : null}

        <label className="flex flex-col gap-1 text-xs text-content-muted">
          <span>What should NodeBench find out?</span>
          <textarea
            data-testid="pipeline-launcher-spec"
            className={`bg-surface border border-edge rounded-md text-xs px-2 py-2 text-content resize-y ${isCompact ? "min-h-[68px]" : "min-h-[88px]"}`}
            placeholder={PLACEHOLDER_BY_KIND[pipelineKind]}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            disabled={submitting}
            maxLength={4000}
          />
          <span className="text-[10px] text-content-muted self-end">
            {spec.length} / 4000
          </span>
        </label>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-content-muted">
            Runs in the background. Safe to leave this page.
            {loggedInUser?._id ? (
              <span data-testid="pipeline-launcher-owner-signedin"> {isCompact ? "Saved to workspace." : ownerLabel}</span>
            ) : (
              <span data-testid="pipeline-launcher-owner-anon"> {isCompact ? "Saved in this browser." : ownerLabel}</span>
            )}
          </div>
          <button
            type="submit"
            data-testid="pipeline-launcher-submit"
            disabled={submitting || !spec.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-600"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {submitting ? "Starting..." : "Run research"}
          </button>
        </div>

        {feedback ? (
          <p
            data-testid={
              feedback.kind === "ok" ? "pipeline-launcher-success" : "pipeline-launcher-error"
            }
            className={`text-[11px] ${
              feedback.kind === "ok"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-700 dark:text-red-300"
            }`}
          >
            {feedback.message}
          </p>
        ) : null}
      </form>
    </section>
  );
};

export default PipelineLauncher;

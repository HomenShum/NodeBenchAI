/**
 * PipelineLauncher
 *
 * Inline form mounted above PipelineRunsPanel that lets users kick off
 * a pi-ai pipeline directly from the UI. On submit it calls the durable
 * `startPipelineRun` workflow mutation (so retries + scheduling are
 * handled by `@convex-dev/workflow`), then resets the form. The new
 * run appears in the panel via the existing reactive query — no manual
 * refresh required.
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Play, Loader2, Layers, Calendar } from "lucide-react";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";

const PIPELINE_KINDS = [
  { value: "research", label: "Research" },
  { value: "code_gen", label: "Code generation" },
  { value: "design_gen", label: "Design generation" },
  { value: "research_then_code", label: "Research → Code (composed)" },
  { value: "research_then_design", label: "Research → Design (composed)" },
  { value: "code_then_design", label: "Code → Design (composed)" },
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
  { value: "gpt-4o-mini", label: "GPT-4o mini · cheap + fast" },
  { value: "openai:gpt-4o", label: "GPT-4o · higher quality" },
  { value: "anthropic:claude-haiku-4.5", label: "Claude Haiku 4.5" },
  { value: "google:gemini-3-flash", label: "Gemini 3 Flash" },
];

const PLACEHOLDER_BY_KIND: Record<string, string> = {
  research:
    "Ask a research question — e.g., What are the practical tradeoffs between pi-ai and Vercel AI SDK?",
  code_gen:
    "Describe what to scaffold — e.g., A TypeScript util that hashes strings with SHA-256, plus a Vitest test.",
  design_gen:
    "Describe the surface — e.g., A landing page for a coding-pipeline product. Hero, CTA, three feature cards, dark mode.",
  research_then_code:
    "Describe what to research and then build — e.g., Compare Tailwind v4 vs Panda CSS, then scaffold a starter using the winner.",
  research_then_design:
    "Describe what to research and then design — e.g., Survey premium SaaS landing pages, then design our hero + CTA.",
  code_then_design:
    "Describe what to scaffold and then design — e.g., A simple kanban board in React, then a polished design for it.",
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

  // Auth-aware ownerKey: when signed in, runs are attributed to the
  // user (`user:<id>`) so the document handoff fires automatically and
  // /reports filtering works. When anonymous, fall back to the persistent
  // anonymous session id (`session:<id>`) so shareable run links resolve
  // for the same browser session even before signup. Storage-bundle export
  // is the only handoff path until they sign in (auth-gated).
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
    ? "Signed in — output also lands as a Workspace document."
    : `Session ${anonymousSessionId?.slice(0, 8) ?? "?"} — bundle export only (sign in for document handoff).`;
  // Schedule mode: when ON, submit creates a scheduledPipelineRuns row
  // instead of firing the workflow immediately. Cron sweeps the row
  // hourly and kicks off the run when nextRunAt elapses.
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduleCadence, setScheduleCadence] = useState<
    "once" | "hourly" | "daily" | "weekly"
  >("daily");
  const isComposed = COMPOSED_KINDS.has(pipelineKind);
  const showLinkupDepth =
    pipelineKind === "research" || pipelineKind === "research_then_code" ||
    pipelineKind === "research_then_design";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!spec.trim()) {
      setFeedback({ kind: "error", message: "Spec required." });
      return;
    }
    if (scheduleMode && isComposed) {
      setFeedback({
        kind: "error",
        message: "Composed pipelines can't be scheduled yet. Pick a primitive kind.",
      });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      if (scheduleMode) {
        const result = await createSchedule({
          ownerKey,
          pipelineKind: pipelineKind as "research" | "code_gen" | "design_gen",
          spec: spec.trim(),
          title: title.trim() || undefined,
          modelId,
          cadence: scheduleCadence,
          nextRunAt: Date.now(), // fire immediately on next cron sweep
          options: showLinkupDepth ? { linkupDepth } : undefined,
        });
        setFeedback({
          kind: "ok",
          message: `Schedule ${result.scheduleId} created — fires on next ${scheduleCadence} cron sweep.`,
        });
        setSpec("");
        setTitle("");
        setSubmitting(false);
        return;
      }
      let workflowId: string;
      if (isComposed) {
        const result = await startComposedPipelineRun({
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
        workflowId = result.workflowId;
      } else {
        const result = await startPipelineRun({
          pipelineKind: pipelineKind as "research" | "code_gen" | "design_gen",
          spec: spec.trim(),
          title: title.trim() || undefined,
          modelId,
          ownerKey,
          forceFresh: true,
          linkupDepth: showLinkupDepth ? linkupDepth : undefined,
        });
        workflowId = result.workflowId;
      }
      setFeedback({
        kind: "ok",
        message: `Workflow ${workflowId} started — ${
          isComposed ? "two runs" : "run"
        } will appear below.${
          ownerKey ? "" : " (anonymous: bundle export only)"
        }`,
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
      aria-label="Run a pipeline"
      className={`nb-surface-card space-y-3 ${isCompact ? "p-3 pipeline-launcher-compact" : "p-4"}`}
    >
      <header className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-emerald-500/15 flex items-center justify-center">
          <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-content">Run a pipeline</h3>
          {isCompact ? (
            <p className="text-[11px] text-content-muted">
              Kind + spec. Full model and schedule controls remain on desktop.
            </p>
          ) : (
            <p className="text-[11px] text-content-muted">
              Pick a kind, describe what you want, and submit. The run lands below in real time.
            </p>
          )}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-3" data-testid="pipeline-launcher-form">
        <div className={`grid grid-cols-1 ${isCompact ? "gap-2" : "md:grid-cols-3 gap-3"}`}>
          <label className="flex flex-col gap-1 text-xs text-content-muted">
            <span>Kind</span>
            <select
              data-testid="pipeline-launcher-kind"
              className="bg-surface border border-edge rounded-md text-xs px-2 py-1.5 text-content"
              value={pipelineKind}
              onChange={(e) =>
                setPipelineKind(e.target.value as "research" | "code_gen" | "design_gen")
              }
              disabled={submitting}
            >
              {PIPELINE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          {!isCompact ? (
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
              placeholder="Auto-derived from spec if blank"
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
        {showLinkupDepth ? (
          <div className="flex items-center gap-2 text-[11px] text-content-muted flex-wrap">
            <span>Web search depth:</span>
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
              Standard (~€0.005/query)
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
              Deep (~€0.05/query, slower)
            </button>
          </div>
        ) : null}
        {isComposed ? (
          <div className="flex items-center gap-1.5 text-[11px] text-content-muted">
            <Layers className="w-3 h-3" />
            <span>Composed run: two pipelineRuns rows will appear (stage 1 → stage 2).</span>
          </div>
        ) : null}
        {!isCompact ? (
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
            <span>Schedule instead of run now</span>
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
          {scheduleMode && isComposed ? (
            <span className="text-amber-700 dark:text-amber-300">
              (composed schedules not supported)
            </span>
          ) : null}
        </div>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-content-muted">
          <span>Spec</span>
          <textarea
            data-testid="pipeline-launcher-spec"
            className={`bg-surface border border-edge rounded-md text-xs px-2 py-2 text-content font-mono resize-y ${isCompact ? "min-h-[68px]" : "min-h-[88px]"}`}
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
            {isCompact ? <>Durable workflow, idempotent resubmit.</> : <>Runs durably via{" "}
            <code className="text-[10px]">@convex-dev/workflow</code> — retries on transient
            failure, idempotent on resubmit.</>}
            {loggedInUser?._id ? (
              <span data-testid="pipeline-launcher-owner-signedin"> {isCompact ? "Signed in." : ownerLabel}</span>
            ) : (
              <span data-testid="pipeline-launcher-owner-anon"> {isCompact ? `Session ${anonymousSessionId?.slice(0, 8) ?? "?"}.` : ownerLabel}</span>
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
            {submitting ? "Starting…" : "Run pipeline"}
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

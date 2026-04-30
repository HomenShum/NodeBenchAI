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

import React, { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Play, Loader2 } from "lucide-react";

const PIPELINE_KINDS = [
  { value: "research", label: "Research" },
  { value: "code_gen", label: "Code generation" },
  { value: "design_gen", label: "Design generation" },
] as const;

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
};

export const PipelineLauncher: React.FC = () => {
  const [pipelineKind, setPipelineKind] = useState<"research" | "code_gen" | "design_gen">(
    "research",
  );
  const [spec, setSpec] = useState("");
  const [title, setTitle] = useState("");
  const [modelId, setModelId] = useState("gpt-4o-mini");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  const startPipelineRun = useMutation(
    api.domains.pipelines.pipelineWorkflow.startPipelineRun,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!spec.trim()) {
      setFeedback({ kind: "error", message: "Spec required." });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await startPipelineRun({
        pipelineKind,
        spec: spec.trim(),
        title: title.trim() || undefined,
        modelId,
        forceFresh: true,
      });
      setFeedback({
        kind: "ok",
        message: `Workflow ${result.workflowId} started — run will appear below.`,
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
      aria-label="Run a pipeline"
      className="nb-surface-card p-4 space-y-3"
    >
      <header className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-emerald-500/15 flex items-center justify-center">
          <Play className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-content">Run a pipeline</h3>
          <p className="text-[11px] text-content-muted">
            Pick a kind, describe what you want, and submit. The run lands below in real time.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-3" data-testid="pipeline-launcher-form">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
        </div>
        <label className="flex flex-col gap-1 text-xs text-content-muted">
          <span>Spec</span>
          <textarea
            data-testid="pipeline-launcher-spec"
            className="bg-surface border border-edge rounded-md text-xs px-2 py-2 text-content font-mono resize-y min-h-[88px]"
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
            Runs durably via{" "}
            <code className="text-[10px]">@convex-dev/workflow</code> — retries on transient
            failure, idempotent on resubmit.
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

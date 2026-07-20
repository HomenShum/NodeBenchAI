/**
 * PipelineLauncher
 *
 * User-facing launcher for server-side research runs. The backend still uses
 * the pi-ai pipeline workflow, but this surface intentionally describes the
 * experience as background research that keeps running after the user leaves.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import { Calendar, Layers } from "lucide-react";
import { ExactComposer } from "@/features/designKit/exact/ExactComposer";
import {
  DEFAULT_PIPELINE_MODEL_SELECTION,
  PIPELINE_MODEL_OPTIONS,
  getPipelineModelOption,
  type PipelineModelSelection,
} from "@/shared/llm/pipelineModelRoutes";

const PIPELINE_KINDS = [
  { value: "research", label: "Research bundle", advanced: false },
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

const REPORT_COMPOSER_SUGGESTIONS = [
  "Research a company",
  "Compare two companies",
  "Ask about a person",
] as const;

const REPORT_COMPOSER_PROMPT_BY_SUGGESTION: Record<
  (typeof REPORT_COMPOSER_SUGGESTIONS)[number],
  string
> = {
  "Research a company": "Research ",
  "Compare two companies": "Compare ",
  "Ask about a person": "Find the public footprint for ",
};

export const PipelineLauncher: React.FC<PipelineLauncherProps> = ({
  variant = "default",
}) => {
  const isCompact = variant === "compact";
  const [pipelineKind, setPipelineKind] = useState<PipelineKindValue>("research");
  const [spec, setSpec] = useState("");
  const [title, setTitle] = useState("");
  const [modelId, setModelId] = useState<PipelineModelSelection>(
    DEFAULT_PIPELINE_MODEL_SELECTION,
  );
  const [linkupDepth, setLinkupDepth] = useState<"standard" | "deep">("standard");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { signIn } = useAuthActions();

  const startPipelineRun = useMutation(
    api.domains.pipelines.pipelineWorkflow.startPipelineRun,
  );
  const startComposedPipelineRun = useMutation(
    api.domains.pipelines.pipelineWorkflow.startComposedPipelineRun,
  );
  const createSchedule = useMutation(
    api.domains.pipelines.pipelineSchedule.createSchedule,
  );

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
  const selectedKindLabel =
    PIPELINE_KINDS.find((kind) => kind.value === pipelineKind)?.label ?? "Research report";
  const selectedModelOption = getPipelineModelOption(modelId);
  const selectedModelLabel = selectedModelOption.shortLabel;
  const selectedModelProvider = selectedModelOption.provider;

  useEffect(() => {
    if (!advancedOpen && !isCompact && isComposed) {
      setPipelineKind("research");
    }
  }, [advancedOpen, isCompact, isComposed]);

  const submitLaunch = async () => {
    if (submitting) return;
    if (!isAuthenticated) {
      setFeedback({ kind: "error", message: "Sign in to start background research." });
      return;
    }
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
          message: "Automatic refresh saved. Its runs and bundles will appear below.",
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
          forceFresh: true,
          linkupDepth: showLinkupDepth ? linkupDepth : undefined,
        });
      } else {
        await startPipelineRun({
          pipelineKind: pipelineKind as "research" | "code_gen" | "design_gen",
          spec: spec.trim(),
          title: title.trim() || undefined,
          modelId,
          forceFresh: true,
          linkupDepth: showLinkupDepth ? linkupDepth : undefined,
        });
      }
      setFeedback({
        kind: "ok",
        message: "Background run started. Track progress and download the completed bundle below.",
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

  if (isAuthLoading || !isAuthenticated) {
    return (
      <section
        data-testid="pipeline-launcher"
        data-pipeline-launcher-variant={variant}
        aria-label="Start research"
        className="pipeline-launcher pipeline-launcher-chatlike nb-surface-card p-4"
      >
        {isAuthLoading ? (
          <p className="text-xs text-content-muted">Checking research access...</p>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-content">Background research</h3>
              <p className="text-xs text-content-muted">
                Sign in to start paid runs or schedule automatic refreshes.
              </p>
            </div>
            <button
              type="button"
              data-testid="pipeline-launcher-sign-in"
              className="rounded-md bg-content px-3 py-1.5 text-xs font-medium text-surface"
              onClick={() =>
                void signIn("google", {
                  redirectTo:
                    typeof window !== "undefined" ? window.location.href : "/?surface=reports",
                })
              }
            >
              Continue with Google
            </button>
          </div>
        )}
      </section>
    );
  }

  const launcherOptions = (
    <div className="pipeline-launcher-composer-options">
      <label className="pipeline-launcher-option-field">
        <span>Output</span>
        <select
          data-testid="pipeline-launcher-kind"
          value={pipelineKind}
          onChange={(e) => setPipelineKind(e.target.value as PipelineKindValue)}
          disabled={submitting}
        >
          {visibleKinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <label className="pipeline-launcher-option-field">
        <span>Title</span>
        <input
          data-testid="pipeline-launcher-title"
          type="text"
          placeholder="Auto-derived"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
          maxLength={120}
        />
      </label>
      {showLinkupDepth ? (
        <div className="pipeline-launcher-option-pills" aria-label="Search depth">
          <button
            type="button"
            data-testid="pipeline-launcher-depth-standard"
            data-active={linkupDepth === "standard"}
            onClick={() => setLinkupDepth("standard")}
            disabled={submitting}
          >
            Standard
          </button>
          <button
            type="button"
            data-testid="pipeline-launcher-depth-deep"
            data-active={linkupDepth === "deep"}
            onClick={() => setLinkupDepth("deep")}
            disabled={submitting}
          >
            Deep refresh
          </button>
        </div>
      ) : null}
      <label className="pipeline-launcher-schedule-field">
        <input
          type="checkbox"
          data-testid="pipeline-launcher-schedule-toggle"
          checked={scheduleMode}
          onChange={(e) => setScheduleMode(e.target.checked)}
          disabled={submitting || isComposed}
        />
        <Calendar className="w-3 h-3" />
        <span>Refresh automatically</span>
      </label>
      {scheduleMode ? (
        <select
          data-testid="pipeline-launcher-schedule-cadence"
          className="pipeline-launcher-cadence"
          value={scheduleCadence}
          onChange={(e) =>
            setScheduleCadence(e.target.value as "once" | "hourly" | "daily" | "weekly")
          }
          disabled={submitting}
        >
          <option value="once">Once</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      ) : null}
      {isComposed ? (
        <span className="pipeline-launcher-composed-note">
          <Layers className="w-3 h-3" />
          Multi-step run saved as separate rows.
        </span>
      ) : null}
    </div>
  );

  const launcherClassName = [
    "pipeline-launcher",
    "pipeline-launcher-chatlike",
    isCompact ? "pipeline-launcher-compact-golden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      data-testid="pipeline-launcher"
      data-pipeline-launcher-variant={variant}
      aria-label="Start research"
      className={launcherClassName}
    >
      <ExactComposer
        as="form"
        innerClassName="pipeline-launcher-composer-inner"
        cardClassName="pipeline-launcher-form"
        cardTestId="pipeline-launcher-form"
        value={spec}
        onValueChange={setSpec}
        onSubmit={submitLaunch}
        placeholder="Ask or paste research text..."
        ariaLabel="Start a background research run"
        inputTestId="pipeline-launcher-spec"
        inputClassName="pipeline-launcher-composer-input"
        maxLength={4000}
        disabled={submitting}
        submitting={submitting}
        submitDisabled={!spec.trim()}
        submitTestId="pipeline-launcher-submit"
        pins={[
          {
            kind: "Output",
            label: selectedKindLabel,
            onClick: () => setAdvancedOpen(true),
            ariaLabel: "Choose output type",
            title: "Choose output type",
          },
        ]}
        addPinLabel="Run options"
        addPinExpanded={advancedOpen}
        onAddPin={() => setAdvancedOpen((open) => !open)}
        modelLabel={selectedModelLabel}
        modelTitle="Model"
        modelProvider={selectedModelProvider}
        modelValue={modelId}
        modelOptions={PIPELINE_MODEL_OPTIONS.map((model) => ({
          value: model.value,
          label: model.label,
        }))}
        onModelValueChange={(value) => setModelId(value as PipelineModelSelection)}
        modelSelectTestId="pipeline-launcher-model"
        options={advancedOpen ? launcherOptions : null}
        suggestions={[...REPORT_COMPOSER_SUGGESTIONS]}
        onSuggestion={(suggestion) => {
          if (suggestion in REPORT_COMPOSER_PROMPT_BY_SUGGESTION) {
            setSpec(
              REPORT_COMPOSER_PROMPT_BY_SUGGESTION[
                suggestion as (typeof REPORT_COMPOSER_SUGGESTIONS)[number]
              ],
            );
          }
        }}
      />
      {feedback ? (
        <p
          data-testid={
            feedback.kind === "ok" ? "pipeline-launcher-success" : "pipeline-launcher-error"
          }
          className={`pipeline-launcher-feedback ${
            feedback.kind === "ok" ? "pipeline-launcher-success" : "pipeline-launcher-error"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
};

export default PipelineLauncher;

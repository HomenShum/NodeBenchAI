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
import { Calendar, Layers, Link2, Mic, Paperclip } from "lucide-react";
import { ExactComposer } from "@/features/designKit/exact/ExactComposer";
import { getAnonymousProductSessionId } from "@/features/product/lib/productIdentity";
import {
  DEFAULT_PIPELINE_MODEL_SELECTION,
  PIPELINE_MODEL_OPTIONS,
  getPipelineModelOption,
  type PipelineModelSelection,
} from "@/shared/llm/pipelineModelRoutes";

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

const REPORT_COMPOSER_SUGGESTIONS = [
  "Research a company",
  "Capture an event note",
  "Ask about a person",
] as const;

const REPORT_COMPOSER_PROMPT_BY_SUGGESTION: Record<
  (typeof REPORT_COMPOSER_SUGGESTIONS)[number],
  string
> = {
  "Research a company": "Research ",
  "Capture an event note": "I am at an event. Capture this note: ",
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
        <span>Route</span>
        <select
          data-testid="pipeline-launcher-model"
          value={modelId}
          onChange={(e) => setModelId(e.target.value as PipelineModelSelection)}
          disabled={submitting}
        >
          {PIPELINE_MODEL_OPTIONS.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
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
        placeholder="Ask, capture, paste, upload, or record..."
        ariaLabel="Ask for a report"
        inputTestId="pipeline-launcher-spec"
        inputClassName="pipeline-launcher-composer-input"
        maxLength={4000}
        disabled={submitting}
        submitting={submitting}
        submitDisabled={!spec.trim()}
        submitTestId="pipeline-launcher-submit"
        pins={[
          {
            kind: "Report",
            label: selectedKindLabel,
            onClick: () => setAdvancedOpen(true),
            ariaLabel: "Choose output type",
            title: "Choose output type",
          },
        ]}
        addPinLabel="Add context"
        addPinExpanded={advancedOpen}
        onAddPin={() => setAdvancedOpen((open) => !open)}
        tools={[
          { key: "attach", label: "Attach file", icon: <Paperclip size={14} /> },
          { key: "url", label: "Add URL", icon: <Link2 size={14} /> },
          { key: "voice", label: "Voice note", icon: <Mic size={14} /> },
        ]}
        modelLabel={selectedModelLabel}
        modelTitle="Model"
        modelProvider={selectedModelProvider}
        onModelClick={() => setAdvancedOpen(true)}
        footerMeta={
          selectedModelOption.isFree
            ? "Memory-first - free route"
            : "Memory-first - auto route"
        }
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

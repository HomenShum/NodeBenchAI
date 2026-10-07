import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  TASTE_BENCH_CORRECTIONS,
  TASTE_BENCH_DIMENSIONS,
  TASTE_BENCH_SCENARIOS,
  getTasteBenchScenario,
  type TasteBenchCorrectionKind,
  type TasteBenchDimension,
  type TasteBenchScenarioId,
} from "@/features/evaluation/data/tasteBenchScenario";

type ArtifactSlot = "a" | "b";
type PresentedChoice = ArtifactSlot | "tie" | "both_fail";

export type TasteBenchBlindArtifact = {
  slotHandle: ArtifactSlot;
  summary: string;
  issues: Array<{
    severity: string;
    title: string;
    details: string;
    route: string | null;
  }>;
  evidenceUrl: string | null;
};

export type TasteBenchBlindRun = {
  runId: string;
  scenarioId: TasteBenchScenarioId;
  catalogVersion: string;
  createdAt: number;
  blindness: {
    level: "role_only";
    disclosure: string;
  };
  slotA: TasteBenchBlindArtifact;
  slotB: TasteBenchBlindArtifact;
};

export type TasteBenchCompletedRun = TasteBenchBlindRun & {
  roleReveal: {
    slotA: "baseline" | "candidate";
    slotB: "baseline" | "candidate";
    disclosure: string;
  };
  decision: {
    choice: "baseline" | "candidate" | "tie" | "both_fail";
    reason: string;
    dimensions: TasteBenchDimension[];
    createdAt: number;
  };
};

export type TasteBenchMetrics = {
  runCount: number;
  completedRunCount: number;
  completionRate: number | null;
  medianDecisionMs: number | null;
  manualCorrectionCount: number | null;
  operationChangedCount: number | null;
  operationUndoneCount: number | null;
  approvalInterruptionCount: number | null;
  proposalInvalidCount: number | null;
  proposalRetryCount: number | null;
  artifactReuseCount: number | null;
  timeToFirstReviewableMs: number | null;
};

export type TasteBenchEligibility = {
  eligibleCount: number;
  requiredCount: number;
  ready: boolean;
};

export type TasteBenchDashboard = {
  activeRun: TasteBenchBlindRun | null;
  latestCompleted: TasteBenchCompletedRun | null;
  metrics: TasteBenchMetrics;
};

export type TasteBenchPanelViewProps = {
  loading?: boolean;
  eligibility: TasteBenchEligibility | null;
  dashboard: TasteBenchDashboard | null;
  selectedScenarioId: TasteBenchScenarioId;
  busy?: boolean;
  error?: string | null;
  onScenarioChange: (scenarioId: TasteBenchScenarioId) => void;
  onStart: (scenarioId: TasteBenchScenarioId) => void | Promise<void>;
  onSubmit: (args: {
    runId: string;
    presentedChoice: PresentedChoice;
    reason: string;
    dimensions: TasteBenchDimension[];
  }) => void | Promise<void>;
  onAbandon: (runId: string) => void | Promise<void>;
  onRecordCorrection: (args: {
    runId: string;
    classification: TasteBenchCorrectionKind;
    note: string;
    dimensions: TasteBenchDimension[];
    beforeSlot: ArtifactSlot;
    afterSlot: ArtifactSlot;
  }) => void | Promise<void>;
};

const EMPTY_METRICS: TasteBenchMetrics = {
  runCount: 0,
  completedRunCount: 0,
  completionRate: null,
  medianDecisionMs: null,
  manualCorrectionCount: null,
  operationChangedCount: null,
  operationUndoneCount: null,
  approvalInterruptionCount: null,
  proposalInvalidCount: null,
  proposalRetryCount: null,
  artifactReuseCount: null,
  timeToFirstReviewableMs: null,
};

function formatDuration(value: number | null): string {
  if (value == null) return "Not measured";
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function formatCount(value: number | null): string {
  return value == null ? "Not measured" : String(value);
}

function DimensionPicker(props: {
  idPrefix: string;
  value: TasteBenchDimension[];
  onChange: (value: TasteBenchDimension[]) => void;
}) {
  const selected = new Set(props.value);
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">
        What drove this judgment?
      </legend>
      <div className="flex flex-wrap gap-2">
        {TASTE_BENCH_DIMENSIONS.map((dimension) => {
          const isSelected = selected.has(dimension.id);
          return (
            <button
              key={dimension.id}
              id={`${props.idPrefix}-${dimension.id}`}
              type="button"
              aria-pressed={isSelected}
              className={`min-h-10 rounded-md border px-3 text-xs font-medium transition-colors ${
                isSelected
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                props.onChange(
                  isSelected
                    ? props.value.filter((value) => value !== dimension.id)
                    : [...props.value, dimension.id],
                );
              }}
            >
              {dimension.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function BlindArtifactCard({
  label,
  artifact,
  revealedRole,
}: {
  label: "A" | "B";
  artifact: TasteBenchBlindArtifact;
  revealedRole?: "baseline" | "candidate";
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-border/60 bg-background">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          Artifact {label}
        </h3>
        <span
          className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
          data-testid={`tastebench-role-${label.toLowerCase()}`}
        >
          {revealedRole
            ? revealedRole === "baseline"
              ? "Baseline"
              : "Candidate"
            : "Role withheld"}
        </span>
      </div>
      <div className="space-y-3 p-4">
        {artifact.evidenceUrl ? (
          <>
            <video
              aria-label={`Artifact ${label} evidence`}
              className="aspect-video w-full rounded-md border border-border/50 bg-muted/30"
              controls
              playsInline
              preload="metadata"
              src={artifact.evidenceUrl}
            />
            <a
              className="inline-flex min-h-10 items-center text-xs font-medium text-primary hover:underline"
              href={artifact.evidenceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open evidence in a new tab
            </a>
          </>
        ) : (
          <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">
            Evidence is unavailable. This run cannot be judged.
          </div>
        )}

        <details className="rounded-md border border-border/50 bg-card px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">
            Read the QA packet
          </summary>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            <p>{artifact.summary}</p>
            {artifact.issues.length > 0 && (
              <ul className="space-y-2">
                {artifact.issues.slice(0, 4).map((issue, index) => (
                  <li
                    key={`${issue.title}-${index}`}
                    className="border-l border-border pl-3"
                  >
                    <span className="font-medium text-foreground">
                      {issue.title}
                    </span>
                    <span className="ml-2 text-xs uppercase text-muted-foreground">
                      {issue.severity}
                    </span>
                    <p className="mt-1 text-xs">{issue.details}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

function OperationalFriction({ metrics }: { metrics: TasteBenchMetrics }) {
  const rows = [
    [
      "First reviewable output",
      formatDuration(metrics.timeToFirstReviewableMs),
    ],
    ["Decision time", formatDuration(metrics.medianDecisionMs)],
    ["Approval interruptions", formatCount(metrics.approvalInterruptionCount)],
    ["Proposal retries", formatCount(metrics.proposalRetryCount)],
    ["Manual changes", formatCount(metrics.operationChangedCount)],
    ["Undos", formatCount(metrics.operationUndoneCount)],
  ] as const;
  return (
    <details className="border-t border-border/50 px-5 py-4">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Operational friction
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Only workflow-reported server events count. Source references are
          recorded but not yet referentially verified; missing evidence stays
          unavailable instead of becoming zero.
        </p>
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="rounded-md border border-border/50 bg-background px-3 py-2"
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}

export function TasteBenchPanelView(props: TasteBenchPanelViewProps) {
  const [reason, setReason] = useState("");
  const [dimensions, setDimensions] = useState<TasteBenchDimension[]>([]);
  const [correctionKind, setCorrectionKind] =
    useState<TasteBenchCorrectionKind>("reduced_density");
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionDimensions, setCorrectionDimensions] = useState<
    TasteBenchDimension[]
  >([]);
  const [correctionDirection, setCorrectionDirection] = useState<
    "a-to-b" | "b-to-a"
  >("a-to-b");
  const activeRun = props.dashboard?.activeRun ?? null;
  const latestCompleted = props.dashboard?.latestCompleted ?? null;
  const metrics = props.dashboard?.metrics ?? EMPTY_METRICS;
  const scenario = getTasteBenchScenario(
    activeRun?.scenarioId ?? props.selectedScenarioId,
  );
  const canSubmit =
    reason.trim().length >= 16 && dimensions.length > 0 && !props.busy;
  const canCorrect =
    correctionNote.trim().length >= 16 &&
    correctionDimensions.length > 0 &&
    !props.busy;

  useEffect(() => {
    setReason("");
    setDimensions([]);
  }, [activeRun?.runId]);

  return (
    <section
      className="nb-surface-card overflow-hidden"
      aria-labelledby="tastebench-title"
    >
      <header className="flex flex-col gap-2 border-b border-border/50 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2
              id="tastebench-title"
              className="text-base font-semibold text-foreground"
            >
              TasteBench
            </h2>
            <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
              Human authoritative
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Compare two real evidence packs against a fixed scenario. No sample
            artifacts or inferred scores.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {metrics.completedRunCount}/{metrics.runCount} completed
        </div>
      </header>

      <div className="space-y-5 p-5">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label
            className="space-y-1.5 text-xs font-medium text-muted-foreground"
            htmlFor="tastebench-scenario"
          >
            Fixed scenario
            <select
              id="tastebench-scenario"
              className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
              value={activeRun?.scenarioId ?? props.selectedScenarioId}
              disabled={Boolean(activeRun) || props.busy}
              onChange={(event) =>
                props.onScenarioChange(
                  event.target.value as TasteBenchScenarioId,
                )
              }
            >
              {TASTE_BENCH_SCENARIOS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {!activeRun && (
            <button
              type="button"
              className="btn-primary-sm min-h-11 px-4 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !props.eligibility?.ready || props.busy || props.loading
              }
              onClick={() => props.onStart(props.selectedScenarioId)}
            >
              Start blind comparison
            </button>
          )}
        </div>

        {scenario && (
          <div className="rounded-md border border-border/50 bg-muted/20 px-4 py-3">
            <div className="text-sm font-medium text-foreground">
              {scenario.objective}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Audience: {scenario.audience}. Expected outcome:{" "}
              {scenario.expectedOutcome}
            </div>
          </div>
        )}

        {props.loading && (
          <div
            className="rounded-md border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground"
            role="status"
          >
            Loading real evidence packs…
          </div>
        )}

        {!props.loading && !activeRun && !props.eligibility?.ready && (
          <div
            className="rounded-md border border-border/60 bg-background p-4"
            data-testid="tastebench-empty"
          >
            <h3 className="text-sm font-medium text-foreground">
              Two comparable evidence packs required
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              This scenario has {props.eligibility?.eligibleCount ?? 0} of{" "}
              {props.eligibility?.requiredCount ?? 2} required hashed media QA
              packets. TasteBench stays empty instead of substituting fixtures.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Tag each QA prompt with{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                tastebench-scenario:{props.selectedScenarioId}
              </code>
              .
            </p>
          </div>
        )}

        {activeRun && (
          <div className="space-y-5">
            <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Role-blind comparison.
              </span>{" "}
              {activeRun.blindness.disclosure}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <BlindArtifactCard label="A" artifact={activeRun.slotA} />
              <BlindArtifactCard label="B" artifact={activeRun.slotB} />
            </div>
            <div className="space-y-4 rounded-lg border border-border/60 bg-background p-4">
              <DimensionPicker
                idPrefix="tastebench-dimension"
                value={dimensions}
                onChange={setDimensions}
              />
              <label
                className="block space-y-1.5 text-xs font-medium text-muted-foreground"
                htmlFor="tastebench-reason"
              >
                Why?
                <textarea
                  id="tastebench-reason"
                  className="min-h-24 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  value={reason}
                  maxLength={1_200}
                  placeholder="Describe the concrete difference that changed your judgment."
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["a", "Prefer A"],
                    ["b", "Prefer B"],
                    ["tie", "Tie"],
                    ["both_fail", "Both fail"],
                  ] as const
                ).map(([choice, label]) => (
                  <button
                    key={choice}
                    type="button"
                    className={
                      choice === "a" || choice === "b"
                        ? "btn-primary-sm min-h-11"
                        : "btn-outline-sm min-h-11"
                    }
                    disabled={!canSubmit}
                    onClick={() =>
                      props.onSubmit({
                        runId: activeRun.runId,
                        presentedChoice: choice,
                        reason: reason.trim(),
                        dimensions,
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="min-h-10 text-xs text-muted-foreground hover:text-foreground"
                disabled={props.busy}
                onClick={() => props.onAbandon(activeRun.runId)}
              >
                End without judgment
              </button>
            </div>
          </div>
        )}

        {!activeRun && latestCompleted && (
          <div className="rounded-lg border border-border/60 bg-background p-4">
            <div className="text-sm font-medium text-foreground">
              Latest human judgment recorded
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {latestCompleted.decision.reason}
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              Outcome:{" "}
              <span className="font-medium text-foreground">
                {latestCompleted.decision.choice.replace("_", " ")}
              </span>
              {" · "}
              {latestCompleted.decision.dimensions
                .join(", ")
                .replaceAll("_", " ")}
            </div>

            <details className="mt-4 border-t border-border/50 pt-4">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Record an observed before/after correction
              </summary>
              <div className="mt-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                  This records your comparison note. It is not counted as measured
                  correction burden until workflow evidence links the underlying edit.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <BlindArtifactCard
                    label="A"
                    artifact={latestCompleted.slotA}
                    revealedRole={latestCompleted.roleReveal.slotA}
                  />
                  <BlindArtifactCard
                    label="B"
                    artifact={latestCompleted.slotB}
                    revealedRole={latestCompleted.roleReveal.slotB}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className="space-y-1.5 text-xs font-medium text-muted-foreground"
                    htmlFor="tastebench-correction-kind"
                  >
                    Classification
                    <select
                      id="tastebench-correction-kind"
                      className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
                      value={correctionKind}
                      onChange={(event) =>
                        setCorrectionKind(
                          event.target.value as TasteBenchCorrectionKind,
                        )
                      }
                    >
                      {TASTE_BENCH_CORRECTIONS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="space-y-1.5 text-xs font-medium text-muted-foreground"
                    htmlFor="tastebench-correction-direction"
                  >
                    Direction
                    <select
                      id="tastebench-correction-direction"
                      className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
                      value={correctionDirection}
                      onChange={(event) =>
                        setCorrectionDirection(
                          event.target.value as "a-to-b" | "b-to-a",
                        )
                      }
                    >
                      <option value="a-to-b">
                        {latestCompleted.roleReveal.slotA === "baseline"
                          ? "Baseline"
                          : "Candidate"}{" "}
                        →{" "}
                        {latestCompleted.roleReveal.slotB === "baseline"
                          ? "Baseline"
                          : "Candidate"}
                      </option>
                      <option value="b-to-a">
                        {latestCompleted.roleReveal.slotB === "baseline"
                          ? "Baseline"
                          : "Candidate"}{" "}
                        →{" "}
                        {latestCompleted.roleReveal.slotA === "baseline"
                          ? "Baseline"
                          : "Candidate"}
                      </option>
                    </select>
                  </label>
                </div>
                <DimensionPicker
                  idPrefix="tastebench-correction-dimension"
                  value={correctionDimensions}
                  onChange={setCorrectionDimensions}
                />
                <label
                  className="block space-y-1.5 text-xs font-medium text-muted-foreground"
                  htmlFor="tastebench-correction-note"
                >
                  What changed?
                  <textarea
                    id="tastebench-correction-note"
                    className="min-h-24 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    value={correctionNote}
                    maxLength={1_200}
                    onChange={(event) => setCorrectionNote(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn-outline-sm min-h-11 px-4"
                  disabled={!canCorrect}
                  onClick={() => {
                    void Promise.resolve(
                      props.onRecordCorrection({
                        runId: latestCompleted.runId,
                        classification: correctionKind,
                        note: correctionNote.trim(),
                        dimensions: correctionDimensions,
                        beforeSlot: correctionDirection === "a-to-b" ? "a" : "b",
                        afterSlot: correctionDirection === "a-to-b" ? "b" : "a",
                      }),
                    ).then(() => {
                      setCorrectionNote("");
                      setCorrectionDimensions([]);
                    }).catch(() => {
                      // The container renders the server error and preserves the form.
                    });
                  }}
                >
                  Save correction evidence
                </button>
              </div>
            </details>
          </div>
        )}

        {props.error && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {props.error}
          </div>
        )}
      </div>

      <OperationalFriction metrics={metrics} />
    </section>
  );
}

const tasteBenchApi = (api as any).domains.evaluation.tasteBench;

export function TasteBenchPanel() {
  const [selectedScenarioId, setSelectedScenarioId] =
    useState<TasteBenchScenarioId>("app-02-pre-delegation-packet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibility = useQuery(tasteBenchApi.listTasteBenchArtifactCandidates, {
    scenarioId: selectedScenarioId,
  }) as TasteBenchEligibility | undefined;
  const dashboard = useQuery(tasteBenchApi.getTasteBenchDashboard, {}) as
    | TasteBenchDashboard
    | undefined;
  const startRun = useMutation(tasteBenchApi.startTasteBenchRun);
  const submitComparison = useMutation(
    tasteBenchApi.submitTasteBenchComparison,
  );
  const abandonRun = useMutation(tasteBenchApi.abandonTasteBenchRun);
  const recordCorrection = useMutation(
    tasteBenchApi.recordTasteBenchCorrection,
  );

  useEffect(() => {
    if (dashboard?.activeRun?.scenarioId) {
      setSelectedScenarioId(dashboard.activeRun.scenarioId);
    }
  }, [dashboard?.activeRun?.scenarioId]);

  const actions = useMemo(
    () => ({
      async run(operation: () => Promise<unknown>): Promise<boolean> {
        setBusy(true);
        setError(null);
        try {
          await operation();
          return true;
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "TasteBench action failed",
          );
          return false;
        } finally {
          setBusy(false);
        }
      },
    }),
    [],
  );

  return (
    <TasteBenchPanelView
      loading={eligibility === undefined || dashboard === undefined}
      eligibility={eligibility ?? null}
      dashboard={dashboard ?? null}
      selectedScenarioId={selectedScenarioId}
      busy={busy}
      error={error}
      onScenarioChange={setSelectedScenarioId}
      onStart={(scenarioId) => actions.run(() => startRun({ scenarioId }))}
      onSubmit={(args) => actions.run(() => submitComparison(args))}
      onAbandon={(runId) =>
        actions.run(() =>
          abandonRun({
            runId,
            reason:
              "Reviewer stopped this comparison before making a judgment.",
          }),
        )
      }
      onRecordCorrection={async (args) => {
        const succeeded = await actions.run(() => recordCorrection(args));
        if (!succeeded) throw new Error("TasteBench correction was not saved");
      }}
    />
  );
}

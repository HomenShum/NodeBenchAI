import React from "react";
import {
  Activity,
  ArrowRight,
  Beaker,
  BriefcaseBusiness,
  Compass,
  GitCompareArrows,
  Loader2,
  Radar,
  TrendingDown,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SuccessLoopCard,
  SuccessLoopHealth,
  SuccessLoopMetricValue,
  SuccessLoopsDashboardSnapshot,
} from "./types";

function getStatusTone(status: SuccessLoopHealth) {
  switch (status) {
    case "strengthening":
      return {
        label: "Strengthening",
        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      };
    case "mixed":
      return {
        label: "Mixed",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      };
    case "weakening":
      return {
        label: "Weakening",
        className: "border-red-500/30 bg-red-500/10 text-red-300",
      };
    default:
      return {
        label: "Missing",
        className: "border-edge bg-background/60 text-content-secondary",
      };
  }
}

function getLoopIcon(loopType: SuccessLoopCard["loopType"]) {
  switch (loopType) {
    case "problem_selection":
      return Compass;
    case "activation":
      return Activity;
    case "retained_value":
      return Workflow;
    case "outcome_attribution":
      return GitCompareArrows;
    case "distribution_proof":
      return Radar;
    case "revenue_expansion":
      return BriefcaseBusiness;
    case "market_sensing":
      return TrendingDown;
    case "organization_learning":
      return Beaker;
    default:
      return TrendingUp;
  }
}

function MetricList({
  label,
  metrics,
}: {
  label: string;
  metrics: SuccessLoopMetricValue[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-content-muted">{label}</div>
      <div className="space-y-1.5">
        {metrics.slice(0, 3).map((metric) => (
          <div
            key={metric.key}
            className="flex items-center justify-between gap-3 rounded-md border border-edge/70 bg-background/40 px-2.5 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-xs text-content">{metric.label}</div>
              <div className="text-[11px] text-content-muted">{metric.source}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-content">{metric.displayValue}</div>
              <div className="text-[11px] text-content-muted">{Math.round(metric.score * 100)} score</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-edge bg-background/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-content-muted">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold", tone ?? "text-content")}>{value}</div>
    </div>
  );
}

export function SuccessLoopsPanel({
  snapshot,
  loading,
}: {
  snapshot: SuccessLoopsDashboardSnapshot | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-edge bg-surface p-4">
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
          Loading success loops...
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-edge bg-surface p-4 text-sm text-content-secondary">
        Loop OS has not been instrumented yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-content">
            <TrendingUp className="h-4 w-4 text-accent" />
            Success Loops
          </div>
          <p className="mt-1 max-w-3xl text-sm text-content-secondary">
            Outer-loop compounding across activation, retention, proof, revenue, and learning.
          </p>
        </div>
        <div className="rounded-lg border border-edge bg-background/40 px-3 py-2 text-xs text-content-secondary">
          {snapshot.summary.totalLoops} loops tracked
        </div>
      </div>

      {snapshot.summary.strengtheningCount === 0 &&
       snapshot.summary.mixedCount === 0 &&
       snapshot.summary.weakeningCount === 0 ? (
        <div className="mt-4 rounded-lg border border-edge bg-background/40 px-4 py-3 text-sm text-content-secondary">
          No loops tracked yet — run a benchmark or complete an agent task to start tracking.
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SummaryChip label="Strengthening" value={String(snapshot.summary.strengtheningCount)} tone="text-emerald-300" />
          <SummaryChip label="Mixed" value={String(snapshot.summary.mixedCount)} tone="text-amber-300" />
          <SummaryChip label="Weakening" value={String(snapshot.summary.weakeningCount)} tone="text-red-300" />
          <SummaryChip
            label="Strongest"
            value={snapshot.summary.strongestLoop?.title ?? "None"}
            tone="text-content"
          />
          <SummaryChip
            label="Weakest"
            value={snapshot.summary.weakestLoop?.title ?? "None"}
            tone="text-content"
          />
        </div>
      )}

      <div className="mt-4 rounded-lg border border-edge bg-background/40 p-3">
        <div className="flex items-start gap-3">
          <ArrowRight className="mt-0.5 h-4 w-4 text-accent" />
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-content-muted">Next move</div>
            <div className="mt-1 text-sm leading-6 text-content">{snapshot.nextRecommendedAction}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {snapshot.loops.map((loop) => {
          const Icon = getLoopIcon(loop.loopType);
          const tone = getStatusTone(loop.status);
          return (
            <div key={loop.loopId} className="rounded-lg border border-edge bg-background/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 text-accent" />
                    <div className="text-sm font-semibold text-content">{loop.title}</div>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        tone.className,
                      )}
                    >
                      {tone.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-content-muted">
                    {loop.owner} · {loop.reviewCadence} review · {Math.round(loop.score * 100)} score
                  </div>
                </div>
                <div className="rounded-md border border-edge bg-surface px-2 py-1 text-[11px] text-content-secondary">
                  {loop.interventionTypes.slice(0, 2).join(" · ")}
                </div>
              </div>

              <p className="mt-3 text-sm leading-6 text-content-secondary">{loop.currentState}</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <MetricList label="Leading metrics" metrics={loop.leadingMetrics} />
                <MetricList label="Lagging metrics" metrics={loop.laggingMetrics} />
              </div>

              {loop.gaps.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {loop.gaps.map((gap) => (
                    <span
                      key={`${loop.loopId}-${gap}`}
                      className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300"
                    >
                      {gap}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-edge bg-background/40 p-4">
          <div className="text-sm font-semibold text-content">Top experiments</div>
          <div className="mt-3 space-y-2">
            {snapshot.topExperiments.length === 0 ? (
              <div className="text-sm text-content-secondary">No experiments logged yet.</div>
            ) : (
              snapshot.topExperiments.map((experiment) => (
                <div key={experiment.experimentKey} className="rounded-md border border-edge bg-surface px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-content">{experiment.title}</div>
                      <div className="mt-1 text-[11px] text-content-muted">
                        {experiment.owner} · {experiment.status} · {experiment.loopType}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-content">
                      {typeof experiment.observedDelta === "number"
                        ? `${Math.round(experiment.observedDelta * 100)}`
                        : "n/a"}
                    </div>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-content-secondary">{experiment.expectedEffect}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-background/40 p-4">
          <div className="text-sm font-semibold text-content">Frozen decisions</div>
          <div className="mt-3 space-y-2">
            {snapshot.frozenDecisions.length === 0 ? (
              <div className="text-sm text-content-secondary">No frozen decisions logged yet.</div>
            ) : (
              snapshot.frozenDecisions.map((decision) => (
                <div key={decision.decisionKey} className="rounded-md border border-edge bg-surface px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-content">{decision.title}</div>
                      <div className="mt-1 text-[11px] text-content-muted">
                        {decision.owner} · {decision.decisionType} · {decision.latestOutcomeVerdict ?? "pending"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-content">
                      {Math.round(decision.confidence * 100)}%
                    </div>
                  </div>
                  {decision.expectedOutcomeSummary ? (
                    <div className="mt-2 text-xs leading-5 text-content-secondary">
                      {decision.expectedOutcomeSummary}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-edge bg-background/40 p-4">
          <div className="text-sm font-semibold text-content">Proof graph</div>
          <div className="mt-3 space-y-2">
            {snapshot.proofGraph.nodes.map((node) => (
              <div key={node.nodeKey} className="rounded-md border border-edge bg-surface px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-content">{node.label}</div>
                    <div className="mt-1 text-[11px] text-content-muted">{node.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-content">{node.value}</div>
                    <div className="text-[11px] text-content-muted">{Math.round(node.score * 100)} score</div>
                  </div>
                </div>
              </div>
            ))}
            {snapshot.proofGraph.edges.length > 0 ? (
              <div className="rounded-md border border-edge bg-surface px-3 py-2.5 text-xs text-content-secondary">
                {snapshot.proofGraph.edges
                  .map((edge) => `${edge.label} ${Math.round(edge.strength * 100)}%`)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-background/40 p-4">
          <div className="text-sm font-semibold text-content">Account value graph</div>
          <div className="mt-3 space-y-2">
            {snapshot.accountValueGraph.nodes.map((node) => (
              <div key={node.accountKey} className="rounded-md border border-edge bg-surface px-3 py-2.5">
                <div className="text-sm font-medium text-content">{node.label}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <SummaryChip label="Activation" value={node.activationState} />
                  <SummaryChip label="Retention" value={node.retentionState} />
                  <SummaryChip label="Expansion" value={node.expansionState} />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-content-secondary">
                  <span>{node.workflowRuns30d} workflow runs</span>
                  <span>
                    {typeof node.timeToFirstValueMinutes === "number"
                      ? `${Math.round(node.timeToFirstValueMinutes)}m to value`
                      : "first value untracked"}
                  </span>
                  <span>{node.integrationsConnected} integrations</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuccessLoopsPanel;

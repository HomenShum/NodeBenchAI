/**
 * ScenarioCatalog - 4 benchmark scenarios as Linear issue-list rows
 */

import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { WORKBENCH_SCENARIOS } from "./workbenchScenarios";
import type { WorkbenchScenario } from "./workbenchScenarios";

function formatEstimatedDuration(estimatedMin: number) {
  if (estimatedMin < 60) return `~${estimatedMin}m`;
  const hours = Math.floor(estimatedMin / 60);
  const minutes = estimatedMin % 60;
  if (minutes === 0) return `~${hours}h`;
  return `~${hours}h ${minutes}m`;
}

function formatAxisLabel(axis: string) {
  const axisLabels: Record<string, string> = {
    design_compliance: "Design",
    layout: "Layout",
    accessibility: "Accessibility",
    visual_qa: "Visual QA",
    tool_correctness: "Tool correctness",
    artifact_integrity: "Artifact integrity",
    citations: "Citations",
    replay_determinism: "Replay",
    completion_probability: "Completion",
    graceful_degradation: "Graceful degrade",
    slo_adherence: "SLOs",
    cost_efficiency: "Cost",
    plan_quality: "Plan quality",
    unforced_errors: "Unforced errors",
    test_additions: "Tests",
    refactor_quality: "Refactor",
  };
  return axisLabels[axis] ?? axis.replace(/_/g, " ");
}

export interface ScenarioStat {
  runCount: number;
  avgScore: number;
  lastRunAt: number;
  lastStatus: "passed" | "failed";
}

function StatusDot({ stat }: { stat?: ScenarioStat }) {
  if (!stat || stat.runCount === 0) {
    return <span className="w-2 h-2 rounded-full bg-content-muted/30 flex-none" title="Not yet run" />;
  }
  if (stat.lastStatus === "passed") {
    return <span className="w-2 h-2 rounded-full bg-emerald-500 flex-none" title="Last run passed" />;
  }
  return <span className="w-2 h-2 rounded-full bg-red-500 flex-none" title="Last run failed" />;
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface border border-edge text-content-muted">
      {children}
    </span>
  );
}

function RunBadge({ stat }: { stat?: ScenarioStat }) {
  const count = stat?.runCount ?? 0;
  if (count === 0) {
    return <span className="text-[10px] font-medium text-content-secondary">Not yet run</span>;
  }
  return (
    <span className="text-[10px] font-medium text-content-secondary">
      {count} {count === 1 ? "run" : "runs"}
      {stat?.avgScore !== undefined && <> · avg {Math.round(stat.avgScore)}</>}
    </span>
  );
}

function ScenarioRow({
  scenario,
  stat,
}: {
  scenario: WorkbenchScenario;
  stat?: ScenarioStat;
}) {
  const Icon = scenario.icon;
  const durationLabel = formatEstimatedDuration(scenario.estimatedMin);
  const metaLabel = `${scenario.subtasks} subtasks · ${durationLabel}`;

  return (
    <div
      className="
        nb-surface-card flex items-start gap-3 px-4 py-4
        hover:border-content-muted/30 bg-surface hover:bg-surface-secondary
        transition-colors group cursor-default
      "
    >
      <div className="mt-1.5">
        <StatusDot stat={stat} />
      </div>

      <div className="flex-none w-8 h-8 rounded-md bg-surface flex items-center justify-center border border-edge">
        <Icon className="w-4 h-4 text-content-secondary" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-content">{scenario.name}</span>
          <RunBadge stat={stat} />
        </div>
        <p className="text-xs text-content-muted mt-0.5 leading-relaxed">
          {scenario.description}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-content-muted">{metaLabel}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {scenario.rubricAxes.slice(0, 3).map((axis) => (
              <Chip key={axis}>{formatAxisLabel(axis)}</Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-none self-stretch sm:self-center">
        <div className="flex flex-col items-end gap-1">
          <button
            disabled
            aria-label={`Run ${scenario.name} benchmark — unlocks after app setup in Phase 2`}
            aria-describedby={`run-disabled-hint-${scenario.id}`}
            title="Benchmark execution coming in Phase 2. Configure a workbench app first."
            className="
              w-full sm:w-auto h-11 sm:h-8 flex items-center justify-center gap-1.5 px-3 sm:px-2.5 rounded border border-edge
              bg-surface-secondary text-xs sm:text-[11px] font-medium text-content-secondary
              opacity-70 cursor-not-allowed transition-all
              disabled:pointer-events-auto disabled:hover:bg-surface-hover disabled:hover:border-content-secondary/30
              disabled:hover:text-content group-hover:opacity-100
            "
          >
            <Play className="w-3 h-3" aria-hidden="true" />
            <span>Run</span>
            <span className="sr-only">— not available until Phase 2 app configuration</span>
          </button>
          <span
            id={`run-disabled-hint-${scenario.id}`}
            className="max-w-[11rem] text-right text-[10px] leading-relaxed text-content-muted"
          >
            Unlocks after app setup in Phase 2.
          </span>
        </div>
      </div>
    </div>
  );
}

export function ScenarioCatalog({
  scenarioStats,
}: {
  scenarioStats?: Record<string, ScenarioStat>;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-content-muted">
          Scenarios
        </h2>
        <span className="text-xs text-content-muted">4 task ladders</span>
      </div>

      <div className="space-y-2">
        {WORKBENCH_SCENARIOS.map((scenario) => (
          <ScenarioRow
            key={scenario.id}
            scenario={scenario}
            stat={scenarioStats?.[scenario.id]}
          />
        ))}
      </div>
    </section>
  );
}

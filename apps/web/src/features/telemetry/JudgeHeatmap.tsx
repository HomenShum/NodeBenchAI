/**
 * JudgeHeatmap — Visual grid of scenario × criteria pass/fail.
 *
 * The ONE component that makes eval quality tangible and inspectable.
 * Each cell is color-coded: green (pass), red (fail), gray (not tested).
 * Click a cell to see details. Rows = scenarios, cols = criteria.
 *
 * Shows: which scenarios fail on which criteria → where to focus fixes.
 */

import { memo, useState } from "react";
import { Grid3X3, ChevronDown, ChevronRight } from "lucide-react";

/* ─── Types ────────────────────────────────────────────────────────────────── */

export interface JudgeCell {
  scenario: string;
  criterion: string;
  pass: boolean;
  reasoning?: string;
  score?: number;
}

export interface JudgeHeatmapData {
  scenarios: string[];
  criteria: string[];
  cells: JudgeCell[];
  overallPassRate: number;
  totalQueries: number;
  judgeModel: string;
  timestamp: string;
}

export interface JudgeHeatmapProps {
  data: JudgeHeatmapData;
  className?: string;
}

/* ─── Criterion short labels ───────────────────────────────────────────────── */

const CRITERION_SHORT: Record<string, string> = {
  RELEVANT_ENTITY: "Entity",
  USEFUL_ANSWER: "Useful",
  ACTIONABLE_SIGNALS: "Signals",
  RISK_AWARENESS: "Risks",
  NEXT_STEPS: "Next",
  ROLE_APPROPRIATE: "Role",
  NO_HALLUCINATION: "Truth",
};

/* ─── Cell component ───────────────────────────────────────────────────────── */

function HeatCell({
  cell,
  onSelect,
  isSelected,
}: {
  cell: JudgeCell | undefined;
  onSelect: () => void;
  isSelected: boolean;
}) {
  if (!cell) {
    return (
      <div
        className="w-8 h-8 rounded border border-white/[0.04] bg-white/[0.01]"
        title="Not tested"
      />
    );
  }

  const bg = cell.pass
    ? "bg-emerald-500/30 border-emerald-500/40 hover:bg-emerald-500/50"
    : "bg-rose-500/30 border-rose-500/40 hover:bg-rose-500/50";

  const ring = isSelected ? "ring-2 ring-[#d97757] ring-offset-1 ring-offset-[#151413]" : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-8 h-8 rounded border transition-all ${bg} ${ring}`}
      title={`${cell.scenario} × ${cell.criterion}: ${cell.pass ? "PASS" : "FAIL"}`}
      aria-label={`${cell.scenario} ${cell.criterion}: ${cell.pass ? "pass" : "fail"}`}
    >
      {cell.score != null && (
        <span className="text-[8px] font-mono text-white/60">{cell.score}</span>
      )}
    </button>
  );
}

/* ─── Main component ───────────────────────────────────────────────────────── */

export const JudgeHeatmap = memo(function JudgeHeatmap({
  data,
  className = "",
}: JudgeHeatmapProps) {
  const [selectedCell, setSelectedCell] = useState<JudgeCell | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Build lookup map: `${scenario}:${criterion}` → cell
  const cellMap = new Map<string, JudgeCell>();
  for (const cell of data.cells) {
    cellMap.set(`${cell.scenario}:${cell.criterion}`, cell);
  }

  // Per-scenario pass rates
  const scenarioRates = data.scenarios.map((scenario) => {
    const scenarioCells = data.criteria.map((c) => cellMap.get(`${scenario}:${c}`));
    const tested = scenarioCells.filter(Boolean);
    const passed = tested.filter((c) => c?.pass);
    return {
      scenario,
      rate: tested.length > 0 ? passed.length / tested.length : 0,
      passCount: passed.length,
      totalCount: tested.length,
    };
  });

  // Per-criterion pass rates
  const criterionRates = data.criteria.map((criterion) => {
    const critCells = data.scenarios.map((s) => cellMap.get(`${s}:${criterion}`));
    const tested = critCells.filter(Boolean);
    const passed = tested.filter((c) => c?.pass);
    return {
      criterion,
      rate: tested.length > 0 ? passed.length / tested.length : 0,
    };
  });

  const pct = Math.round(data.overallPassRate * 100);
  const rateColor = pct >= 90 ? "text-emerald-400" : pct >= 70 ? "text-amber-400" : "text-rose-400";

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden ${className}`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
        aria-expanded={expanded}
      >
        <Grid3X3 className="h-4 w-4 text-[#d97757]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 flex-1">
          Judge Heatmap
        </span>
        <span className={`font-mono text-sm font-bold tabular-nums ${rateColor}`}>
          {pct}%
        </span>
        <span className="text-[10px] text-white/20 ml-1">
          {data.totalQueries} queries · {data.judgeModel}
        </span>
        <span className="text-white/30 ml-2" aria-hidden>
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-5 py-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Grid */}
          <div className="overflow-x-auto">
            <div className="inline-grid gap-1" style={{
              gridTemplateColumns: `120px repeat(${data.criteria.length}, 32px) 60px`,
            }}>
              {/* Header row */}
              <div /> {/* empty corner */}
              {data.criteria.map((c) => (
                <div
                  key={c}
                  className="text-[8px] text-white/30 uppercase tracking-wider text-center truncate"
                  title={c}
                >
                  {CRITERION_SHORT[c] ?? c.slice(0, 5)}
                </div>
              ))}
              <div className="text-[8px] text-white/30 uppercase tracking-wider text-right">Rate</div>

              {/* Data rows — flatMap to avoid Fragment key issues */}
              {scenarioRates.flatMap(({ scenario, rate }) => [
                <div
                  key={`label-${scenario}`}
                  className="text-[10px] text-white/50 truncate flex items-center"
                  title={scenario}
                >
                  {scenario.replace(/_/g, " ")}
                </div>,
                ...data.criteria.map((criterion) => {
                  const cell = cellMap.get(`${scenario}:${criterion}`);
                  return (
                    <HeatCell
                      key={`${scenario}:${criterion}`}
                      cell={cell}
                      onSelect={() => setSelectedCell(cell ?? null)}
                      isSelected={
                        selectedCell?.scenario === scenario &&
                        selectedCell?.criterion === criterion
                      }
                    />
                  );
                }),
                <div
                  key={`rate-${scenario}`}
                  className={`text-[10px] font-mono tabular-nums text-right flex items-center justify-end ${
                    rate >= 0.9 ? "text-emerald-400" : rate >= 0.7 ? "text-amber-400" : "text-rose-400"
                  }`}
                >
                  {Math.round(rate * 100)}%
                </div>,
              ])}

              {/* Footer row: per-criterion rates */}
              <div className="text-[8px] text-white/20 uppercase pt-1">Column %</div>
              {criterionRates.map(({ criterion, rate }) => (
                <div
                  key={`footer-${criterion}`}
                  className={`text-[9px] font-mono tabular-nums text-center pt-1 ${
                    rate >= 0.9 ? "text-emerald-400/60" : rate >= 0.7 ? "text-amber-400/60" : "text-rose-400/60"
                  }`}
                >
                  {Math.round(rate * 100)}
                </div>
              ))}
              <div />
            </div>
          </div>

          {/* Selected cell detail */}
          {selectedCell && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 space-y-1 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${selectedCell.pass ? "bg-emerald-400" : "bg-rose-400"}`}
                />
                <span className="text-xs font-semibold text-white/70">
                  {selectedCell.scenario.replace(/_/g, " ")} × {selectedCell.criterion}
                </span>
                <span className={`text-[10px] font-bold ${selectedCell.pass ? "text-emerald-400" : "text-rose-400"}`}>
                  {selectedCell.pass ? "PASS" : "FAIL"}
                </span>
              </div>
              {selectedCell.reasoning && (
                <p className="text-[11px] text-white/40 pl-4">{selectedCell.reasoning}</p>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className="text-[10px] text-white/15 text-right">
            {new Date(data.timestamp).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
});

/* ─── Demo data factory ────────────────────────────────────────────────────── */

export function createDemoJudgeHeatmapData(): JudgeHeatmapData {
  const scenarios = [
    "weekly_reset", "company_search", "competitor", "multi_entity",
    "pre_delegation", "important_change", "role_specific", "edge_case",
  ];
  const criteria = [
    "RELEVANT_ENTITY", "USEFUL_ANSWER", "ACTIONABLE_SIGNALS",
    "RISK_AWARENESS", "NEXT_STEPS", "ROLE_APPROPRIATE", "NO_HALLUCINATION",
  ];

  const cells: JudgeCell[] = [];
  for (const scenario of scenarios) {
    for (const criterion of criteria) {
      // Simulate realistic pass patterns
      const isEdge = scenario === "edge_case";
      const isHard = scenario === "multi_entity" || scenario === "competitor";
      const baseProb = isEdge ? 0.6 : isHard ? 0.75 : 0.9;
      const criterionPenalty =
        criterion === "RISK_AWARENESS" ? -0.15 :
        criterion === "ROLE_APPROPRIATE" ? -0.1 : 0;

      const pass = Math.random() < baseProb + criterionPenalty;
      cells.push({
        scenario,
        criterion,
        pass,
        reasoning: pass
          ? "Response addresses the criterion adequately"
          : `Missing ${criterion.toLowerCase().replace(/_/g, " ")} for ${scenario.replace(/_/g, " ")} queries`,
        score: pass ? Math.floor(75 + Math.random() * 25) : Math.floor(20 + Math.random() * 40),
      });
    }
  }

  const passCount = cells.filter((c) => c.pass).length;

  return {
    scenarios,
    criteria,
    cells,
    overallPassRate: passCount / cells.length,
    totalQueries: 53,
    judgeModel: "gemini-3.1-flash-lite-preview",
    timestamp: new Date().toISOString(),
  };
}

export default JudgeHeatmap;

/**
 * CostWaterfall — Visual breakdown of where compute spend goes.
 *
 * Horizontal stacked bars showing cost per tool category.
 * Gives instant visibility into: "research tools cost 60% but deliver 90% of value."
 */

import { memo } from "react";
import { DollarSign } from "lucide-react";
import type { ToolAggregate } from "./useLiveTelemetry";

export interface CostWaterfallProps {
  tools: ToolAggregate[];
  totalCost: number;
  className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "deep-sim": "bg-violet-500/70",
  trajectory: "bg-cyan-500/70",
  missions: "bg-orange-500/70",
  research: "bg-blue-500/70",
  verification: "bg-emerald-500/70",
  agents: "bg-pink-500/70",
  session: "bg-slate-500/70",
  mcp: "bg-indigo-500/70",
  git: "bg-teal-500/70",
  proof: "bg-amber-500/70",
  pipeline: "bg-sky-500/70",
  founder: "bg-orange-400/70",
  general: "bg-zinc-500/70",
};

export const CostWaterfall = memo(function CostWaterfall({
  tools,
  totalCost,
  className = "",
}: CostWaterfallProps) {
  // Aggregate by category
  const byCat = new Map<string, { cost: number; calls: number; avgMs: number }>();
  for (const t of tools) {
    const existing = byCat.get(t.category) ?? { cost: 0, calls: 0, avgMs: 0 };
    existing.cost += t.totalCostUsd;
    existing.calls += t.calls;
    existing.avgMs += t.avgMs * t.calls;
    byCat.set(t.category, existing);
  }

  const categories = Array.from(byCat.entries())
    .map(([cat, data]) => ({
      category: cat,
      cost: data.cost,
      calls: data.calls,
      avgMs: data.calls > 0 ? Math.round(data.avgMs / data.calls) : 0,
      pct: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/[0.04]">
        <DollarSign className="h-4 w-4 text-[#d97757]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 flex-1">
          Cost Waterfall
        </span>
        <span className="font-mono text-sm font-bold text-white/70 tabular-nums">
          ${totalCost.toFixed(2)}
        </span>
      </div>

      <div className="px-5 py-4 space-y-2">
        {/* Stacked bar */}
        <div className="flex h-6 rounded-full overflow-hidden bg-white/[0.04]">
          {categories.map((cat) => (
            <div
              key={cat.category}
              className={`${CATEGORY_COLORS[cat.category] ?? "bg-zinc-500/70"} transition-all`}
              style={{ width: `${Math.max(cat.pct, 1)}%` }}
              title={`${cat.category}: $${cat.cost.toFixed(2)} (${Math.round(cat.pct)}%)`}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="space-y-1.5 mt-3">
          {categories.slice(0, 8).map((cat) => (
            <div key={cat.category} className="flex items-center gap-2">
              <div
                className={`h-2.5 w-2.5 rounded-sm shrink-0 ${CATEGORY_COLORS[cat.category] ?? "bg-zinc-500/70"}`}
              />
              <span className="text-[10px] text-white/50 w-20 truncate">{cat.category}</span>
              <div className="flex-1 h-px bg-white/[0.04]" />
              <span className="text-[10px] font-mono tabular-nums text-white/40 w-10 text-right">
                {cat.calls}×
              </span>
              <span className="text-[10px] font-mono tabular-nums text-white/60 w-14 text-right">
                ${cat.cost.toFixed(2)}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-white/30 w-10 text-right">
                {Math.round(cat.pct)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default CostWaterfall;

/**
 * SavingsDashboard — Shows the ROI of using NodeBench.
 *
 * Tracks per-session and cumulative:
 * - Cache hits (searches that cost $0 because result was cached)
 * - Token/cost savings from depth chaining vs flat search
 * - Time saved (cached results return instantly vs 90s deep search)
 * - Nudge value (how many times NodeBench caught something the user would have missed)
 */

import { memo } from "react";
import { DollarSign, Clock, Database, Zap, TrendingUp } from "lucide-react";

// Demo data — populated from Convex searchSessions + value-manifest when connected
const DEMO_SAVINGS = {
  totalSearches: 12,
  cacheHits: 4,
  cacheHitRate: 33,
  totalCostUsd: 1.68,
  savedByCacheUsd: 0.56,
  avgSearchTimeSec: 72,
  instantCachedSec: 0.1,
  timeSavedMin: 4.8,
  nudgesDelivered: 8,
  nudgesActedOn: 5,
  remediationsCompleted: 3,
  searchHistory: [
    { date: "Apr 4", entity: "NodeBench AI", cost: 0.14, cached: false, confidence: 50 },
    { date: "Apr 4", entity: "NodeBench AI", cost: 0.14, cached: false, confidence: 85 },
    { date: "Apr 5", entity: "Tests Assured", cost: 0.14, cached: false, confidence: 85 },
    { date: "Apr 5", entity: "Anthropic", cost: 0.14, cached: false, confidence: 85 },
    { date: "Apr 5", entity: "Stripe", cost: 0.14, cached: false, confidence: 85 },
    { date: "Apr 6", entity: "NodeBench AI", cost: 0, cached: true, confidence: 85 },
    { date: "Apr 6", entity: "Anthropic", cost: 0, cached: true, confidence: 85 },
    { date: "Apr 6", entity: "Stripe", cost: 0, cached: true, confidence: 85 },
  ],
};

export const SavingsDashboard = memo(function SavingsDashboard() {
  const d = DEMO_SAVINGS;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">
          NodeBench Savings
        </div>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          demo data
        </span>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Database} label="Cache Hit Rate" value={`${d.cacheHitRate}%`} sublabel={`${d.cacheHits}/${d.totalSearches} searches`} color="text-emerald-400" />
        <StatCard icon={DollarSign} label="Cost Saved" value={`$${d.savedByCacheUsd.toFixed(2)}`} sublabel={`of $${d.totalCostUsd.toFixed(2)} total`} color="text-emerald-400" />
        <StatCard icon={Clock} label="Time Saved" value={`${d.timeSavedMin.toFixed(1)}m`} sublabel={`${d.cacheHits} instant results`} color="text-blue-400" />
        <StatCard icon={Zap} label="Nudges → Actions" value={`${d.nudgesActedOn}/${d.nudgesDelivered}`} sublabel={`${d.remediationsCompleted} gaps fixed`} color="text-[#d97757]" />
      </div>

      {/* Cost Breakdown */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted mb-3">
          Cost per Search Type
        </div>
        <div className="flex flex-col gap-2">
          <CostBar label="Deep diligence (6 branches × 3 depth)" cost={0.14} maxCost={0.14} color="bg-[#d97757]" />
          <CostBar label="Quick search (1 pass)" cost={0.02} maxCost={0.14} color="bg-blue-500" />
          <CostBar label="Cached result" cost={0} maxCost={0.14} color="bg-emerald-500" />
        </div>
        <div className="mt-3 text-[10px] text-content-muted">
          At 100 searches/day: $14/day without cache → $9.38/day with 33% cache = $4.62/day saved
        </div>
      </div>

      {/* Search History */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-content-muted mb-2">
          Recent Searches
        </div>
        <div className="flex flex-col gap-1">
          {d.searchHistory.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-12 tabular-nums text-content-muted">{s.date}</span>
              <span className="flex-1 text-content-secondary">{s.entity}</span>
              {s.cached ? (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                  CACHED
                </span>
              ) : (
                <span className="tabular-nums text-content-muted">${s.cost.toFixed(2)}</span>
              )}
              <span className="w-10 text-right tabular-nums text-content-muted">{s.confidence}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Projection */}
      <div className="rounded-xl border border-[#d97757]/20 bg-[#d97757]/5 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#d97757]">
          Projected Monthly Savings
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] text-content-muted">10 searches/day</div>
            <div className="text-sm font-bold text-content">$14/mo saved</div>
          </div>
          <div>
            <div className="text-[10px] text-content-muted">100 searches/day</div>
            <div className="text-sm font-bold text-content">$140/mo saved</div>
          </div>
          <div>
            <div className="text-[10px] text-content-muted">1000 searches/day</div>
            <div className="text-sm font-bold text-emerald-400">$1,400/mo saved</div>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-content-muted">
          Based on 33% cache hit rate. Higher with popular entity searches.
        </div>
      </div>
    </div>
  );
});

function StatCard({ icon: Icon, label, value, sublabel, color }: {
  icon: typeof DollarSign; label: string; value: string; sublabel: string; color: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-content-muted">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-content-muted">{sublabel}</div>
    </div>
  );
}

function CostBar({ label, cost, maxCost, color }: { label: string; cost: number; maxCost: number; color: string }) {
  const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-content-secondary">{label}</span>
        <span className="tabular-nums text-content-muted">{cost === 0 ? "FREE" : `$${cost.toFixed(2)}`}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-white/[0.04]">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}

export default SavingsDashboard;

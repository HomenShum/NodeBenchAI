/**
 * ImprovementTimeline — Visualizes ALL improvements made via retention/attrition.
 *
 * Shows: summary cards, quality trend (recharts), cumulative savings (recharts),
 * improvement events timeline with drill-down, replay adoption, promotion funnel.
 *
 * First use of recharts in the NodeBench codebase.
 */

import { memo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Archive,
  RefreshCw,
  Zap,
  Star,
  DollarSign,
  TrendingUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useImprovementData, type TimelineEvent } from "../hooks/useImprovementData";

// ── Constants ────────────────────────────────────────────────────────

const AXIS_STYLE = { fontSize: 10, fill: "rgba(255,255,255,0.4)" };
const GRID_STYLE = { stroke: "rgba(255,255,255,0.04)" };

const EVENT_COLORS: Record<TimelineEvent["type"], string> = {
  trajectory_recorded: "bg-blue-500",
  replay_success: "bg-emerald-500",
  eval_improvement: "bg-emerald-400",
  eval_regression: "bg-rose-400",
  archive_promotion: "bg-[#d97757]",
};

function fmtDate(ts: string) {
  try { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  catch { return ts; }
}

const EVENT_LABELS: Record<TimelineEvent["type"], string> = {
  trajectory_recorded: "Trajectory",
  replay_success: "Replay",
  eval_improvement: "Quality Up",
  eval_regression: "Quality Down",
  archive_promotion: "Promoted",
};

// ── Stat Card ────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub }: {
  icon: typeof Archive;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-content-muted" />
        <span className="text-[10px] uppercase tracking-[0.16em] text-content-muted">{label}</span>
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums text-content">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-content-muted">{sub}</div>}
    </div>
  );
}

// ── Custom Tooltip ───────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/[0.1] bg-[#1a1918] px-3 py-2 text-xs shadow-lg">
      <div className="text-content-muted">{label}</div>
      {payload.map((entry: any) => (
        <div key={entry.name} className="mt-1 font-medium" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}
          {entry.name.includes("%") || entry.name.includes("Quality") ? "%" : ""}
        </div>
      ))}
    </div>
  );
}

// ── Timeline Event Card ──────────────────────────────────────────────

function EventCard({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = EVENT_COLORS[event.type];
  const label = EVENT_LABELS[event.type];
  const hasDetail = event.details.toolsCalled?.length || event.details.scoreComponents?.length || event.details.suggestions?.length;
  const dateStr = new Date(event.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div role="listitem" className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Type badge */}
        <div className="mt-1 flex flex-col items-center gap-1">
          <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
          <span className="text-[9px] text-content-muted">{label}</span>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-content truncate">
              {event.entityName ?? event.details.query?.slice(0, 40) ?? "Unknown"}
            </span>
            {event.classification && (
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-content-muted">
                {event.classification}
              </span>
            )}
          </div>

          {/* Delta metrics */}
          <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
            {event.delta.qualityDelta !== undefined && event.delta.qualityDelta !== 0 && (
              <span className={event.delta.qualityDelta > 0 ? "text-emerald-400" : "text-rose-400"}>
                {event.delta.qualityDelta > 0 ? "+" : ""}{(event.delta.qualityDelta * 100).toFixed(1)}% quality
              </span>
            )}
            {event.delta.tokensSavedPct !== undefined && event.delta.tokensSavedPct > 0 && (
              <span className="text-emerald-400">{event.delta.tokensSavedPct.toFixed(0)}% tokens saved</span>
            )}
            {event.delta.timeSavedMs !== undefined && event.delta.timeSavedMs > 0 && (
              <span className="text-emerald-400">{(event.delta.timeSavedMs / 1000).toFixed(1)}s faster</span>
            )}
            {event.details.sourcesCited !== undefined && (
              <span className="text-content-muted">{event.details.sourcesCited} sources</span>
            )}
          </div>
        </div>

        {/* Timestamp + expand indicator */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-content-muted/50">{dateStr}</span>
          {hasDetail && (expanded ? <ChevronDown className="h-3 w-3 text-content-muted" /> : <ChevronRight className="h-3 w-3 text-content-muted" />)}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 border-t border-white/[0.06] pt-3 space-y-2">
          {event.details.query && (
            <div className="text-[11px] text-content-muted">
              <span className="text-content-muted/50">Query: </span>{event.details.query}
            </div>
          )}

          {event.details.toolsCalled && event.details.toolsCalled.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-content-muted/50 mr-1">Tools:</span>
              {event.details.toolsCalled.map((tool) => (
                <span key={tool} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-content-muted">
                  {tool}
                </span>
              ))}
            </div>
          )}

          {event.details.scoreComponents && event.details.scoreComponents.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-content-muted/50">Score breakdown:</span>
              {event.details.scoreComponents.map((sc) => (
                <div key={sc.key} className="flex items-center gap-2">
                  <div className="h-1.5 rounded-full bg-emerald-500/30" style={{ width: `${Math.max(4, sc.weightedContribution * 400)}px` }} />
                  <span className="text-[10px] text-content-muted">{sc.label}: {(sc.weightedContribution * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}

          {event.details.suggestions && event.details.suggestions.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-content-muted/50">Suggestions:</span>
              {event.details.suggestions.map((s, i) => (
                <div key={i} className="text-[11px] text-amber-300/80">- {s}</div>
              ))}
            </div>
          )}

          {event.details.driftScore !== undefined && (
            <div className="text-[10px] text-content-muted">
              Drift: {(event.details.driftScore * 100).toFixed(0)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Funnel Bar ───────────────────────────────────────────────────────

function FunnelBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-right text-[11px] text-content-muted">{label}</span>
      <div className="flex-1 h-5 rounded bg-white/[0.04] overflow-hidden">
        <div className={`h-full rounded ${color} transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="w-8 text-right text-[12px] font-semibold tabular-nums text-content">{count}</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export const ImprovementTimeline = memo(function ImprovementTimeline() {
  const { data, loading, error, refresh } = useImprovementData();

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-white/[0.03]" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
        <div className="text-sm text-content-muted">
          {error ? `Failed to load: ${error}` : "No improvement data available yet."}
        </div>
        <p className="mt-2 text-xs text-content-muted/60">
          Run a search via the Ask surface to start recording trajectories and evaluations.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-content-secondary transition hover:bg-white/[0.06]"
        >
          <RefreshCw className="h-3 w-3" />Retry
        </button>
      </div>
    );
  }

  const { summary, timeline, qualityCurve, savingsCurve, replayAdoption, promotionFunnel } = data;
  const funnelMax = Math.max(promotionFunnel.candidates, promotionFunnel.validated, promotionFunnel.promoted, 1);

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
          Improvement Timeline
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-content-muted transition hover:bg-white/[0.06]"
        >
          <RefreshCw className="h-3 w-3" />Refresh
        </button>
      </div>

      {/* ── Section 1: Summary Cards ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Archive} label="Trajectories" value={summary.totalTrajectories} />
        <StatCard icon={RefreshCw} label="Replays" value={summary.totalReplays} />
        <StatCard icon={Zap} label="Token Savings" value={`${summary.avgTokenSavingsPct}%`} sub="avg per replay" />
        <StatCard icon={Star} label="Avg Quality" value={`${(summary.avgQualityScore * 100).toFixed(0)}%`} />
        <StatCard icon={DollarSign} label="Cost Saved" value={`$${summary.estimatedCostSavedUsd.toFixed(2)}`} />
        <StatCard icon={TrendingUp} label="Promoted" value={summary.promotedCount} sub={`of ${summary.archiveTotal} archive`} />
      </div>

      {/* ── Section 2: Charts ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Quality trend */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-content-muted mb-3">Quality Trend</div>
          {qualityCurve.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={qualityCurve}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="timestamp" tickFormatter={fmtDate} tick={AXIS_STYLE} />
                <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} tick={AXIS_STYLE} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="avgQuality" name="Quality" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[180px] items-center justify-center text-xs text-content-muted/50">
              Needs 2+ evaluations to show trend
            </div>
          )}
        </div>

        {/* Cumulative savings */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-content-muted mb-3">Cumulative Savings</div>
          {savingsCurve.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={savingsCurve}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="timestamp" tickFormatter={fmtDate} tick={AXIS_STYLE} />
                <YAxis tickFormatter={(v: number) => `${v}`} tick={AXIS_STYLE} width={35} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="cumulativeReplays" name="Replays" stroke="#d97757" fill="#d97757" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[180px] items-center justify-center text-xs text-content-muted/50">
              Needs 2+ trajectories to show curve
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Improvement Events Timeline ──────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-content-muted mb-3">
          Improvement Events ({timeline.length})
        </div>
        {timeline.length > 0 ? (
          <div role="list" className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {timeline.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-content-muted/50">
            No improvement events recorded yet. Run searches to populate.
          </div>
        )}
      </div>

      {/* ── Section 4: Replay Adoption + Promotion Funnel ───────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Replay adoption */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-content-muted mb-3">Replay Adoption</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-emerald-400">
              {replayAdoption.replayPct.toFixed(1)}%
            </span>
            <span className="text-xs text-content-muted">of searches use replay</span>
          </div>
          <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-l-full bg-emerald-500/40 transition-all"
              style={{ width: `${replayAdoption.replayPct}%` }}
            />
            <div
              className="h-full bg-white/[0.06]"
              style={{ width: `${100 - replayAdoption.replayPct}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-content-muted">
            <span>Replayed: {replayAdoption.replayed}</span>
            <span>Full pipeline: {replayAdoption.fullPipeline}</span>
          </div>
        </div>

        {/* Promotion funnel */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-content-muted mb-3">Promotion Funnel</div>
          <div className="space-y-2">
            <FunnelBar label="Candidates" count={promotionFunnel.candidates} max={funnelMax} color="bg-white/[0.1]" />
            <FunnelBar label="Validated" count={promotionFunnel.validated} max={funnelMax} color="bg-amber-500/30" />
            <FunnelBar label="Promoted" count={promotionFunnel.promoted} max={funnelMax} color="bg-emerald-500/30" />
            <FunnelBar label="Retired" count={promotionFunnel.retired} max={funnelMax} color="bg-rose-500/20" />
          </div>
        </div>
      </div>
    </div>
  );
});

export default ImprovementTimeline;

/**
 * ContextInspector — 3-tier context injection state visualization.
 *
 * Shows the pinned / injected / archival context tiers from the NodeBench
 * context injection middleware. Lets devs and users see exactly what context
 * is feeding each query.
 *
 * - Pinned: mission, wedge, confidence %, contradictions, last packet
 * - Injected: weekly reset, milestones, entity signals, dogfood verdict
 * - Archival: total actions, milestones, retrieval tools available
 * - Token budget indicator with progress bar
 * - Refreshable — re-fetches context bundle on click
 */

import { memo, useCallback, useState } from "react";
import {
  Archive,
  Database,
  Layers,
  Pin,
  RefreshCw,
  Zap,
} from "lucide-react";
import type { ContextBundle } from "./types";

/* ─── Token budget bar ───────────────────────────────────────────────────── */

function TokenBudgetBar({
  used,
  total,
}: {
  used: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color =
    pct < 60
      ? "from-emerald-500 to-emerald-400"
      : pct < 85
        ? "from-amber-500 to-amber-400"
        : "from-rose-500 to-rose-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-white/40">Token Budget</span>
        <span className="font-mono tabular-nums text-white/60">
          {used.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ─── Tier card shell ────────────────────────────────────────────────────── */

function TierCard({
  icon: Icon,
  title,
  tokenCount,
  children,
  accentClass = "text-white/40",
}: {
  icon: React.ElementType;
  title: string;
  tokenCount: number;
  children: React.ReactNode;
  accentClass?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.04]">
        <Icon className={`h-3.5 w-3.5 ${accentClass}`} aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 flex-1">
          {title}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-white/25">
          ~{tokenCount} tok
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

/* ─── Key-value row ──────────────────────────────────────────────────────── */

function KVRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-[10px] uppercase tracking-[0.15em] text-white/25 w-28 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-xs text-white/70 min-w-0">{value}</span>
    </div>
  );
}

/* ─── Confidence badge ───────────────────────────────────────────────────── */

function ConfidenceIndicator({ value }: { value: number }) {
  const color =
    value >= 75
      ? "text-emerald-400 bg-emerald-500/10"
      : value >= 50
        ? "text-amber-400 bg-amber-500/10"
        : "text-rose-400 bg-rose-500/10";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value}%
    </span>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export interface ContextInspectorProps {
  data: ContextBundle;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

export const ContextInspector = memo(function ContextInspector({
  data,
  onRefresh,
  isRefreshing = false,
  className = "",
}: ContextInspectorProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[#d97757]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
            Context Injection State
          </h3>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/60 disabled:opacity-40"
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        )}
      </div>

      {/* Token budget */}
      <TokenBudgetBar used={data.tokenBudgetUsed} total={data.totalTokenBudget} />

      {/* Tier 1: Pinned */}
      <TierCard
        icon={Pin}
        title="Pinned Context"
        tokenCount={data.pinned.estimatedTokens}
        accentClass="text-[#d97757]"
      >
        <KVRow label="Mission" value={data.pinned.canonicalMission || "Not set"} />
        <KVRow label="Wedge" value={data.pinned.wedge || "Not set"} />
        <KVRow label="State" value={data.pinned.companyState || "Unknown"} />
        <KVRow
          label="Confidence"
          value={<ConfidenceIndicator value={data.pinned.identityConfidence} />}
        />
        <KVRow
          label="Contradictions"
          value={
            <span
              className={
                data.pinned.contradictionsCount > 0
                  ? "text-amber-400"
                  : "text-white/40"
              }
            >
              {data.pinned.contradictionsCount}
            </span>
          }
        />
        <KVRow
          label="Last Packet"
          value={
            data.pinned.lastPacketSummary ? (
              <span className="text-white/50 text-[11px]">
                {data.pinned.lastPacketSummary}
              </span>
            ) : (
              <span className="text-white/20 italic">None</span>
            )
          }
        />
      </TierCard>

      {/* Tier 2: Injected */}
      <TierCard
        icon={Zap}
        title="Injected Context"
        tokenCount={data.injected.estimatedTokens}
        accentClass="text-amber-400"
      >
        <KVRow
          label="Weekly Reset"
          value={
            data.injected.weeklyResetSummary ? (
              <span className="text-white/50 text-[11px]">
                {data.injected.weeklyResetSummary}
              </span>
            ) : (
              <span className="text-white/20 italic">Not available</span>
            )
          }
        />
        <KVRow
          label="Milestones"
          value={
            data.injected.recentMilestones.length > 0 ? (
              <div className="space-y-1">
                {data.injected.recentMilestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-white/20">
                      {new Date(m.timestamp).toLocaleDateString()}
                    </span>
                    <span className="text-[11px] text-white/50">{m.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-white/20 italic">None recent</span>
            )
          }
        />
        <KVRow
          label="Entity Signals"
          value={
            data.injected.entitySignals.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {data.injected.entitySignals.map((s, i) => (
                  <span
                    key={i}
                    className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-white/50"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-white/20 italic">None</span>
            )
          }
        />
        <KVRow
          label="Dogfood"
          value={
            data.injected.dogfoodVerdict ? (
              <span
                className={
                  data.injected.dogfoodVerdict.toLowerCase().includes("pass")
                    ? "text-emerald-400"
                    : "text-amber-400"
                }
              >
                {data.injected.dogfoodVerdict}
              </span>
            ) : (
              <span className="text-white/20 italic">Not run</span>
            )
          }
        />
      </TierCard>

      {/* Tier 3: Archival */}
      <TierCard
        icon={Archive}
        title="Archival Pointers"
        tokenCount={0}
        accentClass="text-zinc-400"
      >
        <KVRow
          label="Actions"
          value={
            <span className="font-mono tabular-nums">
              {data.archival.totalActions.toLocaleString()}
            </span>
          }
        />
        <KVRow
          label="Milestones"
          value={
            <span className="font-mono tabular-nums">
              {data.archival.totalMilestones.toLocaleString()}
            </span>
          }
        />
        <KVRow
          label="State Diffs"
          value={
            <span className="font-mono tabular-nums">
              {data.archival.totalStateDiffs.toLocaleString()}
            </span>
          }
        />
        <KVRow
          label="Oldest"
          value={
            data.archival.oldestActionDate
              ? new Date(data.archival.oldestActionDate).toLocaleDateString()
              : "N/A"
          }
        />
        <KVRow
          label="Retrieval Tools"
          value={
            data.archival.retrievalTools.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {data.archival.retrievalTools.map((t) => (
                  <span
                    key={t}
                    className="font-mono rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-[#d97757]/70"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-white/20 italic">None</span>
            )
          }
        />
      </TierCard>

      {/* Fetch timestamp */}
      <div className="text-[10px] text-white/15 text-right">
        Fetched {new Date(data.fetchedAt).toLocaleTimeString()}
      </div>
    </div>
  );
});

/* ─── Demo data factory ──────────────────────────────────────────────────── */

export function createDemoContextBundle(): ContextBundle {
  return {
    pinned: {
      canonicalMission:
        "Build the local-first operating-memory and entity-context layer for agent-native businesses",
      wedge: "Founder who needs a single search to produce a decision-grade packet",
      companyState: "Pre-revenue, building in public",
      identityConfidence: 88,
      lastPacketSummary:
        "Anthropic competitive position analysis — 82% confidence, 23 sources",
      contradictionsCount: 2,
      sessionActionsCount: 47,
      estimatedTokens: 185,
    },
    injected: {
      weeklyResetSummary:
        "Shipped search-first AI app redesign, 361 tools with lazy-loading, eval flywheel at 90% pass rate",
      recentMilestones: [
        { title: "Eval flywheel: 100% structural, 90% semantic", timestamp: new Date(Date.now() - 86_400_000).toISOString() },
        { title: "Search quality: 40% to 100%", timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString() },
        { title: "Progressive discovery with BFS depth 1-3", timestamp: new Date(Date.now() - 3 * 86_400_000).toISOString() },
      ],
      entitySignals: ["Anthropic", "Shopify", "NodeBench"],
      dogfoodVerdict: "13/13 scenarios pass",
      estimatedTokens: 210,
    },
    archival: {
      totalActions: 2847,
      totalMilestones: 34,
      totalStateDiffs: 156,
      oldestActionDate: "2025-01-15T00:00:00Z",
      retrievalTools: [
        "search_actions",
        "get_milestones",
        "get_state_history",
        "search_entities",
      ],
    },
    totalTokenBudget: 500,
    tokenBudgetUsed: 395,
    fetchedAt: new Date().toISOString(),
  };
}

export default ContextInspector;

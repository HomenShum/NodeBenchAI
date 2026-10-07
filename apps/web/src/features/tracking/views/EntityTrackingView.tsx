/**
 * EntityTrackingView — Persistent entity tracking surface.
 * Shows monitored entities with trajectory scores, slope-change detection,
 * and sparkline trend indicators.
 */

import { useMemo, useState } from "react";
import { Plus, ArrowUpRight, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { TrajectorySparkline } from "@/shared/ui/TrajectorySparkline";

// ─── Types ──────────────────────────────────────────────────────────────────

type EntityType = "Company" | "Product" | "Founder" | "Creator";

type TrajectoryLabel = "Compounding" | "Improving" | "Flat" | "Drifting";

interface TrackedEntity {
  id: string;
  name: string;
  type: EntityType;
  trajectory: TrajectoryLabel;
  score: number;
  sparklineData: number[];
  lastUpdated: string;
  keyVariable: string;
  keyVariableDirection: "up" | "down" | "flat";
}

interface Insight {
  id: string;
  type: "positive" | "warning" | "alert";
  text: string;
}

// ─── Demo fixtures ──────────────────────────────────────────────────────────

const DEMO_ENTITIES: TrackedEntity[] = [
  {
    id: "acme-ai",
    name: "Acme AI",
    type: "Company",
    trajectory: "Compounding",
    score: 82,
    sparklineData: [58, 62, 68, 72, 75, 79, 82],
    lastUpdated: "2 hours ago",
    keyVariable: "Revenue retention",
    keyVariableDirection: "up",
  },
  {
    id: "quantum-labs",
    name: "Quantum Labs",
    type: "Company",
    trajectory: "Improving",
    score: 67,
    sparklineData: [45, 48, 52, 55, 60, 63, 67],
    lastUpdated: "4 hours ago",
    keyVariable: "Hiring velocity",
    keyVariableDirection: "up",
  },
  {
    id: "sarah-chen",
    name: "Sarah Chen",
    type: "Founder",
    trajectory: "Compounding",
    score: 91,
    sparklineData: [74, 78, 82, 85, 87, 89, 91],
    lastUpdated: "1 hour ago",
    keyVariable: "Trust-node access",
    keyVariableDirection: "up",
  },
  {
    id: "devflow-pro",
    name: "DevFlow Pro",
    type: "Product",
    trajectory: "Flat",
    score: 48,
    sparklineData: [47, 49, 48, 47, 48, 49, 48],
    lastUpdated: "6 hours ago",
    keyVariable: "Churn rate",
    keyVariableDirection: "flat",
  },
  {
    id: "nightowl-studio",
    name: "NightOwl Studio",
    type: "Creator",
    trajectory: "Drifting",
    score: 33,
    sparklineData: [58, 54, 49, 45, 41, 37, 33],
    lastUpdated: "3 hours ago",
    keyVariable: "Audience engagement",
    keyVariableDirection: "down",
  },
];

const DEMO_INSIGHTS: Insight[] = [
  {
    id: "compounding",
    type: "positive",
    text: "2 entities are compounding \u2014 Acme AI and Sarah Chen show sustained improvement across 3+ variables",
  },
  {
    id: "attention",
    type: "warning",
    text: "1 entity needs attention \u2014 DevFlow Pro has been flat for 14 days, consider intervention",
  },
  {
    id: "slope-change",
    type: "alert",
    text: "1 slope change detected \u2014 NightOwl Studio shifted from Improving to Drifting this week",
  },
];

// ─── Color helpers ──────────────────────────────────────────────────────────

const TRAJECTORY_STYLES: Record<
  TrajectoryLabel,
  { bg: string; text: string; border: string; sparkColor: string }
> = {
  Compounding: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
    sparkColor: "#34d399",
  },
  Improving: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    border: "border-cyan-500/20",
    sparkColor: "#22d3ee",
  },
  Flat: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
    sparkColor: "#fbbf24",
  },
  Drifting: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/20",
    sparkColor: "#fb7185",
  },
};

const TYPE_STYLES: Record<EntityType, string> = {
  Company: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Product: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Founder: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Creator: "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

const DIRECTION_SYMBOL: Record<string, string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

const INSIGHT_ICON: Record<Insight["type"], React.ReactNode> = {
  positive: <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" />,
  warning: <Minus className="h-4 w-4 shrink-0 text-amber-400" />,
  alert: <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />,
};

const INSIGHT_BORDER: Record<Insight["type"], string> = {
  positive: "border-emerald-500/20",
  warning: "border-amber-500/20",
  alert: "border-rose-500/20",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function EntityTrackingView() {
  const [entities] = useState<TrackedEntity[]>(DEMO_ENTITIES);
  const [insights] = useState<Insight[]>(DEMO_INSIGHTS);

  const sorted = useMemo(
    () => [...entities].sort((a, b) => b.score - a.score),
    [entities],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
            Entity Tracking
          </p>
          <h1 className="text-2xl font-semibold text-content">Tracked Entities</h1>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-[#d97757] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#c4684a]"
          aria-label="Track new entity"
        >
          <Plus className="h-4 w-4" />
          Track new entity
        </button>
      </header>

      {/* ── Entity cards ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4" aria-label="Tracked entities list">
        {sorted.map((entity, idx) => {
          const tStyle = TRAJECTORY_STYLES[entity.trajectory];
          return (
            <article
              key={entity.id}
              className="group rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]"
              style={{
                animationDelay: `${idx * 60}ms`,
                animation: "fadeSlideUp 0.4s ease-out both",
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                {/* Left: name, badges, key variable */}
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-semibold text-content">{entity.name}</h2>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TYPE_STYLES[entity.type]}`}
                    >
                      {entity.type}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tStyle.bg} ${tStyle.text} ${tStyle.border}`}
                    >
                      {entity.trajectory}
                    </span>
                  </div>

                  <p className="text-sm text-content-secondary">
                    {entity.keyVariable}{" "}
                    <span className={tStyle.text}>
                      {DIRECTION_SYMBOL[entity.keyVariableDirection]}
                    </span>
                  </p>

                  <p className="mt-1.5 text-xs text-content-muted">
                    Updated {entity.lastUpdated}
                  </p>
                </div>

                {/* Right: score + sparkline + link */}
                <div className="flex items-center gap-5">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-2xl font-bold tabular-nums ${tStyle.text}`}>
                        {entity.score}
                      </span>
                      <span className="text-xs text-content-muted">/100</span>
                    </div>
                    <TrajectorySparkline
                      data={entity.sparklineData}
                      width={72}
                      height={24}
                      color={tStyle.sparkColor}
                    />
                  </div>

                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-white/[0.04] hover:text-content"
                    aria-label={`View analysis for ${entity.name}`}
                  >
                    View analysis
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* ── Insights ────────────────────────────────────────────────────── */}
      <section aria-label="Tracking insights">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-content-muted">
          Insights
        </p>
        <div className="flex flex-col gap-3">
          {insights.map((insight, idx) => (
            <div
              key={insight.id}
              className={`flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 ${INSIGHT_BORDER[insight.type]}`}
              style={{
                animationDelay: `${(sorted.length + idx) * 60 + 100}ms`,
                animation: "fadeSlideUp 0.4s ease-out both",
              }}
            >
              {INSIGHT_ICON[insight.type]}
              <p className="text-sm leading-relaxed text-content-secondary">{insight.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stagger animation keyframes */}
      <style>{`
        @keyframes fadeSlideUp {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes fadeSlideUp {
            from { opacity: 1; transform: none; }
            to { opacity: 1; transform: none; }
          }
        }
      `}</style>
    </div>
  );
}

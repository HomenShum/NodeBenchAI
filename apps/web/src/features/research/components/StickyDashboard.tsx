"use client";

import React, { useCallback, useMemo } from "react";
import NumberFlow from "@number-flow/react";
import { motion } from "framer-motion";
import { ShieldAlert, Code, Vote, Cpu, Activity, Zap, Brain, Lock, PieChart, CheckCircle2, Circle, Loader2, Clock } from "lucide-react";
import EnhancedLineChart, { type ChartDataPointContext } from "./EnhancedLineChart";
import type { DashboardState, MarketShareSegment } from "@/features/research/types";
import { formatBriefMonthYear } from "@/lib/briefDate";
import { useEvidence } from "../contexts/EvidenceContext";
import { DeltaIndicator } from "./DeltaIndicator";
import { useEngagementTracking } from "@/lib/hooks/useEngagementTracking";
import { normalizeSourceLabel } from "@/lib/displayText";
import { useMotionConfig } from '@/lib/motion';

export interface WorkflowStep {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
}

// Icon Mapping for capabilities
const IconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  hacking: ShieldAlert,
  coding: Code,
  politics: Vote,
  robotics: Cpu,
  forecasting: Activity,
  reasoning: Brain,
  uptime: Zap,
  safety: Lock,
};

const normalizeCapabilityScore = (score: number) => {
  if (!Number.isFinite(score)) return 0;
  const raw = score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(raw)));
};

const keyStatHints: Record<string, string> = {
  "AI Topics": "AI/ML articles in your feed",
  "Alert Rate": "Percentage of items mentioning outages",
  "Speed": "Estimated response time",
  "Reasoning": "Model reasoning score",
  "Avg Heat": "Average engagement score",
};

const getKeyStatHint = (label: string) => {
  if (!label) return null;
  const direct = keyStatHints[label];
  if (direct) return direct;
  const labelLower = label.toLowerCase();
  if (labelLower.includes("heat")) return "Average engagement score";
  if (labelLower.includes("reason")) return "Model reasoning score";
  return null;
};

const formatKeyStatValue = (label: string, value: unknown): string => {
  if (value === null || value === undefined) return "-";
  const labelLower = label.toLowerCase();
  const applyNumericFormat = (num: number) => {
    if (labelLower.includes("reason") || labelLower.includes("confidence") || labelLower.includes("score")) {
      const pct = num <= 1 ? num * 100 : num;
      return `${Math.round(pct)}%`;
    }
    if (labelLower.includes("heat")) return `${Math.round(num)} pts`;
    if (num > 0 && num < 1) return `${Math.round(num * 100)}%`;
    return `${Math.round(num)}`;
  };

  if (typeof value === "number" && Number.isFinite(value)) {
    return applyNumericFormat(value);
  }

  const raw = String(value).trim();
  if (!raw) return "-";
  const hasUnit = /[a-z%]/i.test(raw);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || hasUnit) return raw;
  return applyNumericFormat(numeric);
};

interface StickyDashboardProps {
  data: DashboardState;
  /** Callback for chart data point clicks (AI agent integration) */
  onDataPointClick?: (point: ChartDataPointContext) => void;
  activeAct?: "actI" | "actII" | "actIII";
  workflowSteps?: WorkflowStep[];
  /** Temporal deltas for "What Changed" indicators */
  deltas?: {
    keyStats: Array<{ label: string; delta: number }>;
    capabilities: Array<{ label: string; delta: number | null }>;
    techReadiness?: {
      existing: number | null;
      emerging: number | null;
      sciFi: number | null;
    } | null;
  } | null;
}

export const StickyDashboard: React.FC<StickyDashboardProps> = ({
  data,
  onDataPointClick,
  activeAct = "actI",
  workflowSteps = [],
  deltas
}) => {
  // Evidence context for chart ↔ evidence linking
  const evidenceCtx = useEvidence();

  // Engagement tracking
  const { trackClick } = useEngagementTracking({
    date: new Date().toISOString().split('T')[0],
    reportType: 'daily_brief',
    componentType: 'dashboard',
    sourceName: 'All Sources',
    autoTrackView: true,
    autoTrackTime: true,
  });

  // Wrap data point click to track engagement
  const handleDataPointClick = useCallback((point: ChartDataPointContext) => {
    // Track the click
    const evidenceId = point.linkedEvidenceIds?.[0];
    if (evidenceId) {
      trackClick(evidenceId);
    }

    // Call original handler
    onDataPointClick?.(point);
  }, [trackClick, onDataPointClick]);

  if (!data) return null;

  // Safe defaults
  const safeMeta = data.meta ?? { currentDate: "Jan 2025", timelineProgress: 0 };
  const safeCharts = {
    trendLine: data.charts?.trendLine,
    marketShare: data.charts?.marketShare ?? [],
  };
  const safeTech = data.techReadiness ?? { existing: 0, emerging: 0, sciFi: 0 };
  const capabilities = data.capabilities ?? [];
  const keyStats = data.keyStats ?? [];
  const agentCount = data.agentCount;

  // Build evidence map for tooltip display
  const evidenceList = evidenceCtx.getEvidenceList();
  const evidenceMap = useMemo(
    () => new Map(evidenceList.map((ev) => [ev.id, ev])),
    [evidenceList]
  );

  // Calculate top market share for the donut center
  const topShare = safeCharts.marketShare.length > 0
    ? safeCharts.marketShare.reduce((prev, current) => (prev.value > current.value ? prev : current))
    : { label: "N/A", value: 0, color: "gray" as const };
  const topShareLabel = normalizeSourceLabel(topShare.label, "Source mix");

  const monthYearLabel = formatBriefMonthYear(safeMeta.currentDate);
  const [monthLabel, yearLabel] = monthYearLabel.split(" ");

  return (
    <div className="w-full font-mono text-content select-none overflow-hidden">
      <div className="z-10 transition-all duration-500 shadow-none space-y-5">

        {/* --- ROW 1: HEADER & CHART --- */}
        <div className="mb-4">
          {/* Header row: date pill + time window (avoid overlapping the chart header) */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center bg-black text-white px-2 py-1 rounded-[4px] text-xs font-medium gap-2">
              <span>{monthLabel}</span>
              <span className="font-bold">{yearLabel || "2025"}</span>
            </div>
            <div className="text-[10px] text-content-muted flex items-center gap-2 pt-0.5">
              <span>{safeCharts.trendLine?.timeWindow ?? "Last 7 days"}</span>
              <span className="text-content-muted/60">·</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Updated today
              </span>
            </div>
          </div>

          {/* Line Chart (compact header; limit annotations to reduce label collisions) */}
          <div className="h-[170px] w-full mt-2">
            {safeCharts.trendLine ? (
              <EnhancedLineChart
                compact
                config={{
                  ...safeCharts.trendLine,
                  annotations: [],
                  timeWindow: safeCharts.trendLine.timeWindow ?? "Last 7 days",
                  yAxisUnit: safeCharts.trendLine.yAxisUnit ?? "%",
                  lastUpdated: "today",
                }}
                onEvidenceClick={evidenceCtx.scrollToEvidence}
                onDataPointClick={handleDataPointClick}
                evidenceMap={evidenceMap}
              />
            ) : (
              <div className="w-full h-full bg-surface-secondary rounded flex flex-col items-center justify-center gap-2">
                <Activity className="w-6 h-6 text-content-muted" />
                <span className="text-xs text-content-muted">Chart data updates daily</span>
              </div>
            )}
          </div>
        </div>

        {/* --- ROW 2: SPLIT GRID (Capabilities vs Donut) --- */}
        <div className="grid grid-cols-1 gap-4 mb-4 md:grid-cols-[minmax(0,1fr)_120px] md:items-start">
          {/* Capabilities */}
          <div className="flex flex-col justify-end">
            <div className="text-xs font-medium text-content-muted mb-2 border-b border-edge pb-1">
              AI Capabilities
            </div>
            <div className="grid grid-cols-2 gap-2">
              {capabilities.map((cap, i) => {
                const capDelta = deltas?.capabilities?.[i]?.delta;
                return (
                  <CapabilityBar
                    key={cap.label}
                    label={cap.label}
                    score={cap.score}
                    icon={cap.icon}
                    delta={capDelta ?? null}
                  />
                );
              })}
            </div>
          </div>

          {/* Market share + readiness */}
          <div className="flex flex-col justify-start">
            {/* Donut - Only render if we have data */}
            {safeCharts.marketShare.length > 0 ? (
              <div className="flex flex-col items-center justify-center relative h-28 mb-3 overflow-hidden rounded-2xl border border-edge/70 bg-surface-secondary/35 px-2 py-3">
                <DonutChart data={safeCharts.marketShare} />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-2">
                  <div className="flex min-w-[60px] flex-col items-center bg-surface/88 px-2 py-1.5">
                    <NumberFlow value={topShare.value} suffix="%" className="text-sm font-bold text-content leading-none" />
                    <span className="mt-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-content-muted">
                      Sources
                    </span>
                  </div>
                </div>
                <div className="mt-2 max-w-full px-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-content-secondary line-clamp-2">
                  {topShareLabel}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 mb-3 bg-surface-secondary rounded-2xl border border-edge/70">
                <PieChart className="w-6 h-6 text-content-muted mb-1" />
                <span className="text-xs text-content-muted">No share data</span>
              </div>
            )}

            {/* Tech Readiness Buckets */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[9px] tracking-normal text-content-muted px-0.5">
                <span>Now</span><span>Next</span><span>Future</span>
              </div>
              <div className="flex justify-between gap-1 h-8">
                <BucketColumn count={safeTech.existing} color="bg-content" delta={deltas?.techReadiness?.existing} />
                <BucketColumn count={safeTech.emerging} color="bg-indigo-500" delta={deltas?.techReadiness?.emerging} />
                <BucketColumn count={safeTech.sciFi} color="bg-surface-secondary" delta={deltas?.techReadiness?.sciFi} />
              </div>
            </div>
          </div>
        </div>

        {/* --- ROW 1: HEADER & ACT INDICATOR --- */}
        <div className="border-b border-edge pb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-2xl font-semibold text-content tracking-tight">
              Pulse
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-content-muted">
                {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
              <div className="w-1.5 h-1.5 rounded-full bg-content-muted motion-safe:animate-pulse" />
            </div>
          </div>

          {/* Minimalist Act Stepper */}
          <div className="flex items-center gap-3">
            {[
              { id: 'actI', label: 'Synthesis' },
              { id: 'actII', label: 'Briefing' },
              { id: 'actIII', label: 'Signals' }
            ].map((act, i) => (
              <React.Fragment key={act.id}>
                {i > 0 && <div className="w-8 h-px bg-surface-secondary" />}
                <div className={`flex items-center gap-2 transition-opacity duration-500 ${activeAct === act.id ? 'opacity-100' : 'opacity-50'
                  }`}>
                  <span className={`text-xs font-semibold text-content`}>
                    {act.label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
        {/* --- ROW 3: KEY STATS WITH DELTAS --- */}
        <div className="flex flex-wrap justify-between items-start gap-x-3 gap-y-2 border-t border-edge pt-3 mb-3 overflow-hidden">
          {keyStats.map((stat, i) => {
            const statDelta = deltas?.keyStats?.[i]?.delta;
            const statHint = getKeyStatHint(stat.label);
            const displayContext = stat.context ?? statHint;
            const displayValue = formatKeyStatValue(stat.label, stat.value);
            return (
              <div key={stat.label} className="flex flex-col min-w-0 max-w-[45%]">
                <span
                  className="text-[10px] text-content-secondary font-medium mb-0.5 truncate"
                  title={stat.label + (statHint ? ` - ${statHint}` : '')}
                >
                  {stat.label}
                </span>
                <div className="flex items-baseline gap-1 min-w-0">
                  <span className="text-sm font-bold text-content shrink-0">{displayValue}</span>
                  {statDelta !== undefined && statDelta !== null && statDelta !== 0 && (
                    <DeltaIndicator value={statDelta} size="sm" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* --- ROW 4: AGENT FOOTER --- */}
        <AgentFooter workflowSteps={workflowSteps} />
      </div>
    </div>
  );
};

// --- SUB-COMPONENTS ---

const CapabilityBar = ({ label, score, icon, delta }: { label: string, score: number, icon: string, delta?: number | null }) => {
  const { instant, transition } = useMotionConfig();
  return (
  <div className="flex flex-col gap-0.5 mb-3 group overflow-hidden">
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-[10px] text-content-secondary font-medium group-hover:text-content dark:group-hover:text-gray-100 transition-colors leading-none truncate min-w-0 flex-1">{label}</span>
      <span className="text-[10px] font-mono font-bold text-content shrink-0 tabular-nums whitespace-nowrap">{normalizeCapabilityScore(score)}%</span>
      {delta !== undefined && delta !== null && delta !== 0 && (
        <DeltaIndicator value={delta} unit="pts" />
      )}
    </div>
    <div className="h-1.5 w-full bg-surface-secondary dark:bg-white/[0.1] overflow-hidden rounded-full">
      <motion.div
        initial={{ width: instant ? `${normalizeCapabilityScore(score)}%` : 0 }}
        animate={{ width: `${normalizeCapabilityScore(score)}%` }}
        transition={transition({ duration: 1.5, ease: "easeOut" })}
        className="h-full bg-content dark:bg-surface rounded-full"
      />
    </div>
  </div>
  );
};

const BucketColumn = ({ count, color, delta }: { count: number, color: string, delta?: number | null }) => {
  // Map old colors to new theme
  const themeColor = color.includes('indigo') || color.includes('slate-900') ? 'bg-content dark:bg-surface' : 'bg-surface-hover dark:bg-gray-500';

  return (
    <div className="flex flex-col-reverse gap-[1px] w-full items-center group relative">
      {[...Array(6)].map((_, i) => (
        <div key={i} className={`w-full h-1 rounded-none ${i < count ? themeColor : "bg-surface-secondary"}`} />
      ))}
      {delta !== undefined && delta !== null && delta !== 0 && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
          <DeltaIndicator value={delta} unit="u" size="sm" />
        </div>
      )}
    </div>
  );
};

const DonutChart = ({ data }: { data: MarketShareSegment[] }) => {
  const { instant, transition } = useMotionConfig();
  const topValue = data[0]?.value || 0;
  const pathLength = Math.max(0, Math.min(1, topValue / 100));

  return (
    <div className="relative w-full h-full flex-shrink-0">
      <svg viewBox="0 0 100 100" className="transform -rotate-90 w-full h-full">
        <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="10" fill="none" className="text-[#E5E5E2] dark:text-white/[0.1]" />
        <motion.circle
          initial={{ pathLength: instant ? pathLength : 0 }}
          animate={{ pathLength }}
          transition={transition({ duration: 2, ease: "easeOut" })}
          cx="50"
          cy="50"
          r="40"
          stroke="currentColor"
          strokeWidth="10"
          fill="none"
          strokeDasharray="1 1"
          className="text-[#111827] dark:text-gray-100"
        />
      </svg>
    </div>
  );
};

const AgentFooter = ({ workflowSteps }: { workflowSteps: WorkflowStep[] }) => {
  const activeStep = workflowSteps.find(s => s.status === 'in_progress');
  const completedCount = workflowSteps.filter(s => s.status === 'completed').length;
  const totalCount = workflowSteps.length;
  const hasActivity = activeStep !== undefined || completedCount > 0;

  // Nothing to show — hide entirely rather than render dead space
  if (totalCount === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-edge">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="px-1.5 py-1 bg-content dark:bg-surface-secondary text-background dark:text-content text-xs font-medium">
            Research
          </div>
          <div className="text-xs font-mono text-content-secondary">
            {completedCount} of {totalCount} done
          </div>
        </div>
        {activeStep && (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 text-content-secondary motion-safe:animate-spin" />
            <span className="text-xs font-semibold text-content">Live</span>
          </div>
        )}
      </div>

      {/* Only render step list when there is something meaningful to show */}
      {hasActivity && (
        <div className="mt-3 space-y-2">
          {workflowSteps.slice(0, 3).map((step) => (
            <div key={step.name} className="flex items-center gap-3 group">
              <div className={`shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center border ${
                step.status === 'completed' ? 'bg-content dark:bg-surface-secondary border-content dark:border-edge' :
                step.status === 'in_progress' ? 'border-content dark:border-edge motion-safe:animate-pulse' :
                'border-edge dark:border-white/[0.2]'
              }`}>
                {step.status === 'completed' && <CheckCircle2 className="w-2.5 h-2.5 text-white dark:text-content" />}
                {step.status === 'in_progress' && <div className="w-1.5 h-1.5 bg-content dark:bg-surface-hover rounded-full" />}
              </div>
              <span className={`text-xs transition-colors ${
                step.status === 'completed' ? 'text-content-muted line-through' :
                step.status === 'in_progress' ? 'text-content font-bold' :
                'text-content-muted'
              }`}>
                {step.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeStep && (
        <div className="mt-3 p-3 bg-surface-secondary border border-edge dark:border-white/[0.08]">
          <p className="text-xs font-mono text-content-muted mb-1">Current Task</p>
          <p className="text-[12px] font-medium text-content italic">
            "{activeStep.name} in progress..."
          </p>
        </div>
      )}

      {/* Activity dots — only rendered when workflow is active */}
      {activeStep && (
        <div className="mt-3 flex gap-1">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 bg-content dark:bg-surface-secondary rounded-none ${
                i % 3 === 0 ? 'opacity-90' : i % 3 === 1 ? 'opacity-50' : 'opacity-25'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default StickyDashboard;

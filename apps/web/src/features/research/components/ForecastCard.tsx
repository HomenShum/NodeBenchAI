import React, { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Search,
  Wrench,
  FileOutput,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface ForecastCardProps {
  question: string;
  probability: number; // 0-1
  confidenceInterval?: { lower: number; upper: number };
  resolutionDate: string;
  topDrivers: string[];
  topCounterarguments: string[];
  updateCount: number;
  previousProbability?: number; // for delta display
  traceSteps?: string[]; // compact TRACE breadcrumb tool names
  status: "active" | "resolved" | "voided";
  outcome?: boolean; // true = YES, false = NO (for resolved)
  brierScore?: number; // individual Brier score (for resolved)
  evidenceTimeline?: Array<{
    date: string;
    title: string;
    direction: "supporting" | "disconfirming" | "neutral";
  }>;
  onExpandTrace?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACE ICON MAP — maps tool-name keywords to lucide icons
// ═══════════════════════════════════════════════════════════════════════════

const TRACE_ICON_MAP: Record<string, React.ElementType> = {
  search: Search,
  fetch: Search,
  query: Search,
  tool: Wrench,
  transform: Wrench,
  analyze: Wrench,
  output: FileOutput,
  report: FileOutput,
  export: FileOutput,
  flag: Flag,
  resolve: Flag,
};

function getTraceIcon(step: string): React.ElementType {
  const lower = step.toLowerCase();
  for (const [keyword, Icon] of Object.entries(TRACE_ICON_MAP)) {
    if (lower.includes(keyword)) return Icon;
  }
  return Wrench;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function deltaPp(current: number, previous: number): number {
  return Math.round((current - previous) * 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROBABILITY BAR (SVG)
// ═══════════════════════════════════════════════════════════════════════════

function ProbabilityBar({
  probability,
  confidenceInterval,
}: {
  probability: number;
  confidenceInterval?: { lower: number; upper: number };
}) {
  const fillPct = Math.max(0, Math.min(1, probability)) * 100;

  return (
    <svg
      width="100%"
      height="8"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      className="rounded-full overflow-hidden"
      role="img"
      aria-label={`Probability ${Math.round(fillPct)}%`}
    >
      <defs>
        <linearGradient id="prob-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#9333ea" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* Background track */}
      <rect x="0" y="0" width="100" height="8" rx="4" className="fill-surface-hover" />
      {/* Confidence interval range */}
      {confidenceInterval && (
        <rect
          x={confidenceInterval.lower * 100}
          y="0"
          width={(confidenceInterval.upper - confidenceInterval.lower) * 100}
          height="8"
          rx="4"
          className="fill-purple-200/50 dark:fill-purple-700/30"
        />
      )}
      {/* Filled portion with gradient */}
      <rect x="0" y="0" width={fillPct} height="8" rx="4" fill="url(#prob-gradient)" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DELTA BADGE
// ═══════════════════════════════════════════════════════════════════════════

function DeltaBadge({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const delta = deltaPp(current, previous);
  if (delta === 0) return null;

  const isPositive = delta > 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
        isPositive
          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
          : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700"
      )}
    >
      {isPositive ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      <span>
        was {pct(previous)}, {isPositive ? "+" : ""}
        {delta}pp today
      </span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE TIMELINE (collapsible)
// ═══════════════════════════════════════════════════════════════════════════

const DIRECTION_STYLES: Record<string, string> = {
  supporting: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  disconfirming: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  neutral: "bg-surface-secondary text-content-secondary",
};

const DIRECTION_DOT: Record<string, string> = {
  supporting: "bg-green-500",
  disconfirming: "bg-red-500",
  neutral: "bg-content-muted",
};

function EvidenceTimeline({
  items,
}: {
  items: NonNullable<ForecastCardProps["evidenceTimeline"]>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-content-secondary hover:text-content transition-colors"
      >
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
        Evidence timeline ({items.length})
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1.5 pl-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  "mt-1.5 w-1.5 h-1.5 rounded-full shrink-0",
                  DIRECTION_DOT[item.direction]
                )}
              />
              <span className="text-content-muted shrink-0 w-16">
                {item.date}
              </span>
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded text-xs font-medium shrink-0",
                  DIRECTION_STYLES[item.direction]
                )}
              >
                {item.direction}
              </span>
              <span className="text-content-secondary leading-snug">
                {item.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACE BREADCRUMB
// ═══════════════════════════════════════════════════════════════════════════

function TraceBreadcrumb({
  steps,
  onExpand,
}: {
  steps: string[];
  onExpand?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex items-center gap-1 text-xs text-content-muted hover:text-content-secondary transition-colors truncate"
    >
      <span className="font-medium text-content-secondary shrink-0">
        via:
      </span>
      {steps.map((step, i) => {
        const Icon = getTraceIcon(step);
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <span className="text-content-muted mx-0.5">
                {"\u2192"}
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 shrink-0">
              <Icon className="w-3 h-3" />
              <span>{step}</span>
            </span>
          </React.Fragment>
        );
      })}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FORECAST CARD
// ═══════════════════════════════════════════════════════════════════════════

export function ForecastCard({
  question,
  probability,
  confidenceInterval,
  resolutionDate,
  topDrivers,
  topCounterarguments,
  updateCount,
  previousProbability,
  traceSteps,
  status,
  outcome,
  brierScore,
  evidenceTimeline,
  onExpandTrace,
}: ForecastCardProps) {
  const isResolved = status === "resolved";
  const isVoided = status === "voided";

  return (
    <div
      className={cn(
        "relative rounded-lg border shadow-sm overflow-hidden transition-all duration-200",
        "border-edge/50 hover:shadow-md hover:border-primary/20",
        "bg-gradient-to-br from-surface to-surface-secondary/50",
        isVoided && "opacity-50"
      )}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-purple-600 via-indigo-500 to-blue-500" />

      <div className="pl-4 pr-4 py-4">
        {/* Header: status + resolution date + updates */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isResolved ? (
              outcome ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500" />
              )
            ) : (
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  status === "active"
                    ? "bg-blue-500 motion-safe:animate-pulse"
                    : "bg-content-muted"
                )}
              />
            )}
            <span
              className={cn(
                "text-xs font-semibold",
                isResolved
                  ? outcome
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                  : isVoided
                    ? "text-content-muted"
                    : "text-blue-600 dark:text-blue-400"
              )}
            >
              {isResolved
                ? outcome
                  ? "Resolved YES"
                  : "Resolved NO"
                : isVoided
                  ? "Voided"
                  : "Active"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-content-muted">
            <span>{resolutionDate}</span>
            <span className="px-1.5 py-0.5 rounded bg-surface-secondary font-medium">
              {updateCount} update{updateCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Question */}
        <h3 className="text-sm font-semibold text-content leading-snug mb-3">
          {question}
        </h3>

        {/* Probability + bar */}
        <div className="mb-3">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-2xl font-bold text-content tabular-nums">
              {pct(probability)}
            </span>
            {confidenceInterval && (
              <span className="text-xs text-content-muted">
                CI [{pct(confidenceInterval.lower)}&ndash;
                {pct(confidenceInterval.upper)}]
              </span>
            )}
            {previousProbability != null &&
              previousProbability !== probability && (
                <DeltaBadge
                  current={probability}
                  previous={previousProbability}
                />
              )}
          </div>
          <ProbabilityBar
            probability={probability}
            confidenceInterval={confidenceInterval}
          />
        </div>

        {/* Resolved: outcome + Brier score */}
        {isResolved && brierScore != null ? (
          <div className="flex items-center gap-3 mb-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border",
                outcome
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700"
                  : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700"
              )}
            >
              {outcome ? (
                <CheckCircle className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              Outcome: {outcome ? "YES" : "NO"}
            </span>
            <span className="text-xs text-content-secondary">
              Brier:{" "}
              <span className="font-mono font-semibold text-content-secondary">
                {brierScore.toFixed(3)}
              </span>
            </span>
          </div>
        ) : (
          <>
            {/* Drivers */}
            {topDrivers.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-content-muted mb-1">
                  Drivers
                </p>
                <ul className="space-y-0.5">
                  {topDrivers.map((d, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-xs text-content-secondary"
                    >
                      <TrendingUp className="w-3 h-3 mt-0.5 text-green-500 shrink-0" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Counterarguments */}
            {topCounterarguments.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-content-muted mb-1">
                  Counterarguments
                </p>
                <ul className="space-y-0.5">
                  {topCounterarguments.map((c, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-xs text-content-secondary"
                    >
                      <TrendingDown className="w-3 h-3 mt-0.5 text-red-500 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Evidence timeline */}
        {evidenceTimeline && evidenceTimeline.length > 0 && (
          <EvidenceTimeline items={evidenceTimeline} />
        )}

        {/* Trace breadcrumb */}
        {traceSteps && traceSteps.length > 0 && (
          <div className="mt-3 pt-2 border-t border-edge dark:border-edge">
            <TraceBreadcrumb steps={traceSteps} onExpand={onExpandTrace} />
          </div>
        )}
      </div>
    </div>
  );
}

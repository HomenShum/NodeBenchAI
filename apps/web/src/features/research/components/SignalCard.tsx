"use client";

/**
 * SignalCard Component
 *
 * Renders a single signal from Act II of the Daily Brief.
 * Features per north-star spec:
 * - Signal label (clean, human)
 * - Synthesis paragraph (2-4 sentences)
 * - What's new vs baseline (Δ metric)
 * - Evidence grid (2-6 cards)
 * - Optional micro-viz
 */

import React, { memo, useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb, LinkIcon, TrendingUp, Tag, BarChart2 } from "lucide-react";
import type { Signal } from "../types/dailyBriefSchema";
import { EvidenceGrid } from "./EvidenceGrid";

// ═══════════════════════════════════════════════════════════════════════════
// DELTA BADGE - Shows what's new vs baseline
// ═══════════════════════════════════════════════════════════════════════════

interface DeltaBadgeProps {
  deltaSummary: string;
}

function DeltaBadge({ deltaSummary }: DeltaBadgeProps) {
  // Try to detect positive/negative delta from text
  const isPositive = deltaSummary.includes("+") || deltaSummary.toLowerCase().includes("up")
    || deltaSummary.toLowerCase().includes("increase");
  const isNegative = deltaSummary.includes("-") || deltaSummary.toLowerCase().includes("down")
    || deltaSummary.toLowerCase().includes("decrease");

  const colorClass = "bg-surface-secondary text-content-secondary border-edge";

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
      <TrendingUp className="w-3 h-3" />
      <span>{deltaSummary}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL CARD
// ═══════════════════════════════════════════════════════════════════════════

interface SignalCardProps {
  signal: Signal;
  index: number;
  defaultExpanded?: boolean;
  onSignalClick?: (signal: Signal) => void;
  /** Show micro-viz placeholder if signal has vizArtifactId */
  showMicroViz?: boolean;
}

export const SignalCard = memo(function SignalCard({
  signal,
  index,
  defaultExpanded = true,
  onSignalClick,
  showMicroViz = false,
}: SignalCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const evidenceCount = signal.evidence?.length || 0;
  const signalLabel = signal.label || `Signal ${index + 1}`;

  return (
    <div
      className="group relative bg-surface border border-edge rounded-lg overflow-hidden
                 hover:shadow-md hover:border-primary/20 transition-all duration-200"
    >
      {/* Left Accent Border */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[var(--accent-primary)]" />

      {/* Header - Always Visible */}
      <button
        type="button"
        onClick={() => {
          setIsExpanded(!isExpanded);
          onSignalClick?.(signal);
        }}
        className="w-full text-left pl-5 pr-4 py-4 flex items-start gap-3"
        aria-expanded={isExpanded}
      >
        {/* Signal Number */}
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-secondary dark:bg-white/[0.08] text-content-secondary
                        flex items-center justify-center text-xs font-semibold mt-0.5">
          {index + 1}
        </div>

        {/* Headline + Meta */}
        <div className="flex-1 min-w-0">
          {/* Signal Label */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-content-secondary bg-surface-secondary px-2 py-0.5 rounded-full flex items-center gap-1">
              <Tag className="w-2.5 h-2.5" />
              {signalLabel}
            </span>
            {signal.vizArtifactId && showMicroViz && (
              <span className="text-xs text-content-muted flex items-center gap-1">
                <BarChart2 className="w-2.5 h-2.5" />
                Chart
              </span>
            )}
          </div>

          {/* Headline */}
          <h3 className="text-base font-semibold text-content leading-snug group-hover:text-content transition-colors">
            {signal.headline}
          </h3>

          {/* Meta Row */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-xs font-medium text-content-secondary flex items-center gap-1">
              <LinkIcon className="w-3 h-3" />
              {evidenceCount} source{evidenceCount !== 1 ? "s" : ""}
            </span>
            {signal.relatedSignalIds && signal.relatedSignalIds.length > 0 && (
              <span className="text-xs text-content-secondary bg-surface-secondary px-1.5 py-0.5 rounded">
                Links to {signal.relatedSignalIds.length} signal{signal.relatedSignalIds.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Expand Toggle */}
        <div className="flex-shrink-0 text-content-secondary group-hover:text-content transition-colors">
          {isExpanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* Delta Summary - What's new vs baseline */}
          {signal.deltaSummary && (
            <DeltaBadge deltaSummary={signal.deltaSummary} />
          )}

          {/* Synthesis Prose */}
          <div className="prose prose-sm prose-slate max-w-none">
            <p className="text-content leading-relaxed">
              {signal.synthesis}
            </p>
          </div>

          {/* Evidence Grid */}
          <EvidenceGrid evidence={signal.evidence || []} />
        </div>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL LIST (renders multiple signals)
// ═══════════════════════════════════════════════════════════════════════════

interface SignalListProps {
  signals: Signal[];
  onSignalClick?: (signal: Signal) => void;
  className?: string;
}

export function SignalList({ signals, onSignalClick, className = "" }: SignalListProps) {
  if (!signals || signals.length === 0) {
    return (
      <div className="text-center py-12 text-content-secondary">
        <div className="w-14 h-14 bg-surface-secondary rounded-lg flex items-center justify-center mx-auto mb-4">
          <Lightbulb className="w-7 h-7 text-content-muted" />
        </div>
        <h3 className="text-base font-semibold text-content mb-1">No signals yet</h3>
        <p className="text-sm text-content-secondary max-w-xs mx-auto mb-3">
          Search for a company or topic to start tracking signals. They refresh automatically.
        </p>
        <code className="inline-block rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs text-content-muted font-mono">
          Try: &quot;Anthropic competitive position&quot;
        </code>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {signals.map((signal, idx) => (
        <SignalCard
          key={signal.id || idx}
          signal={signal}
          index={idx}
          defaultExpanded={idx === 0} // Only first signal expanded by default
          onSignalClick={onSignalClick}
        />
      ))}
    </div>
  );
}

export default SignalCard;


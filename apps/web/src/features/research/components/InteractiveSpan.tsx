"use client";

import React, { useCallback, useRef, useEffect, useId } from "react";
import { Info, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { useFocusSync, useSpanHover } from "../contexts/FocusSyncContext";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface InteractiveSpanProps {
  /** Unique ID for this span (used for focus sync) */
  spanId: string;
  /** Data point index this span references */
  dataIndex?: number;
  /** Display content */
  children: React.ReactNode;
  /** Optional tooltip summary */
  summary?: string;
  /** Optional source citation */
  source?: string;
  /** Visual variant */
  variant?: "default" | "positive" | "negative" | "warning" | "neutral";
  /** Whether to show the data point indicator */
  showIndicator?: boolean;
  /** Custom className */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * InteractiveSpan - A text span that syncs with chart focus state.
 * 
 * When hovered, it highlights the corresponding data point on the chart.
 * When the chart point is hovered, this span gets highlighted.
 * 
 * Supports keyboard navigation and proper ARIA attributes.
 */
export const InteractiveSpan: React.FC<InteractiveSpanProps> = ({
  spanId,
  dataIndex,
  children,
  summary,
  source,
  variant = "default",
  showIndicator = false,
  className,
}) => {
  const tooltipId = useId();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isTooltipOpen, setIsTooltipOpen] = React.useState(false);
  
  // Get focus sync context
  const { onTextHover, focusState } = useFocusSync();
  
  // Check if this span is highlighted (either by direct hover or chart hover)
  const isHoveredBySpan = useSpanHover(spanId);
  const isHoveredByChart = dataIndex !== undefined && focusState.focusedDataIndex === dataIndex;
  const isHighlighted = isHoveredBySpan || isHoveredByChart;

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Update focus state to highlight chart point
    onTextHover(spanId, dataIndex);
    // Show tooltip after delay
    timeoutRef.current = setTimeout(() => setIsTooltipOpen(true), 300);
  }, [spanId, dataIndex, onTextHover]);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Clear focus state
    onTextHover(null);
    // Hide tooltip after delay
    timeoutRef.current = setTimeout(() => setIsTooltipOpen(false), 100);
  }, [onTextHover]);

  const handleFocus = useCallback(() => {
    onTextHover(spanId, dataIndex);
    setIsTooltipOpen(true);
  }, [spanId, dataIndex, onTextHover]);

  const handleBlur = useCallback(() => {
    onTextHover(null);
    setIsTooltipOpen(false);
  }, [onTextHover]);

  // Variant styles
  const variantStyles = {
    default: "text-blue-700 decoration-blue-300/60 hover:bg-blue-50 hover:text-blue-800",
    positive: "text-content-secondary decoration-indigo-300/60 hover:bg-indigo-50 hover:text-content",
    negative: "text-red-700 decoration-red-300/60 hover:bg-red-50 hover:text-red-800",
    warning: "text-amber-700 decoration-amber-300/60 hover:bg-amber-50 hover:text-amber-800",
    neutral: "text-content decoration-[color:var(--bg-tertiary)]/60 hover:bg-surface-hover hover:text-content",
  };

  const VariantIcon = {
    default: Info,
    positive: TrendingUp,
    negative: TrendingDown,
    warning: AlertCircle,
    neutral: Info,
  }[variant];

  return (
    <span
      className="group relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      data-span-id={spanId}
      data-data-index={dataIndex}
    >
      <button
        type="button"
        className={cn(
          "cursor-help font-medium decoration-2 underline underline-offset-4 transition-all rounded-sm px-0.5",
          "focus:outline-none focus:ring-2 focus:ring-offset-1",
          variantStyles[variant],
          isHighlighted && "ring-2 ring-offset-1 bg-yellow-100/50 ring-yellow-400/50",
          className
        )}
        aria-describedby={summary ? tooltipId : undefined}
        aria-expanded={isTooltipOpen}
        tabIndex={0}
      >
        {showIndicator && dataIndex !== undefined && (
          <span className="mr-1 text-xs opacity-60">[{dataIndex}]</span>
        )}
        {children}
      </button>

      {/* Tooltip Card */}
      {summary && (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute left-0 top-full z-50 w-72 translate-y-2",
            "rounded-lg border border-edge bg-surface p-3 text-left shadow-xl ring-1 ring-black/5",
            "transition-all duration-200 origin-top",
            isTooltipOpen ? "opacity-100 scale-100 visible" : "opacity-0 scale-95 invisible"
          )}
        >
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <VariantIcon className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-bold text-content-secondary">
                {dataIndex !== undefined ? `Point ${dataIndex}` : "Context"}
              </span>
            </span>
            <span className="text-sm leading-relaxed text-content font-sans">{summary}</span>
            {source && (
              <span className="border-t border-edge pt-2 text-xs text-content-secondary">
                Source: {source}
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
};

export default InteractiveSpan;


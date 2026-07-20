"use client";

/**
 * EnhancedLineChart - Production-ready chart with full utility
 *
 * Features:
 * - Title with metric + unit + window
 * - Y-axis with units and baseline reference
 * - Delta callout showing change from baseline
 * - Voronoi-style nearest-point selection (no pixel hunting)
 * - WCAG-compliant tooltips (keyboard accessible, hoverable, persistent)
 * - Empty state handling
 * - Crosshair/vertical rule on hover
 */

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Clock, RefreshCw } from "lucide-react";
import type { ChartSeries, ChartPoint, TrendLineConfig, TooltipPayload } from "@/features/research/types";
import { useMotionConfig } from '@/lib/motion';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Data point context for AI agent integration */
export interface ChartDataPointContext {
  seriesId: string;
  dataIndex: number;
  dataLabel: string;
  value: number;
  unit?: string;
}

interface EnhancedLineChartProps {
  config: TrendLineConfig;
  /** Callback when user clicks a data point with linked evidence */
  onEvidenceClick?: (evidenceId: string) => void;
  /** Callback when user clicks a data point (for AI agent integration) */
  onDataPointClick?: (point: ChartDataPointContext) => void;
  /** Map of evidence ID -> evidence data for tooltip display */
  evidenceMap?: Map<string, { id: string; title: string; source?: string; url?: string }>;
  /** Show loading state */
  isLoading?: boolean;
  /** Error message to display */
  error?: string;
  /** Callback for refresh button */
  onRefresh?: () => void;
  /** Hide the header section */
  compact?: boolean;
}

interface HoveredPoint {
  index: number;
  seriesId: string;
  x: number;
  y: number;
  value: number;
  label: string;
  linkedEvidenceIds?: string[];
  pointTooltip?: TooltipPayload;
  isPinned?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART DIMENSIONS
// ═══════════════════════════════════════════════════════════════════════════

const CHART = {
  width: 400,
  height: 160,
  paddingX: 40,
  paddingY: 25,
  paddingTop: 10,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

const getSeriesColor = (series: ChartSeries) => {
  if (series.color?.startsWith("#")) return series.color;
  const colorMap: Record<string, string> = {
    accent: "#4f46e5",
    gray: "#94a3b8",
    black: "#0f172a",
    emerald: "#10b981",
    red: "#ef4444",
    amber: "#f59e0b",
  };
  return colorMap[series.color ?? "accent"] ?? "#4f46e5";
};

const formatValue = (value: number, unit?: string): string => {
  if (unit === "%") return `${Math.round(value)}%`;
  if (unit === "pts") return `${value.toFixed(1)} pts`;
  return value.toLocaleString();
};

const getPointEvidenceIds = (pt: ChartPoint): string[] => {
  const raw = [...(pt.linkedEvidenceIds ?? []), ...(pt.tooltip?.linkedEvidenceIds ?? [])]
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  return [...new Set(raw)];
};

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/** Delta badge showing change from baseline */
function DeltaCallout({ delta }: { delta: TrendLineConfig["delta"] }) {
  if (!delta) return null;

  const Icon = delta.direction === "up" ? TrendingUp : delta.direction === "down" ? TrendingDown : Minus;
  const colorClass = delta.direction === "up" ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10"
    : delta.direction === "down" ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10"
      : "text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-white/[0.06]";
  const sign = delta.direction === "up" ? "+" : delta.direction === "down" ? "" : "";

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${colorClass}`}>
      <Icon className="w-3 h-3" />
      <span>{sign}{formatValue(delta.value, "%")}</span>
      {delta.label && <span className="text-xs opacity-70 whitespace-nowrap">{delta.label}</span>}
    </div>
  );
}

/** Chart header with title, time window, delta, and last updated */
function ChartHeader({ config, isLoading, onRefresh }: {
  config: TrendLineConfig;
  isLoading?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="min-w-0 flex-1">
        {/* Title with unit */}
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 tracking-wide truncate">
            {config.title || "Trend"}
            {config.yAxisUnit && <span className="text-slate-400 dark:text-slate-500 font-normal"> ({config.yAxisUnit})</span>}
          </h3>
          {config.delta && <DeltaCallout delta={config.delta} />}
        </div>

        {/* Time window and last updated */}
        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
          {config.timeWindow && <span>{config.timeWindow}</span>}
          {config.lastUpdated && (
            <>
              <span>•</span>
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                Updated {config.lastUpdated}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Refresh button */}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50"
          aria-label="Refresh chart data"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isLoading ? "motion-safe:animate-spin" : ""}`} />
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const EnhancedLineChart: React.FC<EnhancedLineChartProps> = ({
  config,
  onEvidenceClick,
  onDataPointClick,
  evidenceMap,
  isLoading,
  error,
  onRefresh,
  compact,
}) => {
  const { instant, transition: motionTransition } = useMotionConfig();
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null);
  const [pinnedPoint, setPinnedPoint] = useState<HoveredPoint | null>(null);
  const [isTooltipHovered, setIsTooltipHovered] = useState(false);
  const [isFocusDismissed, setIsFocusDismissed] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoverClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Track domain changes to trigger subtle highlight animations
  // Must be declared before any early returns
  const previousDomain = useRef<{ minY: number; maxY: number } | null>(null);
  const [isDomainTransitioning, setIsDomainTransitioning] = useState(false);

  // Compute all points with coordinates for nearest-point selection
  const allPointsWithCoords = useMemo(() => {
    if (!config?.series?.length) return [];

    const allValues = config.series.flatMap((s) => s.data.map((d) => d.value));
    const minY = config.gridScale?.min ?? Math.min(0, ...allValues);
    const maxY = config.gridScale?.max ?? Math.max(...allValues) * 1.1;
    const range = Math.max(maxY - minY, 1);
    const xSteps = Math.max(...config.series.map((s) => s.data.length - 1), config.xAxisLabels.length - 1, 1);

    const points: Array<{
      seriesId: string;
      seriesLabel: string;
      index: number;
      point: ChartPoint;
      x: number;
      y: number;
      color: string;
    }> = [];

    config.series.forEach((series) => {
      const color = getSeriesColor(series);
      const visibleEnd = Math.min(config.visibleEndIndex, series.data.length - 1);
      series.data.forEach((point, i) => {
        if (i > visibleEnd) return;
        const x = CHART.paddingX + (i / xSteps) * (CHART.width - CHART.paddingX * 2);
        const y = CHART.height - CHART.paddingY - ((point.value - minY) / range) * (CHART.height - CHART.paddingY - CHART.paddingTop);
        points.push({
          seriesId: series.id,
          seriesLabel: series.label,
          index: i,
          point,
          x,
          y,
          color,
        });
      });
    });
    return points;
  }, [config]);

  // Find nearest point using Euclidean distance (Voronoi-style)
  const findNearestPoint = useCallback((mouseX: number, mouseY: number) => {
    if (!allPointsWithCoords.length) return null;

    let nearest = allPointsWithCoords[0];
    let minDist = Infinity;

    allPointsWithCoords.forEach((pt) => {
      const dist = Math.hypot(pt.x - mouseX, pt.y - mouseY);
      if (dist < minDist) {
        minDist = dist;
        nearest = pt;
      }
    });

    // Only select if within reasonable range (50px)
    if (minDist > 50) return null;

    return {
      index: nearest.index,
      seriesId: nearest.seriesId,
      x: nearest.x,
      y: nearest.y,
      value: nearest.point.value,
      label: nearest.seriesLabel,
      linkedEvidenceIds: getPointEvidenceIds(nearest.point),
      pointTooltip: nearest.point.tooltip,
    };
  }, [allPointsWithCoords]);

  // Handle mouse move for nearest-point selection
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (pinnedPoint || isTooltipHovered) return; // Don't update hover when pinned or tooltip hovered

    if (hoverClearTimeoutRef.current) {
      clearTimeout(hoverClearTimeoutRef.current);
      hoverClearTimeoutRef.current = null;
    }

    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const scaleX = CHART.width / rect.width;
    const scaleY = CHART.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const nearest = findNearestPoint(mouseX, mouseY);
    setHoveredPoint(nearest);
  }, [findNearestPoint, pinnedPoint, isTooltipHovered]);

  const handleMouseLeave = useCallback(() => {
    if (pinnedPoint) return;
    hoverClearTimeoutRef.current = setTimeout(() => {
      setHoveredPoint(null);
    }, 80);
  }, [pinnedPoint]);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const scaleX = CHART.width / rect.width;
    const scaleY = CHART.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const nearest = findNearestPoint(mouseX, mouseY);

    if (nearest) {
      if (pinnedPoint?.index === nearest.index && pinnedPoint?.seriesId === nearest.seriesId) {
        // Clicking same point unpins it
        setPinnedPoint(null);
      } else {
        setPinnedPoint({ ...nearest, isPinned: true });
        // Scroll to first evidence if available
        if (nearest.linkedEvidenceIds?.length && onEvidenceClick) {
          onEvidenceClick(nearest.linkedEvidenceIds[0]);
        }
        // Notify AI agent integration (for bidirectional focus)
        if (onDataPointClick) {
          onDataPointClick({
            seriesId: nearest.seriesId,
            dataIndex: nearest.index,
            dataLabel: nearest.label,
            value: nearest.value,
            unit: config.yAxisUnit,
          });
        }
      }
    } else {
      setPinnedPoint(null);
    }
  }, [findNearestPoint, pinnedPoint, onEvidenceClick, onDataPointClick, config.yAxisUnit]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!config?.series?.length) return;

    const primarySeries = config.series[0];
    const maxIndex = primarySeries.data.length - 1;

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const direction = e.key === "ArrowRight" ? 1 : -1;
      const newIndex = Math.max(0, Math.min(maxIndex, (focusedIndex ?? 0) + direction));
      setFocusedIndex(newIndex);

      // Find the point at this index
      const pt = allPointsWithCoords.find((p) => p.seriesId === primarySeries.id && p.index === newIndex);
      if (pt) {
        setHoveredPoint({
          index: pt.index,
          seriesId: pt.seriesId,
          x: pt.x,
          y: pt.y,
          value: pt.point.value,
          label: pt.seriesLabel,
          linkedEvidenceIds: getPointEvidenceIds(pt.point),
          pointTooltip: pt.point.tooltip,
        });
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (hoveredPoint) {
        setPinnedPoint(hoveredPoint.isPinned ? null : { ...hoveredPoint, isPinned: true });
        if (hoveredPoint.linkedEvidenceIds?.length && onEvidenceClick) {
          onEvidenceClick(hoveredPoint.linkedEvidenceIds[0]);
        }
      }
    } else if (e.key === "Escape") {
      setPinnedPoint(null);
      setHoveredPoint(null);
      setFocusedIndex(null);
      setIsTooltipHovered(false);
      setIsFocusDismissed(true);
    }
  }, [config, focusedIndex, hoveredPoint, allPointsWithCoords, onEvidenceClick]);

  // Dismiss pinned tooltip on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!pinnedPoint) return;
      const target = e.target as Node;
      if (svgRef.current?.contains(target)) return;
      if (tooltipRef.current?.contains(target)) return;
      setPinnedPoint(null);
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [pinnedPoint]);

  useEffect(() => {
    return () => {
      if (hoverClearTimeoutRef.current) clearTimeout(hoverClearTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof config.focusIndex === "number") setFocusedIndex(config.focusIndex);
    else setFocusedIndex(null);
    setIsFocusDismissed(false);
  }, [config.focusIndex]);

  const focusFallback = useMemo<HoveredPoint | null>(() => {
    if (typeof config.focusIndex !== "number") return null;
    const primary = config.series.find((s) => s.type === "solid") ?? config.series[0];
    if (!primary) return null;
    const pt = allPointsWithCoords.find((p) => p.seriesId === primary.id && p.index === config.focusIndex);
    if (!pt) return null;
    return {
      index: pt.index,
      seriesId: pt.seriesId,
      x: pt.x,
      y: pt.y,
      value: pt.point.value,
      label: pt.seriesLabel,
      linkedEvidenceIds: getPointEvidenceIds(pt.point),
      pointTooltip: pt.point.tooltip,
    };
  }, [allPointsWithCoords, config.focusIndex, config.series]);

  const activePoint = pinnedPoint ?? hoveredPoint ?? (!isFocusDismissed ? focusFallback : null);

  // Compute scales before any early returns (for domain transition effect)
  const allValuesForDomain = config?.series?.flatMap((s) => s.data.map((d) => d.value)) ?? [];
  const minYComputed = config?.gridScale?.min ?? Math.min(0, ...allValuesForDomain);
  const maxYComputed = config?.gridScale?.max ?? Math.max(...allValuesForDomain, 1) * 1.1;

  // Domain transition effect - must be called before any early returns
  React.useEffect(() => {
    const prev = previousDomain.current;
    if (prev && (prev.minY !== minYComputed || prev.maxY !== maxYComputed)) {
      setIsDomainTransitioning(true);
      const timeout = setTimeout(() => setIsDomainTransitioning(false), 600);
      return () => clearTimeout(timeout);
    }
    previousDomain.current = { minY: minYComputed, maxY: maxYComputed };
  }, [minYComputed, maxYComputed]);

  // Empty state - now after all hooks
  if (!config?.series?.length) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200 text-slate-400 text-xs">
        No chart data available
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 rounded-lg border border-red-200 text-red-600 text-xs p-4">
        <span className="font-medium mb-1">Chart Error</span>
        <span className="text-red-500">{error}</span>
        {onRefresh && (
          <button type="button" onClick={onRefresh} className="mt-2 text-red-600 underline">
            Retry
          </button>
        )}
      </div>
    );
  }

  // Use the precomputed values for rendering
  const minY = minYComputed;
  const maxY = maxYComputed;
  const range = Math.max(maxY - minY, 1);
  const xSteps = Math.max(
    ...config.series.map((s) => s.data.length - 1),
    config.xAxisLabels.length - 1,
    1,
  );

  const getCoord = (index: number, value: number) => ({
    x: CHART.paddingX + (index / xSteps) * (CHART.width - CHART.paddingX * 2),
    y: CHART.height - CHART.paddingY - ((value - minY) / range) * (CHART.height - CHART.paddingY - CHART.paddingTop),
  });

  // Build smooth path
  const buildPath = (points: Array<{ x: number; y: number }>) => {
    const safePoints = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (safePoints.length === 0) return "";
    if (safePoints.length < 2) {
      return safePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    }

    let d = `M ${safePoints[0].x} ${safePoints[0].y}`;
    for (let i = 0; i < safePoints.length - 1; i++) {
      const p0 = safePoints[i - 1] ?? safePoints[i];
      const p1 = safePoints[i];
      const p2 = safePoints[i + 1];
      const p3 = safePoints[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  };

  // Y-axis tick values
  const yTicks = [minY, minY + range * 0.5, maxY].map((v) => ({
    value: v,
    y: getCoord(0, v).y,
    label: formatValue(v, config.yAxisUnit),
  }));

  const primarySeries = config.series.find((s) => s.type === "solid") ?? config.series[0];
  const primarySeriesId = primarySeries.id;

  const annotationPoints = (config.annotations ?? [])
    .map((annotation) => {
      const targetIndex = annotation.targetIndex ?? annotation.associatedDataIndex;
      if (targetIndex === undefined || targetIndex === null) return null;
      const point = primarySeries.data[targetIndex];
      if (!point) return null;
      const coord = getCoord(targetIndex, point.value);
      const label = annotation.title.length > 26
        ? `${annotation.title.slice(0, 26)}...`
        : annotation.title;
      return { annotation, coord, label };
    })
    .filter(Boolean) as Array<{
      annotation: NonNullable<typeof config.annotations>[number];
      coord: { x: number; y: number };
      label: string;
    }>;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      {!compact && <ChartHeader config={config} isLoading={isLoading} onRefresh={onRefresh} />}

      {/* Chart container */}
      <div className="relative flex-1 min-h-0">
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-surface flex items-center justify-center z-10 rounded">
            <RefreshCw className="w-5 h-5 text-slate-400 motion-safe:animate-spin" />
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          className="w-full h-full overflow-visible cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="img"
          aria-label={`${config.title} chart showing ${config.series.length} series`}
        >
          {/* Domain transition highlight */}
          <AnimatePresence>
            {isDomainTransitioning && (
              <motion.rect
                key="domain-highlight"
                x={CHART.paddingX}
                y={CHART.paddingTop}
                width={CHART.width - CHART.paddingX * 2}
                height={CHART.height - CHART.paddingY - CHART.paddingTop}
                fill="rgba(79,70,229,0.10)"
                initial={{ opacity: instant ? 0 : 0.35 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={motionTransition({ duration: 0.6, ease: "easeOut" })}
              />
            )}
          </AnimatePresence>

          {/* Y-axis labels (animate vertically when domain changes) */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <motion.line
                x1={CHART.paddingX}
                x2={CHART.width - CHART.paddingX + 10}
                initial={false}
                animate={{ y1: tick.y, y2: tick.y }}
                className="stroke-slate-100"
                strokeDasharray="2 2"
                transition={motionTransition({ duration: 0.4, ease: "easeOut" })}
              />
              <motion.text
                x={CHART.paddingX - 5}
                initial={false}
                animate={{ y: tick.y + 3 }}
                textAnchor="end"
                className="text-xs fill-slate-400 font-mono"
                transition={motionTransition({ duration: 0.4, ease: "easeOut" })}
              >
                {tick.label}
              </motion.text>
            </g>
          ))}

          {/* Baseline reference line */}
          {config.baseline && (
            <g>
              <motion.line
                x1={CHART.paddingX}
                x2={CHART.width - CHART.paddingX}
                initial={false}
                animate={{
                  y1: getCoord(0, config.baseline.value).y,
                  y2: getCoord(0, config.baseline.value).y,
                }}
                className="stroke-slate-300 dark:stroke-slate-600"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                transition={motionTransition({ duration: 0.4, ease: "easeOut" })}
              />
              <motion.text
                x={CHART.width - CHART.paddingX + 3}
                initial={false}
                animate={{ y: getCoord(0, config.baseline.value).y + 3 }}
                className="text-[10px] fill-slate-500 dark:fill-slate-400 font-medium font-mono"
                transition={motionTransition({ duration: 0.4, ease: "easeOut" })}
              >
                {config.baseline.label}
              </motion.text>
            </g>
          )}

          {/* X-axis labels */}
          {config.xAxisLabels.map((label, i) => {
            const { x } = getCoord(i, 0);
            const muted = i > config.visibleEndIndex;
            return (
              <text
                key={i}
                x={x}
                y={CHART.height - 3}
                textAnchor="middle"
                className={`text-xs font-mono ${muted ? "fill-slate-200" : "fill-slate-400"}`}
              >
                {label}
              </text>
            );
          })}

          {/* Series lines */}
          {config.series.map((series) => {
            const color = getSeriesColor(series);
            const isGhost = series.type === "ghost";
            const visibleEnd = Number.isFinite(config.visibleEndIndex)
              ? Math.min(config.visibleEndIndex, series.data.length - 1)
              : series.data.length - 1;

            const points = series.data.map((pt, i) => ({ i, ...getCoord(i, pt.value), point: pt }));
            const visiblePoints = points.filter((p) => p.i <= visibleEnd);

            const presentIndexRaw = typeof config.presentIndex === "number" ? config.presentIndex : null;
            const presentIndex =
              presentIndexRaw === null ? null : Math.max(0, Math.min(presentIndexRaw, visibleEnd));

            const historyPoints =
              presentIndex !== null && !isGhost
                ? visiblePoints.filter((p) => p.i <= presentIndex)
                : visiblePoints;

            const projectionPoints =
              presentIndex !== null && !isGhost && presentIndex < visibleEnd
                ? visiblePoints.filter((p) => p.i >= presentIndex && p.i <= visibleEnd)
                : [];

            const historyPath = buildPath(historyPoints.map((p) => ({ x: p.x, y: p.y })));
            const projectionPath =
              projectionPoints.length >= 2
                ? buildPath(projectionPoints.map((p) => ({ x: p.x, y: p.y })))
                : "";
            const hasHistoryPath = historyPath.trim().startsWith("M");
            const hasProjectionPath = projectionPath.trim().startsWith("M");

            return (
              <g key={series.id}>
                {hasHistoryPath && (
                  <motion.path
                    d={historyPath}
                    fill="none"
                    stroke={color}
                    strokeWidth={isGhost ? 1.5 : 2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={isGhost ? "6 4" : "0"}
                    opacity={isGhost ? 0.4 : 1}
                    initial={{ pathLength: instant ? 1 : 0, d: historyPath }}
                    animate={{ pathLength: 1, d: historyPath }}
                    transition={motionTransition({ duration: 1.0, ease: "easeOut" })}
                  />
                )}

                {!isGhost && hasProjectionPath && (
                  <motion.path
                    d={projectionPath}
                    fill="none"
                    stroke={color}
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="6 4"
                    opacity={0.55}
                    initial={{ pathLength: instant ? 1 : 0, d: projectionPath }}
                    animate={{ pathLength: 1, d: projectionPath }}
                    transition={motionTransition({ duration: 1.0, ease: "easeOut" })}
                  />
                )}

                {/* Data points */}
                {series.data.map((pt, i) => {
                  if (i > visibleEnd) return null;
                  const coord = getCoord(i, pt.value);
                  const isActive = activePoint?.seriesId === series.id && activePoint?.index === i;
                  const isFocus = series.id === primarySeriesId && config.focusIndex === i;
                  const isProjected = !isGhost && presentIndex !== null && i > presentIndex;
                  const evidenceIds = getPointEvidenceIds(pt);
                  const hasEvidence = evidenceIds.length > 0;

                  return (
                    <g key={i}>
                      {/* Point circle */}
                      <motion.circle
                        cx={coord.x}
                        cy={coord.y}
                        r={isActive || isFocus ? 6 : 4}
                        fill="white"
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray={isProjected ? "3 3" : "0"}
                        opacity={isProjected ? 0.65 : isGhost ? 0.45 : 1}
                        initial={{ scale: instant ? 1 : 0 }}
                        animate={{ scale: 1 }}
                        transition={motionTransition({ delay: i * 0.05 })}
                      />

                      {/* Evidence indicator */}
                      {hasEvidence && (
                        <circle
                          cx={coord.x}
                          cy={coord.y}
                          r={2}
                          fill={color}
                          opacity={isProjected ? 0.65 : 1}
                        />
                      )}

                      {/* Active pulse */}
                      {isActive && !instant && (
                        <motion.circle
                          cx={coord.x}
                          cy={coord.y}
                          r={6}
                          fill={color}
                          initial={{ opacity: 0.5, scale: 1 }}
                          animate={{ opacity: 0, scale: 2 }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        />
                      )}

                      {/* Focus pulse (when not actively hovered/pinned) */}
                      {isFocus && !isActive && !instant && (
                        <motion.circle
                          cx={coord.x}
                          cy={coord.y}
                          r={6}
                          fill={color}
                          initial={{ opacity: 0.4, scale: 1 }}
                          animate={{ opacity: 0, scale: 2 }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {annotationPoints.length > 0 && (() => {
            // Simple collision avoidance: offset labels that would overlap
            const usedSlots: Array<{ x: number; y: number; w: number }> = [];
            return (
              <g>
                {annotationPoints.map(({ annotation, coord, label }, idx) => {
                  const color = annotation.sentiment === "negative"
                    ? "#ef4444"
                    : annotation.sentiment === "positive"
                      ? "#10b981"
                      : "#64748b";
                  const truncLabel = label.length > 20 ? label.slice(0, 18) + "…" : label;
                  const labelW = truncLabel.length * 6.5 + 12;
                  let y = Math.max(CHART.paddingTop + 6, coord.y - 14);

                  // Robust collision avoidance: recursively check and offset
                  let hasOverlap = true;
                  let attempts = 0;
                  while (hasOverlap && attempts < 5) {
                    hasOverlap = false;
                    for (const slot of usedSlots) {
                      const xOverlap = Math.abs(coord.x - slot.x) < (labelW + slot.w) / 2 + 10;
                      const yOverlap = Math.abs(y - slot.y) < 20;
                      if (xOverlap && yOverlap) {
                        y = Math.min(CHART.height - CHART.paddingY - 10, slot.y + 22);
                        hasOverlap = true;
                        break;
                      }
                    }
                    attempts++;
                  }

                  usedSlots.push({ x: coord.x, y, w: labelW });
                  if (compact) {
                    return (
                      <g key={annotation.id ?? `${coord.x}-${coord.y}-${idx}`}>
                        <circle cx={coord.x} cy={coord.y} r={3} fill={color} className="shadow-sm" />
                        {annotation.description && (
                          <title>{annotation.description}</title>
                        )}
                      </g>
                    );
                  }

                  return (
                    <g key={annotation.id ?? `${coord.x}-${coord.y}-${idx}`}>
                      <circle cx={coord.x} cy={coord.y} r={3} fill={color} className="shadow-sm" />
                      <rect
                        x={coord.x + 6}
                        y={y - 10}
                        width={labelW}
                        height={18}
                        rx={6}
                        fill="var(--bg-surface)"
                        stroke="var(--border-edge)"
                        strokeWidth={1}
                        className="shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                      />
                      <text
                        x={coord.x + 12}
                        y={y + 3}
                        className="text-[10px] fill-content font-medium font-mono"
                      >
                        {truncLabel}
                      </text>
                      {annotation.description && (
                        <title>{annotation.description}</title>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Vertical crosshair on hover */}
          {activePoint && (
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={CHART.paddingTop}
              y2={CHART.height - CHART.paddingY}
              className="stroke-slate-300"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          )}
        </svg>

        {/* Tooltip */}
        <AnimatePresence>
          {activePoint && (
            <motion.div
              ref={tooltipRef}
              initial={{ opacity: instant ? 1 : 0, y: instant ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: instant ? 1 : 0 }}
              className="absolute z-50 pointer-events-auto"
              onMouseEnter={() => {
                if (hoverClearTimeoutRef.current) {
                  clearTimeout(hoverClearTimeoutRef.current);
                  hoverClearTimeoutRef.current = null;
                }
                setIsTooltipHovered(true);
              }}
              onMouseLeave={() => {
                setIsTooltipHovered(false);
                if (!pinnedPoint) setHoveredPoint(null);
              }}
              style={{
                left: `${(activePoint.x / CHART.width) * 100}%`,
                top: `${(activePoint.y / CHART.height) * 100}%`,
                transform: "translate(-50%, -100%)",
                marginTop: "-12px",
              }}
            >
              <div className={`bg-slate-900 text-white px-3 py-2 rounded-lg shadow-xl text-xs min-w-[120px] ${activePoint.isPinned ? "ring-2 ring-ring" : ""
                }`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs text-indigo-200">
                    {activePoint.pointTooltip?.kicker ?? "Intel"}
                  </span>
                  {activePoint.isPinned && (
                    <span className="text-[8px] bg-indigo-500 px-1 rounded">PINNED</span>
                  )}
                </div>

                <div className="font-medium text-xs leading-snug">
                  {activePoint.pointTooltip?.title ?? config.xAxisLabels[activePoint.index] ?? `Point ${activePoint.index + 1}`}
                </div>
                <div className="text-lg font-bold">
                  {formatValue(activePoint.value, config.yAxisUnit)}
                </div>
                <div className="text-slate-400 text-xs">{activePoint.label}</div>
                {activePoint.pointTooltip?.body && (
                  <div className="mt-1 text-xs text-slate-300 leading-relaxed">
                    {activePoint.pointTooltip.body}
                  </div>
                )}

                {/* Evidence count */}
                {(activePoint.linkedEvidenceIds?.length ?? 0) > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-700">
                    <div className="text-xs text-slate-400">
                      Sources ({activePoint.linkedEvidenceIds?.length})
                    </div>
                    <div className="mt-1 space-y-1">
                      {activePoint.linkedEvidenceIds!.slice(0, 3).map((id) => {
                        const ev = evidenceMap?.get(id);
                        const title = ev?.title ?? id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEvidenceClick?.(id);
                            }}
                            className="w-full text-left text-xs text-slate-200 hover:text-indigo-200 hover:bg-slate-800/60 rounded px-1 py-0.5 transition-colors"
                          >
                            {title}
                            {ev?.source ? <span className="text-slate-500 ml-1">· {ev.source}</span> : null}
                          </button>
                        );
                      })}
                      {(activePoint.linkedEvidenceIds?.length ?? 0) > 3 && (
                        <div className="text-xs text-slate-500 italic px-1">
                          +{(activePoint.linkedEvidenceIds?.length ?? 0) - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Arrow */}
              <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-slate-900 mx-auto" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default EnhancedLineChart;

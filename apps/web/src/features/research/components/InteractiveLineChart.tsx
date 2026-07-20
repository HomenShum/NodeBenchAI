"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMotionConfig } from '@/lib/motion';
import ChartTooltip, { type TooltipEvidence } from "./ChartTooltip";
import type { Annotation, ChartSeries, ChartPoint, TrendLineConfig, TooltipPayload } from "@/features/research/types";

interface ChartProps {
  config: TrendLineConfig;
  annotations?: Annotation[];
  onAnnotationHover?: (note: Annotation | null) => void;
  /** Callback when user clicks a data point with linked evidence */
  onEvidenceClick?: (evidenceId: string) => void;
  /** Map of evidence ID -> evidence data for tooltip display */
  evidenceMap?: Map<string, { id: string; title: string; source?: string; url?: string }>;
}

type HoveredPoint = {
  x: number;
  y: number;
  content: TooltipPayload;
  linkedEvidenceIds?: string[];
};

const colorStyle = (series: ChartSeries) => {
  if (series.color && series.color.startsWith("#")) {
    return { className: "", stroke: series.color, fill: series.color };
  }
  // Return actual hex colors for SVG stroke/fill instead of Tailwind classes
  if (series.color === "accent") return { className: "text-indigo-600", stroke: "#4f46e5", fill: "#4f46e5" };
  if (series.color === "gray") return { className: "text-slate-400", stroke: "#94a3b8", fill: "#94a3b8" };
  if (series.color === "black") return { className: "text-slate-900", stroke: "#0f172a", fill: "#0f172a" };
  return { className: series.color ? series.color : "text-slate-800", stroke: "#1e293b", fill: "#1e293b" };
};

export const InteractiveLineChart: React.FC<ChartProps> = ({
  config,
  annotations = [],
  onAnnotationHover,
  onEvidenceClick,
  evidenceMap,
}) => {
  const { instant, transition } = useMotionConfig();
  const [hoveredData, setHoveredData] = useState<HoveredPoint | null>(null);

  // useMemo must be called unconditionally (before any early returns)
  const allValues = useMemo(
    () => config?.series?.flatMap((s) => s.data.map((d) => d.value)) ?? [],
    [config?.series],
  );

  // Build linked evidence for tooltip from evidenceMap
  const getLinkedEvidence = (linkedIds?: string[]): TooltipEvidence[] => {
    if (!linkedIds?.length || !evidenceMap) return [];
    return linkedIds
      .map((id) => evidenceMap.get(id))
      .filter(Boolean) as TooltipEvidence[];
  };

  // Memoize scale calculations that only depend on data values and grid config
  const { minY, maxY, range, xSteps } = useMemo(() => {
    if (!config?.series?.length) return { minY: 0, maxY: 1, range: 1, xSteps: 1 };
    const minYRaw = Math.min(...allValues, 0);
    const maxYRaw = Math.max(...allValues, 1);
    const computedMinY = typeof config.gridScale?.min === "number" ? config.gridScale.min : Math.min(0, minYRaw);
    const computedMaxY = typeof config.gridScale?.max === "number" ? config.gridScale.max : Math.max(maxYRaw * 1.1, 1);
    const computedRange = Math.max(computedMaxY - computedMinY, 1);
    const computedXSteps = Math.max(
      Math.max(...config.series.map((s) => s.data.length - 1)),
      config.xAxisLabels.length - 1,
      1,
    );
    return { minY: computedMinY, maxY: computedMaxY, range: computedRange, xSteps: computedXSteps };
  }, [allValues, config?.series, config?.gridScale?.min, config?.gridScale?.max, config?.xAxisLabels?.length]);

  // Early return AFTER all hooks are called
  if (!config?.series?.length) {
    return <div className="w-full h-full rounded-md bg-slate-50" />;
  }

  const width = 400;
  const height = 160;
  const paddingX = 20;
  const paddingY = 20;

  const gridLines = [0.25, 0.5, 0.75];

  const getCoord = (index: number, value: number) => {
    const clampedIndex = Math.min(index, xSteps);
    const x = paddingX + (clampedIndex / xSteps) * (width - paddingX * 2);
    const y = height - paddingY - ((value - minY) / range) * (height - paddingY * 2);
    return { x, y };
  };

  const buildSmoothPath = (pts: Array<{ x: number; y: number }>) => {
    const safePts = pts.filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    if (safePts.length === 0) return "";
    if (safePts.length < 3) {
      return safePts
        .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`)
        .join(" ");
    }

    let d = `M ${safePts[0].x} ${safePts[0].y}`;
    for (let i = 0; i < safePts.length - 1; i++) {
      const p0 = safePts[i - 1] ?? safePts[i];
      const p1 = safePts[i];
      const p2 = safePts[i + 1];
      const p3 = safePts[i + 2] ?? p2;

      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    }
    return d;
  };

  const renderSeries = (series: ChartSeries) => {
    const visibleEnd = Number.isFinite(config.visibleEndIndex)
      ? Math.min(config.visibleEndIndex, series.data.length - 1)
      : series.data.length - 1;

    const buildPath = (endIndex: number) => {
      const slice = series.data.slice(0, Math.max(endIndex + 1, 2));
      const pointSet = slice.map((pt, i) => getCoord(i, pt.value));
      return buildSmoothPath(pointSet);
    };

    const fullPath = buildPath(series.data.length - 1);
    const visiblePath = buildPath(Math.max(visibleEnd, 0));
    const hasFullPath = fullPath.trim().startsWith("M");
    const hasVisiblePath = visiblePath.trim().startsWith("M");
    const isGhost = series.type === "ghost";
    const { className, stroke, fill } = colorStyle(series);
    const dash = isGhost ? "6 6" : "0";

    return (
      <g key={series.id}>
        {/* Ghost baseline - shows "path traveled" (previous state) at low opacity */}
        {hasFullPath && (
          <motion.path
            d={fullPath}
            fill="none"
            stroke={stroke}
            strokeWidth={isGhost ? 1.5 : 0}
            strokeDasharray={dash}
            className={className}
            initial={{ opacity: 0, pathLength: instant ? 1 : 0, d: fullPath }}
            animate={{ opacity: isGhost ? 0.25 : 0, pathLength: 1, d: fullPath }}
            transition={transition({ duration: 1, ease: "easeInOut" })}
          />
        )}

        {/* Visible / confirmed segment - current state */}
        {hasVisiblePath && (
          <motion.path
            d={visiblePath}
            fill="none"
            stroke={stroke}
            strokeWidth={isGhost ? 2 : 2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={dash}
            className={className}
            initial={{ opacity: 0, pathLength: instant ? 1 : 0, d: visiblePath }}
            animate={{ opacity: 1, pathLength: 1, d: visiblePath }}
            transition={transition({ duration: 1.2, ease: "easeInOut" })}
          />
        )}

        {/* Points */}
        {series.data.map((point, i) => {
          const { x, y } = getCoord(i, point.value);
          const isFocused = config.focusIndex === i;
          const isVisible = i <= visibleEnd;
          const dotOpacity = isVisible ? 1 : isGhost ? 0.35 : 0;

          if (!isVisible && !isGhost) return null;

          return (
            <g key={i}>
              <motion.circle
                cx={x}
                cy={y}
                r={isFocused ? 4 : 3}
                className={`fill-white stroke-2 ${className}`}
                style={{ opacity: dotOpacity }}
                initial={{ scale: instant ? 1 : 0 }}
                animate={{ scale: 1 }}
                transition={transition({ delay: i * 0.05 })}
              />

              {isFocused && (
                <motion.circle
                  cx={x}
                  cy={y}
                  r={8}
                  className={className ? className.replace("text-", "fill-") : ""}
                  style={{ opacity: dotOpacity }}
                  fill={fill}
                  initial={{ opacity: instant ? 0 : 0.4, scale: 1 }}
                  animate={{ opacity: 0, scale: instant ? 1 : 2 }}
                  transition={transition({ repeat: Infinity, duration: 1.5 })}
                />
              )}

              <circle
                cx={x}
                cy={y}
                r={12}
                className={`fill-transparent ${point.linkedEvidenceIds?.length ? "cursor-pointer" : "cursor-default"}`}
                onMouseEnter={() => {
                  const fallbackTitle = config.xAxisLabels[i]
                    ? `${series.label} - ${config.xAxisLabels[i]}`
                    : series.label;
                  const tooltipContent: TooltipPayload = point.tooltip ?? {
                    title: fallbackTitle,
                    body: `Value: ${point.value}`,
                  };
                  // Merge linkedEvidenceIds from both point and tooltip
                  const linkedIds = point.linkedEvidenceIds ?? point.tooltip?.linkedEvidenceIds ?? [];
                  setHoveredData({ x, y, content: tooltipContent, linkedEvidenceIds: linkedIds });
                }}
                onMouseLeave={() => setHoveredData(null)}
                onClick={() => {
                  // On click, scroll to first linked evidence
                  const linkedIds = point.linkedEvidenceIds ?? point.tooltip?.linkedEvidenceIds ?? [];
                  if (linkedIds.length > 0 && onEvidenceClick) {
                    onEvidenceClick(linkedIds[0]);
                  }
                }}
              />
            </g>
          );
        })}
      </g>
    );
  };

  const resolveAnnotationCoord = (note: Annotation) => {
    if (note.position) {
      return {
        x: (note.position.x / 100) * width,
        y: (note.position.y / 100) * height,
      };
    }
    const target = typeof note.targetIndex === "number" ? note.targetIndex : note.associatedDataIndex;
    const primarySeries = config.series.find((s) => s.type === "solid") ?? config.series[0];
    const idx = primarySeries ? Math.min(Math.max(target ?? 0, 0), primarySeries.data.length - 1) : 0;
    const val = primarySeries?.data?.[idx]?.value ?? 0;
    return getCoord(idx, val);
  };

  return (
    <div className="relative w-full h-full">
      <div className="absolute inset-0 z-50" style={{ pointerEvents: hoveredData?.linkedEvidenceIds?.length ? "auto" : "none" }}>
        <ChartTooltip
          active={!!hoveredData}
          data={
            hoveredData
              ? {
                  id: "data-point",
                  title: hoveredData.content.title,
                  description: hoveredData.content.body,
                  position: {
                    x: (hoveredData.x / width) * 100,
                    y: (hoveredData.y / height) * 100,
                  },
                  kicker: hoveredData.content.kicker,
                  linkedEvidence: getLinkedEvidence(hoveredData.linkedEvidenceIds),
                }
              : null
          }
          onEvidenceClick={onEvidenceClick}
        />
      </div>

      <svg viewBox={`-10 -10 ${width + 20} ${height + 20}`} className="w-full h-full overflow-visible">
        {/* Background grid */}
        {gridLines.map((ratio, idx) => {
          const y = paddingY + ratio * (height - paddingY * 2);
          return (
            <line
              key={idx}
              x1={paddingX}
              x2={width - paddingX}
              y1={y}
              y2={y}
              className="stroke-slate-100"
              strokeDasharray="2 2"
              strokeWidth={1}
            />
          );
        })}

        {/* Chart Title Label */}
        <text x="25" y="20" className="text-xs font-bold fill-slate-300 font-mono tracking-widest">
          {config.title || "Reliability Index"}
        </text>

        {config.xAxisLabels.map((label, i) => {
          const { x } = getCoord(i, 0);
          const muted = i > config.visibleEndIndex;
          return (
            <text
              key={i}
              x={x}
              y={height - 2}
              textAnchor="middle"
              className={`text-[10px] font-mono ${muted ? "fill-slate-200" : "fill-slate-400"}`}
            >
              {label}
            </text>
          );
        })}

        {config.series.map((series) => renderSeries(series))}

        {/* Dynamic Label at end of primary line */}
        {config.series.length > 0 && (() => {
          const primarySeries = config.series.find((s) => s.type === "solid") ?? config.series[0];
          const lastIdx = Math.min(config.visibleEndIndex, primarySeries.data.length - 1);
          const lastVal = primarySeries.data[lastIdx]?.value ?? 0;
          const { x, y } = getCoord(lastIdx, lastVal);
          return (
            <text
              x={x + 5}
              y={y - 8}
              className="text-xs font-bold fill-slate-700 font-mono"
            >
              {primarySeries.label}
            </text>
          );
        })()}

        {annotations.map((note) => {
          const { x, y } = resolveAnnotationCoord(note);
          return (
            <motion.g
              key={note.id}
              initial={{ opacity: instant ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={transition({ delay: 0.3 })}
            >
              <circle
                cx={x}
                cy={y}
                r="4"
                className="fill-white stroke-indigo-600 stroke-[2px] cursor-pointer hover:stroke-indigo-400 hover:scale-125 transition-all duration-300"
              />
              <circle
                cx={x}
                cy={y}
                r="16"
                className="fill-transparent cursor-pointer"
                onMouseEnter={() =>
                  onAnnotationHover?.({
                    ...note,
                    position: { x: (x / width) * 100, y: (y / height) * 100 },
                  })
                }
                onMouseLeave={() => onAnnotationHover?.(null)}
              />
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
};

export default InteractiveLineChart;

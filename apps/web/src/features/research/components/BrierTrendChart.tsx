"use client";

import React, { useState, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface BrierDataPoint {
  /** Date or forecast name (x-axis) */
  label: string;
  /** Brier score 0 to 0.5 (y-axis, lower is better) */
  brierScore: number;
}

interface BrierTrendChartProps {
  dataPoints: BrierDataPoint[];
  /** SVG width in px (default 320) */
  width?: number;
  /** SVG height in px (default 160) */
  height?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const PAD = { top: 15, right: 15, bottom: 40, left: 45 } as const;

/** Y-axis ticks: 0 (perfect) through 0.25 (random baseline) */
const Y_TICKS = [0, 0.05, 0.1, 0.15, 0.2, 0.25] as const;

/** Y domain maximum (random baseline) */
const Y_MAX = 0.25;

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const BrierTrendChart: React.FC<BrierTrendChartProps> = ({
  dataPoints,
  width = 320,
  height = 160,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Computed plot area dimensions
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  // Map data to pixel coordinates
  const points = useMemo(() => {
    if (dataPoints.length < 2) return [];
    return dataPoints.map((d, i) => ({
      x: PAD.left + (i / (dataPoints.length - 1)) * plotW,
      // Y: 0 at top, Y_MAX at bottom
      y: PAD.top + (d.brierScore / Y_MAX) * plotH,
      label: d.label,
      score: d.brierScore,
    }));
  }, [dataPoints, plotW, plotH]);

  // ── Empty state ──────────────────────────────────────────────────────
  if (dataPoints.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Brier trend chart — insufficient data"
      >
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-gray-500 dark:fill-gray-400"
          fontSize={12}
        >
          Need 2+ resolved forecasts
        </text>
      </svg>
    );
  }

  // ── Derived SVG paths ────────────────────────────────────────────────
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  // Area path: line + close along bottom edge
  const areaPath = [
    linePath,
    `L${points[points.length - 1].x},${PAD.top + plotH}`,
    `L${points[0].x},${PAD.top + plotH}`,
    "Z",
  ].join(" ");

  const baselineY = PAD.top + plotH; // y=0.25 maps to bottom of plot

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Rolling Brier score trend chart"
      className="select-none"
    >
      {/* ── Grid lines (dotted, horizontal at each y tick) ─────────── */}
      {Y_TICKS.map((tick) => {
        const y = PAD.top + (tick / Y_MAX) * plotH;
        return (
          <line
            key={`grid-${tick}`}
            x1={PAD.left}
            y1={y}
            x2={PAD.left + plotW}
            y2={y}
            className="stroke-gray-200 dark:stroke-gray-700"
            strokeWidth={0.5}
            strokeDasharray="2 3"
          />
        );
      })}

      {/* ── Y-axis labels ──────────────────────────────────────────── */}
      {Y_TICKS.map((tick) => {
        const y = PAD.top + (tick / Y_MAX) * plotH;
        return (
          <text
            key={`ylabel-${tick}`}
            x={PAD.left - 6}
            y={y}
            textAnchor="end"
            dominantBaseline="central"
            className="fill-gray-500 dark:fill-gray-400"
            fontSize={9}
          >
            {tick.toFixed(2)}
          </text>
        );
      })}

      {/* ── Baseline: dashed red at y=0.25 ─────────────────────────── */}
      <line
        x1={PAD.left}
        y1={baselineY}
        x2={PAD.left + plotW}
        y2={baselineY}
        className="stroke-red-400 dark:stroke-red-500"
        strokeWidth={1}
        strokeDasharray="6 3"
      />
      <text
        x={PAD.left + plotW + 2}
        y={baselineY}
        dominantBaseline="central"
        className="fill-red-400 dark:fill-red-500"
        fontSize={8}
      >
        Random
      </text>

      {/* ── Area fill (8% opacity) ─────────────────────────────────── */}
      <path
        d={areaPath}
        className="fill-indigo-500/[0.08] dark:fill-indigo-400/[0.08]"
      />

      {/* ── Data line ──────────────────────────────────────────────── */}
      <path
        d={linePath}
        fill="none"
        className="stroke-indigo-500 dark:stroke-indigo-400"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── Data points (circles) ──────────────────────────────────── */}
      {points.map((p, i) => (
        <circle
          key={`pt-${i}`}
          cx={p.x}
          cy={p.y}
          r={3}
          className="fill-indigo-500 dark:fill-indigo-400 cursor-pointer"
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(null)}
        />
      ))}

      {/* ── X-axis labels (every other, rotated -45deg) ────────────── */}
      {points.map((p, i) =>
        i % 2 === 0 ? (
          <text
            key={`xlabel-${i}`}
            x={0}
            y={0}
            transform={`translate(${p.x},${PAD.top + plotH + 8}) rotate(-45)`}
            textAnchor="end"
            className="fill-gray-500 dark:fill-gray-400"
            fontSize={9}
          >
            {p.label}
          </text>
        ) : null,
      )}

      {/* ── Tooltip ────────────────────────────────────────────────── */}
      {hoveredIdx !== null && (() => {
        const p = points[hoveredIdx];
        const tooltipText = `${p.label}: Brier ${p.score.toFixed(3)}`;
        const tooltipW = tooltipText.length * 5.5 + 12;
        // Flip tooltip left if it would overflow the right edge
        const tooltipX = p.x + tooltipW + 4 > width ? p.x - tooltipW - 4 : p.x + 8;
        const tooltipY = Math.max(PAD.top, p.y - 24);

        return (
          <g pointerEvents="none">
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipW}
              height={20}
              rx={4}
              className="fill-gray-800 dark:fill-gray-200"
              opacity={0.92}
            />
            <text
              x={tooltipX + 6}
              y={tooltipY + 13}
              className="fill-white dark:fill-gray-900"
              fontSize={10}
              fontWeight={500}
            >
              {tooltipText}
            </text>
          </g>
        );
      })()}
    </svg>
  );
};

export default BrierTrendChart;

/**
 * TrajectorySparkline — Tiny inline SVG trend indicator.
 * Shows whether a metric is compounding (up), stable (flat), or drifting (down).
 * Botanical gold stroke in dark-botanical, accent-primary otherwise.
 *
 * V3 design principle: "Show trajectories, not snapshots."
 */

import { useMemo } from "react";

interface TrajectorySparklineProps {
  /** Array of numeric values (at least 2 points) */
  data: number[];
  /** Width in px (default 48) */
  width?: number;
  /** Height in px (default 16) */
  height?: number;
  className?: string;
  /** Override stroke color */
  color?: string;
}

export function TrajectorySparkline({
  data,
  width = 48,
  height = 16,
  className = "",
  color,
}: TrajectorySparklineProps) {
  const path = useMemo(() => {
    if (data.length < 2) return "";

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;
    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    const points = data.map((v, i) => ({
      x: padding + (i / (data.length - 1)) * innerW,
      y: padding + innerH - ((v - min) / range) * innerH,
    }));

    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }, [data, width, height]);

  // Determine trend for ARIA label
  const trend = useMemo(() => {
    if (data.length < 2) return "stable";
    const first = data[0];
    const last = data[data.length - 1];
    const delta = (last - first) / (Math.abs(first) || 1);
    if (delta > 0.05) return "rising";
    if (delta < -0.05) return "falling";
    return "stable";
  }, [data]);

  if (data.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle ${className}`}
      aria-label={`Trend: ${trend}`}
      role="img"
    >
      <path
        d={path}
        fill="none"
        stroke={color ?? "var(--accent-primary)"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      <circle
        cx={width - 2}
        cy={path ? Number(path.split(" ").slice(-1)[0]) : height / 2}
        r={2}
        fill={color ?? "var(--accent-primary)"}
      />
    </svg>
  );
}

export default TrajectorySparkline;

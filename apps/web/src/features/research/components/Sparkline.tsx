"use client";

import React from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 120,
  height = 32,
  stroke = "#111827",
  fill = "transparent",
}) => {
  if (!data.length) {
    return <div className="h-8 w-[120px] bg-surface-secondary" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, 1);

  const points = data.map((value, idx) => {
    const x = (idx / Math.max(data.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points.join(" ")}
        fill={fill}
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

interface SparkBarsProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  labels?: string[];
  onBarHover?: (index: number) => void;
  onBarLeave?: () => void;
}

export const SparkBars: React.FC<SparkBarsProps> = ({
  data,
  width = 120,
  height = 32,
  color = "#1f2937",
  labels,
  onBarHover,
  onBarLeave,
}) => {
  if (!data.length) {
    return <div className="h-8 w-[120px] bg-surface-secondary" />;
  }

  const max = Math.max(...data, 1);
  const barWidth = width / data.length;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {data.map((value, idx) => {
        const barHeight = (value / max) * height;
        const label = labels && labels.length === data.length ? labels[idx] : undefined;
        return (
          <rect
            key={`${idx}-${value}`}
            x={idx * barWidth}
            y={height - barHeight}
            width={Math.max(1, barWidth - 2)}
            height={barHeight}
            fill={color}
            rx={1}
            onMouseEnter={() => onBarHover?.(idx)}
            onMouseLeave={() => onBarLeave?.()}
          >
            {label && <title>{label}</title>}
          </rect>
        );
      })}
    </svg>
  );
};

export default Sparkline;

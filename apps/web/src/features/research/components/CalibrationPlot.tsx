import { useState } from "react";

interface CalibrationBin {
  binLabel: string;
  predictedProb: number;
  observedFreq: number;
  count: number;
}

interface CalibrationPlotProps {
  bins: CalibrationBin[];
  width?: number;
  height?: number;
}

const PAD = { top: 15, right: 15, bottom: 35, left: 45 };

export function CalibrationPlot({
  bins,
  width = 280,
  height = 220,
}: CalibrationPlotProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const hasData =
    bins.length > 0 && bins.some((b) => b.count > 0);

  const toX = (v: number) => PAD.left + v * plotW;
  const toY = (v: number) => PAD.top + (1 - v) * plotH;

  const sortedBins = [...bins]
    .filter((b) => b.count > 0)
    .sort((a, b) => a.predictedProb - b.predictedProb);

  const gridValues = [0.25, 0.5, 0.75];
  const axisValues = [0, 0.5, 1.0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="select-none"
      role="img"
      aria-label="Calibration plot"
    >
      {/* --- Empty state --- */}
      {!hasData && (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-gray-400 dark:fill-gray-500"
          fontSize={12}
        >
          Building track record...
        </text>
      )}

      {hasData && (
        <>
          {/* --- Grid lines (dotted) --- */}
          {gridValues.map((v) => (
            <g key={`grid-${v}`}>
              <line
                x1={toX(v)}
                y1={toY(0)}
                x2={toX(v)}
                y2={toY(1)}
                className="stroke-gray-100 dark:stroke-gray-800"
                strokeDasharray="2 3"
                strokeWidth={0.75}
              />
              <line
                x1={toX(0)}
                y1={toY(v)}
                x2={toX(1)}
                y2={toY(v)}
                className="stroke-gray-100 dark:stroke-gray-800"
                strokeDasharray="2 3"
                strokeWidth={0.75}
              />
            </g>
          ))}

          {/* --- Axis border lines --- */}
          {axisValues.map((v) => (
            <g key={`axis-${v}`}>
              <line
                x1={toX(v)}
                y1={toY(0)}
                x2={toX(v)}
                y2={toY(1)}
                className="stroke-gray-200 dark:stroke-gray-700"
                strokeWidth={v === 0 ? 1 : 0.5}
              />
              <line
                x1={toX(0)}
                y1={toY(v)}
                x2={toX(1)}
                y2={toY(v)}
                className="stroke-gray-200 dark:stroke-gray-700"
                strokeWidth={v === 0 ? 1 : 0.5}
              />
            </g>
          ))}

          {/* --- Tick labels --- */}
          {axisValues.map((v) => (
            <g key={`tick-${v}`}>
              {/* X-axis tick */}
              <text
                x={toX(v)}
                y={toY(0) + 13}
                textAnchor="middle"
                className="fill-gray-400 dark:fill-gray-500"
                fontSize={9}
              >
                {v.toFixed(1)}
              </text>
              {/* Y-axis tick */}
              <text
                x={toX(0) - 6}
                y={toY(v)}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-gray-400 dark:fill-gray-500"
                fontSize={9}
              >
                {v.toFixed(1)}
              </text>
            </g>
          ))}

          {/* --- Perfect calibration diagonal (dashed) --- */}
          <line
            x1={toX(0)}
            y1={toY(0)}
            x2={toX(1)}
            y2={toY(1)}
            className="stroke-gray-300 dark:stroke-gray-600"
            strokeDasharray="5 4"
            strokeWidth={1}
          />

          {/* --- Connecting line through data points --- */}
          {sortedBins.length > 1 && (
            <polyline
              points={sortedBins
                .map((b) => `${toX(b.predictedProb)},${toY(b.observedFreq)}`)
                .join(" ")}
              fill="none"
              className="stroke-indigo-400 dark:stroke-indigo-500"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          )}

          {/* --- Data circles --- */}
          {sortedBins.map((bin, i) => {
            const r = Math.max(3, Math.sqrt(bin.count) * 2.5);
            const cx = toX(bin.predictedProb);
            const cy = toY(bin.observedFreq);

            return (
              <circle
                key={`pt-${i}`}
                cx={cx}
                cy={cy}
                r={r}
                className="fill-indigo-500 dark:fill-indigo-400 stroke-white dark:stroke-gray-900"
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            );
          })}

          {/* --- Tooltip --- */}
          {hoveredIdx !== null && sortedBins[hoveredIdx] && (() => {
            const bin = sortedBins[hoveredIdx];
            const cx = toX(bin.predictedProb);
            const cy = toY(bin.observedFreq);
            const label = `${bin.binLabel}, Observed: ${(bin.observedFreq * 100).toFixed(0)}%, N=${bin.count}`;

            const tooltipW = label.length * 5.6 + 16;
            const tooltipH = 22;

            // Flip tooltip left if it would overflow right edge
            let tx = cx - tooltipW / 2;
            if (tx + tooltipW > width - 2) tx = width - tooltipW - 2;
            if (tx < 2) tx = 2;

            // Place above the circle; flip below if too close to top
            let ty = cy - 14 - tooltipH;
            if (ty < 2) ty = cy + 14;

            return (
              <g pointerEvents="none">
                <rect
                  x={tx}
                  y={ty}
                  width={tooltipW}
                  height={tooltipH}
                  rx={4}
                  className="fill-gray-800 dark:fill-gray-200"
                  opacity={0.92}
                />
                <text
                  x={tx + tooltipW / 2}
                  y={ty + tooltipH / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-white dark:fill-gray-900"
                  fontSize={9}
                  fontWeight={500}
                >
                  {label}
                </text>
              </g>
            );
          })()}

          {/* --- X-axis label --- */}
          <text
            x={PAD.left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            className="fill-gray-500 dark:fill-gray-400"
            fontSize={10}
          >
            Predicted
          </text>

          {/* --- Y-axis label (rotated) --- */}
          <text
            x={12}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(-90, 12, ${PAD.top + plotH / 2})`}
            className="fill-gray-500 dark:fill-gray-400"
            fontSize={10}
          >
            Observed
          </text>
        </>
      )}
    </svg>
  );
}

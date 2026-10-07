"use client";

/**
 * SafeVegaChart - Sandboxed Vega-Lite Visualization Component
 *
 * Security Features:
 * 1. Forbids data.url (prevents external data loading / SSRF)
 * 2. Enforces inline data only via data.values
 * 3. Disables/limits embed actions (export, source, editor)
 * 4. Validates spec complexity before rendering
 *
 * Usage:
 * ```tsx
 * <SafeVegaChart
 *   artifact={dashboardVizArtifact}
 *   className="w-full h-48"
 * />
 * ```
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { AlertCircle, BarChart2, LineChart, PieChart, ScatterChart } from "lucide-react";
import type { VizArtifact, VizIntent } from "../types/dailyBriefSchema";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SafeVegaChartProps {
  artifact: VizArtifact;
  className?: string;
  /** Max spec string length before rejection */
  maxSpecSize?: number;
  /** Show the intent/rationale header */
  showHeader?: boolean;
  /** Callback when chart render fails */
  onError?: (error: Error) => void;
}

interface ValidationError {
  type: "security" | "complexity" | "data" | "spec";
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

function validateVegaSpec(
  spec: Record<string, unknown>,
  data: Array<Record<string, unknown>>,
  maxSpecSize: number
): ValidationError | null {
  const specString = JSON.stringify(spec);

  // 1. Check spec size (complexity guard)
  if (specString.length > maxSpecSize) {
    return {
      type: "complexity",
      message: `Spec too large (${specString.length} > ${maxSpecSize} chars). Simplify the visualization.`
    };
  }

  // 2. SECURITY: Forbid data.url (prevents external data loading)
  if (/"data"\s*:\s*\{[^}]*"url"/i.test(specString)) {
    return {
      type: "security",
      message: "External data URLs are forbidden. Use inline data only."
    };
  }

  // 3. Forbid any url field in data context
  if (/data\.url/i.test(specString)) {
    return {
      type: "security",
      message: "External data loading is disabled for security."
    };
  }

  // 4. Check data array is valid
  if (!Array.isArray(data) || data.length === 0) {
    return {
      type: "data",
      message: "No inline data provided. Cannot render chart."
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENT ICON MAPPING
// ═══════════════════════════════════════════════════════════════════════════

const INTENT_ICONS: Record<VizIntent, React.ReactNode> = {
  time_series: <LineChart className="w-4 h-4" />,
  category_compare: <BarChart2 className="w-4 h-4" />,
  distribution: <BarChart2 className="w-4 h-4" />,
  correlation: <ScatterChart className="w-4 h-4" />,
  part_to_whole: <PieChart className="w-4 h-4" />
};

const INTENT_LABELS: Record<VizIntent, string> = {
  time_series: "Time Series",
  category_compare: "Comparison",
  distribution: "Distribution",
  correlation: "Correlation",
  part_to_whole: "Composition"
};

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK SVG CHART (when Vega not available)
// ═══════════════════════════════════════════════════════════════════════════

interface FallbackChartProps {
  data: Array<Record<string, unknown>>;
  intent: VizIntent;
}

const FallbackChart: React.FC<FallbackChartProps> = ({ data, intent }) => {
  // Simple SVG bar chart fallback
  const maxValue = Math.max(...data.map((d) => Number(d.value || d.count || d.volume || 0)));
  const width = 300;
  const height = 150;
  const barWidth = Math.max(20, (width - 40) / data.length - 4);

  if (intent === "category_compare" || intent === "distribution") {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
        {data.map((d, i) => {
          const value = Number(d.value || d.count || d.volume || 0);
          const barHeight = maxValue > 0 ? (value / maxValue) * (height - 40) : 0;
          const x = 20 + i * (barWidth + 4);
          const y = height - 20 - barHeight;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill="currentColor"
                className="text-content"
                rx={2}
              />
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                className="text-[8px] fill-[color:var(--text-secondary)]"
              >
                {String(d.topic || d.label || d.category || i + 1).slice(0, 6)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  // Line chart fallback for time_series
  if (intent === "time_series") {
    const points = data
      .map((d, i) => {
        const value = Number(d.value || d.count || 0);
        const x = 20 + (i / Math.max(data.length - 1, 1)) * (width - 40);
        const y = height - 20 - (maxValue > 0 ? (value / maxValue) * (height - 40) : 0);
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-content"
        />
        {data.map((d, i) => {
          const value = Number(d.value || d.count || 0);
          const x = 20 + (i / Math.max(data.length - 1, 1)) * (width - 40);
          const y = height - 20 - (maxValue > 0 ? (value / maxValue) * (height - 40) : 0);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={3}
              fill="currentColor"
              className="text-content"
            />
          );
        })}
      </svg>
    );
  }

  // Generic placeholder
  return (
    <div className="flex items-center justify-center h-full text-content-secondary text-sm">
      <span>Chart preview not available</span>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const SafeVegaChart: React.FC<SafeVegaChartProps> = ({
  artifact,
  className = "",
  maxSpecSize = 10000,
  showHeader = true,
  onError
}) => {
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<any>(null);

  // Validate spec before rendering
  const validationError = useMemo(() => {
    return validateVegaSpec(artifact.spec, artifact.data, maxSpecSize);
  }, [artifact.spec, artifact.data, maxSpecSize]);

  // Build safe spec with inline data
  const safeSpec = useMemo(() => {
    if (validationError) return null;

    // Create a copy of the spec
    const spec = { ...artifact.spec };

    // Force inline data - override any data.url
    (spec as any).data = { values: artifact.data };

    // Ensure responsive sizing
    if (!spec.width) (spec as any).width = "container";
    if (!spec.height) (spec as any).height = 150;

    // Add Vega-Lite schema if missing
    if (!(spec as any).$schema) {
      (spec as any).$schema = "https://vega.github.io/schema/vega-lite/v6.json";
    }

    return spec;
  }, [artifact.spec, artifact.data, validationError]);

  // Handle errors
  const handleError = useCallback(
    (err: Error) => {
      setRenderError(err.message);
      onError?.(err);
    },
    [onError]
  );

  // Render Vega-Lite safely via vega-embed (dynamic import, actions disabled).
  useEffect(() => {
    if (!safeSpec || validationError) return;

    let cancelled = false;
    setRenderError(null);
    setIsEmbedded(false);

    (async () => {
      try {
        const mod: any = await import("vega-embed");
        const vegaEmbed = mod?.default ?? mod;
        if (typeof vegaEmbed !== "function") {
          throw new Error("vega-embed not available");
        }

        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;

        // Clean up any prior view.
        if (viewRef.current) {
          try {
            viewRef.current.finalize();
          } catch {
            // ignore
          }
          viewRef.current = null;
        }

        el.innerHTML = "";
        const res = await vegaEmbed(el, safeSpec as any, {
          actions: false, // disable exports/editor
          renderer: "canvas",
        });

        if (cancelled) {
          try {
            res?.view?.finalize?.();
          } catch {
            // ignore
          }
          return;
        }

        viewRef.current = res?.view ?? null;
        setIsEmbedded(true);
      } catch (e: any) {
        if (cancelled) return;
        handleError(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    return () => {
      cancelled = true;
      if (viewRef.current) {
        try {
          viewRef.current.finalize();
        } catch {
          // ignore
        }
        viewRef.current = null;
      }
    };
  }, [handleError, safeSpec, validationError]);

  // Show validation error
  if (validationError) {
    return (
      <div className={`rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">
              Chart blocked: {validationError.type}
            </p>
            <p className="text-xs text-red-600 mt-1">{validationError.message}</p>
          </div>
        </div>
      </div>
    );
  }

  // Show render error
  if (renderError) {
    return (
      <div className={`rounded-lg border border-amber-200 bg-amber-50 p-4 ${className}`}>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Chart render failed</p>
            <p className="text-xs text-amber-600 mt-1">{renderError}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-edge bg-surface overflow-hidden ${className}`}>
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-edge bg-surface-secondary/50">
          <div className="flex items-center gap-2 text-content">
            {INTENT_ICONS[artifact.intent]}
            <span className="text-xs font-medium">{INTENT_LABELS[artifact.intent]}</span>
          </div>
          {artifact.rationale && (
            <span className="text-xs text-content-secondary truncate max-w-[200px]" title={artifact.rationale}>
              {artifact.rationale}
            </span>
          )}
        </div>
      )}

      <div className="p-3">
        {!isEmbedded && (
          <div className="h-[160px]">
            <FallbackChart data={artifact.data} intent={artifact.intent} />
          </div>
        )}
        <div ref={containerRef} className={isEmbedded ? "block" : "hidden"} />
      </div>
    </div>
  );
};

export default SafeVegaChart;

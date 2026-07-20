"use client";

import React, { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { BarChart3, RefreshCw } from "lucide-react";

interface StrategyMetricsPanelProps {
  title: string;
  summary?: string;
  url?: string;
  initialData?: any;
}

export const StrategyMetricsPanel: React.FC<StrategyMetricsPanelProps> = ({ title, summary, url, initialData }) => {
  const refresh = useAction(api.domains.research.strategyMetrics.refreshStrategyMetrics);
  const [report, setReport] = useState<any | null>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (initialData) {
      setReport(initialData);
      return;
    }
    if (!title) return;
    setIsLoading(true);
    refresh({ title, summary, url })
      .then((res) => {
        if (mounted) setReport(res.metrics);
      })
      .catch((err) => {
        if (mounted) setError(err?.message ?? "Failed to load strategy metrics.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [initialData, refresh, summary, title, url]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-content-secondary" />
          <div>
            <div className="text-xs font-bold text-content-muted">Strategy Metrics</div>
            <div className="text-sm font-semibold text-content">Pivot justification</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsLoading(true);
            refresh({ title, summary, url, forceRefresh: true })
              .then((res) => setReport(res.metrics))
              .catch((err) => setError(err?.message ?? "Failed to refresh."))
              .finally(() => setIsLoading(false));
          }}
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      {report?.narrative && (
        <div className="text-xs text-content-secondary leading-relaxed">{report.narrative}</div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        {(report?.metrics ?? []).slice(0, 4).map((metric: any, idx: number) => (
          <div key={`${metric.label}-${idx}`} className="rounded-md border border-edge bg-surface-secondary p-2">
            <div className="text-xs text-content-muted">{metric.label}</div>
            <div className="text-sm font-semibold text-content">
              {metric.value}{metric.unit ? ` ${metric.unit}` : ""}
            </div>
            {metric.context && <div className="text-xs text-content-muted">{metric.context}</div>}
          </div>
        ))}
      </div>

      {report?.risks?.length ? (
        <div className="text-xs text-content-secondary">
          <div className="text-xs text-content-muted">Risks</div>
          <ul className="list-disc list-inside space-y-1">
            {report.risks.slice(0, 3).map((risk: string, idx: number) => (
              <li key={`${risk}-${idx}`}>{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report?.sources?.length ? (
        <div className="flex flex-wrap gap-2 text-xs text-content-muted">
          {report.sources.slice(0, 3).map((source: any, idx: number) => (
            <a
              key={`${source.url}-${idx}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-edge bg-surface-secondary px-2 py-1 hover:text-content-secondary"
            >
              {source.title || "Source"}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default StrategyMetricsPanel;

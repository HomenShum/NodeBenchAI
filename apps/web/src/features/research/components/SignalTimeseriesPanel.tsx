"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { SparkBars } from "./Sparkline";
import { Activity, Download } from "lucide-react";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

interface SignalTimeseriesPanelProps {
  keyword: string;
  days?: number;
}

function SignalTimeseriesPanelContent({ keyword, days = 14 }: SignalTimeseriesPanelProps) {
  const timeseries = useQuery(
    api.domains.research.signalTimeseries.getSignalTimeseries,
    keyword ? { keyword, days } : "skip",
  );

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const counts = useMemo(() => (timeseries ?? []).map((point) => point.count), [timeseries]);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const latest = counts[counts.length - 1] ?? 0;
  const activePoint = useMemo(() => {
    if (!timeseries || timeseries.length === 0) return null;
    if (activeIndex !== null && timeseries[activeIndex]) return timeseries[activeIndex];
    return timeseries[timeseries.length - 1];
  }, [activeIndex, timeseries]);
  const activeEvents = useMemo(() => activePoint?.events ?? [], [activePoint]);
  const labels = useMemo(() => {
    if (!timeseries) return [];
    return timeseries.map((point) => `${point.date}: ${point.count} hits`);
  }, [timeseries]);
  const ledgerRows = useMemo(() => {
    if (!timeseries) return [];
    return timeseries.slice(-7);
  }, [timeseries]);

  const handleExport = () => {
    if (!timeseries || timeseries.length === 0) return;
    const rows = [
      ["date", "count", "events"].join(","),
      ...timeseries.map((point: any) => {
        const events = (point.events ?? []).map((ev: any) => ev.title).join(" | ");
        const safeEvents = `"${events.replace(/"/g, '""')}"`;
        return `${point.date},${point.count},${safeEvents}`;
      }),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `signal-${keyword}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!keyword) return null;

  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-content-secondary" />
        <div>
          <div className="text-xs font-bold text-content-muted">Signal Momentum</div>
          <div className="text-sm font-semibold text-content">{keyword}</div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-content-secondary">
        <span>Total {total} hits</span>
        <div className="flex items-center gap-2">
          <span>Latest: {latest}</span>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center gap-1 text-xs text-content-muted hover:text-content-secondary"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center">
        <SparkBars
          data={counts}
          width={180}
          height={40}
          color="#0f172a"
          labels={labels}
          onBarHover={setActiveIndex}
          onBarLeave={() => setActiveIndex(null)}
        />
      </div>

      {activePoint && (
        <div className="rounded-md border border-edge bg-surface-secondary px-3 py-2 text-xs text-content-secondary">
          <div className="text-xs text-content-muted">Active day</div>
          <div className="font-semibold text-content">
            {activePoint.date} • {activePoint.count} hits
          </div>
        </div>
      )}

      {activeEvents.length > 0 && (
        <div className="space-y-2 text-xs text-content-secondary">
          <div className="text-xs text-content-muted">Mapped events</div>
          {activeEvents.map((event: any, idx: number) => (
            <a
              key={`${event.title}-${idx}`}
              href={event.url || "#"}
              target={event.url ? "_blank" : undefined}
              rel={event.url ? "noopener noreferrer" : undefined}
              className="block rounded-md border border-edge bg-surface-secondary px-2 py-1 hover:border-edge"
            >
              <div className="font-semibold text-content">{event.title}</div>
              {event.source && <div className="text-xs text-content-muted">{event.source}</div>}
            </a>
          ))}
        </div>
      )}

      {ledgerRows.length > 0 && (
        <div className="space-y-2 text-xs text-content-secondary">
          <div className="text-xs text-content-muted">Event ledger</div>
          <div className="space-y-1">
            {ledgerRows.map((row: any, idx: number) => (
              <div
                key={`${row.date}-${idx}`}
                className="flex items-center justify-between rounded-md border border-edge bg-surface px-2 py-1"
              >
                <span className="text-content-secondary">{row.date}</span>
                <span className="text-content-secondary">{row.count} hits</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SignalTimeseriesPanelFallback({ keyword }: { keyword: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-content-secondary" />
        <div>
          <div className="text-xs font-bold text-content-muted">Signal Momentum</div>
          <div className="text-sm font-semibold text-content">{keyword}</div>
        </div>
      </div>
      <div className="text-xs text-content-muted">Timeseries temporarily unavailable</div>
    </div>
  );
}

export const SignalTimeseriesPanel: React.FC<SignalTimeseriesPanelProps> = (props) => {
  if (!props.keyword) return null;

  return (
    <ErrorBoundary
      section="Signal timeseries"
      fallback={<SignalTimeseriesPanelFallback keyword={props.keyword} />}
    >
      <SignalTimeseriesPanelContent {...props} />
    </ErrorBoundary>
  );
};

export default SignalTimeseriesPanel;

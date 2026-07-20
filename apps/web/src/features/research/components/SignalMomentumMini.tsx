"use client";

import React, { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { SparkBars } from "./Sparkline";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";

interface SignalMomentumMiniProps {
  keyword: string;
  days?: number;
}

function SignalMomentumMiniContent({ keyword, days = 10 }: SignalMomentumMiniProps) {
  const cleanedKeyword = useMemo(() => {
    const words = keyword.split(/\s+/).map((word) => word.replace(/[^a-z0-9]/gi, ""));
    const candidate = words.find((word) => word.length > 3);
    return candidate || keyword.split(" ")[0];
  }, [keyword]);

  const timeseries = useQuery(
    api.domains.research.signalTimeseries.getSignalTimeseries,
    cleanedKeyword ? { keyword: cleanedKeyword, days } : "skip",
  );

  const counts = useMemo(() => (timeseries ?? []).map((point) => point.count), [timeseries]);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const latest = counts[counts.length - 1] ?? 0;

  if (!cleanedKeyword) return null;

  return (
    <div className="mt-6 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-content-secondary flex items-center justify-between gap-3">
      <div>
        <div className="text-xs text-content-muted">Momentum</div>
        <div className="text-xs font-semibold text-content-secondary">{cleanedKeyword}</div>
      </div>
      <div className="flex items-center gap-3">
        <SparkBars data={counts} width={90} height={24} color="#111827" />
        <div className="text-xs text-content-secondary">
          {latest} latest / {total} total
        </div>
      </div>
    </div>
  );
}

function SignalMomentumMiniFallback({ keyword }: { keyword: string }) {
  return (
    <div className="mt-6 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-content-secondary">
      <div className="text-xs text-content-muted">Momentum</div>
      <div className="text-xs font-semibold text-content-secondary">{keyword}</div>
      <div className="mt-1 text-xs text-content-muted">Temporarily unavailable</div>
    </div>
  );
}

export const SignalMomentumMini: React.FC<SignalMomentumMiniProps> = (props) => {
  if (!props.keyword) return null;

  return (
    <ErrorBoundary
      section="Signal momentum"
      fallback={<SignalMomentumMiniFallback keyword={props.keyword} />}
    >
      <SignalMomentumMiniContent {...props} />
    </ErrorBoundary>
  );
};

export default SignalMomentumMini;

/**
 * useImprovementData — Fetches aggregated improvement timeline from
 * /api/improvements/stats. Same pattern as useHyperLoopData in
 * HyperLoopDashboard.
 */

import { useState, useEffect, useCallback } from "react";

// ── Types (mirror server response) ───────────────────────────────────

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: "trajectory_recorded" | "replay_success" | "eval_improvement" | "eval_regression" | "archive_promotion";
  entityName: string | null;
  classification: string | null;
  before: { qualityScore?: number; durationMs?: number; tokenCount?: number };
  after: { qualityScore?: number; durationMs?: number; tokenCount?: number };
  delta: { qualityDelta?: number; timeSavedMs?: number; tokensSavedPct?: number };
  details: {
    toolsCalled?: string[];
    sourcesCited?: number;
    claims?: number;
    suggestions?: string[];
    lens?: string;
    query?: string;
    driftScore?: number;
    scoreComponents?: Array<{ key: string; label: string; weightedContribution: number }>;
  };
}

export interface ImprovementData {
  summary: {
    totalTrajectories: number;
    totalReplays: number;
    avgTokenSavingsPct: number;
    avgTimeSavingsPct: number;
    estimatedCostSavedUsd: number;
    avgQualityScore: number;
    archiveTotal: number;
    promotedCount: number;
    validatedCount: number;
    candidateCount: number;
    totalEvaluations: number;
  };
  timeline: TimelineEvent[];
  qualityCurve: Array<{ timestamp: string; avgQuality: number; sampleSize: number }>;
  savingsCurve: Array<{ timestamp: string; cumulativeTokensSavedPct: number; cumulativeTimeSavedPct: number; cumulativeReplays: number }>;
  replayAdoption: { total: number; replayed: number; fullPipeline: number; replayPct: number };
  promotionFunnel: { candidates: number; validated: number; promoted: number; retired: number };
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useImprovementData(): {
  data: ImprovementData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<ImprovementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch("/api/improvements/stats", { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json as ImprovementData);
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message ?? "Failed to load improvement data");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}

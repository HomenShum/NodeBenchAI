"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Sparkline, SparkBars } from "./Sparkline";
import { GitBranch, Star, Clock, RefreshCw } from "lucide-react";

interface RepoStatsPanelProps {
  repoUrl: string;
  initialData?: any;
}

export const RepoStatsPanel: React.FC<RepoStatsPanelProps> = ({ repoUrl, initialData }) => {
  const statsQuery = useQuery(api.domains.research.repoStatsQueries.getRepoStats, { repoUrl });
  const stats = initialData ?? statsQuery;
  const refresh = useAction(api.domains.research.repoStats.refreshRepoStats);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!repoUrl) return;
    if (stats && stats.fetchedAt) return;

    setIsRefreshing(true);
    refresh({ repoUrl })
      .catch((err: any) => {
        if (mounted) setError(err?.message ?? "Failed to load repo stats.");
      })
      .finally(() => {
        if (mounted) setIsRefreshing(false);
      });

    return () => {
      mounted = false;
    };
  }, [repoUrl, refresh, stats]);

  const starHistory = stats?.starHistory ?? [];
  const commitHistory = stats?.commitHistory ?? [];

  const starsPerDay = useMemo(() => {
    const recent = starHistory.slice(-7);
    if (!recent.length) return 0;
    const total = recent.reduce((sum: number, item: any) => sum + (item.delta ?? item.stars ?? 0), 0);
    return Math.round(total / recent.length);
  }, [starHistory]);

  const commitsPerWeek = useMemo(() => {
    const recent = commitHistory.slice(-4);
    if (!recent.length) return 0;
    const total = recent.reduce((sum: number, item: any) => sum + (item.commits ?? 0), 0);
    return Math.round(total / recent.length);
  }, [commitHistory]);

  const lastPush = stats?.pushedAt ? new Date(stats.pushedAt).toLocaleDateString("en-US") : "n/a";

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
        <div>
          <div className="text-xs font-bold text-content-muted">Repo Momentum</div>
          <div className="text-sm font-semibold text-content">{stats?.repoFullName ?? "GitHub Repo"}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsRefreshing(true);
            refresh({ repoUrl, forceRefresh: true })
              .catch((err: any) => setError(err?.message ?? "Failed to refresh."))
              .finally(() => setIsRefreshing(false));
          }}
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
          aria-label="Refresh repo stats"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs text-content-secondary">
        <div className="rounded-md border border-edge bg-surface-secondary p-2">
          <div className="flex items-center gap-1 text-xs text-content-muted">
            <Star className="w-3 h-3" /> Stars/day
          </div>
          <div className="text-lg font-semibold text-content">{starsPerDay}</div>
        </div>
        <div className="rounded-md border border-edge bg-surface-secondary p-2">
          <div className="flex items-center gap-1 text-xs text-content-muted">
            <GitBranch className="w-3 h-3" /> Commits/wk
          </div>
          <div className="text-lg font-semibold text-content">{commitsPerWeek}</div>
        </div>
        <div className="rounded-md border border-edge bg-surface-secondary p-2">
          <div className="flex items-center gap-1 text-xs text-content-muted">
            <Clock className="w-3 h-3" /> Last push
          </div>
          <div className="text-sm font-semibold text-content">{lastPush}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold text-content-muted mb-1">Star Velocity</div>
          <Sparkline
            data={starHistory.map((item: any) => item.delta ?? item.stars ?? 0)}
            stroke="#111827"
          />
        </div>
        <div>
          <div className="text-xs font-bold text-content-muted mb-1">Commit Velocity</div>
          <SparkBars
            data={commitHistory.map((item: any) => item.commits ?? 0)}
            color="#0f172a"
          />
        </div>
      </div>
    </div>
  );
};

export default RepoStatsPanel;

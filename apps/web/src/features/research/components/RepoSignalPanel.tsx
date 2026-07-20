"use client";

import React, { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Network, RefreshCw, Star, GitBranch } from "lucide-react";
import SignalMomentumMini from "./SignalMomentumMini";

interface RepoSignalPanelProps {
  title: string;
  summary?: string;
  url?: string;
}

export const RepoSignalPanel: React.FC<RepoSignalPanelProps> = ({ title, summary, url }) => {
  const refresh = useAction(api.domains.research.repoScout.refreshRepoScout);
  const [report, setReport] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!title) return;
    setIsLoading(true);
    refresh({ title, summary, url })
      .then((res) => {
        if (mounted) setReport(res.report);
      })
      .catch((err) => {
        if (mounted) setError(err?.message ?? "Failed to scout repos.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refresh, summary, title, url]);

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
          <Network className="w-4 h-4 text-content-secondary" />
          <div>
            <div className="text-xs font-bold text-content-muted">Moat Pressure</div>
            <div className="text-sm font-semibold text-content">Open-source challengers</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsLoading(true);
            refresh({ title, summary, url, forceRefresh: true })
              .then((res) => setReport(res.report))
              .catch((err) => setError(err?.message ?? "Failed to refresh."))
              .finally(() => setIsLoading(false));
          }}
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      {report?.moatSummary && (
        <div className="text-xs text-content-secondary leading-relaxed">{report.moatSummary}</div>
      )}

      <SignalMomentumMini keyword={title} />

      {report?.moatRisks?.length ? (
        <ul className="list-disc list-inside text-xs text-content-secondary space-y-1">
          {report.moatRisks.slice(0, 3).map((risk: string, idx: number) => (
            <li key={`${risk}-${idx}`}>{risk}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        {(report?.repos ?? []).slice(0, 4).map((repo: any, idx: number) => (
          <a
            key={`${repo.url}-${idx}`}
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-edge bg-surface-secondary px-3 py-2 hover:border-gray-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-content">{repo.name}</div>
              <div className="flex items-center gap-2 text-xs text-content-secondary">
                <span className="inline-flex items-center gap-1"><Star className="w-3 h-3" /> {repo.starVelocity}/day</span>
                <span className="inline-flex items-center gap-1"><GitBranch className="w-3 h-3" /> {repo.commitsPerWeek}/wk</span>
              </div>
            </div>
            {repo.description && (
              <div className="text-xs text-content-secondary mt-1 line-clamp-2">{repo.description}</div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
};

export default RepoSignalPanel;

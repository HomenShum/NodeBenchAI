"use client";

import React, { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { EntityRadar } from "./EntityRadar";

interface StackImpactPanelProps {
  title: string;
  summary?: string;
  url?: string;
  techStack: string[];
}

export const StackImpactPanel: React.FC<StackImpactPanelProps> = ({
  title,
  summary,
  url,
  techStack,
}) => {
  // All hooks must be called before any early returns
  const refresh = useAction(api.domains.research.stackImpact.refreshStackImpact);
  const [impact, setImpact] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasValidTechStack = techStack && techStack.length > 0;

  useEffect(() => {
    let mounted = true;
    if (!title || techStack.length === 0) return;
    setIsLoading(true);
    refresh({ title, summary, url, techStack })
      .then((result) => {
        if (mounted) setImpact(result.impact);
      })
      .catch((err) => {
        if (mounted) setError(err?.message ?? "Failed to map stack impact.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refresh, summary, techStack, title, url]);

  // Early returns after all hooks are called
  if (!hasValidTechStack) {
    return (
      <div className="rounded-lg border border-edge bg-surface p-4 space-y-2">
        <div className="text-xs font-bold text-content-muted">Stack Impact</div>
        <div className="text-sm font-semibold text-content">Set your tech stack</div>
        <div className="text-xs text-content-secondary">
          Add your stack in Settings to map direct and second-order exposure.
        </div>
      </div>
    );
  }

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
          <div className="text-xs font-bold text-content-muted">Stack Impact</div>
          <div className="text-sm font-semibold text-content">Dependency Map</div>
        </div>
        <button
          type="button"
          onClick={() =>
            refresh({ title, summary, url, techStack, forceRefresh: true }).then((res) => setImpact(res.impact))
          }
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
          aria-label="Refresh stack impact"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      {impact?.summary && (
        <div className="text-xs text-content-secondary leading-relaxed">{impact.summary}</div>
      )}

      {impact?.riskLevel && (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-xs font-bold">
          <AlertTriangle className="w-3 h-3" />
          {impact.riskLevel} risk
        </div>
      )}

      {(() => {
        const sourceCveUrl = impact?.sourceUrls?.find((url: string) => /CVE-\\d{4}-\\d{4,7}/i.test(url));
        const cveUrl = impact?.cveUrl ?? sourceCveUrl;
        const cveId =
          impact?.cveId ??
          (cveUrl ? cveUrl.match(/CVE-\\d{4}-\\d{4,7}/i)?.[0] : undefined);
        if (!cveId && !cveUrl) return null;
        return (
        <div className="text-xs text-content-secondary">
          <span className="font-semibold">CVE:</span>{" "}
          {cveUrl ? (
            <a
              href={cveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-content-secondary hover:text-content"
            >
              {cveId || cveUrl}
            </a>
          ) : (
            cveId
          )}
        </div>
        );
      })()}

      <EntityRadar graph={impact?.graph ?? null} />

      {impact?.sourceUrls?.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-content-muted">Sources</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {impact.sourceUrls.slice(0, 4).map((url: string, idx: number) => {
              let label = url;
              try {
                label = new URL(url).hostname.replace(/^www\./, "");
              } catch {
                label = url;
              }
              return (
                <a
                  key={`${url}-${idx}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-full border border-edge bg-surface-secondary px-2 py-1 text-content-secondary hover:text-content"
                >
                  {label}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StackImpactPanel;

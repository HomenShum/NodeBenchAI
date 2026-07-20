"use client";

import React, { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { FileText, RefreshCw, ExternalLink } from "lucide-react";

interface PaperDetailsCardProps {
  url: string;
  title?: string;
}

export const PaperDetailsCard: React.FC<PaperDetailsCardProps> = ({ url, title }) => {
  const refresh = useAction(api.domains.research.paperDetails.refreshPaperDetails);
  const [details, setDetails] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!url) return;
    setIsLoading(true);
    refresh({ url, title })
      .then((result) => {
        if (mounted) setDetails(result.details);
      })
      .catch((err) => {
        if (mounted) setError(err?.message ?? "Failed to load paper details.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refresh, title, url]);

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
          <div className="text-xs font-bold text-content-muted">Citation Card</div>
          <div className="text-sm font-semibold text-content">{details?.title ?? "Research Paper"}</div>
        </div>
        <button
          type="button"
          onClick={() => refresh({ url, title, forceRefresh: true }).then((res) => setDetails(res.details))}
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-content-secondary"
          aria-label="Refresh paper details"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      {details?.authors?.length > 0 && (
        <div className="text-xs text-content-secondary">
          {details.authors.slice(0, 4).join(", ")}
        </div>
      )}

      {typeof details?.citationCount === "number" && (
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full border border-indigo-100 bg-indigo-50 text-xs font-semibold text-content-secondary">
          {details.citationCount} citations
        </div>
      )}

      <div className="text-xs text-content-secondary leading-relaxed">
        <span className="text-xs font-bold text-content-muted">Abstract</span>
        <div className="mt-1">{details?.abstract || "Abstract unavailable."}</div>
      </div>

      {details?.methodology && (
        <div className="text-xs text-content-secondary leading-relaxed">
          <span className="text-xs font-bold text-content-muted">Methodology</span>
          <div className="mt-1">{details.methodology}</div>
        </div>
      )}

      {details?.keyFindings?.length > 0 && (
        <div className="text-xs text-content-secondary">
          <span className="text-xs font-bold text-content-muted">Key Findings</span>
          <ul className="mt-2 list-disc list-inside space-y-1">
            {details.keyFindings.slice(0, 4).map((item: string, idx: number) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-edge">
        {details?.pdfUrl && (
          <a
            href={details.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-content-secondary hover:text-content"
          >
            <FileText className="w-3 h-3" />
            PDF
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-content-secondary hover:text-content-secondary"
        >
          View source
        </a>
      </div>
    </div>
  );
};

export default PaperDetailsCard;

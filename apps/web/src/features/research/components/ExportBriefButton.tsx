"use client";

/**
 * ExportBriefButton - Export/Share the Daily Brief with provenance intact
 *
 * Supports:
 * - Copy to clipboard (Markdown)
 * - Download as Markdown file
 * - Share via native share API (if available)
 */

import React, { useState, useCallback } from "react";
import { Download, Copy, Share2, Check, FileText } from "lucide-react";
import type { DailyBriefPayload } from "../types/dailyBriefSchema";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ExportBriefButtonProps {
  brief: DailyBriefPayload;
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKDOWN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function briefToMarkdown(brief: DailyBriefPayload): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  // Header
  lines.push(`# Daily Brief`);
  lines.push(`*Generated: ${brief.provenance?.generation?.generatedAt || now}*`);
  lines.push("");

  // Day Thesis
  if (brief.meta?.summary) {
    lines.push(`## Executive Summary`);
    lines.push(`> ${brief.meta.summary}`);
    lines.push("");
  }

  // Quality Metrics
  if (brief.quality) {
    lines.push(`## Quality Metrics`);
    lines.push(`- **Coverage**: ${brief.quality.coverage.itemsScanned} item${brief.quality.coverage.itemsScanned !== 1 ? 's' : ''} from ${brief.quality.coverage.sourcesCount} source${brief.quality.coverage.sourcesCount !== 1 ? 's' : ''}`);
    lines.push(`- **Freshness**: ${brief.quality.freshness.medianAgeHours}h median age (${brief.quality.freshness.windowLabel})`);
    lines.push(`- **Confidence**: ${brief.quality.confidence.score}% (${brief.quality.confidence.level})`);
    lines.push("");
  }

  // Act II: Signals
  if (brief.actII?.signals && brief.actII.signals.length > 0) {
    lines.push(`## Signals`);
    brief.actII.signals.forEach((signal, i) => {
      lines.push(`### ${i + 1}. ${signal.headline}`);
      if (signal.deltaSummary) lines.push(`*${signal.deltaSummary}*`);
      lines.push("");
      lines.push(signal.synthesis);
      lines.push("");
      if (signal.evidence && signal.evidence.length > 0) {
        lines.push(`**Sources:**`);
        signal.evidence.forEach((ev) => {
          lines.push(`- [${ev.title}](${ev.url}) - ${ev.source}`);
        });
        lines.push("");
      }
    });
  }

  // Act III: Actions
  if (brief.actIII?.actions && brief.actIII.actions.length > 0) {
    lines.push(`## Recommended Actions`);
    brief.actIII.actions.forEach((action, i) => {
      lines.push(`### ${i + 1}. ${action.label}`);
      lines.push(`*Status: ${action.status}*`);
      if (action.whyNow) lines.push(`**Why now:** ${action.whyNow}`);
      if (action.deliverable) lines.push(`**Deliverable:** ${action.deliverable}`);
      if (action.expectedOutcome) lines.push(`**Expected outcome:** ${action.expectedOutcome}`);
      if (action.risks) lines.push(`**Risks:** ${action.risks}`);
      lines.push("");
      lines.push(action.content || action.resultMarkdown || "");
      lines.push("");
    });
  }

  // Provenance
  if (brief.provenance) {
    lines.push(`---`);
    lines.push(`## Provenance`);
    lines.push(`- **Model**: ${brief.provenance.generation.model}`);
    lines.push(`- **Generated At**: ${brief.provenance.generation.generatedAt}`);
    lines.push(`- **Validation**: ${brief.provenance.generation.validationStatus}`);
    if (brief.provenance.generation.retryCount) {
      lines.push(`- **Retries**: ${brief.provenance.generation.retryCount}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function ExportBriefButton({ brief, className = "" }: ExportBriefButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const markdown = useCallback(() => briefToMarkdown(brief), [brief]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [markdown]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([markdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-brief-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [markdown]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Daily Brief",
          text: brief.meta?.summary || "Daily Brief",
          url: window.location.href,
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Share failed:", err);
        }
      }
    }
  }, [brief.meta?.summary]);

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 bg-surface border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
      >
        <Share2 className="w-4 h-4" />
        Export
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-slate-200 rounded-lg shadow-lg z-50 py-1">
          <button
            type="button"
            onClick={() => {
              handleCopy();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-indigo-500" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy as Markdown"}
          </button>

          <button
            type="button"
            onClick={() => {
              handleDownload();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download .md
          </button>

          {canShare && (
            <button
              type="button"
              onClick={() => {
                handleShare();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              Share...
            </button>
          )}

          <div className="border-t border-slate-100 my-1" />

          <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1">
            <FileText className="w-3 h-3" />
            Includes provenance metadata
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

export default ExportBriefButton;


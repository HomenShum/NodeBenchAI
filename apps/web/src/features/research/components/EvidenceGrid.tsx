"use client";

/**
 * EvidenceGrid Component
 *
 * Renders evidence items in a horizontal scrollable card grid.
 * Used in SignalCard to show sources backing each signal.
 * Supports highlight animation when scrolled to from chart tooltip.
 */

import React from "react";
import { ExternalLink, Clock, TrendingUp } from "lucide-react";
import type { Evidence } from "../types/dailyBriefSchema";
import { useEvidenceHighlight } from "../contexts/EvidenceContext";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return "";
  }
}

function formatRelativeTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function getDomainName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "source";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE CARD
// ═══════════════════════════════════════════════════════════════════════════

interface EvidenceCardProps {
  evidence: Evidence;
  index: number;
}

function EvidenceCard({ evidence, index }: EvidenceCardProps) {
  const faviconUrl = evidence.favicon || getFaviconUrl(evidence.url);
  const timeAgo = formatRelativeTime(evidence.publishedAt);
  const domain = getDomainName(evidence.url);

  // Check if this card is currently highlighted (scrolled-to from chart)
  const isHighlighted = useEvidenceHighlight(evidence.id);

  return (
    <a
      href={evidence.url}
      target="_blank"
      rel="noopener noreferrer"
      data-evidence-id={evidence.id}
      className={`
        group flex-shrink-0 w-[260px] bg-surface border rounded-lg p-3
        transition-all duration-300
        hover:border-indigo-300
        hover:bg-gradient-to-br hover:from-indigo-50/50 hover:to-white
        ${isHighlighted
          ? "border-indigo-500 shadow-lg shadow-indigo-200/50 ring-2 ring-ring motion-safe:animate-pulse"
          : "border-edge"
        }
      `}
    >
      {/* Header: Favicon + Source + Score */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {faviconUrl && (
            <img
              src={faviconUrl}
              alt=""
              className="w-4 h-4 rounded-sm"
              width={16}
              height={16}
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          )}
          <span className="text-xs font-semibold tracking-wide text-content-secondary">
            {evidence.source}
          </span>
        </div>
        {evidence.score !== undefined && evidence.score > 0 && (
          <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
            <TrendingUp className="w-3 h-3" />
            <span>{evidence.score}</span>
          </div>
        )}
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-content line-clamp-2 mb-2 group-hover:text-indigo-700 transition-colors">
        {evidence.title}
      </h4>

      {/* Relevance */}
      <p className="text-xs text-content line-clamp-2 mb-2">
        {evidence.relevance}
      </p>

      {/* Footer: Time + Link Icon */}
      <div className="flex items-center justify-between pt-2 border-t border-edge">
        <div className="flex items-center gap-1 text-xs text-content-secondary">
          <Clock className="w-3 h-3" />
          <span>{timeAgo}</span>
        </div>
        <ExternalLink className="w-3 h-3 text-content-secondary group-hover:text-indigo-500 transition-colors" />
      </div>
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE GRID
// ═══════════════════════════════════════════════════════════════════════════

interface EvidenceGridProps {
  evidence: Evidence[];
  className?: string;
}

export function EvidenceGrid({ evidence, className = "" }: EvidenceGridProps) {
  if (!evidence || evidence.length === 0) {
    return null;
  }

  return (
    <div className={`relative ${className}`}>
      {/* Section Label */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold tracking-wide text-content-secondary">
          Evidence ({evidence.length})
        </span>
        <div className="flex-1 h-px bg-[color:var(--border-color)]" />
      </div>

      {/* Horizontal Scroll Container */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-surface-secondary scrollbar-track-surface-secondary">
        {evidence.map((ev, idx) => (
          <EvidenceCard key={ev.id || idx} evidence={ev} index={idx} />
        ))}
      </div>

      {/* Fade edge (right) */}
      {evidence.length > 2 && (
        <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface pointer-events-none" />
      )}
    </div>
  );
}

export default EvidenceGrid;


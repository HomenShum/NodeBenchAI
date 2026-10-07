"use client";

/**
 * EvidenceTimeline Component
 *
 * Renders a vertical list of evidence items with direction indicators
 * (supporting / disconfirming / neutral). Items are expandable to show
 * excerpt text and source links. Supports maxVisible overflow with
 * "Show N more" toggle.
 */

import React, { useState, useCallback } from "react";
import { ExternalLink, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface EvidenceTimelineItem {
  date: string;
  title: string;
  direction: "supporting" | "disconfirming" | "neutral";
  sourceUrl?: string;
  excerpt?: string;
}

interface EvidenceTimelineProps {
  items: EvidenceTimelineItem[];
  maxVisible?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIRECTION DOT
// ═══════════════════════════════════════════════════════════════════════════

const DIRECTION_COLORS: Record<EvidenceTimelineItem["direction"], string> = {
  supporting: "bg-green-500",
  disconfirming: "bg-red-500",
  neutral: "bg-gray-400",
};

const DIRECTION_LABELS: Record<EvidenceTimelineItem["direction"], string> = {
  supporting: "Supporting",
  disconfirming: "Disconfirming",
  neutral: "Neutral",
};

function DirectionDot({ direction }: { direction: EvidenceTimelineItem["direction"] }) {
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", DIRECTION_COLORS[direction])}
      title={DIRECTION_LABELS[direction]}
      aria-label={DIRECTION_LABELS[direction]}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE ENTRY
// ═══════════════════════════════════════════════════════════════════════════

interface TimelineEntryProps {
  item: EvidenceTimelineItem;
}

function TimelineEntry({ item }: TimelineEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const hasExpandableContent = Boolean(item.excerpt || item.sourceUrl);

  const handleToggle = useCallback(() => {
    if (hasExpandableContent) {
      setExpanded((prev) => !prev);
    }
  }, [hasExpandableContent]);

  return (
    <div className="py-3 px-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={!hasExpandableContent}
        className={cn(
          "w-full text-left flex items-start gap-3 group",
          hasExpandableContent && "cursor-pointer"
        )}
        aria-expanded={hasExpandableContent ? expanded : undefined}
      >
        {/* Direction dot + date column */}
        <div className="flex flex-col items-center gap-1 pt-0.5 flex-shrink-0 min-w-[72px]">
          <DirectionDot direction={item.direction} />
          <span className="text-xs text-content-secondary">{item.date}</span>
        </div>

        {/* Title + chevron */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {hasExpandableContent && (
              <ChevronRight
                className={cn(
                  "w-3.5 h-3.5 text-content-muted transition-transform duration-200 flex-shrink-0",
                  expanded && "rotate-90"
                )}
              />
            )}
            <span className="text-sm text-content group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2">
              {item.title}
            </span>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 ml-[84px] space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {item.excerpt && (
            <p className="text-xs text-content-secondary leading-relaxed">
              {item.excerpt}
            </p>
          )}
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              View source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE TIMELINE
// ═══════════════════════════════════════════════════════════════════════════

export function EvidenceTimeline({ items, maxVisible = 5 }: EvidenceTimelineProps) {
  const [showAll, setShowAll] = useState(false);

  if (!items || items.length === 0) {
    return null;
  }

  const visibleItems = showAll ? items : items.slice(0, maxVisible);
  const overflowCount = items.length - maxVisible;
  const hasOverflow = overflowCount > 0 && !showAll;

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {visibleItems.map((item, idx) => (
        <TimelineEntry key={`${item.date}-${item.title}-${idx}`} item={item} />
      ))}

      {hasOverflow && (
        <div className="py-2 px-2">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
          >
            Show {overflowCount} more
          </button>
        </div>
      )}

      {showAll && overflowCount > 0 && (
        <div className="py-2 px-2">
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-xs text-content-secondary hover:underline"
          >
            Show less
          </button>
        </div>
      )}
    </div>
  );
}

export default EvidenceTimeline;

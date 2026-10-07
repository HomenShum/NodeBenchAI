"use client";

/**
 * NarrativeCard - ForYouFeed-style Card for Narratives
 *
 * Displays a narrative thread as a card suitable for feed display.
 * Matches the editorial newspaper style of ForYouFeed.
 *
 * @module features/narrative/components/NarrativeCard
 */

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Bookmark,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Clock,
} from "lucide-react";
import type { NarrativeThread, NarrativeEvent, ThreadPhase } from "../../types";
import { PHASE_COLORS } from "../../types";

interface NarrativeCardProps {
  thread: NarrativeThread;
  latestEvent?: NarrativeEvent;
  variant?: "hero" | "standard" | "compact";
  onSave?: () => void;
  onClick?: () => void;
}

/**
 * Format relative time
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Get phase label and icon
 */
function getPhaseDisplay(phase: ThreadPhase): { label: string; icon: React.ReactNode } {
  switch (phase) {
    case "emerging":
      return { label: "Emerging Story", icon: <Sparkles className="w-3 h-3" /> };
    case "escalating":
      return { label: "Escalating", icon: <TrendingUp className="w-3 h-3" /> };
    case "climax":
      return { label: "Breaking", icon: <AlertTriangle className="w-3 h-3" /> };
    case "resolution":
      return { label: "Resolving", icon: <TrendingUp className="w-3 h-3 rotate-180" /> };
    case "dormant":
      return { label: "Dormant", icon: <Clock className="w-3 h-3" /> };
  }
}

/**
 * NarrativeCard Component
 */
export function NarrativeCard({
  thread,
  latestEvent,
  variant = "standard",
  onSave,
  onClick,
}: NarrativeCardProps) {
  const [saved, setSaved] = useState(false);
  const phaseColors = PHASE_COLORS[thread.currentPhase];
  const phaseDisplay = getPhaseDisplay(thread.currentPhase);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaved(!saved);
    onSave?.();
  };

  if (variant === "hero") {
    return (
      <article onClick={onClick} className="group cursor-pointer">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Text Content */}
          <div className="flex-1 space-y-3">
            {/* Category Tag */}
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 text-xs font-medium ${phaseColors.text}`}>
                {phaseDisplay.icon}
                {phaseDisplay.label}
              </span>
              {thread.plotTwistCount > 0 && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs text-red-600 font-medium">
                    {thread.plotTwistCount} plot twist{thread.plotTwistCount > 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>

            {/* Headline */}
            <h3 className="text-2xl md:text-3xl font-bold text-content leading-tight group-hover:text-content transition-colors">
              {thread.name}
            </h3>

            {/* Thesis */}
            <p className="text-content-secondary leading-relaxed text-lg font-normal line-clamp-3">
              {thread.thesis}
            </p>

            {/* Latest Event */}
            {latestEvent && (
              <div className="bg-surface-secondary rounded-lg p-3 border border-edge">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-content-secondary">Latest Development</span>
                  <span className="text-xs text-content-muted">
                    {formatTimeAgo(latestEvent.occurredAt)}
                  </span>
                </div>
                <p className="text-sm text-content-secondary line-clamp-2">
                  {latestEvent.headline}
                </p>
              </div>
            )}

            {/* Meta */}
            <div className="flex items-center gap-4 pt-2">
              <div className="flex flex-wrap gap-1.5">
                {thread.entityKeys.slice(0, 2).map((key) => (
                  <span
                    key={key}
                    className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-md"
                  >
                    {key.split(":")[1] || key}
                  </span>
                ))}
              </div>
              <span className="text-sm text-content-muted">
                {thread.eventCount} events
              </span>
              <button
                type="button"
                onClick={handleSave}
                className={`ml-auto p-2 rounded-full transition-colors ${
                  saved
                    ? "text-content-secondary bg-indigo-50"
                    : "text-content-muted hover:text-content-secondary hover:bg-surface-hover"
                }`}
                title={saved ? "Saved" : "Save for later"}
                aria-label={saved ? "Saved" : "Save for later"}
              >
                <Bookmark className={`w-4 h-4 ${saved ? "fill-current" : ""}`} />
              </button>
            </div>
          </div>

          {/* Visual Element */}
          <div className={`w-full md:w-64 h-40 md:h-auto rounded flex items-center justify-center flex-shrink-0 ${phaseColors.bg} ${phaseColors.border} border`}>
            <div className="text-center">
              <div className={`text-2xl mb-2 ${phaseColors.text}`}>
                {phaseDisplay.icon}
              </div>
              <span className={`text-xs font-medium ${phaseColors.text}`}>
                {phaseDisplay.label}
              </span>
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (variant === "compact") {
    return (
      <article onClick={onClick} className="group cursor-pointer py-3 border-b border-edge last:border-0">
        <div className="flex items-start gap-3">
          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${phaseColors.bg} ${phaseColors.border} border`} />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-content group-hover:text-content transition-colors line-clamp-1">
              {thread.name}
            </h4>
            <div className="flex items-center gap-2 text-xs text-content-secondary mt-0.5">
              <span>{phaseDisplay.label}</span>
              <span>·</span>
              <span>{thread.eventCount} events</span>
              <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </article>
    );
  }

  // Standard variant
  return (
    <article onClick={onClick} className="group cursor-pointer">
      <div className="space-y-2">
        {/* Category */}
        <span className={`flex items-center gap-1 text-xs font-medium ${phaseColors.text}`}>
          {phaseDisplay.icon}
          {phaseDisplay.label}
        </span>

        {/* Headline */}
        <h4 className="text-lg font-semibold text-content leading-snug group-hover:text-content transition-colors line-clamp-2">
          {thread.name}
        </h4>

        {/* Thesis */}
        <p className="text-sm text-content-secondary leading-relaxed line-clamp-2 font-normal">
          {thread.thesis}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-content-muted pt-1">
          <span>{thread.eventCount} events</span>
          <span>{formatTimeAgo(thread.latestEventAt)}</span>
          <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </article>
  );
}

export default NarrativeCard;

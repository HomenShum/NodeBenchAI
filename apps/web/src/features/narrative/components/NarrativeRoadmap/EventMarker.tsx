"use client";

/**
 * EventMarker - Interactive Event Indicator
 *
 * Displays a single narrative event as a dot/marker with:
 * - Size based on significance
 * - Color coding for event type
 * - Tooltip with details and citations
 * - Click interaction
 *
 * @module features/narrative/components/NarrativeRoadmap/EventMarker
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ExternalLink,
  CheckCircle,
  XCircle,
} from "lucide-react";
import type { NarrativeEvent, EventSignificance } from "../../types";
import { SIGNIFICANCE_COLORS } from "../../types";
import { useMotionConfig } from "@/lib/motion";

interface EventMarkerProps {
  event: NarrativeEvent;
  onClick?: () => void;
  showTooltip?: boolean;
}

/**
 * Get marker size based on significance
 */
function getMarkerSize(significance: EventSignificance): string {
  switch (significance) {
    case "minor":
      return "w-2 h-2";
    case "moderate":
      return "w-3 h-3";
    case "major":
      return "w-3.5 h-3.5";
    case "plot_twist":
      return "w-4 h-4";
  }
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * EventMarker Component
 */
export function EventMarker({
  event,
  onClick,
  showTooltip = true,
}: EventMarkerProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { instant, transition } = useMotionConfig();
  const colors = SIGNIFICANCE_COLORS[event.significance];
  const size = getMarkerSize(event.significance);

  const isPlotTwist = event.significance === "plot_twist";

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Marker */}
      <motion.button
        type="button"
        onClick={onClick}
        className={`
          ${size} rounded-full ${colors.bg}
          ring-2 ${colors.ring}
          cursor-pointer transition-transform
          hover:scale-125 focus:outline-none focus:ring-offset-1
          ${isPlotTwist ? "motion-safe:animate-pulse" : ""}
        `}
        whileHover={!instant ? { scale: 1.2 } : undefined}
        whileTap={!instant ? { scale: 0.9 } : undefined}
        title={event.headline}
      >
        {isPlotTwist && (
          <AlertTriangle className="w-full h-full text-white p-0.5" />
        )}
      </motion.button>

      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && isHovered && (
          <motion.div
            initial={{ opacity: 0, y: instant ? 0 : 5, scale: instant ? 1 : 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: instant ? 0 : 5, scale: instant ? 1 : 0.95 }}
            transition={transition(0.15)}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 pointer-events-none"
          >
            <div className="bg-content text-white rounded-lg shadow-xl p-3 text-xs">
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    {event.significance === "plot_twist" && (
                      <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                    )}
                    <span className={`
                      text-xs font-medium
                      ${event.significance === "plot_twist" ? "text-red-400" :
                        event.significance === "major" ? "text-purple-400" :
                        event.significance === "moderate" ? "text-blue-400" :
                        "text-content-muted"}
                    `}>
                      {event.significance.replace("_", " ")}
                    </span>
                  </div>
                  <h4 className="font-semibold leading-tight text-white/95">
                    {event.headline}
                  </h4>
                </div>
                <div className="flex items-center gap-1 text-content-muted flex-shrink-0">
                  {event.isVerified ? (
                    <CheckCircle className="w-3 h-3 text-indigo-400" aria-label="Verified" />
                  ) : (
                    <XCircle className="w-3 h-3 text-content-secondary" aria-label="Unverified" />
                  )}
                </div>
              </div>

              {/* Summary */}
              <p className="text-content-muted leading-relaxed mb-2 line-clamp-3">
                {event.summary}
              </p>

              {/* Meta */}
              <div className="flex items-center justify-between text-content-muted pt-2 border-t border-edge">
                <span>{formatRelativeTime(event.occurredAt)}</span>
                <span>{event.sourceUrls.length} source{event.sourceUrls.length !== 1 ? "s" : ""}</span>
              </div>

              {/* Sources Preview */}
              {event.sourceNames.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {event.sourceNames.slice(0, 3).map((name, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-content/80 rounded text-xs text-content-muted"
                    >
                      {name}
                    </span>
                  ))}
                  {event.sourceNames.length > 3 && (
                    <span className="px-1.5 py-0.5 text-xs text-content-secondary">
                      +{event.sourceNames.length - 3} more
                    </span>
                  )}
                </div>
              )}

              {/* Contradiction Warning */}
              {event.hasContradictions && (
                <div className="flex items-center gap-1 mt-2 text-amber-400 text-xs">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Contains contradicting information</span>
                </div>
              )}

              {/* Tooltip Arrow */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                <div className="border-8 border-transparent border-t-content" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default EventMarker;

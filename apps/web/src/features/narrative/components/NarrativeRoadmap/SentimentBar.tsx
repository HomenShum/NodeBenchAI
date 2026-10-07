"use client";

/**
 * SentimentBar - Weekly Sentiment Visualization
 *
 * Displays sentiment trends as a colored bar beneath thread lanes.
 *
 * @module features/narrative/components/NarrativeRoadmap/SentimentBar
 */

import React from "react";
import { motion } from "framer-motion";
import type { SentimentDataPoint, SentimentLevel, WeekColumn } from "../../types";
import { SENTIMENT_COLORS } from "../../types";
import { useMotionConfig } from "@/lib/motion";

interface SentimentBarProps {
  weekColumns: WeekColumn[];
  sentimentData: Map<string, SentimentDataPoint>;
  height?: number;
}

/**
 * Get sentiment indicator
 */
function getSentimentIndicator(sentiment: SentimentLevel): string {
  switch (sentiment) {
    case "very_negative":
      return "↓↓";
    case "negative":
      return "↓";
    case "neutral":
      return "—";
    case "positive":
      return "↑";
    case "very_positive":
      return "↑↑";
  }
}

/**
 * SentimentBar Component
 */
export function SentimentBar({
  weekColumns,
  sentimentData,
  height = 4,
}: SentimentBarProps) {
  const { instant, transition } = useMotionConfig();

  return (
    <div className="flex">
      {/* Empty space for thread column */}
      <div className="w-48 flex-shrink-0 border-r border-edge" />

      {/* Sentiment segments for each week */}
      {weekColumns.map((week, index) => {
        const data = sentimentData.get(week.weekNumber);
        const sentimentColor = data
          ? SENTIMENT_COLORS[data.sentiment]
          : "bg-surface-secondary";
        const indicator = data ? getSentimentIndicator(data.sentiment) : null;

        return (
          <div
            key={week.weekNumber}
            className={`w-24 flex-shrink-0 border-r border-edge relative group ${
              week.isCurrent ? "bg-blue-50/20" : ""
            }`}
          >
            {/* Sentiment bar */}
            <motion.div
              initial={{ scaleY: instant ? 1 : 0 }}
              animate={{ scaleY: 1 }}
              transition={transition({ delay: index * 0.02 })}
              className={`h-${height} ${sentimentColor} origin-bottom`}
              style={{ height: `${height}px` }}
            />

            {/* Tooltip on hover */}
            {data && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  <span className="font-medium">{indicator}</span>
                  <span className="ml-1">{data.sentiment.replace("_", " ")}</span>
                  {data.delta !== 0 && (
                    <span className={`ml-1 ${data.delta > 0 ? "text-indigo-400" : "text-red-400"}`}>
                      ({data.delta > 0 ? "+" : ""}{(data.delta * 100).toFixed(0)}%)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default SentimentBar;

"use client";

/**
 * NarrativeRoadmap - PM-style Timeline Visualization
 *
 * A horizontal timeline showing narrative threads as lanes with
 * event markers, sentiment bands, and phase indicators.
 *
 * Features:
 * - Horizontal week columns (configurable, default 12 weeks)
 * - Thread lanes with phase coloring
 * - Event markers sized by significance
 * - Plot twist highlights
 * - Expandable thread details
 * - Citation tooltips
 *
 * @module features/narrative/components/NarrativeRoadmap
 */

import React, { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  Filter,
} from "lucide-react";
import { useNarrativeThreads } from "../../hooks/useNarrativeThreads";
import { useTimelineEvents, generateWeekColumns } from "../../hooks/useNarrativeEvents";
import type {
  NarrativeThread,
  NarrativeEvent,
  NarrativeRoadmapProps,
  WeekColumn,
  ThreadPhase,
} from "../../types";
import { PHASE_COLORS, SIGNIFICANCE_COLORS } from "../../types";
import ThreadLane from "./ThreadLane";
import EventMarker from "./EventMarker";

/**
 * NarrativeRoadmap Component
 */
export function NarrativeRoadmap({
  userId,
  entityKeys,
  weekCount = 12,
  onThreadClick,
  onEventClick,
  className = "",
}: NarrativeRoadmapProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<ThreadPhase | "all">("all");

  // Fetch threads
  const { threads, isLoading: threadsLoading } = useNarrativeThreads({
    entityKey: entityKeys?.[0],
    includePublic: true,
    limit: 20,
  });

  // Generate week columns
  const weekColumns = useMemo(() => generateWeekColumns(weekCount), [weekCount]);

  // Fetch timeline events
  const { eventsByThreadAndWeek, isLoading: eventsLoading } = useTimelineEvents(
    threads.map((t) => t._id),
    weekCount
  );

  // Filter threads by phase
  const filteredThreads = useMemo(() => {
    if (phaseFilter === "all") return threads;
    return threads.filter((t) => t.currentPhase === phaseFilter);
  }, [threads, phaseFilter]);

  // Scroll handlers
  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 300;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  // Toggle thread expansion
  const toggleExpand = (threadId: string) => {
    setExpandedThreadId((prev) => (prev === threadId ? null : threadId));
  };

  const isLoading = threadsLoading || eventsLoading;

  if (isLoading) {
    return (
      <div className={`bg-background rounded-lg border border-edge p-8 ${className}`}>
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-edge dark:border-white/[0.12] border-t-gray-700 dark:border-t-gray-300 rounded-full motion-safe:animate-spin mx-auto mb-4" />
            <p className="text-content-secondary text-sm font-normal">Loading stories...</p>
          </div>
        </div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className={`bg-[#FAFAFA] rounded-lg border border-edge p-8 ${className}`}>
        <div className="text-center">
          <Sparkles className="w-12 h-12 text-content-muted mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-content mb-2">
            No stories yet
          </h3>
          <p className="text-content-secondary text-sm font-normal max-w-md mx-auto">
            Start tracking topics to build evolving story threads.
            New developments are discovered weekly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#FAFAFA] dark:bg-white/[0.01] rounded-lg border border-edge overflow-hidden ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-edge">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-content-secondary" />
            <div>
              <h2 className="text-lg font-bold text-content">
                Story Timeline
              </h2>
              <p className="text-xs text-content-secondary font-normal">
                {threads.length} threads · {weekCount} weeks
              </p>
            </div>
          </div>

          {/* Phase Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-content-muted" />
            <div className="flex gap-1">
              {(["all", "emerging", "escalating", "climax", "resolution", "dormant"] as const).map(
                (phase) => (
                  <button
                    key={phase}
                    type="button"
                    onClick={() => setPhaseFilter(phase)}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${phaseFilter === phase
                        ? "bg-gray-900 dark:bg-white/[0.15] text-white"
                        : "text-content-secondary hover:bg-surface-hover"
                      }`}
                  >
                    {phase === "all" ? "All" : phase.charAt(0).toUpperCase() + phase.slice(1)}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Container */}
      <div className="relative">
        {/* Scroll buttons */}
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-surface/90 dark:bg-white/[0.08] shadow-md hover:bg-surface dark:hover:bg-white/[0.12] transition-colors"
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-4 h-4 text-content-secondary" />
        </button>
        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-surface/90 dark:bg-white/[0.08] shadow-md hover:bg-surface dark:hover:bg-white/[0.12] transition-colors"
          aria-label="Scroll right"
        >
          <ChevronRight className="w-4 h-4 text-content-secondary" />
        </button>

        {/* Scrollable content */}
        <div
          ref={scrollContainerRef}
          className="overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none]"
        >
          <div className="min-w-max">
            {/* Week Headers */}
            <div className="flex border-b border-edge bg-gray-50/50">
              {/* Thread name column */}
              <div className="w-48 flex-shrink-0 px-4 py-3 border-r border-edge">
                <span className="text-xs font-medium text-content-secondary">
                  Threads
                </span>
              </div>
              {/* Week columns */}
              {weekColumns.map((week) => (
                <div
                  key={week.weekNumber}
                  className={`w-24 flex-shrink-0 px-2 py-3 text-center border-r border-edge ${week.isCurrent ? "bg-blue-50/50 dark:bg-blue-500/[0.06]" : ""
                    }`}
                >
                  <div className="text-xs font-medium text-content-secondary">{week.label}</div>
                  <div className="text-xs text-content-muted">{week.weekNumber}</div>
                </div>
              ))}
            </div>

            {/* Thread Lanes */}
            <AnimatePresence>
              {filteredThreads.map((thread, index) => {
                const threadEvents = eventsByThreadAndWeek.get(thread._id as string);
                const isExpanded = expandedThreadId === thread._id;

                return (
                  <ThreadLane
                    key={thread._id}
                    thread={thread}
                    weekColumns={weekColumns}
                    eventsByWeek={threadEvents || new Map()}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleExpand(thread._id)}
                    onThreadClick={onThreadClick}
                    onEventClick={onEventClick}
                    index={index}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="px-6 py-3 border-t border-edge bg-gray-50/30 dark:bg-white/[0.01]">
        <div className="flex items-center justify-between text-xs text-content-secondary">
          <div className="flex items-center gap-4">
            <span className="font-medium">Event Significance:</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-300" /> Minor
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-blue-400" /> Moderate
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-3.5 rounded-full bg-purple-500" /> Major
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> Plot Twist
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-medium">Phase:</span>
            {(["emerging", "escalating", "climax", "resolution"] as ThreadPhase[]).map((phase) => (
              <span key={phase} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase].bg} ${PHASE_COLORS[phase].border} border`} />
                {phase.charAt(0).toUpperCase() + phase.slice(1)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NarrativeRoadmap;
